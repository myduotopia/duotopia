"""
Issue #673: example-sentence validation on assignment create/update.

When teachers attach vocabulary content to a practice mode that reads from
example_sentence (reading / rearrangement / word_cloze), every selected vocab
item must carry both example_sentence and example_sentence_translation.
Otherwise the student-side experience silently degrades — the bug we're
preventing here. The API rejects the request with 422 and a structured detail
the frontend can localize.
"""

import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from main import app
from database import Base, get_db
from models import (
    Teacher,
    Student,
    Classroom,
    ClassroomStudent,
    Program,
    Lesson,
    Content,
    ContentItem,
    Assignment,
    AssignmentContent,
    ContentType,
    SubscriptionPeriod,
)
from auth import get_password_hash


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_assignment_example_validation.db"
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
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db
client = TestClient(app)


@pytest.fixture(scope="function")
def fresh_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def _seed_minimal(db) -> dict:
    """Teacher + active subscription + classroom + student + lesson skeleton."""
    teacher = Teacher(
        name="測試教師",
        email="teacher@test.com",
        password_hash=get_password_hash("password123"),
        email_verified=True,
        is_active=True,
    )
    db.add(teacher)
    db.commit()

    now = datetime.now(timezone.utc)
    db.add(
        SubscriptionPeriod(
            teacher_id=teacher.id,
            plan_name="Tutor Teachers",
            amount_paid=299,
            quota_total=2000,
            quota_used=0,
            start_date=now,
            end_date=now + timedelta(days=30),
            payment_method="trial",
            payment_status="paid",
            status="active",
        )
    )

    classroom = Classroom(name="測試教室", teacher_id=teacher.id, is_active=True)
    db.add(classroom)
    db.commit()

    student = Student(
        name="測試學生",
        student_number="S001",
        password_hash=get_password_hash("student123"),
        birthdate=datetime(2010, 1, 1),
    )
    db.add(student)
    db.commit()
    db.add(
        ClassroomStudent(
            classroom_id=classroom.id, student_id=student.id, is_active=True
        )
    )

    program = Program(
        name="測試課程",
        teacher_id=teacher.id,
        classroom_id=classroom.id,
        is_template=False,
        is_active=True,
    )
    db.add(program)
    db.commit()

    lesson = Lesson(program_id=program.id, name="測試單元", order_index=1, is_active=True)
    db.add(lesson)
    db.commit()

    return {
        "teacher_id": teacher.id,
        "classroom_id": classroom.id,
        "student_id": student.id,
        "lesson_id": lesson.id,
    }


def _add_vocab_content(db, lesson_id: int, title: str, items: list[dict]) -> int:
    content = Content(
        lesson_id=lesson_id,
        title=title,
        type=ContentType.VOCABULARY_SET,
        order_index=1,
        is_active=True,
    )
    db.add(content)
    db.commit()
    for idx, it in enumerate(items, start=1):
        db.add(
            ContentItem(
                content_id=content.id,
                order_index=idx,
                text=it["text"],
                translation=it.get("translation", ""),
                audio_url=it.get("audio_url", ""),
                example_sentence=it.get("example_sentence"),
                example_sentence_translation=it.get("example_sentence_translation"),
            )
        )
    db.commit()
    return content.id


def _add_example_sentences_content(db, lesson_id: int, title: str) -> int:
    """Sentence-as-text content (different content type — not affected by this rule)."""
    content = Content(
        lesson_id=lesson_id,
        title=title,
        type=ContentType.EXAMPLE_SENTENCES,
        order_index=2,
        is_active=True,
    )
    db.add(content)
    db.commit()
    db.add(
        ContentItem(
            content_id=content.id,
            order_index=1,
            text="In the park there is a big tree.",
            translation="公園裡有一棵大樹。",
            audio_url="https://example.com/sentence.mp3",
            # Deliberately omit example_sentence fields — for this content type
            # the sentence lives in `text`, not `example_sentence`.
        )
    )
    db.commit()
    return content.id


def _login_teacher() -> str:
    resp = client.post(
        "/api/auth/teacher/login",
        json={"email": "teacher@test.com", "password": "password123"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _create_payload(classroom_id: int, content_ids: list[int], **overrides) -> dict:
    base = {
        "title": "測試作業",
        "description": "",
        "classroom_id": classroom_id,
        "content_ids": content_ids,
        "student_ids": [],
        "due_date": datetime.now(timezone.utc).isoformat(),
    }
    base.update(overrides)
    return base


# --- create_assignment validation -----------------------------------------


@pytest.mark.parametrize("practice_mode", ["reading", "rearrangement", "word_cloze"])
def test_create_rejects_vocab_missing_example_sentence(fresh_db, practice_mode):
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Animals",
        [
            {
                "text": "cat",
                "translation": "貓",
                "example_sentence": "The cat is sleeping.",
                "example_sentence_translation": "貓在睡覺。",
            },
            # Bad item: blank example_sentence
            {
                "text": "dog",
                "translation": "狗",
                "example_sentence": "",
                "example_sentence_translation": "狗在跑。",
            },
        ],
    )
    db.close()

    token = _login_teacher()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"], [content_id], practice_mode=practice_mode
        ),
    )

    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "EXAMPLE_SENTENCE_REQUIRED"
    assert detail["practice_mode"] == practice_mode
    assert detail["content_titles"] == ["Animals"]


def test_create_rejects_vocab_missing_example_translation(fresh_db):
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Park Words",
        [
            {
                "text": "tree",
                "translation": "樹",
                "example_sentence": "There is a tree.",
                "example_sentence_translation": "   ",  # whitespace-only ⇒ invalid
            },
        ],
    )
    db.close()

    token = _login_teacher()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"], [content_id], practice_mode="reading"
        ),
    )

    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["code"] == "EXAMPLE_SENTENCE_REQUIRED"
    assert detail["content_titles"] == ["Park Words"]


def test_create_lists_every_offending_content_when_multiple(fresh_db):
    """Frontend toast renders the list — confirm we send all offenders."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    bad_a = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Set A",
        [{"text": "a", "translation": "甲"}],  # totally missing
    )
    bad_b = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Set B",
        [
            {
                "text": "b",
                "translation": "乙",
                "example_sentence": "B is B.",
                "example_sentence_translation": "",
            }
        ],
    )
    good = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Set C",
        [
            {
                "text": "c",
                "translation": "丙",
                "example_sentence": "C is good.",
                "example_sentence_translation": "丙很好。",
            }
        ],
    )
    db.close()

    token = _login_teacher()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"], [bad_a, bad_b, good], practice_mode="reading"
        ),
    )

    assert resp.status_code == 422
    titles = resp.json()["detail"]["content_titles"]
    assert sorted(titles) == ["Set A", "Set B"]


def test_create_allows_vocab_content_with_full_example_data(fresh_db):
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Complete Set",
        [
            {
                "text": "apple",
                "translation": "蘋果",
                "example_sentence": "I eat an apple.",
                "example_sentence_translation": "我吃一顆蘋果。",
            }
        ],
    )
    db.close()

    token = _login_teacher()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"], [content_id], practice_mode="reading"
        ),
    )
    assert resp.status_code == 200, resp.text


def test_create_allows_example_sentences_content_without_example_fields(fresh_db):
    """EXAMPLE_SENTENCES content stores the sentence in `text` itself, so the
    rule should not apply even when example_sentence is blank."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_example_sentences_content(db, seed["lesson_id"], "Sentence Set")
    db.close()

    token = _login_teacher()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"], [content_id], practice_mode="reading"
        ),
    )
    assert resp.status_code == 200, resp.text


def test_create_allows_word_selection_on_vocab_without_examples(fresh_db):
    """word_selection doesn't read example_sentence; missing fields are fine."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Word-only",
        [{"text": "cat", "translation": "貓"}],
    )
    db.close()

    token = _login_teacher()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"], [content_id], practice_mode="word_selection"
        ),
    )
    assert resp.status_code == 200, resp.text


# --- update_assignment (PUT) validation ----------------------------------


def test_put_update_rejects_swapping_in_invalid_vocab(fresh_db):
    """Swapping content_ids to a vocab content missing example data should
    abort the update — and existing assignment metadata must remain
    untouched (we validate before mutation)."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    good = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Good",
        [
            {
                "text": "cat",
                "translation": "貓",
                "example_sentence": "The cat sleeps.",
                "example_sentence_translation": "貓睡覺。",
            }
        ],
    )
    bad = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Bad",
        [{"text": "dog", "translation": "狗"}],  # no example
    )
    db.close()

    token = _login_teacher()
    create_resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(seed["classroom_id"], [good], practice_mode="reading"),
    )
    assert create_resp.status_code == 200
    assignment_id = create_resp.json()["assignment_id"]

    update_resp = client.put(
        f"/api/teachers/assignments/{assignment_id}",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [bad],
            title="新標題",
            practice_mode="reading",
        ),
    )
    assert update_resp.status_code == 422
    assert update_resp.json()["detail"]["code"] == "EXAMPLE_SENTENCE_REQUIRED"

    # Pre-existing assignment unchanged
    db = TestingSessionLocal()
    a = db.query(Assignment).filter(Assignment.id == assignment_id).one()
    assert a.title == "測試作業"  # not "新標題"
    linked = (
        db.query(AssignmentContent)
        .filter(AssignmentContent.assignment_id == assignment_id)
        .all()
    )
    # Original `good` content still wired up (note: assignments duplicate
    # contents on create, so the linked content_id is the COPY of `good`,
    # but it must NOT be `bad` — and there must still be exactly one link).
    assert len(linked) == 1
    db.close()


def test_put_update_uses_existing_practice_mode_when_not_in_request(fresh_db):
    """If the PUT payload omits practice_mode, fall back to the assignment's
    current mode for validation. Ensures we can't bypass the rule by simply
    leaving the field out."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    good = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Good",
        [
            {
                "text": "cat",
                "translation": "貓",
                "example_sentence": "The cat.",
                "example_sentence_translation": "貓。",
            }
        ],
    )
    bad = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Bad",
        [{"text": "dog", "translation": "狗"}],
    )
    db.close()

    token = _login_teacher()
    create_resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(seed["classroom_id"], [good], practice_mode="reading"),
    )
    assignment_id = create_resp.json()["assignment_id"]

    payload = _create_payload(seed["classroom_id"], [bad])
    payload.pop("due_date", None)  # exercise minimal payload too
    # practice_mode intentionally absent
    resp = client.put(
        f"/api/teachers/assignments/{assignment_id}",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "EXAMPLE_SENTENCE_REQUIRED"


# --- patch_assignment is intentionally NOT validated -----------------------


def test_patch_does_not_validate_examples(fresh_db):
    """PATCH only updates metadata fields (title/description/...). It cannot
    change practice_mode or content_ids, so validation does not apply.
    This test pins the contract — if PATCH ever starts mutating those
    fields, the new path needs the validator hooked in (see the comment in
    routers/assignments/crud.py::patch_assignment)."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    good = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Good",
        [
            {
                "text": "cat",
                "translation": "貓",
                "example_sentence": "The cat.",
                "example_sentence_translation": "貓。",
            }
        ],
    )
    db.close()

    token = _login_teacher()
    create_resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(seed["classroom_id"], [good], practice_mode="reading"),
    )
    assignment_id = create_resp.json()["assignment_id"]

    resp = client.patch(
        f"/api/teachers/assignments/{assignment_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"title": "Renamed"},
    )
    assert resp.status_code == 200, resp.text


if __name__ == "__main__":
    print(
        "Run: pytest tests/integration/api/test_assignment_example_sentence_validation.py -v"
    )
