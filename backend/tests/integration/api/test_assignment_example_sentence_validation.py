"""
Issue #673 / #757: example-sentence + example-audio validation on assignment
create/update.

When teachers attach vocabulary content to a practice mode that reads from
example_sentence (reading / rearrangement / word_cloze), every selected vocab
item must carry both example_sentence and example_sentence_translation.
Otherwise the student-side experience silently degrades — the bug we're
preventing here. The API rejects the request with 422 and a structured detail
the frontend can localize.

Issue #757 adds a second-stage audio check for the listening flavours of the
same modes (reading / rearrangement+play_audio / word_cloze+play_audio):
dispatch no longer backfills missing TTS, so we must block dispatch when the
source vocab set lacks ``example_sentence_audio_url`` and surface a distinct
``EXAMPLE_AUDIO_REQUIRED`` code so the frontend can point teachers back to the
content editor.
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
                example_sentence_audio_url=it.get("example_sentence_audio_url"),
                cloze_answer=it.get("cloze_answer"),
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
                # Issue #757: reading mode needs example audio at dispatch
                "example_sentence_audio_url": "https://cdn/example/apple.mp3",
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


# --- Issue #860: show_example_sentence gates example + cloze requirement ----


@pytest.mark.parametrize("practice_mode", ["word_selection", "word_selection_quiz"])
def test_create_rejects_example_flag_when_sentence_missing(fresh_db, practice_mode):
    """With show_example_sentence on, the selection family DOES need example
    sentences — the题目 becomes a blanked example. Missing sentence ⇒ 422."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Word-only",
        [{"text": "cat", "translation": "貓"}],  # no example sentence
    )
    db.close()

    token = _login_teacher()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [content_id],
            practice_mode=practice_mode,
            show_example_sentence=True,
        ),
    )
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "EXAMPLE_SENTENCE_REQUIRED"
    assert detail["content_titles"] == ["Word-only"]


@pytest.mark.parametrize("practice_mode", ["word_selection", "word_selection_quiz"])
def test_create_rejects_example_flag_when_cloze_answer_missing(fresh_db, practice_mode):
    """Sentence + translation present but no cloze_answer ⇒ CLOZE_ANSWER_REQUIRED
    (we must know which word to blank out, same as word_cloze)."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "No-Cloze",
        [
            {
                "text": "apple",
                "translation": "蘋果",
                "example_sentence": "I eat an apple.",
                "example_sentence_translation": "我吃一顆蘋果。",
                # cloze_answer deliberately omitted
            }
        ],
    )
    db.close()

    token = _login_teacher()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [content_id],
            practice_mode=practice_mode,
            show_example_sentence=True,
        ),
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "CLOZE_ANSWER_REQUIRED"


@pytest.mark.parametrize("practice_mode", ["word_selection", "word_selection_quiz"])
def test_create_allows_example_flag_with_full_data(fresh_db, practice_mode):
    """Full example sentence + translation + matching cloze_answer ⇒ 200."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Complete",
        [
            {
                "text": "apple",
                "translation": "蘋果",
                "example_sentence": "I eat an apple.",
                "example_sentence_translation": "我吃一顆蘋果。",
                "cloze_answer": "apple",
            }
        ],
    )
    db.close()

    token = _login_teacher()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [content_id],
            practice_mode=practice_mode,
            show_example_sentence=True,
        ),
    )
    assert resp.status_code == 200, resp.text


def test_create_without_example_flag_stays_permissive(fresh_db):
    """Regression guard: word_selection_quiz WITHOUT the flag must still be
    dispatchable on a vocab set that has no example sentences at all."""
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
            seed["classroom_id"],
            [content_id],
            practice_mode="word_selection_quiz",
            show_example_sentence=False,
        ),
    )
    assert resp.status_code == 200, resp.text


def test_instant_practice_reconfigure_validates_example_flag(fresh_db):
    """Issue #860: 即刻練習 reconfigure（老師在練習畫面切到「顯示例句」）也必須
    驗證教材有例句 + cloze 答案。少了守衛會回 200，學生端卻靜默退回一般題型，
    老師不知道資料不足 —— 與其他所有寫入路徑不一致。"""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    no_example = _add_vocab_content(
        db,
        seed["lesson_id"],
        "NoExample",
        [
            {"text": "cat", "translation": "貓"},
            {"text": "dog", "translation": "狗"},
            {"text": "bird", "translation": "鳥"},
            {"text": "fish", "translation": "魚"},
        ],
    )
    db.close()

    token = _login_teacher()
    headers = {"Authorization": f"Bearer {token}"}
    created = client.post(
        "/api/teachers/instant-practice/create",
        headers=headers,
        json={
            "content_id": no_example,
            "classroom_id": seed["classroom_id"],
            "practice_mode": "word_selection",
            "show_image": False,
        },
    )
    assert created.status_code == 200, created.text
    assignment_id = created.json()["assignment_id"]

    # 切到「顯示例句」— 教材沒有例句，應被擋下
    resp = client.patch(
        f"/api/teachers/instant-practice/{assignment_id}/reconfigure",
        headers=headers,
        json={
            "practice_mode": "word_selection",
            "show_example_sentence": True,
            "show_image": False,
        },
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "EXAMPLE_SENTENCE_REQUIRED"


def test_put_uses_persisted_example_flag_when_not_resent(fresh_db):
    """Issue #860 回歸：PUT（換 content_ids）通常不會重送 show_example_sentence。
    若當成 False，已開啟例句挖空的作業就能換上「沒有例句」的教材而驗證不到。
    必須沿用作業上已存的旗標來驗證。"""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    good = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Good",
        [
            {
                "text": "apple",
                "translation": "蘋果",
                "example_sentence": "I eat an apple.",
                "example_sentence_translation": "我吃一顆蘋果。",
                "cloze_answer": "apple",
            }
        ],
    )
    bad = _add_vocab_content(
        db,
        seed["lesson_id"],
        "NoExample",
        [{"text": "dog", "translation": "狗"}],  # 無例句
    )
    db.close()

    token = _login_teacher()
    created = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [good],
            practice_mode="word_selection_quiz",
            show_example_sentence=True,
        ),
    )
    assert created.status_code == 200, created.text
    assignment_id = created.json()["assignment_id"]

    # 換成沒有例句的教材，且「不重送」show_example_sentence
    resp = client.put(
        f"/api/teachers/assignments/{assignment_id}",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [bad],
            title="換教材",
            practice_mode="word_selection_quiz",
        ),
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "EXAMPLE_SENTENCE_REQUIRED"


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
                "example_sentence_audio_url": "https://cdn/example/cat.mp3",
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
                "example_sentence_audio_url": "https://cdn/example/cat.mp3",
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
    """PATCH skips example-sentence-text validation (practice_mode and
    content_ids are immutable here, so the create/PUT text check still
    holds). Issue #757 added a narrow exception for play_audio toggles —
    covered separately in test_patch_rejects_play_audio_toggle_*. This
    test still pins the broader contract for metadata-only updates."""
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
                "example_sentence_audio_url": "https://cdn/example/cat.mp3",
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


# --- Issue #757: example-audio validation ---------------------------------


def _full_text_item(*, audio_url: str | None = "https://cdn/example/cat.mp3") -> dict:
    """A vocab item with sentence + translation, optionally with audio."""
    return {
        "text": "cat",
        "translation": "貓",
        "example_sentence": "The cat is sleeping.",
        "example_sentence_translation": "貓在睡覺。",
        "example_sentence_audio_url": audio_url,
        # Issue #632: a complete vocab item carries a confirmed cloze answer so
        # word_cloze dispatch isn't blocked by the cloze-answer guard.
        "cloze_answer": "cat",
    }


def test_create_rejects_reading_when_example_audio_missing(fresh_db):
    """reading mode must have example_sentence_audio_url — the student-side
    speech assessment plays the sentence audio as the prompt."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "No Audio Set",
        [_full_text_item(audio_url=None)],
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

    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "EXAMPLE_AUDIO_REQUIRED"
    assert detail["practice_mode"] == "reading"
    assert detail["content_titles"] == ["No Audio Set"]


def test_create_rejects_rearrangement_when_play_audio_and_audio_missing(fresh_db):
    """rearrangement + play_audio (聽力重組) needs the sentence audio."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Listening Rearrange",
        [_full_text_item(audio_url="")],  # empty == missing
    )
    db.close()

    token = _login_teacher()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [content_id],
            practice_mode="rearrangement",
            play_audio=True,
        ),
    )

    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "EXAMPLE_AUDIO_REQUIRED"
    assert resp.json()["detail"]["play_audio"] is True


def test_create_allows_rearrangement_without_play_audio_when_audio_missing(fresh_db):
    """rearrangement without play_audio is pure text — audio not required."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Text Rearrange",
        [_full_text_item(audio_url=None)],
    )
    db.close()

    token = _login_teacher()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [content_id],
            practice_mode="rearrangement",
            play_audio=False,
        ),
    )
    assert resp.status_code == 200, resp.text


def test_create_rejects_word_cloze_when_play_audio_and_audio_missing(fresh_db):
    """word_cloze + play_audio (聽力克漏字) needs the sentence audio."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Listening Cloze",
        [_full_text_item(audio_url=None)],
    )
    db.close()

    token = _login_teacher()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [content_id],
            practice_mode="word_cloze",
            play_audio=True,
        ),
    )

    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "EXAMPLE_AUDIO_REQUIRED"


def test_create_allows_word_cloze_without_play_audio_when_audio_missing(fresh_db):
    """word_cloze without play_audio (pure text cloze) doesn't need audio."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Text Cloze",
        [_full_text_item(audio_url=None)],
    )
    db.close()

    token = _login_teacher()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [content_id],
            practice_mode="word_cloze",
            play_audio=False,
        ),
    )
    assert resp.status_code == 200, resp.text


def test_create_rejects_word_cloze_when_cloze_answer_not_set(fresh_db):
    """Issue #632: dispatching word_cloze on a vocab set whose items have no
    confirmed cloze_answer must be blocked — even when the answer would be
    auto-extractable — so the teacher sets/reviews it first."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    # Complete item (sentence + translation + audio) but cloze_answer omitted.
    item = _full_text_item()
    item.pop("cloze_answer")
    content_id = _add_vocab_content(db, seed["lesson_id"], "Unconfirmed Cloze", [item])
    db.close()

    token = _login_teacher()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [content_id],
            practice_mode="word_cloze",
            play_audio=False,
        ),
    )

    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "CLOZE_ANSWER_REQUIRED"
    assert detail["content_titles"] == ["Unconfirmed Cloze"]


def test_create_audio_validation_lists_only_offenders(fresh_db):
    """Audio-validation detail should list every content with missing audio
    so the frontend can render a useful 'fix these vocab sets' message."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    bad_a = _add_vocab_content(
        db, seed["lesson_id"], "Bad A", [_full_text_item(audio_url=None)]
    )
    bad_b = _add_vocab_content(
        db, seed["lesson_id"], "Bad B", [_full_text_item(audio_url="")]
    )
    good = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Good",
        [_full_text_item(audio_url="https://cdn/example/good.mp3")],
    )
    db.close()

    token = _login_teacher()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [bad_a, bad_b, good],
            practice_mode="reading",
        ),
    )

    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "EXAMPLE_AUDIO_REQUIRED"
    assert sorted(resp.json()["detail"]["content_titles"]) == ["Bad A", "Bad B"]


def test_create_audio_check_skips_word_selection(fresh_db):
    """word_selection doesn't play sentence audio — missing audio is fine."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "No Audio Set",
        [_full_text_item(audio_url=None)],
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


def test_create_audio_check_runs_after_sentence_check(fresh_db):
    """When BOTH the sentence text and audio are missing, the text check
    fires first so teachers fix the more fundamental data problem before
    they see the audio nag."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Totally Empty",
        [{"text": "x", "translation": "甲"}],
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
    assert resp.json()["detail"]["code"] == "EXAMPLE_SENTENCE_REQUIRED"


# --- Issue #757: PATCH play_audio toggle audio validation -----------------


def test_patch_rejects_play_audio_toggle_when_audio_missing(fresh_db):
    """Toggling play_audio True on an existing rearrangement assignment whose
    copy contents lack example audio must be blocked — otherwise students
    would open the activity to silent audio prompts."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    # Create assignment in rearrangement (text-only) mode, with sentence
    # text + translation but NO audio — that's a legal create payload because
    # play_audio defaults to False.
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Text-Only Set",
        [_full_text_item(audio_url=None)],
    )
    db.close()

    token = _login_teacher()
    create_resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [content_id],
            practice_mode="rearrangement",
            play_audio=False,
        ),
    )
    assert create_resp.status_code == 200, create_resp.text
    assignment_id = create_resp.json()["assignment_id"]

    # Now PATCH play_audio → True. Backend must validate the copy contents.
    patch_resp = client.patch(
        f"/api/teachers/assignments/{assignment_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"play_audio": True},
    )
    assert patch_resp.status_code == 422, patch_resp.text
    assert patch_resp.json()["detail"]["code"] == "EXAMPLE_AUDIO_REQUIRED"


def test_patch_allows_play_audio_toggle_when_audio_present(fresh_db):
    """Same flow but the vocab set DOES have audio — toggle should succeed."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Audio Set",
        [_full_text_item(audio_url="https://cdn/example/cat.mp3")],
    )
    db.close()

    token = _login_teacher()
    create_resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [content_id],
            practice_mode="rearrangement",
            play_audio=False,
        ),
    )
    assignment_id = create_resp.json()["assignment_id"]

    patch_resp = client.patch(
        f"/api/teachers/assignments/{assignment_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"play_audio": True},
    )
    assert patch_resp.status_code == 200, patch_resp.text


def test_patch_allows_play_audio_toggle_off_without_validation(fresh_db):
    """Turning play_audio OFF is always safe — never validate audio."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Audio Set",
        [_full_text_item(audio_url="https://cdn/example/cat.mp3")],
    )
    db.close()

    token = _login_teacher()
    create_resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [content_id],
            practice_mode="rearrangement",
            play_audio=True,
        ),
    )
    assignment_id = create_resp.json()["assignment_id"]

    patch_resp = client.patch(
        f"/api/teachers/assignments/{assignment_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"play_audio": False},
    )
    assert patch_resp.status_code == 200, patch_resp.text


def test_patch_skips_audio_check_for_modes_that_dont_need_audio(fresh_db):
    """play_audio True on word_selection (which doesn't read sentence audio
    at all) should not trigger the audio check."""
    db = TestingSessionLocal()
    seed = _seed_minimal(db)
    content_id = _add_vocab_content(
        db,
        seed["lesson_id"],
        "Word-only Set",
        [{"text": "cat", "translation": "貓"}],  # no example, no audio
    )
    db.close()

    token = _login_teacher()
    create_resp = client.post(
        "/api/teachers/assignments/create",
        headers={"Authorization": f"Bearer {token}"},
        json=_create_payload(
            seed["classroom_id"],
            [content_id],
            practice_mode="word_selection",
        ),
    )
    assignment_id = create_resp.json()["assignment_id"]

    patch_resp = client.patch(
        f"/api/teachers/assignments/{assignment_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"play_audio": True},
    )
    assert patch_resp.status_code == 200, patch_resp.text


if __name__ == "__main__":
    print(
        "Run: pytest tests/integration/api/test_assignment_example_sentence_validation.py -v"
    )
