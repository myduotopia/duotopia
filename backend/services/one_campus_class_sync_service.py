"""1Campus class roster sync.

Syncs the entire roster of classes + students for a school from the 1Campus
jasmine API into Duotopia. Designed for #635.

Behaviour rules (locked by the issue spec):
- Single-teacher classrooms only (one teacher_id per Classroom).
- Match strategy:
    * Classroom: WHERE one_campus_class_id = ?  (NULL = manual, never touched)
    * Student:   WHERE Identity.one_campus_student_id = ?  (rename writes to ALL
                 linked Students under that Identity)
- Strictly additive: classrooms / students that disappear from 1Campus stay
  in Duotopia (we never delete; learning records must be preserved).
- Failure-tolerant: API errors are collected into SyncResult.errors instead
  of raising, so a partial sync still commits useful work.

Expected upstream JSON shape (verified against the real jasmine API; see
docs/integrations/1campus-jasmine-api.md):

    get_class:           {"class": [{"classID": 0, "className": "..."}, ...]}
    get_class_student:   {"class": [{"student": [{"studentID": 0,
                                                  "studentName": "...",
                                                  "studentNumber": "..."},
                                                 ...]},
                                    ...]}
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.classroom import Classroom, ClassroomStudent
from models.user import Identity, Student
from services.one_campus_service import OneCampusService

logger = logging.getLogger(__name__)


@dataclass
class SyncResult:
    classrooms_added: int = 0
    classrooms_updated: int = 0
    students_added: int = 0
    students_updated: int = 0
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "classrooms_added": self.classrooms_added,
            "classrooms_updated": self.classrooms_updated,
            "students_added": self.students_added,
            "students_updated": self.students_updated,
            "errors": list(self.errors),
        }


# Hold strong references to in-flight background tasks. asyncio only keeps
# weak references to tasks created via create_task, so a GC cycle between
# awaits can silently cancel them mid-run. Tasks remove themselves on done.
_live_background_tasks: "set[asyncio.Task]" = set()


def schedule_background_sync(
    school_dsns: str, teacher_id: int, teacher_acc: Optional[str] = None
) -> None:
    """Fire-and-forget background sync for a single school.

    Used by the OAuth login paths so that returning the access token isn't
    blocked on syncing the teacher's roster. The task uses its own DB session
    (the request's session would close when the response returns) and
    swallows all exceptions — login must not break when 1Campus is misbehaving.
    """
    try:
        task = asyncio.create_task(
            _run_sync_in_background(school_dsns, teacher_id, teacher_acc)
        )
    except RuntimeError:
        # No running event loop (rare — e.g. when called from sync code).
        # Skip rather than crash: the manual sync button is the recovery path.
        logger.warning(
            "No running event loop for background 1Campus sync "
            "(school=%s, teacher=%s); skipping",
            school_dsns,
            teacher_id,
        )
        return

    _live_background_tasks.add(task)
    task.add_done_callback(_live_background_tasks.discard)


async def _run_sync_in_background(
    school_dsns: str, teacher_id: int, teacher_acc: Optional[str]
) -> None:
    """Run the sync with a fresh DB session, logging exceptions."""
    # Late import to avoid a circular-import chain at module-load time.
    from database import SessionLocal

    db = SessionLocal()
    try:
        result = await OneCampusClassSyncService.sync_school(
            db, school_dsns, teacher_id, teacher_acc=teacher_acc
        )
        logger.info(
            "Background 1Campus sync done (school=%s, teacher=%s): %s",
            school_dsns,
            teacher_id,
            result.to_dict(),
        )
    except Exception as e:
        logger.exception(
            "Background 1Campus sync crashed (school=%s, teacher=%s): %s",
            school_dsns,
            teacher_id,
            e,
        )
    finally:
        try:
            db.close()
        except Exception:
            pass


def collect_teacher_school_dsns(user_role_data: dict) -> list[str]:
    """Pick out unique schoolDsns values where the user has a teacherRole.

    Used by both the manual-sync endpoint and the OAuth login flow to decide
    which schools' rosters to sync. Order is preserved to keep the per-school
    work deterministic across calls; duplicates (a teacher listed twice for
    the same DSNS) are dropped.
    """
    result: list[str] = []
    for school in user_role_data.get("school", []) or []:
        if school.get("teacherRole"):
            dsns = school.get("schoolDsns")
            if dsns and dsns not in result:
                result.append(dsns)
            elif not dsns:
                # Surface this when triaging "teacher synced 0 classes"
                # tickets — the upstream payload had a teacherRole but no
                # schoolDsns, which is unusual.
                logger.debug(
                    "Skipping school with teacherRole but no schoolDsns: %r",
                    school,
                )
    return result


class OneCampusClassSyncService:
    @staticmethod
    async def sync_school(
        db: Session,
        school_dsns: str,
        teacher_id: int,
        teacher_acc: Optional[str] = None,
    ) -> SyncResult:
        """Sync the classes + students this teacher is responsible for in one school.

        teacher_acc is the teacher's 1Campus account email. When provided, the
        upstream `getClass` call filters to only the classes where the teacher
        is homeroom (班導) or co-homeroom (副班導). Without it the API would
        return *every* class in the school and we'd mis-assign other teachers'
        classes to this user — so callers should always supply it.
        """
        result = SyncResult()
        now = datetime.now(timezone.utc)

        try:
            classes_data = await OneCampusService.get_class(
                school_dsns, teacher_acc=teacher_acc
            )
        except Exception as e:
            msg = f"getClass failed for {school_dsns}: {e}"
            logger.warning(msg)
            result.errors.append(msg)
            return result

        classes = classes_data.get("class") or []

        for cls in classes:
            class_id = str(cls.get("classID") or "").strip()
            class_name = (cls.get("className") or "").strip()
            if not class_id:
                continue

            try:
                classroom, created = _upsert_classroom(
                    db, class_id, class_name, school_dsns, teacher_id, now
                )
                if created:
                    result.classrooms_added += 1
                else:
                    result.classrooms_updated += 1
            except Exception as e:
                msg = f"upsert classroom {class_id}: {e}"
                logger.exception(msg)
                result.errors.append(msg)
                continue

            try:
                students_data = await OneCampusService.get_class_student(
                    school_dsns, class_id
                )
            except Exception as e:
                msg = f"getClassStudent failed for class {class_id}: {e}"
                logger.warning(msg)
                result.errors.append(msg)
                continue

            # getClassStudent returns {"class": [{"student": [...]}]} — the
            # student list is nested one level inside a `class` array. With a
            # specific classID we expect exactly one class object, but iterate
            # defensively in case the API returns more.
            students = []
            for cls_in_resp in students_data.get("class") or []:
                students.extend(cls_in_resp.get("student") or [])

            for stu in students:
                try:
                    student, student_created, student_renamed = _upsert_student(db, stu)
                    if student_created:
                        result.students_added += 1
                    elif student_renamed:
                        result.students_updated += 1
                    if student is not None:
                        _ensure_classroom_student_link(db, classroom.id, student.id)
                except Exception as e:
                    sid = stu.get("studentID")
                    msg = f"upsert student {sid} in class {class_id}: {e}"
                    logger.exception(msg)
                    result.errors.append(msg)

        try:
            db.commit()
        except Exception as e:
            db.rollback()
            msg = f"commit failed: {e}"
            logger.exception(msg)
            result.errors.append(msg)

        return result


# ---------------------------------------------------------------------------
# Internal helpers (module-private)
# ---------------------------------------------------------------------------


def _upsert_classroom(
    db: Session,
    class_id: str,
    class_name: str,
    school_dsns: str,
    teacher_id: int,
    now: datetime,
) -> tuple[Classroom, bool]:
    classroom = (
        db.query(Classroom).filter(Classroom.one_campus_class_id == class_id).first()
    )
    if classroom is None:
        classroom = Classroom(
            name=class_name or class_id,
            teacher_id=teacher_id,
            one_campus_class_id=class_id,
            one_campus_school_dsns=school_dsns,
            last_synced_at=now,
            is_active=True,
        )
        db.add(classroom)
        db.flush()
        return classroom, True

    if class_name and classroom.name != class_name:
        classroom.name = class_name
    classroom.one_campus_school_dsns = school_dsns
    classroom.last_synced_at = now
    # Do NOT overwrite teacher_id on existing classrooms — first-teacher
    # ownership wins (single-teacher schema, per #635 scope decision).
    return classroom, False


def _upsert_student(db: Session, stu: dict) -> tuple[Student, bool, bool]:
    """Upsert Identity + Student.

    Returns (student, created, renamed) where:
      - created: a brand-new Student row was inserted
      - renamed: an existing Student.name (or any linked Student.name) was
                 changed to the incoming name
    """
    one_campus_student_id = str(stu.get("studentID") or "").strip()
    student_name = (stu.get("studentName") or "").strip()
    student_number = stu.get("studentNumber")

    if not one_campus_student_id:
        raise ValueError("studentID missing from 1Campus payload")

    identity: Optional[Identity] = (
        db.query(Identity)
        .filter(
            Identity.one_campus_student_id == one_campus_student_id,
            Identity.is_active.is_(True),
        )
        .first()
    )

    if identity is None:
        try:
            # Issue #730: isolate the INSERT in a SAVEPOINT so a unique-constraint
            # conflict (a concurrent sync inserted the same one_campus_student_id
            # first) rolls back only this insert, not the whole batch transaction.
            with db.begin_nested():
                identity = Identity(
                    one_campus_student_id=one_campus_student_id,
                    email_verified=False,
                    is_active=True,
                )
                db.add(identity)
                db.flush()
        except IntegrityError:
            # The concurrent sync won the race. Re-read the existing row (ignore
            # is_active so a previously soft-deleted identity is reused and
            # reactivated) and fall through to the existing-identity update path.
            identity = (
                db.query(Identity)
                .filter(Identity.one_campus_student_id == one_campus_student_id)
                .first()
            )
            if identity is None:
                raise
            if not identity.is_active:
                identity.is_active = True
        else:
            student = Student(
                name=student_name or one_campus_student_id,
                student_number=student_number,
                password_hash=None,
                identity_id=identity.id,
                is_primary_account=True,
                is_active=True,
            )
            db.add(student)
            db.flush()
            return student, True, False

    linked_students = (
        db.query(Student)
        .filter(
            Student.identity_id == identity.id,
            Student.is_active.is_(True),
        )
        .all()
    )

    renamed = False
    if student_name:
        for s in linked_students:
            if s.name != student_name:
                s.name = student_name
                renamed = True
    # Schools sometimes renumber students mid-year. Without this, Duotopia
    # student_number drifts from 1Campus indefinitely.
    if student_number:
        for s in linked_students:
            if s.student_number != student_number:
                s.student_number = student_number
                renamed = True

    primary = next(
        (s for s in linked_students if getattr(s, "is_primary_account", False)),
        linked_students[0] if linked_students else None,
    )

    if primary is None:
        # Identity exists with no active student — rare edge case, create one.
        primary = Student(
            name=student_name or one_campus_student_id,
            student_number=student_number,
            password_hash=None,
            identity_id=identity.id,
            is_primary_account=True,
            is_active=True,
        )
        db.add(primary)
        db.flush()
        return primary, True, False

    return primary, False, renamed


def _ensure_classroom_student_link(
    db: Session, classroom_id: int, student_id: int
) -> None:
    existing = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.student_id == student_id,
        )
        .first()
    )
    if existing is None:
        db.add(
            ClassroomStudent(
                classroom_id=classroom_id,
                student_id=student_id,
                is_active=True,
            )
        )
        db.flush()
