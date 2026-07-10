"""
Unit tests for Assignment system models
Tests model relationships, constraints, and behaviors
"""

import pytest
from datetime import datetime, timedelta  # noqa: F401
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base
from models import (
    Assignment,
    AssignmentContent,
    StudentAssignment,
    StudentContentProgress,
    Teacher,
    Student,
    Classroom,
    Content,
    ContentItem,
    Lesson,
    Program,
    AssignmentStatus,
    ContentType,
)


@pytest.fixture
def db_session():
    """Create an in-memory SQLite database for testing"""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture
def sample_teacher(db_session):
    """Create a sample teacher"""
    teacher = Teacher(
        email="test@example.com", password_hash="hashed_password", name="Test Teacher"
    )
    db_session.add(teacher)
    db_session.commit()
    return teacher


@pytest.fixture
def sample_classroom(db_session, sample_teacher):
    """Create a sample classroom"""
    classroom = Classroom(
        name="Test Classroom",
        teacher_id=sample_teacher.id,
        description="Test classroom for unit tests",
    )
    db_session.add(classroom)
    db_session.commit()
    return classroom


@pytest.fixture
def sample_student(db_session):
    """Create a sample student"""
    from datetime import date

    student = Student(
        name="Test Student",
        email="student@example.com",
        password_hash="hashed_password",
        birthdate=date(2010, 1, 1),
    )
    db_session.add(student)
    db_session.commit()
    return student


@pytest.fixture
def sample_program(db_session, sample_teacher, sample_classroom):
    """Create a sample program"""
    program = Program(
        name="Test Program",
        teacher_id=sample_teacher.id,
        classroom_id=sample_classroom.id,
        description="Test program for unit tests",
    )
    db_session.add(program)
    db_session.commit()
    return program


@pytest.fixture
def sample_lesson(db_session, sample_program):
    """Create a sample lesson"""
    lesson = Lesson(
        program_id=sample_program.id,
        name="Test Lesson",
        description="Test lesson for unit tests",
    )
    db_session.add(lesson)
    db_session.commit()
    return lesson


@pytest.fixture
def sample_content(db_session, sample_lesson):
    """Create a sample content"""
    content = Content(
        lesson_id=sample_lesson.id,
        type=ContentType.EXAMPLE_SENTENCES,
        title="Test Content",
        content_items=[
            ContentItem(order_index=0, text="Hello", translation="你好"),
            ContentItem(order_index=1, text="World", translation="世界"),
        ],
    )
    db_session.add(content)
    db_session.commit()
    return content


class TestAssignmentModel:
    def test_create_assignment(self, db_session, sample_teacher, sample_classroom):
        """Test creating a new assignment"""
        assignment = Assignment(
            title="Test Assignment",
            description="Test description",
            classroom_id=sample_classroom.id,
            teacher_id=sample_teacher.id,
            due_date=datetime.utcnow() + timedelta(days=7),
        )
        db_session.add(assignment)
        db_session.commit()

        assert assignment.id is not None
        assert assignment.title == "Test Assignment"
        assert assignment.is_active is True
        assert assignment.classroom_id == sample_classroom.id
        assert assignment.teacher_id == sample_teacher.id

    def test_assignment_soft_delete(self, db_session, sample_teacher, sample_classroom):
        """Test soft delete functionality"""
        assignment = Assignment(
            title="Test Assignment",
            classroom_id=sample_classroom.id,
            teacher_id=sample_teacher.id,
        )
        db_session.add(assignment)
        db_session.commit()

        # Soft delete
        assignment.is_active = False
        db_session.commit()

        # Verify it still exists but is inactive
        fetched = db_session.query(Assignment).filter_by(id=assignment.id).first()
        assert fetched is not None
        assert fetched.is_active is False

    def test_assignment_relationships(
        self, db_session, sample_teacher, sample_classroom
    ):
        """Test assignment relationships"""
        assignment = Assignment(
            title="Test Assignment",
            classroom_id=sample_classroom.id,
            teacher_id=sample_teacher.id,
        )
        db_session.add(assignment)
        db_session.commit()

        # Refresh to load relationships
        db_session.refresh(assignment)

        assert assignment.teacher.id == sample_teacher.id
        assert assignment.classroom.id == sample_classroom.id


class TestAssignmentContentModel:
    def test_create_assignment_content(
        self, db_session, sample_teacher, sample_classroom, sample_content
    ):
        """Test creating assignment-content relationship"""
        assignment = Assignment(
            title="Test Assignment",
            classroom_id=sample_classroom.id,
            teacher_id=sample_teacher.id,
        )
        db_session.add(assignment)
        db_session.commit()

        assignment_content = AssignmentContent(
            assignment_id=assignment.id, content_id=sample_content.id, order_index=0
        )
        db_session.add(assignment_content)
        db_session.commit()

        assert assignment_content.id is not None
        assert assignment_content.assignment_id == assignment.id
        assert assignment_content.content_id == sample_content.id

    def test_multiple_contents_per_assignment(
        self, db_session, sample_teacher, sample_classroom, sample_lesson
    ):
        """Test that an assignment can have multiple contents"""
        assignment = Assignment(
            title="Multi-content Assignment",
            classroom_id=sample_classroom.id,
            teacher_id=sample_teacher.id,
        )
        db_session.add(assignment)

        # Create multiple contents
        contents = []
        for i in range(3):
            content = Content(
                lesson_id=sample_lesson.id,
                type=ContentType.EXAMPLE_SENTENCES,
                title=f"Content {i+1}",
                content_items=[],
            )
            contents.append(content)
        db_session.add_all(contents)
        db_session.commit()

        # Link contents to assignment
        for idx, content in enumerate(contents):
            ac = AssignmentContent(
                assignment_id=assignment.id, content_id=content.id, order_index=idx
            )
            db_session.add(ac)
        db_session.commit()

        # Verify
        assignment_contents = (
            db_session.query(AssignmentContent)
            .filter_by(assignment_id=assignment.id)
            .all()
        )
        assert len(assignment_contents) == 3
        assert all(ac.order_index == idx for idx, ac in enumerate(assignment_contents))


class TestStudentAssignmentModel:
    def test_create_student_assignment(
        self, db_session, sample_teacher, sample_classroom, sample_student
    ):
        """Test creating a student assignment"""
        assignment = Assignment(
            title="Test Assignment",
            classroom_id=sample_classroom.id,
            teacher_id=sample_teacher.id,
        )
        db_session.add(assignment)
        db_session.commit()

        student_assignment = StudentAssignment(
            assignment_id=assignment.id,
            student_id=sample_student.id,
            classroom_id=sample_classroom.id,
            title=assignment.title,
            status=AssignmentStatus.NOT_STARTED,
        )
        db_session.add(student_assignment)
        db_session.commit()

        assert student_assignment.id is not None
        assert student_assignment.status == AssignmentStatus.NOT_STARTED
        assert student_assignment.is_active is True

    def test_assignment_status_transitions(
        self, db_session, sample_teacher, sample_classroom, sample_student
    ):
        """Test assignment status transitions"""
        assignment = Assignment(
            title="Test Assignment",
            classroom_id=sample_classroom.id,
            teacher_id=sample_teacher.id,
        )
        db_session.add(assignment)
        db_session.commit()

        student_assignment = StudentAssignment(
            assignment_id=assignment.id,
            student_id=sample_student.id,
            classroom_id=sample_classroom.id,
            title=assignment.title,
            status=AssignmentStatus.NOT_STARTED,
        )
        db_session.add(student_assignment)
        db_session.commit()

        # Test status transitions
        valid_transitions = [
            AssignmentStatus.IN_PROGRESS,
            AssignmentStatus.SUBMITTED,
            AssignmentStatus.GRADED,
            AssignmentStatus.RETURNED,
            AssignmentStatus.RESUBMITTED,
        ]

        for status in valid_transitions:
            student_assignment.status = status
            db_session.commit()
            assert student_assignment.status == status


class TestStudentContentProgressModel:
    def test_create_content_progress(
        self,
        db_session,
        sample_teacher,
        sample_classroom,
        sample_student,
        sample_content,
    ):
        """Test creating student content progress"""
        assignment = Assignment(
            title="Test Assignment",
            classroom_id=sample_classroom.id,
            teacher_id=sample_teacher.id,
        )
        db_session.add(assignment)
        db_session.commit()

        student_assignment = StudentAssignment(
            assignment_id=assignment.id,
            student_id=sample_student.id,
            classroom_id=sample_classroom.id,
            title=assignment.title,
        )
        db_session.add(student_assignment)
        db_session.commit()

        progress = StudentContentProgress(
            student_assignment_id=student_assignment.id,
            content_id=sample_content.id,
            status=AssignmentStatus.NOT_STARTED,
            order_index=0,
        )
        db_session.add(progress)
        db_session.commit()

        assert progress.id is not None
        assert progress.status == AssignmentStatus.NOT_STARTED
        assert progress.checked is None

    def test_progress_tracking(
        self,
        db_session,
        sample_teacher,
        sample_classroom,
        sample_student,
        sample_content,
    ):
        """Test progress tracking features"""
        assignment = Assignment(
            title="Test Assignment",
            classroom_id=sample_classroom.id,
            teacher_id=sample_teacher.id,
        )
        db_session.add(assignment)
        db_session.commit()

        student_assignment = StudentAssignment(
            assignment_id=assignment.id,
            student_id=sample_student.id,
            classroom_id=sample_classroom.id,
            title=assignment.title,
        )
        db_session.add(student_assignment)
        db_session.commit()

        progress = StudentContentProgress(
            student_assignment_id=student_assignment.id,
            content_id=sample_content.id,
            status=AssignmentStatus.IN_PROGRESS,
            score=85.5,
            checked=True,
            feedback="Good work!",
            response_data={"audio_url": "test.mp3"},
            ai_scores={"wpm": 80, "accuracy": 0.92},
        )
        db_session.add(progress)
        db_session.commit()

        assert progress.score == 85.5
        assert progress.checked is True
        assert progress.feedback == "Good work!"
        assert progress.response_data["audio_url"] == "test.mp3"
        assert progress.ai_scores["wpm"] == 80


class TestCascadeDeletion:
    def test_assignment_cascade_delete(
        self,
        db_session,
        sample_teacher,
        sample_classroom,
        sample_student,
        sample_content,
    ):
        """Test cascade deletion of assignment and related records"""
        assignment = Assignment(
            title="Test Assignment",
            classroom_id=sample_classroom.id,
            teacher_id=sample_teacher.id,
        )
        db_session.add(assignment)
        db_session.commit()

        # Create related records
        assignment_content = AssignmentContent(
            assignment_id=assignment.id, content_id=sample_content.id
        )
        db_session.add(assignment_content)

        student_assignment = StudentAssignment(
            assignment_id=assignment.id,
            student_id=sample_student.id,
            classroom_id=sample_classroom.id,
            title=assignment.title,
        )
        db_session.add(student_assignment)
        db_session.commit()

        progress = StudentContentProgress(
            student_assignment_id=student_assignment.id, content_id=sample_content.id
        )
        db_session.add(progress)
        db_session.commit()

        # Store IDs for verification
        assignment_content_id = assignment_content.id
        student_assignment_id = student_assignment.id
        progress_id = progress.id

        # Delete assignment
        db_session.delete(assignment)
        db_session.commit()

        # Verify cascade deletion
        assert (
            db_session.query(AssignmentContent)
            .filter_by(id=assignment_content_id)
            .first()
            is None
        )
        assert (
            db_session.query(StudentAssignment)
            .filter_by(id=student_assignment_id)
            .first()
            is None
        )
        assert (
            db_session.query(StudentContentProgress).filter_by(id=progress_id).first()
            is None
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
