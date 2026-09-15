"""Issue #1045: 監考答對數超過總題數（31/30）。

Root cause: ``_upsert_quiz_answer`` had no lock, so an autosave and a 換題/送出
request for the same question could both see "no existing row" and INSERT twice;
readers then counted rows instead of questions.

Covers the verification points:

* V3 — the upsert locks the PracticeSession row (``with_for_update``) and two
  upserts for the same question leave ONE row with correct counters.
  LIMITATION: the test DB is SQLite, which ignores ``SELECT ... FOR UPDATE`` and
  serialises writers, so true concurrent transactions cannot be reproduced here.
  We assert the lock call is issued + sequential double upsert is idempotent.
* V4 — manually seeded duplicate rows: live-progress, ``compute_quiz_score`` and
  ``_build_quiz_submission`` all report correct ≤ total and use the latest answer.
* V5 — non-quiz practice may still store many rows per (session, item): no
  UNIQUE constraint exists on those columns.
* V11 — per-question deduction = 100/n without pre-rounding (only total rounds).
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Query, sessionmaker

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
    PracticeAnswer,
    PracticeSession,
    Program,
    Student,
    StudentAssignment,
    Teacher,
)
from routers.assignments.grading import _build_quiz_submission
from routers.students.quiz_assignments import _upsert_quiz_answer, compute_quiz_score

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_quiz_answer_dedup_1045.db"
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

MODE = "word_selection_quiz"


@pytest.fixture(scope="function")
def setup_database():
    app.dependency_overrides[get_db] = _override_get_db
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def _seed(n_items: int = 3) -> None:
    """Teacher/student/classroom + live word_selection_quiz with ``n_items`` items.

    Also creates an extra ContentItem (id 999) in a content NOT assigned, used to
    prove readers ignore answers for items outside the assignment.
    """
    db = TestingSessionLocal()
    db.add(
        Teacher(
            id=1,
            name="t",
            email="teacher@test.com",
            password_hash=get_password_hash("password123"),
            email_verified=True,
            is_active=True,
        )
    )
    db.add(Classroom(id=1, name="c", teacher_id=1, is_active=True))
    db.add(
        Student(
            id=1,
            name="s",
            email="student@test.com",
            password_hash=get_password_hash("password123"),
            email_verified=True,
            is_active=True,
            birthdate=datetime(2010, 1, 1).date(),
        )
    )
    db.commit()
    db.add(ClassroomStudent(classroom_id=1, student_id=1, is_active=True))
    db.add(
        Program(
            id=1, name="p", teacher_id=1, level="A1", is_template=False, is_active=True
        )
    )
    db.commit()
    db.add(Lesson(id=1, name="l", program_id=1, order_index=1, is_active=True))
    db.commit()
    for cid in (1, 2):
        db.add(
            Content(
                id=cid,
                lesson_id=1,
                title=f"ct{cid}",
                type=ContentType.EXAMPLE_SENTENCES,
                order_index=cid,
                is_active=True,
                is_assignment_copy=True,
            )
        )
    db.commit()
    for i in range(1, n_items + 1):
        db.add(
            ContentItem(
                id=i,
                content_id=1,
                order_index=i,
                text=f"word{i}",
                translation=f"字{i}",
            )
        )
    db.add(ContentItem(id=999, content_id=2, order_index=1, text="x", translation="外"))
    db.commit()
    db.add(
        Assignment(
            id=1,
            title="quiz",
            classroom_id=1,
            teacher_id=1,
            practice_mode=MODE,
            show_image=False,
            shuffle_questions=False,
            is_live_quiz=True,
            is_active=True,
        )
    )
    db.commit()
    db.add(AssignmentContent(assignment_id=1, content_id=1, order_index=1))
    db.add(
        StudentAssignment(
            id=1,
            assignment_id=1,
            student_id=1,
            teacher_id=1,
            classroom_id=1,
            title="quiz",
            status=AssignmentStatus.IN_PROGRESS,
            is_active=True,
            assigned_at=datetime.now(timezone.utc),
        )
    )
    db.commit()
    db.close()


def _make_session(db, completed: bool = False) -> PracticeSession:
    session = PracticeSession(
        student_id=1,
        student_assignment_id=1,
        practice_mode=MODE,
        words_practiced=0,
        correct_count=0,
        started_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc) if completed else None,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def _add_raw_answer(db, session_id: int, item_id: int, is_correct: bool, ans: str):
    db.add(
        PracticeAnswer(
            practice_session_id=session_id,
            content_item_id=item_id,
            is_correct=is_correct,
            time_spent_seconds=0,
            answer_data={"type": MODE, "selected_answer": ans},
        )
    )
    db.commit()


def _teacher_headers() -> dict:
    resp = client.post(
        "/api/auth/teacher/login",
        json={"email": "teacher@test.com", "password": "password123"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


# ---------------------------------------------------------------- V3


def test_upsert_takes_session_row_lock(setup_database, monkeypatch):
    """V3: _upsert_quiz_answer issues SELECT ... FOR UPDATE on the session row."""
    _seed()
    calls = []
    original = Query.with_for_update

    def _spy(self, *args, **kwargs):
        calls.append(self.column_descriptions[0]["entity"])
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Query, "with_for_update", _spy)
    db = TestingSessionLocal()
    try:
        session = _make_session(db)
        _upsert_quiz_answer(db, session, 1, True, 0, {"type": MODE})
        db.commit()
    finally:
        db.close()
    assert PracticeSession in calls


def test_double_upsert_same_item_single_row_and_counters(setup_database):
    """V3: two upserts on the same question (autosave + 換題) → one row; counters right."""
    _seed()
    db = TestingSessionLocal()
    try:
        session = _make_session(db)
        # First write wrong, second (same txn, no commit between) flips to correct.
        _upsert_quiz_answer(db, session, 1, False, 0, {"type": MODE, "v": 1})
        _upsert_quiz_answer(db, session, 1, True, 0, {"type": MODE, "v": 2})
        db.commit()
        # Then a separate transaction repeats the same correct answer.
        _upsert_quiz_answer(db, session, 1, True, 0, {"type": MODE, "v": 3})
        db.commit()
        _upsert_quiz_answer(db, session, 2, True, 0, {"type": MODE})
        db.commit()

        rows = (
            db.query(PracticeAnswer)
            .filter(PracticeAnswer.practice_session_id == session.id)
            .all()
        )
        assert sorted(r.content_item_id for r in rows) == [1, 2]
        fresh = db.query(PracticeSession).filter_by(id=session.id).one()
        db.refresh(fresh)
        assert fresh.words_practiced == 2
        assert fresh.correct_count == 2
    finally:
        db.close()


# ---------------------------------------------------------------- V4


def _seed_duplicates(completed: bool) -> int:
    """3 items. item1: old wrong + new correct; item2: old correct + new wrong;
    item3: correct twice; plus a row for an out-of-assignment item (999).
    Latest-per-item → correct = {1, 3} = 2, answered = 3."""
    db = TestingSessionLocal()
    try:
        session = _make_session(db, completed=completed)
        sid = session.id
        _add_raw_answer(db, sid, 1, False, "wrong")
        _add_raw_answer(db, sid, 1, True, "字1")
        _add_raw_answer(db, sid, 2, True, "字2")
        _add_raw_answer(db, sid, 2, False, "latest-wrong")
        _add_raw_answer(db, sid, 3, True, "字3")
        _add_raw_answer(db, sid, 3, True, "字3")
        _add_raw_answer(db, sid, 999, True, "外")
        return sid
    finally:
        db.close()


def test_live_progress_dedupes_duplicate_rows(setup_database):
    """V4: live-progress counts questions (latest row each), never rows."""
    _seed()
    _seed_duplicates(completed=False)
    resp = client.get(
        "/api/teachers/assignments/1/quiz/live-progress", headers=_teacher_headers()
    )
    assert resp.status_code == 200, resp.text
    student = next(s for s in resp.json()["students"] if s["student_id"] == 1)
    assert student["total_questions"] == 3
    assert student["answered_count"] == 3
    assert student["correct_count"] == 2
    assert student["correct_count"] <= student["total_questions"]


def test_compute_quiz_score_dedupes_duplicate_rows(setup_database):
    """V4: compute_quiz_score uses latest answer per item, only assignment items."""
    _seed()
    sid = _seed_duplicates(completed=True)
    db = TestingSessionLocal()
    try:
        sa = db.query(StudentAssignment).filter_by(id=1).one()
        session = db.query(PracticeSession).filter_by(id=sid).one()
        score, correct, total, answered = compute_quiz_score(db, sa, session)
    finally:
        db.close()
    assert total == 3
    assert correct == 2
    assert answered == 3
    assert correct <= total
    assert score == 66.7


def test_build_quiz_submission_uses_latest_duplicate(setup_database):
    """V4: grading view takes the latest row per item and correct ≤ total."""
    _seed()
    _seed_duplicates(completed=True)
    db = TestingSessionLocal()
    try:
        sa = db.query(StudentAssignment).filter_by(id=1).one()
        student = db.query(Student).filter_by(id=1).one()
        result = _build_quiz_submission(db, sa, student, MODE)
    finally:
        db.close()
    questions = {q["content_item_id"]: q for q in result["questions"]}
    assert set(questions) == {1, 2, 3}
    assert questions[1]["is_correct"] is True
    assert questions[1]["student_answer"] == "字1"
    assert questions[2]["is_correct"] is False
    assert questions[2]["student_answer"] == "latest-wrong"
    correct = sum(1 for q in questions.values() if q["is_correct"])
    assert correct == 2 <= len(questions)


# ---------------------------------------------------------------- V5


def test_non_quiz_practice_can_store_multiple_rows_per_item(setup_database):
    """V5: no UNIQUE(practice_session_id, content_item_id) — Ebbinghaus practice
    (word_selection / spelling / cloze) keeps writing one row per attempt."""
    for constraint in PracticeAnswer.__table__.constraints:
        cols = {c.name for c in getattr(constraint, "columns", [])}
        assert cols != {"practice_session_id", "content_item_id"}
    for index in PracticeAnswer.__table__.indexes:
        cols = {c.name for c in index.columns}
        assert not (index.unique and cols == {"practice_session_id", "content_item_id"})

    _seed()
    db = TestingSessionLocal()
    try:
        session = PracticeSession(
            student_id=1,
            student_assignment_id=1,
            practice_mode="word_selection",
            words_practiced=0,
            correct_count=0,
            started_at=datetime.now(timezone.utc),
        )
        db.add(session)
        db.commit()
        for _ in range(3):
            _add_raw_answer(db, session.id, 1, True, "字1")
        count = (
            db.query(PracticeAnswer)
            .filter(PracticeAnswer.practice_session_id == session.id)
            .count()
        )
    finally:
        db.close()
    assert count == 3


# ---------------------------------------------------------------- V11


@pytest.mark.parametrize(
    "n_items, n_correct, expected",
    [
        (30, 0, 0.0),  # 全錯 = 0（不再是 round(100/30,1)=3.3 → 1.0 殘值）
        (30, 29, 96.7),  # 錯 1 題：100 - 100/30 = 96.666… → 96.7
        (7, 6, 85.7),  # 7 題錯 1：100 - 100/7 = 85.714… → 85.7
        (3, 0, 0.0),
    ],
)
def test_compute_quiz_score_exact_per_question(
    setup_database, n_items, n_correct, expected
):
    """V11: per_question = 100/n (no pre-rounding); only the total rounds to 1dp."""
    _seed(n_items)
    db = TestingSessionLocal()
    try:
        session = _make_session(db, completed=True)
        for i in range(1, n_items + 1):
            _add_raw_answer(db, session.id, i, i <= n_correct, "a")
        sa = db.query(StudentAssignment).filter_by(id=1).one()
        score, correct, total, _answered = compute_quiz_score(db, sa, session)
    finally:
        db.close()
    assert total == n_items
    assert correct == n_correct
    assert score == expected
