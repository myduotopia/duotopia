"""Integration tests for the #830 小考 revision lifecycle.

Covers the full submit → return → re-submit flow for ``word_selection_quiz``,
guarding the regressions called out in #830:

* First submission writes the subtractive score and sets ``SUBMITTED``.
* Re-calling ``/complete`` is idempotent (no 0分 re-zero, no 95→100 inflation).
* A returned quiz that is re-submitted while still wrong is blocked with
  ``QUIZ_REVISION_INCOMPLETE``.
* A successful revision flips status to ``RESUBMITTED`` but FREEZES the
  original score (``write_score=False`` on the revision path).

Source of truth: ``routers/students/quiz_assignments.py`` (``_complete_quiz``,
``compute_quiz_score``, ``finalize_quiz_submission``) and
``routers/assignments/grading.py`` (``return_for_revision`` /
``_return_quiz_for_revision``).
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

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_quiz_revision_830.db"
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


# Three vocabulary items → per-question deduction = round(100/3, 1) = 33.3.
_ITEMS = [
    (1, "apple", "蘋果"),
    (2, "banana", "香蕉"),
    (3, "cherry", "櫻桃"),
]


def _seed() -> None:
    """Create teacher/student/classroom + a word_selection_quiz with 3 items."""
    db = TestingSessionLocal()
    teacher = Teacher(
        id=1,
        name="t",
        email="teacher@test.com",
        password_hash=get_password_hash("password123"),
        email_verified=True,
        is_active=True,
    )
    db.add(teacher)
    classroom = Classroom(id=1, name="c", teacher_id=1, is_active=True)
    db.add(classroom)
    student = Student(
        id=1,
        name="s",
        email="student@test.com",
        password_hash=get_password_hash("password123"),
        email_verified=True,
        is_active=True,
        birthdate=datetime(2010, 1, 1).date(),
    )
    db.add(student)
    db.commit()
    db.add(ClassroomStudent(classroom_id=1, student_id=1, is_active=True))
    program = Program(
        id=1, name="p", teacher_id=1, level="A1", is_template=False, is_active=True
    )
    db.add(program)
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
    assignment = Assignment(
        id=1,
        title="quiz",
        classroom_id=1,
        teacher_id=1,
        practice_mode="word_selection_quiz",
        show_image=False,
        shuffle_questions=False,
        is_active=True,
    )
    db.add(assignment)
    db.commit()
    db.add(AssignmentContent(assignment_id=1, content_id=1, order_index=1))
    sa = StudentAssignment(
        id=1,
        assignment_id=1,
        student_id=1,
        teacher_id=1,
        classroom_id=1,
        title="quiz",
        status=AssignmentStatus.NOT_STARTED,
        is_active=True,
        assigned_at=datetime.now(timezone.utc),
    )
    db.add(sa)
    db.commit()
    db.close()


def _student_headers() -> dict:
    resp = client.post(
        "/api/auth/student/login", json={"id": 1, "password": "password123"}
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _teacher_headers() -> dict:
    resp = client.post(
        "/api/auth/teacher/login",
        json={"email": "teacher@test.com", "password": "password123"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _start(headers: dict) -> int:
    start = client.get(
        "/api/students/assignments/1/vocabulary/selection_quiz/start",
        headers=headers,
    )
    assert start.status_code == 200, start.text
    return start.json()["session_id"]


def _answer(headers: dict, session_id: int, item_id: int, selected: str) -> None:
    resp = client.post(
        "/api/students/assignments/1/vocabulary/selection_quiz/answer",
        headers=headers,
        json={
            "content_item_id": item_id,
            "selected_answer": selected,
            "time_spent_seconds": 0,
            "session_id": session_id,
        },
    )
    assert resp.status_code == 200, resp.text


def _complete(headers: dict, session_id: int):
    return client.post(
        "/api/students/assignments/1/vocabulary/selection_quiz/complete",
        headers=headers,
        json={"session_id": session_id},
    )


def _sa_status() -> AssignmentStatus:
    db = TestingSessionLocal()
    try:
        return db.query(StudentAssignment).filter_by(id=1).first().status
    finally:
        db.close()


def test_first_submission_all_correct(setup_database):
    """All-correct first submission → SUBMITTED, score 100, correct_count 3.

    NOTE: with ``show_image=False`` the selection answer key is the item's
    ``translation`` (``text_field_for_show_image(False) == "translation"``), so a
    correct selection submits the Chinese translation, not the English ``text``.
    """
    _seed()
    headers = _student_headers()
    session_id = _start(headers)
    for item_id, _text, translation in _ITEMS:
        _answer(headers, session_id, item_id, translation)

    done = _complete(headers, session_id)
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["score"] == 100
    assert body["correct_count"] == 3
    assert _sa_status() == AssignmentStatus.SUBMITTED


def test_first_submission_one_wrong_uses_subtractive_formula(setup_database):
    """One wrong answer → score = 100 - 1 * round(100/3, 1) = 66.7, SUBMITTED."""
    _seed()
    headers = _student_headers()
    session_id = _start(headers)
    _answer(headers, session_id, 1, "蘋果")
    _answer(headers, session_id, 2, "香蕉")
    _answer(headers, session_id, 3, "wrong-answer")  # 1 wrong out of 3

    done = _complete(headers, session_id)
    assert done.status_code == 200, done.text
    body = done.json()
    # per_question = round(100/3, 1) = 33.3 → 100 - 33.3 = 66.7
    assert body["score"] == 66.7
    assert body["correct_count"] == 2
    assert _sa_status() == AssignmentStatus.SUBMITTED


def test_recomplete_is_idempotent(setup_database):
    """Calling /complete twice returns the SAME score (#830 0分 / 95→100 guard)."""
    _seed()
    headers = _student_headers()
    session_id = _start(headers)
    _answer(headers, session_id, 1, "蘋果")
    _answer(headers, session_id, 2, "香蕉")
    _answer(headers, session_id, 3, "wrong-answer")

    first = _complete(headers, session_id)
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["score"] == 66.7

    second = _complete(headers, session_id)
    assert second.status_code == 200, second.text
    second_body = second.json()
    # Idempotent: identical score, no re-zero and no inflation to 100.
    assert second_body["score"] == first_body["score"] == 66.7
    assert second_body["correct_count"] == first_body["correct_count"] == 2
    assert _sa_status() == AssignmentStatus.SUBMITTED


def test_revision_gate_blocks_still_wrong_resubmit(setup_database):
    """After teacher return, re-submitting while still wrong → 400 REVISION_INCOMPLETE."""
    _seed()
    s_headers = _student_headers()
    session_id = _start(s_headers)
    _answer(s_headers, session_id, 1, "蘋果")
    _answer(s_headers, session_id, 2, "香蕉")
    _answer(s_headers, session_id, 3, "wrong-answer")
    assert _complete(s_headers, session_id).json()["score"] == 66.7

    # Teacher returns the SA for revision via the real endpoint.
    ret = client.post(
        "/api/teachers/assignments/1/return-for-revision",
        headers=_teacher_headers(),
        json={"student_id": 1},
    )
    assert ret.status_code == 200, ret.text
    assert ret.json()["status"] == "RETURNED"
    assert _sa_status() == AssignmentStatus.RETURNED

    # Student re-enters: the return seeds a fresh revision session carrying the
    # already-correct items; only the wrong item (id 3) needs redoing.
    rev_session = _start(s_headers)
    _answer(s_headers, rev_session, 3, "still-wrong")  # still wrong

    blocked = _complete(s_headers, rev_session)
    assert blocked.status_code == 400, blocked.text
    detail = blocked.json()["detail"]
    assert detail["code"] == "QUIZ_REVISION_INCOMPLETE"
    assert detail["total"] == 3
    assert detail["correct_count"] < 3


def test_revision_success_freezes_original_score(setup_database):
    """Fixing all answers on revision → RESUBMITTED, but score stays frozen."""
    _seed()
    s_headers = _student_headers()
    session_id = _start(s_headers)
    _answer(s_headers, session_id, 1, "蘋果")
    _answer(s_headers, session_id, 2, "香蕉")
    _answer(s_headers, session_id, 3, "wrong-answer")
    assert _complete(s_headers, session_id).json()["score"] == 66.7

    ret = client.post(
        "/api/teachers/assignments/1/return-for-revision",
        headers=_teacher_headers(),
        json={"student_id": 1},
    )
    assert ret.status_code == 200, ret.text

    # Student fixes the previously-wrong item correctly.
    rev_session = _start(s_headers)
    _answer(s_headers, rev_session, 3, "櫻桃")

    done = _complete(s_headers, rev_session)
    assert done.status_code == 200, done.text
    assert _sa_status() == AssignmentStatus.RESUBMITTED

    # Score is the FROZEN original (66.7), NOT recomputed to 100 on revision.
    db = TestingSessionLocal()
    try:
        stored = db.query(StudentAssignment).filter_by(id=1).first().score
    finally:
        db.close()
    assert stored == 66.7
