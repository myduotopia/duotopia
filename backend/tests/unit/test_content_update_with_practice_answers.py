"""
Test: Updating content with existing practice_answers should succeed.

Regression test for Issue #578:
When a teacher edits a content copy that students have already practiced on,
the save failed with 409 because practice_answers had a FK to content_items
without ON DELETE CASCADE.

The fix: content_ops.update_content now explicitly deletes practice_answers
before deleting content_items.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from main import app
from database import get_db
from models import (
    Base,
    Teacher,
    Student,
    Classroom,
    ClassroomStudent,
    Program,
    Lesson,
    Content,
    ContentItem,
    ContentType,
    Assignment,
    AssignmentContent,
    StudentAssignment,
)
from models.progress import PracticeSession, PracticeAnswer
from auth import get_password_hash

# ---------- SQLite test DB ----------
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_content_update_practice.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
client = TestClient(app)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


# ---------- Fixtures ----------
@pytest.fixture(scope="module", autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)

    db = TestingSessionLocal()

    teacher = Teacher(
        email="practice-test@teacher.com",
        name="Practice Test Teacher",
        password_hash=get_password_hash("test123"),
        email_verified=True,
    )
    db.add(teacher)
    db.flush()

    classroom = Classroom(
        name="Practice Test Classroom", teacher_id=teacher.id, grade="Grade 1"
    )
    db.add(classroom)
    db.flush()

    student = Student(
        name="Test Student",
        student_number="S001",
    )
    db.add(student)
    db.flush()

    cs = ClassroomStudent(
        classroom_id=classroom.id,
        student_id=student.id,
    )
    db.add(cs)

    program = Program(
        name="Practice Test Program",
        description="Test",
        teacher_id=teacher.id,
        classroom_id=classroom.id,
    )
    db.add(program)
    db.flush()

    lesson = Lesson(
        name="Practice Test Lesson",
        program_id=program.id,
        order_index=1,
    )
    db.add(lesson)
    db.flush()

    # Create a vocabulary_set content with items
    content = Content(
        title="Word Selection Test",
        type=ContentType.VOCABULARY_SET,
        lesson_id=lesson.id,
        order_index=1,
        level="A1",
    )
    db.add(content)
    db.flush()

    item1 = ContentItem(
        content_id=content.id, order_index=0, text="apple", translation="蘋果"
    )
    item2 = ContentItem(
        content_id=content.id, order_index=1, text="banana", translation="香蕉"
    )
    db.add_all([item1, item2])
    db.flush()

    # Create assignment referencing this content
    assignment = Assignment(
        title="Test Assignment",
        classroom_id=classroom.id,
        teacher_id=teacher.id,
    )
    db.add(assignment)
    db.flush()

    ac = AssignmentContent(
        assignment_id=assignment.id,
        content_id=content.id,
    )
    db.add(ac)
    db.flush()

    sa = StudentAssignment(
        assignment_id=assignment.id,
        student_id=student.id,
    )
    db.add(sa)
    db.flush()

    # Simulate student practice: create session + answers
    session = PracticeSession(
        student_id=student.id,
        student_assignment_id=sa.id,
        practice_mode="word_selection",
        words_practiced=2,
        correct_count=1,
    )
    db.add(session)
    db.flush()

    ans1 = PracticeAnswer(
        practice_session_id=session.id,
        content_item_id=item1.id,
        is_correct=True,
    )
    ans2 = PracticeAnswer(
        practice_session_id=session.id,
        content_item_id=item2.id,
        is_correct=False,
    )
    db.add_all([ans1, ans2])

    db.commit()
    db.close()

    yield

    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def auth_token():
    response = client.post(
        "/api/auth/teacher/login",
        json={"email": "practice-test@teacher.com", "password": "test123"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


@pytest.fixture
def content_id():
    """Get the test content ID by querying the DB directly (order-independent)."""
    db = TestingSessionLocal()
    content = (
        db.query(Content).filter(Content.type == ContentType.VOCABULARY_SET).first()
    )
    cid = content.id
    db.close()
    return cid


# ---------- Tests ----------
class TestUpdateContentWithPracticeAnswers:
    """Issue #578: 作業副本編輯後儲存失敗"""

    def test_update_content_items_with_existing_practice_answers(
        self, auth_token, content_id
    ):
        """Updating content items should succeed even when practice_answers exist.

        Before the fix, this returned 409 because DELETE FROM content_items
        violated the FK constraint from practice_answers.
        """
        db = TestingSessionLocal()
        content = db.query(Content).filter(Content.id == content_id).one()

        # Verify practice_answers exist before update
        item_ids = [item.id for item in content.content_items]
        pa_count = (
            db.query(PracticeAnswer)
            .filter(PracticeAnswer.content_item_id.in_(item_ids))
            .count()
        )
        assert pa_count == 2, "Expected 2 practice_answers before update"
        db.close()

        # Update content items (this triggers delete-and-recreate)
        response = client.put(
            f"/api/teachers/contents/{content_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "title": "Word Selection Updated",
                "items": [
                    {"text": "cherry", "translation": "櫻桃"},
                    {"text": "grape", "translation": "葡萄"},
                    {"text": "mango", "translation": "芒果"},
                ],
            },
        )

        assert (
            response.status_code == 200
        ), f"Expected 200, got {response.status_code}: {response.json()}"
        data = response.json()
        assert data["title"] == "Word Selection Updated"
        assert len(data["items"]) == 3

        # Verify old practice_answers were cleaned up
        db = TestingSessionLocal()
        remaining_pa = (
            db.query(PracticeAnswer)
            .filter(PracticeAnswer.content_item_id.in_(item_ids))
            .count()
        )
        assert remaining_pa == 0, "Old practice_answers should be deleted"
        db.close()

    def test_update_title_only_does_not_replace_items(self, auth_token, content_id):
        """Updating only the title (no items in payload) should not replace items."""
        # Get current item count before title-only update
        db = TestingSessionLocal()
        items_before = (
            db.query(ContentItem).filter(ContentItem.content_id == content_id).count()
        )
        db.close()

        response = client.put(
            f"/api/teachers/contents/{content_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"title": "Title Only Change"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Title Only Change"
        assert len(data["items"]) == items_before
