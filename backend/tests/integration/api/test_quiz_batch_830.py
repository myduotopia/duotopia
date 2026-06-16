"""Integration tests for the #830 batch teacher quiz endpoints.

Covers ``batch_return_for_revision`` and ``batch_reset_not_started`` in
``routers/assignments/grading.py`` (mounted under
``/api/teachers/assignments``):

* batch-return-for-revision returns ``{returned, skipped, count}``; an already
  RETURNED student and a non-existent student_id are both skipped.
* A teacher who does not own the assignment gets 403.
* An archived assignment gets 403.
* batch-reset-not-started flips status to NOT_STARTED but preserves the
  frozen score / answers.
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from auth import get_password_hash
from database import Base, get_db
from main import app
from models import (
    Assignment,
    AssignmentContent,
    AssignmentStatus,
    Classroom,
    ClassroomStudent,
    Content,
    ContentItem,
    ContentType,
    Lesson,
    Program,
    Student,
    StudentAssignment,
    Teacher,
)

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_quiz_batch_830.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


client = TestClient(app)


@pytest.fixture(scope="function")
def setup_database():
    # Re-bind the override to THIS module's engine for every test — when several
    # self-contained quiz test files run together they share one ``app`` and the
    # global override would otherwise point at whichever module imported last.
    app.dependency_overrides[get_db] = _override_get_db
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


# Student ids seeded on the quiz assignment.
_STUDENT_IDS = (1, 2, 3)


def _seed(*, archived: bool = False) -> None:
    """Two teachers + 3 students on one word_selection_quiz assignment.

    Teacher 1 owns assignment 1 (3 students, all SUBMITTED with score 80).
    Teacher 2 owns nothing here — used for the authorization test.
    """
    db = TestingSessionLocal()
    db.add_all(
        [
            Teacher(
                id=1,
                name="t1",
                email="teacher@test.com",
                password_hash=get_password_hash("password123"),
                email_verified=True,
                is_active=True,
            ),
            Teacher(
                id=2,
                name="t2",
                email="other@test.com",
                password_hash=get_password_hash("password123"),
                email_verified=True,
                is_active=True,
            ),
        ]
    )
    db.add(Classroom(id=1, name="c", teacher_id=1, is_active=True))
    for sid in _STUDENT_IDS:
        db.add(
            Student(
                id=sid,
                name=f"s{sid}",
                email=f"student{sid}@test.com",
                password_hash=get_password_hash("password123"),
                email_verified=True,
                is_active=True,
                birthdate=datetime(2010, 1, 1).date(),
            )
        )
    db.commit()
    for sid in _STUDENT_IDS:
        db.add(ClassroomStudent(classroom_id=1, student_id=sid, is_active=True))
    db.add(
        Program(
            id=1, name="p", teacher_id=1, level="A1", is_template=False, is_active=True
        )
    )
    db.commit()
    db.add(Lesson(id=1, name="l", program_id=1, order_index=1, is_active=True))
    db.commit()
    db.add(
        Content(
            id=1,
            lesson_id=1,
            title="ct",
            type=ContentType.EXAMPLE_SENTENCES,
            order_index=1,
            is_active=True,
            is_assignment_copy=True,
        )
    )
    db.commit()
    db.add_all(
        [
            ContentItem(
                id=1, content_id=1, order_index=1, text="apple", translation="蘋果"
            ),
            ContentItem(
                id=2, content_id=1, order_index=2, text="banana", translation="香蕉"
            ),
        ]
    )
    db.commit()
    db.add(
        Assignment(
            id=1,
            title="quiz",
            classroom_id=1,
            teacher_id=1,
            practice_mode="word_selection_quiz",
            show_image=False,
            shuffle_questions=False,
            is_active=True,
            is_archived=archived,
        )
    )
    db.commit()
    db.add(AssignmentContent(assignment_id=1, content_id=1, order_index=1))
    for sid in _STUDENT_IDS:
        db.add(
            StudentAssignment(
                id=sid,
                assignment_id=1,
                student_id=sid,
                teacher_id=1,
                classroom_id=1,
                title="quiz",
                status=AssignmentStatus.SUBMITTED,
                score=80,
                is_active=True,
                assigned_at=datetime.now(timezone.utc),
                submitted_at=datetime.now(timezone.utc),
            )
        )
    db.commit()
    db.close()


def _teacher_headers(email: str = "teacher@test.com") -> dict:
    resp = client.post(
        "/api/auth/teacher/login",
        json={"email": email, "password": "password123"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _sa(sa_id: int) -> StudentAssignment:
    db = TestingSessionLocal()
    try:
        return db.query(StudentAssignment).filter_by(id=sa_id).first()
    finally:
        db.close()


def test_batch_return_skips_already_returned_and_missing(setup_database):
    """Returned + non-existent student_ids are skipped, valid ones returned."""
    _seed()
    headers = _teacher_headers()

    # Pre-return student 2 so it is already in RETURNED status.
    first = client.post(
        "/api/teachers/assignments/1/batch-return-for-revision",
        headers=headers,
        json={"student_ids": [2]},
    )
    assert first.status_code == 200, first.text
    assert first.json() == {"returned": [2], "skipped": [], "count": 1}

    # Batch: 1 fresh, 2 already returned, 999 non-existent.
    resp = client.post(
        "/api/teachers/assignments/1/batch-return-for-revision",
        headers=headers,
        json={"student_ids": [1, 2, 999]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["returned"] == [1]
    assert sorted(body["skipped"]) == [2, 999]
    assert body["count"] == 1

    assert _sa(1).status == AssignmentStatus.RETURNED
    assert _sa(2).status == AssignmentStatus.RETURNED


def test_batch_return_other_teacher_forbidden(setup_database):
    """A teacher who does not own the assignment gets 403."""
    _seed()
    resp = client.post(
        "/api/teachers/assignments/1/batch-return-for-revision",
        headers=_teacher_headers("other@test.com"),
        json={"student_ids": [1]},
    )
    assert resp.status_code == 403, resp.text


def test_batch_return_archived_forbidden(setup_database):
    """An archived assignment cannot be batch-returned (403)."""
    _seed(archived=True)
    resp = client.post(
        "/api/teachers/assignments/1/batch-return-for-revision",
        headers=_teacher_headers(),
        json={"student_ids": [1]},
    )
    assert resp.status_code == 403, resp.text


def test_batch_reset_not_started_preserves_score(setup_database):
    """batch-reset → NOT_STARTED while score/answers are preserved."""
    _seed()
    headers = _teacher_headers()

    assert _sa(1).score == 80
    resp = client.post(
        "/api/teachers/assignments/1/batch-reset-not-started",
        headers=headers,
        json={"student_ids": [1, 3]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert sorted(body["reset"]) == [1, 3]
    assert body["skipped"] == []
    assert body["count"] == 2

    # Status reset, but the frozen score is untouched.
    for sid in (1, 3):
        sa = _sa(sid)
        assert sa.status == AssignmentStatus.NOT_STARTED
        assert sa.score == 80
    # Student 2 was not in the batch — unchanged.
    assert _sa(2).status == AssignmentStatus.SUBMITTED
