"""Issue #1045 V8: 小考批改頁題目區資料。

* 批改 API 回傳的選項與學生 start endpoint 同 item 同設定時完全一致（文字＋順序）。
* 新作答寫入 ``answer_data.options_shown``；老師事後改派發設定，批改頁仍顯示學生當時選項。
* 舊資料（無 ``options_shown``）fallback 以同 seed 重建，不報錯。
* 每題 ``deduction`` 讀自 ``StudentItemProgress.teacher_review_score``；頂層 ``quiz_settings``。
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
    PracticeAnswer,
    Program,
    Student,
    StudentAssignment,
    StudentItemProgress,
    Teacher,
)

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_quiz_grading_view_1045.db"
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

_WORDS = [
    (1, "apple", "蘋果"),
    (2, "banana", "香蕉"),
    (3, "cherry", "櫻桃"),
    (4, "grape", "葡萄"),
    (5, "lemon", "檸檬"),
    (6, "mango", "芒果"),
]


@pytest.fixture(scope="function")
def setup_database():
    app.dependency_overrides[get_db] = _override_get_db
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def _seed(practice_mode: str = "word_selection_quiz") -> None:
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
    for order, (item_id, text, translation) in enumerate(_WORDS, start=1):
        db.add(
            ContentItem(
                id=item_id,
                content_id=1,
                order_index=order,
                text=text,
                translation=translation,
            )
        )
    db.commit()
    db.add(
        Assignment(
            id=1,
            title="quiz",
            classroom_id=1,
            teacher_id=1,
            practice_mode=practice_mode,
            show_image=False,
            shuffle_questions=True,
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
            status=AssignmentStatus.NOT_STARTED,
            is_active=True,
            assigned_at=datetime.now(timezone.utc),
        )
    )
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


def _start_answer_complete() -> dict:
    """Student starts, answers every item (item 1 wrong), completes.
    Returns {content_item_id: options} exactly as the start endpoint shipped them."""
    headers = _student_headers()
    start = client.get(
        "/api/students/assignments/1/vocabulary/selection_quiz/start",
        headers=headers,
    )
    assert start.status_code == 200, start.text
    body = start.json()
    session_id = body["session_id"]
    start_options = {}
    for word in body["words"]:
        start_options[word["content_item_id"]] = word["options"]
        selected = (
            "wrong-pick" if word["content_item_id"] == 1 else word["correct_text"]
        )
        resp = client.post(
            "/api/students/assignments/1/vocabulary/selection_quiz/answer",
            headers=headers,
            json={
                "content_item_id": word["content_item_id"],
                "selected_answer": selected,
                "time_spent_seconds": 0,
                "session_id": session_id,
            },
        )
        assert resp.status_code == 200, resp.text
    done = client.post(
        "/api/students/assignments/1/vocabulary/selection_quiz/complete",
        headers=headers,
        json={"session_id": session_id},
    )
    assert done.status_code == 200, done.text
    return start_options


def _grading_view() -> dict:
    resp = client.get(
        "/api/teachers/assignments/1/submissions/1", headers=_teacher_headers()
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _options_by_item(view: dict) -> dict:
    return {q["content_item_id"]: q["options"] for q in view["submissions"]}


def test_grading_options_match_start_endpoint(setup_database):
    """V8: same item + same settings → identical options (text AND order)."""
    _seed()
    start_options = _start_answer_complete()
    view = _grading_view()
    assert _options_by_item(view) == start_options

    db = TestingSessionLocal()
    try:
        answers = db.query(PracticeAnswer).all()
    finally:
        db.close()
    assert answers
    for ans in answers:
        assert ans.answer_data["options_shown"] == start_options[ans.content_item_id]


def test_grading_options_survive_setting_change(setup_database):
    """V8: teacher flips show_image after the quiz → grading still shows options_shown."""
    _seed()
    start_options = _start_answer_complete()

    db = TestingSessionLocal()
    try:
        assignment = db.query(Assignment).filter_by(id=1).one()
        assignment.show_image = True  # answer key flips from translation → text
        db.commit()
    finally:
        db.close()

    view = _grading_view()
    assert _options_by_item(view) == start_options
    assert view["quiz_settings"]["show_image"] is True


def test_legacy_answers_without_options_shown_fallback(setup_database):
    """V8: legacy rows (no options_shown) rebuild options with the same seed, no error."""
    _seed()
    start_options = _start_answer_complete()

    db = TestingSessionLocal()
    try:
        for ans in db.query(PracticeAnswer).all():
            data = dict(ans.answer_data)
            data.pop("options_shown", None)
            ans.answer_data = data
        db.commit()
    finally:
        db.close()

    view = _grading_view()
    assert _options_by_item(view) == start_options


def test_grading_view_ships_question_area_fields(setup_database):
    """V8: per-question image_url / blanked_sentence / deduction + top-level quiz_settings."""
    _seed()
    _start_answer_complete()

    db = TestingSessionLocal()
    try:
        db.add(
            StudentItemProgress(
                student_assignment_id=1,
                content_item_id=1,
                teacher_review_score=2.5,
            )
        )
        db.commit()
    finally:
        db.close()

    view = _grading_view()
    questions = {q["content_item_id"]: q for q in view["submissions"]}
    assert set(questions) == {w[0] for w in _WORDS}
    for q in questions.values():
        assert "image_url" in q
        assert "blanked_sentence" in q
    assert questions[1]["deduction"] == 2.5
    assert questions[1]["is_correct"] is False
    assert questions[2]["deduction"] is None
    assert set(view["quiz_settings"]) == {
        "show_example_sentence",
        "show_image",
        "show_option_images",
        "show_translation",
        "show_word",
    }


def test_non_selection_quiz_has_no_options(setup_database):
    """Spelling quiz: options is None (no fallback rebuild), view still loads."""
    _seed("word_spelling_quiz")
    view = _grading_view()
    assert all(q["options"] is None for q in view["submissions"])
