"""Integration tests for the atomic increment_analysis_count semantics.

The function used to be a pure in-memory mutation; PR #701 hardened it
to an UPDATE ... WHERE count < MAX so two concurrent callers can never
both push the same row past MAX. These tests verify the DB-level
semantics with a real session — the unit-level rule tests for
check_can_analyze stay in tests/unit/test_analysis_quota.py.
"""

from datetime import date, datetime, timezone

import pytest
from sqlalchemy.orm import Session

from auth import get_password_hash
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
from services.analysis_quota import (
    MAX_AI_ANALYSIS_ATTEMPTS,
    increment_analysis_count,
)


@pytest.fixture
def progress_row(shared_test_session: Session):
    """Build the minimum object graph needed for a StudentItemProgress."""
    teacher = Teacher(
        email="atomic-teacher@test.com",
        name="Atomic Teacher",
        password_hash=get_password_hash("password123"),
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(teacher)
    shared_test_session.commit()

    classroom = Classroom(name="AtomicClassroom", teacher_id=teacher.id)
    shared_test_session.add(classroom)
    shared_test_session.commit()

    student = Student(
        email="atomic-student@test.com",
        name="Atomic Student",
        password_hash=get_password_hash("password123"),
        birthdate=date(2010, 1, 1),
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(student)
    shared_test_session.commit()
    shared_test_session.add(
        ClassroomStudent(classroom_id=classroom.id, student_id=student.id)
    )

    program = Program(
        name="Atomic Program", teacher_id=teacher.id, classroom_id=classroom.id
    )
    shared_test_session.add(program)
    shared_test_session.commit()
    lesson = Lesson(program_id=program.id, name="Atomic Lesson")
    shared_test_session.add(lesson)
    shared_test_session.commit()
    content = Content(
        lesson_id=lesson.id, title="Atomic Content", type="reading_assessment"
    )
    shared_test_session.add(content)
    shared_test_session.commit()
    item = ContentItem(
        content_id=content.id,
        order_index=0,
        text="hello",
        translation="哈囉",
    )
    shared_test_session.add(item)
    shared_test_session.commit()

    assignment = Assignment(
        title="Atomic Assignment",
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

    sa = StudentAssignment(
        assignment_id=assignment.id,
        student_id=student.id,
        classroom_id=classroom.id,
        title=assignment.title,
        due_date=assignment.due_date,
        status=AssignmentStatus.IN_PROGRESS,
    )
    shared_test_session.add(sa)
    shared_test_session.commit()

    progress = StudentItemProgress(
        student_assignment_id=sa.id,
        content_item_id=item.id,
        status="IN_PROGRESS",
        ai_analysis_count=0,
    )
    shared_test_session.add(progress)
    shared_test_session.commit()
    shared_test_session.refresh(progress)
    return progress


def _read_back(db: Session, progress_id: int) -> int:
    """Read the count from a fresh expire+query, bypassing identity map."""
    db.expire_all()
    row = (
        db.query(StudentItemProgress)
        .filter(StudentItemProgress.id == progress_id)
        .first()
    )
    return int(row.ai_analysis_count or 0)


class TestIncrementAtomic:
    def test_increments_from_zero(
        self, shared_test_session: Session, progress_row: StudentItemProgress
    ):
        assert progress_row.ai_analysis_count == 0
        result = increment_analysis_count(progress_row, shared_test_session)
        shared_test_session.commit()
        assert result == 1
        # In-memory updated by synchronize_session="fetch"
        assert progress_row.ai_analysis_count == 1
        # DB confirms
        assert _read_back(shared_test_session, progress_row.id) == 1

    def test_increments_to_max(
        self, shared_test_session: Session, progress_row: StudentItemProgress
    ):
        progress_row.ai_analysis_count = 2
        shared_test_session.commit()
        result = increment_analysis_count(progress_row, shared_test_session)
        shared_test_session.commit()
        assert result == MAX_AI_ANALYSIS_ATTEMPTS
        assert progress_row.ai_analysis_count == MAX_AI_ANALYSIS_ATTEMPTS
        assert _read_back(shared_test_session, progress_row.id) == 3

    def test_does_not_increment_when_at_max(
        self, shared_test_session: Session, progress_row: StudentItemProgress
    ):
        progress_row.ai_analysis_count = MAX_AI_ANALYSIS_ATTEMPTS
        shared_test_session.commit()
        result = increment_analysis_count(progress_row, shared_test_session)
        shared_test_session.commit()
        # WHERE count < MAX clause matches 0 rows; in-memory clamped to MAX.
        assert result == MAX_AI_ANALYSIS_ATTEMPTS
        assert progress_row.ai_analysis_count == MAX_AI_ANALYSIS_ATTEMPTS
        assert _read_back(shared_test_session, progress_row.id) == 3

    def test_simulated_concurrent_callers_cannot_exceed_max(
        self, shared_test_session: Session, progress_row: StudentItemProgress
    ):
        """Both callers see count=2 in their pre-fetched object, both call
        increment_analysis_count without committing between. The atomic
        UPDATE ... WHERE count < MAX makes the second call a no-op at the
        DB level — net effect is +1, not +2.
        """
        progress_row.ai_analysis_count = 2
        shared_test_session.commit()

        # Two stale references to the same row, each thinks count=2.
        stale_a = progress_row
        stale_b = (
            shared_test_session.query(StudentItemProgress)
            .filter(StudentItemProgress.id == progress_row.id)
            .first()
        )
        assert stale_a.ai_analysis_count == 2
        assert stale_b.ai_analysis_count == 2

        # First caller wins → DB goes 2 → 3.
        increment_analysis_count(stale_a, shared_test_session)
        # Second caller's UPDATE matches 0 rows because count is now 3.
        increment_analysis_count(stale_b, shared_test_session)
        shared_test_session.commit()

        # Final DB state: 3, not 4.
        assert _read_back(shared_test_session, progress_row.id) == 3
