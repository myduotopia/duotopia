"""Issue #1045 V10: 小考批改頁每題扣分存檔。

* POST /grade 帶 ``quiz_deductions`` → 依 content_item_id upsert
  ``StudentItemProgress.teacher_review_score``；重讀批改 API 的 deduction 一致。
* 多題組（兩個 Content）仍依 content_item_id 對題。
* 沒有任何 StudentContentProgress 也能存（不經 item_results 映射）。
* 小考送 item_results 不會把 100/60 寫進 teacher_review_score。
* 老師直接改總分 → 以送出的 score 為準；扣分不反向改寫。
* 驗證：deduction 超出 0–100 → 422；content_item_id 不屬於本作業 → 400。
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
    StudentContentProgress,
    StudentItemProgress,
    Teacher,
)

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_quiz_deductions_1045.db"
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
    app.dependency_overrides[get_db] = _override_get_db
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def _seed() -> None:
    """Quiz across TWO content groups (items 1-2 in content 1, items 3-4 in content 2),
    plus an unassigned content 3 (item 99). No StudentContentProgress rows."""
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
    for cid in (1, 2, 3):
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
    for item_id, content_id, order in [
        (1, 1, 1),
        (2, 1, 2),
        (3, 2, 1),
        (4, 2, 2),
        (99, 3, 1),
    ]:
        db.add(
            ContentItem(
                id=item_id,
                content_id=content_id,
                order_index=order,
                text=f"w{item_id}",
                translation=f"字{item_id}",
            )
        )
    db.commit()
    db.add(
        Assignment(
            id=1,
            title="quiz",
            classroom_id=1,
            teacher_id=1,
            practice_mode="word_spelling_quiz",
            show_image=False,
            shuffle_questions=False,
            is_active=True,
        )
    )
    db.commit()
    db.add(AssignmentContent(assignment_id=1, content_id=1, order_index=1))
    db.add(AssignmentContent(assignment_id=1, content_id=2, order_index=2))
    db.add(
        StudentAssignment(
            id=1,
            assignment_id=1,
            student_id=1,
            teacher_id=1,
            classroom_id=1,
            title="quiz",
            status=AssignmentStatus.SUBMITTED,
            score=50.0,
            is_active=True,
            assigned_at=datetime.now(timezone.utc),
        )
    )
    db.commit()
    db.close()


def _teacher_headers() -> dict:
    resp = client.post(
        "/api/auth/teacher/login",
        json={"email": "teacher@test.com", "password": "password123"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _grade(headers: dict, **body):
    payload = {"student_id": 1, "feedback": "", "update_status": True, **body}
    return client.post(
        "/api/teachers/assignments/1/grade", headers=headers, json=payload
    )


def _deductions_in_db() -> dict:
    db = TestingSessionLocal()
    try:
        return {
            ip.content_item_id: (
                float(ip.teacher_review_score)
                if ip.teacher_review_score is not None
                else None
            )
            for ip in db.query(StudentItemProgress).filter_by(student_assignment_id=1)
        }
    finally:
        db.close()


def test_save_then_reload_deductions_across_groups_without_content_progress(
    setup_database,
):
    """V10: multi-group quiz, no StudentContentProgress → deductions saved by item id
    and the grading view reads the same values back."""
    _seed()
    headers = _teacher_headers()
    db = TestingSessionLocal()
    try:
        assert db.query(StudentContentProgress).count() == 0
    finally:
        db.close()

    resp = _grade(
        headers,
        score=73.3,
        quiz_deductions=[
            {"content_item_id": 1, "deduction": 0},
            {"content_item_id": 2, "deduction": 25},
            {"content_item_id": 3, "deduction": 1.7},
            {"content_item_id": 4, "deduction": 0},
        ],
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["score"] == 73.3
    assert _deductions_in_db() == {1: 0.0, 2: 25.0, 3: 1.7, 4: 0.0}

    view = client.get("/api/teachers/assignments/1/submissions/1", headers=headers)
    assert view.status_code == 200, view.text
    by_item = {q["content_item_id"]: q["deduction"] for q in view.json()["submissions"]}
    assert by_item == {1: 0.0, 2: 25.0, 3: 1.7, 4: 0.0}
    assert view.json()["current_score"] == 73.3


def test_resave_updates_existing_rows_in_place(setup_database):
    """Upsert: a second save updates the same StudentItemProgress rows (no duplicates)."""
    _seed()
    headers = _teacher_headers()
    assert (
        _grade(
            headers, score=75, quiz_deductions=[{"content_item_id": 2, "deduction": 25}]
        ).status_code
        == 200
    )
    assert (
        _grade(
            headers, score=90, quiz_deductions=[{"content_item_id": 2, "deduction": 10}]
        ).status_code
        == 200
    )
    db = TestingSessionLocal()
    try:
        rows = db.query(StudentItemProgress).filter_by(content_item_id=2).all()
    finally:
        db.close()
    assert len(rows) == 1
    assert float(rows[0].teacher_review_score) == 10.0


def test_manual_total_wins_over_deductions(setup_database):
    """Teacher typed a total that doesn't match 100 − Σdeductions → stored score is the sent one."""
    _seed()
    headers = _teacher_headers()
    resp = _grade(
        headers,
        score=88,
        quiz_deductions=[{"content_item_id": 2, "deduction": 50}],
    )
    assert resp.status_code == 200, resp.text
    db = TestingSessionLocal()
    try:
        sa = db.query(StudentAssignment).filter_by(id=1).one()
    finally:
        db.close()
    assert sa.score == 88
    assert _deductions_in_db() == {2: 50.0}


def test_quiz_item_results_do_not_pollute_deductions(setup_database):
    """Quiz grading ignores item_results (its 100/60 mapping would overwrite deductions)."""
    _seed()
    headers = _teacher_headers()
    db = TestingSessionLocal()
    try:
        db.add(
            StudentContentProgress(student_assignment_id=1, content_id=1, order_index=1)
        )
        db.commit()
    finally:
        db.close()
    resp = _grade(
        headers,
        score=90,
        quiz_deductions=[{"content_item_id": 1, "deduction": 10}],
        item_results=[
            {"item_index": 0, "feedback": "", "passed": False, "score": 60},
            {"item_index": 1, "feedback": "", "passed": True, "score": 100},
        ],
    )
    assert resp.status_code == 200, resp.text
    assert _deductions_in_db() == {1: 10.0}


def test_rejects_out_of_range_and_foreign_items(setup_database):
    """deduction outside 0–100 → 422; item not in assignment → 400 and nothing saved."""
    _seed()
    headers = _teacher_headers()
    too_big = _grade(
        headers, score=0, quiz_deductions=[{"content_item_id": 1, "deduction": 101}]
    )
    assert too_big.status_code == 422, too_big.text
    negative = _grade(
        headers, score=0, quiz_deductions=[{"content_item_id": 1, "deduction": -1}]
    )
    assert negative.status_code == 422, negative.text
    foreign = _grade(
        headers, score=0, quiz_deductions=[{"content_item_id": 99, "deduction": 5}]
    )
    assert foreign.status_code == 400, foreign.text
    assert _deductions_in_db() == {}
