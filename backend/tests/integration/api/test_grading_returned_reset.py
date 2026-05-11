"""Integration tests — issue #676 Phase 2 RETURNED reset.

When a teacher returns a student's assignment for revision (single or
batch flow), every per-item AI analysis count must reset to 0 so the
student gets a fresh allotment of attempts. Already-passed items still
get the reset; the teacher_passed=True gate in the speech endpoint
prevents the student from spending the freshly-returned attempts on
those items. Two-rule design — one rule per call site.
"""

from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from auth import create_access_token, get_password_hash
from models import (
    Assignment,
    AssignmentContent,
    AssignmentStatus,
    Classroom,
    ClassroomStudent,
    Content,
    ContentItem,
    Lesson,
    Program,
    Student,
    StudentAssignment,
    StudentItemProgress,
    Teacher,
)


# ---------- Fixtures ----------


@pytest.fixture
def teacher(shared_test_session: Session):
    t = Teacher(
        email="reset-teacher@test.com",
        name="Reset Teacher",
        password_hash=get_password_hash("password123"),
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


@pytest.fixture
def teacher_headers(teacher: Teacher):
    token = create_access_token(data={"sub": str(teacher.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def returned_reset_setup(shared_test_session: Session, teacher: Teacher):
    """Build a classroom + 2 students + assignment with 3 items each, where
    every item's ai_analysis_count is non-zero (3, 2, 1) to make the reset
    observable per-item.
    """
    classroom = Classroom(name="ResetClassroom", teacher_id=teacher.id)
    shared_test_session.add(classroom)
    shared_test_session.commit()

    students = []
    for i in range(2):
        s = Student(
            email=f"reset-student-{i}@test.com",
            name=f"Reset Student {i}",
            password_hash=get_password_hash("password123"),
            birthdate=date(2010, 1, 1),
            is_active=True,
            email_verified=True,
        )
        shared_test_session.add(s)
        shared_test_session.commit()
        shared_test_session.add(
            ClassroomStudent(classroom_id=classroom.id, student_id=s.id)
        )
        students.append(s)
    shared_test_session.commit()

    program = Program(
        name="Reset Program", teacher_id=teacher.id, classroom_id=classroom.id
    )
    shared_test_session.add(program)
    shared_test_session.commit()
    lesson = Lesson(program_id=program.id, name="Reset Lesson")
    shared_test_session.add(lesson)
    shared_test_session.commit()

    content = Content(
        lesson_id=lesson.id, title="Reset Content", type="reading_assessment"
    )
    shared_test_session.add(content)
    shared_test_session.commit()

    items = []
    for i in range(3):
        item = ContentItem(
            content_id=content.id,
            order_index=i,
            text=f"item {i}",
            translation=f"中譯 {i}",
        )
        shared_test_session.add(item)
        items.append(item)
    shared_test_session.commit()
    for item in items:
        shared_test_session.refresh(item)

    assignment = Assignment(
        title="Reset Assignment",
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        due_date=datetime.now(timezone.utc),
    )
    shared_test_session.add(assignment)
    shared_test_session.commit()
    shared_test_session.add(
        AssignmentContent(assignment_id=assignment.id, content_id=content.id)
    )
    shared_test_session.commit()

    student_assignments = []
    for s in students:
        sa = StudentAssignment(
            assignment_id=assignment.id,
            student_id=s.id,
            classroom_id=classroom.id,
            title=assignment.title,
            due_date=assignment.due_date,
            status=AssignmentStatus.SUBMITTED,
            score=85.0,
        )
        shared_test_session.add(sa)
        shared_test_session.commit()
        shared_test_session.refresh(sa)
        student_assignments.append(sa)

    # Seed item progress: counts 3 / 2 / 1 across the 3 items so we can
    # tell the difference between "reset all" and "reset some".
    counts = [3, 2, 1]
    for sa in student_assignments:
        for item, count in zip(items, counts):
            shared_test_session.add(
                StudentItemProgress(
                    student_assignment_id=sa.id,
                    content_item_id=item.id,
                    status="SUBMITTED",
                    ai_analysis_count=count,
                    attempts=count,
                )
            )
    shared_test_session.commit()

    return {
        "teacher": teacher,
        "classroom": classroom,
        "students": students,
        "assignment": assignment,
        "student_assignments": student_assignments,
        "items": items,
    }


# ---------- Helpers ----------


def _all_counts(db: Session, sa_id: int) -> list[int]:
    rows = (
        db.query(StudentItemProgress)
        .filter(StudentItemProgress.student_assignment_id == sa_id)
        .order_by(StudentItemProgress.content_item_id)
        .all()
    )
    return [int(r.ai_analysis_count or 0) for r in rows]


def _all_attempts(db: Session, sa_id: int) -> list[int]:
    """Sanity check: legacy `attempts` field must NOT be touched by reset."""
    rows = (
        db.query(StudentItemProgress)
        .filter(StudentItemProgress.student_assignment_id == sa_id)
        .order_by(StudentItemProgress.content_item_id)
        .all()
    )
    return [int(r.attempts or 0) for r in rows]


# ---------- Single-student return-for-revision ----------


class TestSingleReturnForRevisionResetsCount:
    def test_resets_all_items_to_zero(
        self,
        test_client: TestClient,
        shared_test_session: Session,
        returned_reset_setup,
        teacher_headers,
    ):
        sa = returned_reset_setup["student_assignments"][0]
        student = returned_reset_setup["students"][0]
        assignment = returned_reset_setup["assignment"]

        # Sanity: counts start non-zero
        before = _all_counts(shared_test_session, sa.id)
        assert before == [3, 2, 1]

        response = test_client.post(
            f"/api/teachers/assignments/{assignment.id}/return-for-revision",
            json={"student_id": student.id, "message": "please redo"},
            headers=teacher_headers,
        )
        assert response.status_code == 200, response.text

        # Force a fresh read — bypass session caching of the seeded rows.
        shared_test_session.expire_all()
        after = _all_counts(shared_test_session, sa.id)
        assert after == [
            0,
            0,
            0,
        ], f"All ai_analysis_count must reset on RETURNED, got {after}"

    def test_does_not_touch_other_students(
        self,
        test_client: TestClient,
        shared_test_session: Session,
        returned_reset_setup,
        teacher_headers,
    ):
        sa_returned = returned_reset_setup["student_assignments"][0]
        sa_untouched = returned_reset_setup["student_assignments"][1]
        student = returned_reset_setup["students"][0]
        assignment = returned_reset_setup["assignment"]

        response = test_client.post(
            f"/api/teachers/assignments/{assignment.id}/return-for-revision",
            json={"student_id": student.id},
            headers=teacher_headers,
        )
        assert response.status_code == 200

        shared_test_session.expire_all()
        assert _all_counts(shared_test_session, sa_returned.id) == [0, 0, 0]
        assert _all_counts(shared_test_session, sa_untouched.id) == [3, 2, 1]

    def test_does_not_touch_legacy_attempts_field(
        self,
        test_client: TestClient,
        shared_test_session: Session,
        returned_reset_setup,
        teacher_headers,
    ):
        sa = returned_reset_setup["student_assignments"][0]
        student = returned_reset_setup["students"][0]
        assignment = returned_reset_setup["assignment"]

        response = test_client.post(
            f"/api/teachers/assignments/{assignment.id}/return-for-revision",
            json={"student_id": student.id},
            headers=teacher_headers,
        )
        assert response.status_code == 200

        shared_test_session.expire_all()
        # `attempts` is shared with word-selection / rearrangement flows;
        # this PR must leave it alone.
        assert _all_attempts(shared_test_session, sa.id) == [3, 2, 1]


# ---------- Batch finalize-batch-grade flow ----------


class TestBatchFinalizeResetsReturnedStudentsOnly:
    def test_only_returned_decisions_reset(
        self,
        test_client: TestClient,
        shared_test_session: Session,
        returned_reset_setup,
        teacher_headers,
    ):
        students = returned_reset_setup["students"]
        sa_returned = returned_reset_setup["student_assignments"][0]
        sa_graded = returned_reset_setup["student_assignments"][1]
        classroom = returned_reset_setup["classroom"]
        assignment = returned_reset_setup["assignment"]

        response = test_client.post(
            f"/api/teachers/assignments/{assignment.id}/finalize-batch-grade",
            json={
                "classroom_id": classroom.id,
                "teacher_decisions": {
                    str(students[0].id): "RETURNED",
                    str(students[1].id): "GRADED",
                },
            },
            headers=teacher_headers,
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["returned_count"] == 1
        assert body["graded_count"] == 1

        shared_test_session.expire_all()
        # RETURNED student → counts wiped
        assert _all_counts(shared_test_session, sa_returned.id) == [0, 0, 0]
        # GRADED student → counts preserved (no fresh attempts owed)
        assert _all_counts(shared_test_session, sa_graded.id) == [3, 2, 1]
