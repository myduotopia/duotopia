"""Integration tests for the #830 per-question class stats endpoint.

Covers ``get_quiz_question_stats`` in ``routers/assignments/detail.py``
(``GET /api/teachers/assignments/{id}/quiz-question-stats``):

* Response carries ``is_quiz=true`` and ``total_submitted`` = number of
  students who submitted.
* Each question buckets students into correct / wrong / unanswered, and the
  three buckets add up to ``total_submitted`` for every content_item.
* A teacher who does not own the assignment gets 404 (the endpoint's
  not-found-or-no-permission contract).
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

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_quiz_stats_830.db"
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


# Three items; with show_image=False the selection answer key is `translation`.
_ITEMS = [
    (1, "apple", "蘋果"),
    (2, "banana", "香蕉"),
    (3, "cherry", "櫻桃"),
]
_STUDENT_IDS = (1, 2)


def _seed() -> None:
    """Teacher 1 owns the quiz; teacher 2 owns nothing; 2 students enrolled."""
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
                student_number=str(sid),
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
                id=item_id,
                content_id=1,
                order_index=order,
                text=text,
                translation=translation,
            )
            for order, (item_id, text, translation) in enumerate(_ITEMS, start=1)
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
                status=AssignmentStatus.NOT_STARTED,
                is_active=True,
                assigned_at=datetime.now(timezone.utc),
            )
        )
    db.commit()
    db.close()


def _student_headers(sid: int) -> dict:
    resp = client.post(
        "/api/auth/student/login", json={"id": sid, "password": "password123"}
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _teacher_headers(email: str = "teacher@test.com") -> dict:
    resp = client.post(
        "/api/auth/teacher/login",
        json={"email": email, "password": "password123"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _submit_quiz(sa_id: int, headers: dict, answers: dict) -> None:
    """Drive the real student flow: start, answer the given items, complete.

    ``answers`` maps content_item_id -> selected_answer. Items omitted are left
    UNANSWERED (no PracticeAnswer row).
    """
    start = client.get(
        f"/api/students/assignments/{sa_id}/vocabulary/selection_quiz/start",
        headers=headers,
    )
    assert start.status_code == 200, start.text
    session_id = start.json()["session_id"]
    for item_id, selected in answers.items():
        resp = client.post(
            f"/api/students/assignments/{sa_id}/vocabulary/selection_quiz/answer",
            headers=headers,
            json={
                "content_item_id": item_id,
                "selected_answer": selected,
                "time_spent_seconds": 0,
                "session_id": session_id,
            },
        )
        assert resp.status_code == 200, resp.text
    done = client.post(
        f"/api/students/assignments/{sa_id}/vocabulary/selection_quiz/complete",
        headers=headers,
        json={"session_id": session_id},
    )
    assert done.status_code == 200, done.text


def test_quiz_question_stats_buckets(setup_database):
    """Buckets per question add up to total_submitted with correct membership."""
    _seed()

    # Student 1: item1 correct, item2 wrong, item3 unanswered.
    _submit_quiz(
        1,
        _student_headers(1),
        {1: "蘋果", 2: "wrong-answer"},
    )
    # Student 2: item1 correct, item2 correct, item3 wrong.
    _submit_quiz(
        2,
        _student_headers(2),
        {1: "蘋果", 2: "香蕉", 3: "wrong-answer"},
    )

    resp = client.get(
        "/api/teachers/assignments/1/quiz-question-stats",
        headers=_teacher_headers(),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_quiz"] is True
    assert body["total_submitted"] == 2

    questions = {q["content_item_id"]: q for q in body["questions"]}
    assert len(questions) == 3

    # Every question's three buckets must add up to total_submitted.
    for q in body["questions"]:
        bucket_total = len(q["correct"]) + len(q["wrong"]) + len(q["unanswered"])
        assert bucket_total == body["total_submitted"], q

    # Item 1: both correct.
    assert len(questions[1]["correct"]) == 2
    assert len(questions[1]["wrong"]) == 0
    assert len(questions[1]["unanswered"]) == 0

    # Item 2: student 2 correct, student 1 wrong.
    assert {m["student_id"] for m in questions[2]["correct"]} == {2}
    assert {m["student_id"] for m in questions[2]["wrong"]} == {1}

    # Item 3: student 1 unanswered, student 2 wrong.
    assert {m["student_id"] for m in questions[3]["unanswered"]} == {1}
    assert {m["student_id"] for m in questions[3]["wrong"]} == {2}

    # The answer (correct text) is the English `text` for non-cloze quizzes.
    assert questions[1]["answer"] == "apple"


def test_quiz_question_stats_other_teacher_forbidden(setup_database):
    """A teacher who does not own the assignment gets 404."""
    _seed()
    resp = client.get(
        "/api/teachers/assignments/1/quiz-question-stats",
        headers=_teacher_headers("other@test.com"),
    )
    assert resp.status_code == 404, resp.text
