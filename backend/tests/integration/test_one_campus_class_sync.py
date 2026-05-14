"""
Integration tests for 1Campus class roster sync.

Covers (per issue #635):
- New 1Campus classroom + students fully created
- Existing classroom: name + last_synced_at updated
- Student rename: written to ALL linked students under the same Identity
- 1Campus class disappears: Duotopia classroom is NOT deleted
- Manually-created classroom (no one_campus_class_id): NOT touched
- getClass / getClassStudent failure: SyncResult collects errors but does not raise

The 1Campus jasmine API is mocked; we never hit the real network.
"""

import pytest
from unittest.mock import AsyncMock, patch

from models.classroom import Classroom, ClassroomStudent
from models.user import Identity, Student, Teacher
from services.one_campus_class_sync_service import (
    OneCampusClassSyncService,
    SyncResult,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_teacher(db, name="Teacher A", email="t@example.com") -> Teacher:
    teacher = Teacher(
        name=name,
        email=email,
        password_hash=None,
        has_password=False,
        is_active=True,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    return teacher


def _patch_one_campus_apis(get_class_payload, get_class_student_map):
    """Patch OneCampusService.get_class + get_class_student.

    `get_class_student_map` maps class_id -> response payload (or Exception).
    """

    async def _get_class_student_side_effect(school_dsns, class_id):
        val = get_class_student_map.get(class_id)
        if isinstance(val, Exception):
            raise val
        return val if val is not None else {"class": [{"student": []}]}

    return (
        patch(
            "services.one_campus_class_sync_service.OneCampusService.get_class",
            new_callable=AsyncMock,
            return_value=get_class_payload,
        ),
        patch(
            "services.one_campus_class_sync_service.OneCampusService.get_class_student",
            new_callable=AsyncMock,
            side_effect=_get_class_student_side_effect,
        ),
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestOneCampusClassSyncService:
    @pytest.mark.asyncio
    async def test_creates_new_classrooms_and_students(self, shared_test_session):
        """All-new sync: classrooms + students + ClassroomStudent links created."""
        db = shared_test_session
        teacher = _make_teacher(db)

        get_class_payload = {
            "class": [
                {"classID": "C001", "className": "Class 1A"},
                {"classID": "C002", "className": "Class 1B"},
            ]
        }
        # Real getClassStudent response wraps `student` inside `class[]` —
        # see docs/integrations/1campus-jasmine-api.md.
        get_class_student_map = {
            "C001": {
                "class": [
                    {
                        "student": [
                            {
                                "studentID": "S001",
                                "studentName": "Alice",
                                "studentNumber": "001",
                            },
                            {
                                "studentID": "S002",
                                "studentName": "Bob",
                                "studentNumber": "002",
                            },
                        ]
                    }
                ]
            },
            "C002": {
                "class": [
                    {
                        "student": [
                            {
                                "studentID": "S003",
                                "studentName": "Charlie",
                                "studentNumber": "003",
                            },
                        ]
                    }
                ]
            },
        }

        p_class, p_student = _patch_one_campus_apis(
            get_class_payload, get_class_student_map
        )
        with p_class, p_student:
            result: SyncResult = await OneCampusClassSyncService.sync_school(
                db, school_dsns="my.school", teacher_id=teacher.id
            )

        assert result.classrooms_added == 2
        assert result.students_added == 3
        assert result.classrooms_updated == 0
        assert result.students_updated == 0
        assert result.errors == []

        classrooms = (
            db.query(Classroom)
            .filter(Classroom.one_campus_class_id.isnot(None))
            .order_by(Classroom.one_campus_class_id)
            .all()
        )
        assert len(classrooms) == 2
        assert classrooms[0].name == "Class 1A"
        assert classrooms[0].teacher_id == teacher.id
        assert classrooms[0].one_campus_school_dsns == "my.school"
        assert classrooms[0].last_synced_at is not None

        # ClassroomStudent links
        c1_links = (
            db.query(ClassroomStudent)
            .filter(ClassroomStudent.classroom_id == classrooms[0].id)
            .all()
        )
        assert len(c1_links) == 2

    @pytest.mark.asyncio
    async def test_updates_classroom_name_and_last_synced_at(self, shared_test_session):
        """Existing classroom matched by one_campus_class_id gets renamed + timestamp bumped."""
        db = shared_test_session
        teacher = _make_teacher(db)

        existing = Classroom(
            name="Old Name",
            teacher_id=teacher.id,
            one_campus_class_id="C100",
            one_campus_school_dsns="my.school",
            is_active=True,
        )
        db.add(existing)
        db.commit()

        get_class_payload = {"class": [{"classID": "C100", "className": "New Name"}]}
        p_class, p_student = _patch_one_campus_apis(
            get_class_payload, {"C100": {"class": [{"student": []}]}}
        )
        with p_class, p_student:
            result = await OneCampusClassSyncService.sync_school(
                db, school_dsns="my.school", teacher_id=teacher.id
            )

        assert result.classrooms_updated == 1
        assert result.classrooms_added == 0
        db.refresh(existing)
        assert existing.name == "New Name"
        assert existing.last_synced_at is not None

    @pytest.mark.asyncio
    async def test_renames_all_linked_students_under_same_identity(
        self, shared_test_session
    ):
        """Renaming a 1Campus student updates every Student row under that Identity."""
        db = shared_test_session
        teacher = _make_teacher(db)

        identity = Identity(
            one_campus_student_id="S500",
            email_verified=False,
            is_active=True,
        )
        db.add(identity)
        db.flush()

        # Two linked students under the same identity
        s_primary = Student(
            name="Old Name",
            identity_id=identity.id,
            is_primary_account=True,
            is_active=True,
        )
        s_secondary = Student(
            name="Old Name",
            identity_id=identity.id,
            is_primary_account=False,
            is_active=True,
        )
        db.add_all([s_primary, s_secondary])
        db.commit()

        get_class_payload = {"class": [{"classID": "C001", "className": "X"}]}
        get_class_student_map = {
            "C001": {
                "class": [
                    {"student": [{"studentID": "S500", "studentName": "New Name"}]}
                ]
            }
        }
        p_class, p_student = _patch_one_campus_apis(
            get_class_payload, get_class_student_map
        )
        with p_class, p_student:
            await OneCampusClassSyncService.sync_school(
                db, school_dsns="my.school", teacher_id=teacher.id
            )

        db.refresh(s_primary)
        db.refresh(s_secondary)
        assert s_primary.name == "New Name"
        assert s_secondary.name == "New Name"

    @pytest.mark.asyncio
    async def test_syncs_student_number_when_school_renumbers(
        self, shared_test_session
    ):
        """student_number drift between 1Campus and Duotopia must be corrected.

        Schools sometimes renumber students mid-year. The rename helper used
        to update only `name` and silently leave `student_number` stale.
        Verify both linked students get the new number, and the result
        registers as an update.
        """
        db = shared_test_session
        teacher = _make_teacher(db)

        identity = Identity(
            one_campus_student_id="S700",
            email_verified=False,
            is_active=True,
        )
        db.add(identity)
        db.flush()

        s_primary = Student(
            name="Renumbered Student",
            student_number="001",
            identity_id=identity.id,
            is_primary_account=True,
            is_active=True,
        )
        s_secondary = Student(
            name="Renumbered Student",
            student_number="001",
            identity_id=identity.id,
            is_primary_account=False,
            is_active=True,
        )
        db.add_all([s_primary, s_secondary])
        db.commit()

        get_class_payload = {"class": [{"classID": "C700", "className": "Room 7"}]}
        # Same name as the seeded students, so name comparison is a no-op —
        # the only thing that should change is student_number.
        get_class_student_map = {
            "C700": {
                "class": [
                    {
                        "student": [
                            {
                                "studentID": "S700",
                                "studentName": "Renumbered Student",
                                "studentNumber": "002",
                            }
                        ]
                    }
                ]
            }
        }
        p_class, p_student = _patch_one_campus_apis(
            get_class_payload, get_class_student_map
        )
        with p_class, p_student:
            result = await OneCampusClassSyncService.sync_school(
                db, school_dsns="my.school", teacher_id=teacher.id
            )

        db.refresh(s_primary)
        db.refresh(s_secondary)
        assert s_primary.student_number == "002"
        assert s_secondary.student_number == "002"
        assert result.students_updated == 1

    @pytest.mark.asyncio
    async def test_does_not_delete_disappeared_classrooms(self, shared_test_session):
        """A 1Campus classroom that no longer appears in getClass must NOT be deleted."""
        db = shared_test_session
        teacher = _make_teacher(db)

        ghost = Classroom(
            name="Stale",
            teacher_id=teacher.id,
            one_campus_class_id="C999",
            one_campus_school_dsns="my.school",
            is_active=True,
        )
        db.add(ghost)
        db.commit()
        ghost_id = ghost.id

        get_class_payload = {"class": [{"classID": "C001", "className": "Live class"}]}
        p_class, p_student = _patch_one_campus_apis(
            get_class_payload, {"C001": {"class": [{"student": []}]}}
        )
        with p_class, p_student:
            await OneCampusClassSyncService.sync_school(
                db, school_dsns="my.school", teacher_id=teacher.id
            )

        survivor = db.query(Classroom).filter(Classroom.id == ghost_id).first()
        assert survivor is not None
        assert survivor.name == "Stale"

    @pytest.mark.asyncio
    async def test_does_not_touch_manually_created_classrooms(
        self, shared_test_session
    ):
        """Classrooms with one_campus_class_id IS NULL must be invisible to sync."""
        db = shared_test_session
        teacher = _make_teacher(db)

        manual = Classroom(
            name="Manual",
            teacher_id=teacher.id,
            one_campus_class_id=None,
            is_active=True,
        )
        db.add(manual)
        db.commit()
        manual_id = manual.id

        get_class_payload = {
            "class": [{"classID": "C001", "className": "1Campus class"}]
        }
        p_class, p_student = _patch_one_campus_apis(
            get_class_payload, {"C001": {"class": [{"student": []}]}}
        )
        with p_class, p_student:
            await OneCampusClassSyncService.sync_school(
                db, school_dsns="my.school", teacher_id=teacher.id
            )

        survivor = db.query(Classroom).filter(Classroom.id == manual_id).first()
        assert survivor.name == "Manual"
        assert survivor.one_campus_class_id is None

    @pytest.mark.asyncio
    async def test_get_class_failure_returns_error_not_raise(self, shared_test_session):
        """If getClass blows up, sync_school records the error and returns gracefully."""
        db = shared_test_session
        teacher = _make_teacher(db)

        with patch(
            "services.one_campus_class_sync_service.OneCampusService.get_class",
            new_callable=AsyncMock,
            side_effect=RuntimeError("upstream 500"),
        ):
            result = await OneCampusClassSyncService.sync_school(
                db, school_dsns="my.school", teacher_id=teacher.id
            )

        assert result.classrooms_added == 0
        assert any("upstream 500" in e for e in result.errors)

    @pytest.mark.asyncio
    async def test_get_class_student_failure_records_error_per_class(
        self, shared_test_session
    ):
        """If getClassStudent fails for one class, the rest still sync."""
        db = shared_test_session
        teacher = _make_teacher(db)

        get_class_payload = {
            "class": [
                {"classID": "C001", "className": "Alpha"},
                {"classID": "C002", "className": "Beta"},
            ]
        }
        get_class_student_map = {
            "C001": RuntimeError("class 001 timeout"),
            "C002": {
                "class": [{"student": [{"studentID": "S010", "studentName": "Zoe"}]}]
            },
        }
        p_class, p_student = _patch_one_campus_apis(
            get_class_payload, get_class_student_map
        )
        with p_class, p_student:
            result = await OneCampusClassSyncService.sync_school(
                db, school_dsns="my.school", teacher_id=teacher.id
            )

        assert result.classrooms_added == 2
        assert result.students_added == 1
        assert any("C001" in e for e in result.errors)
