"""Regression tests for #828 quiz-mode review fixes.

Covers the two behavioural guarantees flagged in PR #836 code review:

1. **Score integrity** — the selection quiz answer endpoint must compute
   ``is_correct`` server-side and IGNORE any client-supplied value, so a
   student cannot post ``is_correct=true`` for a wrong answer and fake 100%.
2. **Case-insensitive spelling** — the spelling quiz must accept answers that
   differ only in case (consistent with the cloze quiz).
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

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_quiz_828.db"
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


app.dependency_overrides[get_db] = _override_get_db
client = TestClient(app)


@pytest.fixture(scope="function")
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def _seed(practice_mode: str, *, show_image: bool) -> int:
    """Create teacher/student/classroom + a quiz assignment. Returns SA id."""
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
                id=1, content_id=1, order_index=1, text="Good morning", translation="早安"
            ),
            ContentItem(
                id=2,
                content_id=1,
                order_index=2,
                text="Good afternoon",
                translation="午安",
            ),
        ]
    )
    db.commit()
    assignment = Assignment(
        id=1,
        title="quiz",
        classroom_id=1,
        teacher_id=1,
        practice_mode=practice_mode,
        show_image=show_image,
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
    return 1


def _student_token() -> str:
    resp = client.post(
        "/api/auth/student/login", json={"id": 1, "password": "password123"}
    )
    return resp.json()["access_token"]


def test_selection_quiz_ignores_client_is_correct(setup_database):
    """A wrong answer with client is_correct=true must still score 0."""
    sa_id = _seed("word_selection_quiz", show_image=False)
    headers = {"Authorization": f"Bearer {_student_token()}"}

    start = client.get(
        f"/api/students/assignments/{sa_id}/vocabulary/selection_quiz/start",
        headers=headers,
    )
    assert start.status_code == 200, start.text
    session_id = start.json()["session_id"]

    # Answer BOTH questions WRONG but claim is_correct=true (the attack).
    for item_id, wrong in ((1, "午安"), (2, "早安")):
        resp = client.post(
            f"/api/students/assignments/{sa_id}/vocabulary/selection_quiz/answer",
            headers=headers,
            json={
                "content_item_id": item_id,
                "selected_answer": wrong,
                "is_correct": True,  # client lies
                "time_spent_seconds": 0,
                "session_id": session_id,
            },
        )
        assert resp.status_code == 200, resp.text
        # Server overrides the client value.
        assert resp.json()["is_correct"] is False

    done = client.post(
        f"/api/students/assignments/{sa_id}/vocabulary/selection_quiz/complete",
        headers=headers,
        json={"session_id": session_id},
    )
    assert done.status_code == 200, done.text
    assert done.json()["score"] == 0
    assert done.json()["correct_count"] == 0


def test_selection_quiz_correct_answer_scores(setup_database):
    """Sanity: a genuinely correct selection answer is accepted server-side."""
    sa_id = _seed("word_selection_quiz", show_image=False)
    headers = {"Authorization": f"Bearer {_student_token()}"}

    start = client.get(
        f"/api/students/assignments/{sa_id}/vocabulary/selection_quiz/start",
        headers=headers,
    )
    session_id = start.json()["session_id"]
    resp = client.post(
        f"/api/students/assignments/{sa_id}/vocabulary/selection_quiz/answer",
        headers=headers,
        json={
            "content_item_id": 1,
            "selected_answer": "早安",  # correct translation
            "is_correct": False,  # client lies the other way
            "time_spent_seconds": 0,
            "session_id": session_id,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_correct"] is True


def _seed_example_selection_quiz() -> int:
    """Issue #860: word_selection_quiz with show_example_sentence on, backed by a
    vocabulary set whose items carry example sentences + cloze answers."""
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
            type=ContentType.VOCABULARY_SET,
            order_index=1,
            is_active=True,
            is_assignment_copy=True,
        )
    )
    db.commit()
    db.add_all(
        [
            ContentItem(
                id=1,
                content_id=1,
                order_index=1,
                text="apple",
                translation="蘋果",
                example_sentence="I eat an apple.",
                example_sentence_translation="我吃一顆蘋果。",
                cloze_answer="apple",
            ),
            ContentItem(
                id=2,
                content_id=1,
                order_index=2,
                text="banana",
                translation="香蕉",
                example_sentence="The banana is yellow.",
                example_sentence_translation="香蕉是黃色的。",
                cloze_answer="banana",
            ),
            # Issue #860 回歸：cloze_answer 是原形但句中是變化形（apple → apples），
            # 挖空必須整個 apples 拿掉，不能殘留 "s" 洩漏答案。
            ContentItem(
                id=3,
                content_id=1,
                order_index=3,
                text="cup",
                translation="杯子",
                example_sentence="I have two cups.",
                example_sentence_translation="我有兩個杯子。",
                cloze_answer="cup",
            ),
            # Issue #860 回歸：沒設 cloze_answer 時要 fallback 到單字本身，
            # 否則整句連答案一起顯示（老師派發預覽實際踩到）。
            ContentItem(
                id=4,
                content_id=1,
                order_index=4,
                text="take pictures",
                translation="拍照",
                example_sentence="I love to take pictures of landscapes.",
                example_sentence_translation="我喜歡拍風景照。",
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
            show_example_sentence=True,
            shuffle_questions=False,
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
    return 1


def test_selection_quiz_start_ships_example_sentence_and_cloze(setup_database):
    """Issue #860: with show_example_sentence on, the start payload must carry
    the example sentence + cloze_answer for each word so the frontend can blank
    it, and echo show_example_sentence=True in the settings."""
    sa_id = _seed_example_selection_quiz()
    headers = {"Authorization": f"Bearer {_student_token()}"}

    start = client.get(
        f"/api/students/assignments/{sa_id}/vocabulary/selection_quiz/start",
        headers=headers,
    )
    assert start.status_code == 200, start.text
    body = start.json()
    assert body["show_example_sentence"] is True
    by_id = {w["content_item_id"]: w for w in body["words"]}
    assert by_id[1]["example_sentence"] == "I eat an apple."
    assert by_id[1]["cloze_answer"] == "apple"
    assert by_id[1]["blanked_sentence"] == "I eat an _."
    assert by_id[2]["cloze_answer"] == "banana"
    assert by_id[2]["blanked_sentence"] == "The _ is yellow."
    # 例句翻譯／音檔刻意不下放（會洩漏答案）
    assert "example_sentence_translation" not in by_id[1]
    assert "example_sentence_audio_url" not in by_id[1]


def test_selection_quiz_blanks_inflected_form_without_leaking_suffix(setup_database):
    """Issue #860 回歸：cloze_answer='cup' 但句中是 'cups' → 整個 cups 挖掉。
    先前前端用子字串比對會變成 'I have two _s.'，尾巴洩漏答案。"""
    sa_id = _seed_example_selection_quiz()
    headers = {"Authorization": f"Bearer {_student_token()}"}

    start = client.get(
        f"/api/students/assignments/{sa_id}/vocabulary/selection_quiz/start",
        headers=headers,
    )
    assert start.status_code == 200, start.text
    word = {w["content_item_id"]: w for w in start.json()["words"]}[3]
    assert word["blanked_sentence"] == "I have two _."
    assert "s." not in word["blanked_sentence"]
    assert word["cloze_answer"] == "cups"  # 實際出現在句中的變化形


def test_selection_quiz_blanks_without_stored_cloze_answer(setup_database):
    """Issue #860 回歸：沒設 cloze_answer 時 fallback 到單字本身。
    片語答案收合成單一格 —— 顯示格數等於洩漏答案是幾個字（選擇題不可洩漏）。"""
    sa_id = _seed_example_selection_quiz()
    headers = {"Authorization": f"Bearer {_student_token()}"}

    start = client.get(
        f"/api/students/assignments/{sa_id}/vocabulary/selection_quiz/start",
        headers=headers,
    )
    assert start.status_code == 200, start.text
    word = {w["content_item_id"]: w for w in start.json()["words"]}[4]
    assert word["blanked_sentence"] == "I love to _ of landscapes."
    assert "take pictures" not in word["blanked_sentence"]


def test_spelling_quiz_is_case_insensitive(setup_database):
    """Typing the right word in the wrong case is accepted (#828)."""
    sa_id = _seed("word_spelling_quiz", show_image=True)
    headers = {"Authorization": f"Bearer {_student_token()}"}

    start = client.get(
        f"/api/students/assignments/{sa_id}/vocabulary/spelling_quiz/start",
        headers=headers,
    )
    assert start.status_code == 200, start.text
    session_id = start.json()["session_id"]
    resp = client.post(
        f"/api/students/assignments/{sa_id}/vocabulary/spelling_quiz/answer",
        headers=headers,
        json={
            "content_item_id": 1,
            "typed_answer": "good MORNING",  # correct word, mixed case
            "time_spent_seconds": 0,
            "session_id": session_id,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_correct"] is True
