"""
上傳題本匯入 API 測試（Issue #1112 C2）。AI 呼叫與 GCS 一律 mock。

涵蓋：
- 每天 1 本（台灣時間自然日、放棄的不算）與 ``Teacher.is_admin`` 豁免；不佔 magic paste 額度
- 同一份題本（檔案雜湊）重複匯入 → 409 並回那次匯入 id；放棄後可再匯入
- 逐頁擷取：頁圖存檔、題目卡、用量列（thinking 分欄）與匯入加總
- 答案頁回填：先處理題目頁（AI 作答），答案頁晚到 → 改成答案頁答案；老師改過的不覆蓋
- 已知答案帶進後續頁的 prompt、答案來源 = answer_page
- 重複比對：自己題庫單題（題目＋選項）、題組（文字＋小題題目，選項不同也算）、同一份匯入內；
  別人的題目不比、部分小題相同不算
- 重試單一題、跨頁題組合併、放棄匯入、未完成列表
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm.attributes import flag_modified

from auth import create_access_token, get_password_hash
from models import (
    ExamImport,
    ExamImportPage,
    ExamImportUsage,
    ExamPoint,
    MagicPasteUsage,
    Question,
    QuestionGroup,
    QuestionOption,
    Teacher,
)
from services import exam_import_service as eis
from services import exam_import_storage
from services.exam_paper_service import CallUsage, ExamPaperService
from services.question_bank_service import normalize_stem

BASE = "/api/question-bank/exam-imports"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def _png(tag: str) -> bytes:
    return PNG + tag.encode()


# ---------------------------------------------------------------- fixtures


def _make_teacher(session, email: str, is_admin: bool = False) -> Teacher:
    t = Teacher(
        email=email,
        password_hash=get_password_hash("test123"),
        name=email.split("@")[0],
        is_active=True,
        is_demo=False,
        email_verified=True,
        is_admin=is_admin,
    )
    session.add(t)
    session.commit()
    session.refresh(t)
    return t


def _headers(teacher: Teacher) -> dict:
    token = create_access_token(data={"sub": str(teacher.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def teacher(shared_test_session):
    return _make_teacher(shared_test_session, "ei_a@duotopia.com")


@pytest.fixture
def other_teacher(shared_test_session):
    return _make_teacher(shared_test_session, "ei_b@duotopia.com")


@pytest.fixture
def admin(shared_test_session):
    return _make_teacher(shared_test_session, "ei_admin@duotopia.com", is_admin=True)


@pytest.fixture
def exam_points(shared_test_session):
    s = shared_test_session
    s.add(ExamPoint(code="grammar", names={"zh-TW": "文法", "en": "Grammar"}))
    s.add(ExamPoint(code="reading.main_idea", names={"zh-TW": "主旨", "en": "Main idea"}))
    s.commit()
    return {ep.code: ep.id for ep in s.query(ExamPoint).all()}


@pytest.fixture
def fake_storage(monkeypatch):
    stored, deleted = [], []

    def store(import_id, page_no, content, content_type):
        stored.append((import_id, page_no))
        return f"https://storage.example/exam_imports/{import_id}/page_{page_no}.png"

    def delete(import_id):
        deleted.append(import_id)
        return 1

    monkeypatch.setattr(exam_import_storage, "store_page_image", store)
    monkeypatch.setattr(exam_import_storage, "delete_import_images", delete)
    return {"stored": stored, "deleted": deleted}


class FakeAI:
    """依頁圖內容回預設 JSON；記下每次收到的 prompt。"""

    def __init__(self):
        self.responses = {}
        self.prompts = []

    def on(self, image: bytes, payload: dict):
        self.responses[image] = payload

    async def call(self, _self, image_bytes, mime_type, prompt):
        self.prompts.append(prompt)
        payload = self.responses[image_bytes]
        text = payload if isinstance(payload, str) else json.dumps(payload)
        return text, CallUsage(
            model="gemini-3.5-flash",
            input_tokens=1000,
            output_tokens=200,
            thinking_tokens=300,
        )


@pytest.fixture
def fake_ai(monkeypatch):
    ai = FakeAI()

    async def _call(self, image_bytes, mime_type, prompt):
        return await ai.call(self, image_bytes, mime_type, prompt)

    monkeypatch.setattr(ExamPaperService, "_call_model", _call)
    return ai


def _hash(tag: str) -> str:
    return hashlib.sha256(tag.encode()).hexdigest()


def _create(client, teacher, tag="paper", pages=3, accents=None):
    return client.post(
        BASE,
        json={
            "file_name": f"{tag}.pdf",
            "file_hash": _hash(tag),
            "page_count": pages,
            "tts_accents": accents or ["American English"],
            "settings": {"grade_min": 7, "grade_max": 9, "visibility": "private"},
        },
        headers=_headers(teacher),
    )


def _send(client, teacher, import_id, page_no, image):
    return client.post(
        f"{BASE}/{import_id}/pages/{page_no}",
        files={"file": ("page.png", image, "image/png")},
        headers=_headers(teacher),
    )


def _q(no, stem, options, **kw):
    return {
        "no": no,
        "box_2d": [100, 50, 200, 950],
        "stem": stem,
        "options": options,
        "printed_answer_indexes": kw.get("printed", []),
        "ai_answer_indexes": kw.get("ai", []),
        "explanation": kw.get("explanation", ""),
        "exam_point_codes": kw.get("codes", []),
        "blank": kw.get("blank"),
    }


def _single(no, stem, options, **kw):
    return {
        "kind": "single",
        "box_2d": [100, 50, 200, 950],
        "question": _q(no, stem, options, **kw),
    }


def _page(*units, answer_key=None, is_answer_page=False):
    return {
        "is_answer_page": is_answer_page,
        "answer_key": answer_key or [],
        "units": list(units),
    }


def _all_questions(data):
    out = {}
    for page in data["pages"]:
        for card in page["cards"]:
            qs = (
                [card["question"]]
                if card["kind"] == "single"
                else card["group"]["questions"]
            )
            for q in qs:
                out[q["source_question_no"]] = q
    return out


# ---------------------------------------------------------------- 建立：額度與重複


def test_requires_auth(test_client):
    assert test_client.get(BASE).status_code == 401


def test_create_import_makes_pending_pages(test_client, teacher):
    resp = _create(
        test_client, teacher, pages=4, accents=["British English", "British English"]
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["status"] == "processing"
    assert data["tts_accents"] == ["British English"]
    assert [p["page_no"] for p in data["pages"]] == [1, 2, 3, 4]
    assert all(p["status"] == "pending" for p in data["pages"])


@pytest.mark.parametrize(
    "body_patch",
    [
        {"page_count": 21},
        {"page_count": 0},
        {"tts_accents": []},
        {"tts_accents": ["Klingon"]},
        {"file_hash": "not-a-hash"},
    ],
)
def test_create_validation(test_client, teacher, body_patch):
    body = {
        "file_name": "x.pdf",
        "file_hash": _hash("x"),
        "page_count": 2,
        "tts_accents": ["American English"],
    }
    body.update(body_patch)
    resp = test_client.post(BASE, json=body, headers=_headers(teacher))
    assert resp.status_code == 422


def test_daily_limit_one_per_day(test_client, teacher):
    assert _create(test_client, teacher, tag="first").status_code == 201
    resp = _create(test_client, teacher, tag="second")
    assert resp.status_code == 429
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_DAILY_LIMIT"


def test_daily_limit_ignores_abandoned(test_client, teacher, fake_storage):
    first = _create(test_client, teacher, tag="first").json()
    assert (
        test_client.delete(
            f"{BASE}/{first['id']}", headers=_headers(teacher)
        ).status_code
        == 200
    )
    assert _create(test_client, teacher, tag="second").status_code == 201


def test_daily_limit_uses_taiwan_calendar_day(shared_test_session, teacher):
    # 台灣 10/27 00:30 = UTC 10/26 16:30；前一筆在台灣 10/26 23:30 = UTC 10/26 15:30 → 不同天
    s = shared_test_session
    s.add(
        ExamImport(
            teacher_id=teacher.id,
            file_name="old.pdf",
            file_hash=_hash("old"),
            page_count=1,
            created_at=datetime(2026, 10, 26, 15, 30, tzinfo=timezone.utc),
        )
    )
    s.commit()
    now = datetime(2026, 10, 26, 16, 30, tzinfo=timezone.utc)
    assert eis.count_today_imports(s, teacher.id, now) == 0
    same_day = datetime(2026, 10, 26, 15, 59, tzinfo=timezone.utc)
    assert eis.count_today_imports(s, teacher.id, same_day) == 1


def test_admin_is_not_limited(test_client, admin):
    for i in range(3):
        assert _create(test_client, admin, tag=f"admin-{i}").status_code == 201


def test_import_does_not_touch_magic_paste_quota(
    test_client, shared_test_session, teacher
):
    _create(test_client, teacher)
    assert shared_test_session.query(MagicPasteUsage).count() == 0


def test_duplicate_file_is_blocked_with_existing_id(test_client, admin):
    first = _create(test_client, admin, tag="same").json()
    resp = _create(test_client, admin, tag="same")
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["error"] == "EXAM_IMPORT_DUPLICATE"
    assert detail["existing_import_id"] == first["id"]


def test_duplicate_check_is_per_teacher_and_skips_abandoned(
    test_client, admin, other_teacher, fake_storage
):
    first = _create(test_client, admin, tag="same").json()
    # 別的老師上傳同一份 → 不擋
    assert _create(test_client, other_teacher, tag="same").status_code == 201
    # 放棄後再上傳 → 不擋
    test_client.delete(f"{BASE}/{first['id']}", headers=_headers(admin))
    assert _create(test_client, admin, tag="same").status_code == 201


# ---------------------------------------------------------------- 逐頁擷取與用量


def test_extract_page_writes_cards_and_usage(
    test_client, shared_test_session, teacher, exam_points, fake_ai, fake_storage
):
    imp = _create(test_client, teacher, pages=2).json()
    fake_ai.on(
        _png("p1"),
        _page(
            _single(
                "1",
                "I ___ a student.",
                ["am", "is", "are"],
                ai=[0],
                codes=["grammar", "made.up"],
            ),
            _single("2", "She ___ tall.", ["am", "is"], printed=[1]),
        ),
    )
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 200, resp.text
    page = resp.json()["page"]
    assert page["status"] == "done"
    assert page["image_url"].endswith("page_1.png")
    q1, q2 = (c["question"] for c in page["cards"])
    assert q1["source_question_no"] == "1"
    assert q1["correct_indexes"] == [0] and q1["answer_source"] == "ai"
    assert q1["exam_point_codes"] == ["grammar"]  # 清單外的 code 丟掉
    assert q1["exam_point_ids"] == [exam_points["grammar"]]
    assert q2["correct_indexes"] == [1] and q2["answer_source"] == "answer_page"
    assert all(c["tts_accent"] == "American English" for c in page["cards"])

    usage = shared_test_session.query(ExamImportUsage).all()
    assert len(usage) == 1
    assert (
        usage[0].input_tokens,
        usage[0].output_tokens,
        usage[0].thinking_tokens,
    ) == (1000, 200, 300)
    assert usage[0].call_type == "extract_page" and usage[0].page_no == 1
    row = shared_test_session.get(ExamImport, imp["id"])
    shared_test_session.refresh(row)
    assert row.ai_call_count == 1 and row.thinking_tokens == 300
    assert float(row.estimated_cost_usd) > 0
    assert row.question_count == 2


def test_failed_ai_output_still_records_usage(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    imp = _create(test_client, teacher, pages=1).json()
    fake_ai.on(_png("bad"), "this is not json")
    resp = _send(test_client, teacher, imp["id"], 1, _png("bad"))
    assert resp.status_code == 502
    usage = shared_test_session.query(ExamImportUsage).one()
    assert usage.succeeded is False
    page = shared_test_session.query(ExamImportPage).one()
    assert page.status == "failed"


def test_done_page_cannot_be_resent(test_client, teacher, fake_ai, fake_storage):
    imp = _create(test_client, teacher, pages=1).json()
    fake_ai.on(_png("p1"), _page(_single("1", "Q?", ["a", "b"], ai=[0])))
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 409


def test_rejects_pdf_page(test_client, teacher, fake_ai, fake_storage):
    imp = _create(test_client, teacher, pages=1).json()
    resp = test_client.post(
        f"{BASE}/{imp['id']}/pages/1",
        files={"file": ("p.pdf", b"%PDF-1.4 xxx", "application/pdf")},
        headers=_headers(teacher),
    )
    assert resp.status_code == 400


def test_other_teacher_cannot_touch_import(test_client, teacher, other_teacher):
    imp = _create(test_client, teacher).json()
    assert (
        test_client.get(
            f"{BASE}/{imp['id']}", headers=_headers(other_teacher)
        ).status_code
        == 404
    )
    assert (
        test_client.delete(
            f"{BASE}/{imp['id']}", headers=_headers(other_teacher)
        ).status_code
        == 404
    )


# ---------------------------------------------------------------- 答案頁


def test_answer_page_first_then_known_answers_used(
    test_client, teacher, fake_ai, fake_storage
):
    """先送最後一頁（答案頁）→ 已知答案帶進第 1 頁 prompt，答案來源 = 答案頁。"""
    imp = _create(test_client, teacher, pages=2).json()
    fake_ai.on(
        _png("key"),
        _page(
            answer_key=[{"no": "1", "answer": "(C)"}, {"no": "2", "answer": "A"}],
            is_answer_page=True,
        ),
    )
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "Pick one.", ["x", "y", "z"]),
            _single("2", "Pick two.", ["x", "y"], ai=[1]),
        ),
    )
    page2 = _send(test_client, teacher, imp["id"], 2, _png("key")).json()["page"]
    assert page2["is_answer_page"] is True
    assert page2["answer_key"] == {"1": [2], "2": [0]}

    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert '"1": [2]' in fake_ai.prompts[-1]  # 已知答案在 prompt 裡
    data = test_client.get(f"{BASE}/{imp['id']}", headers=_headers(teacher)).json()
    qs = _all_questions(data)
    assert (
        qs["1"]["correct_indexes"] == [2] and qs["1"]["answer_source"] == "answer_page"
    )
    # AI 也回了答案，但已知答案優先
    assert (
        qs["2"]["correct_indexes"] == [0] and qs["2"]["answer_source"] == "answer_page"
    )
    assert data["status"] == "ready"


def test_late_answer_page_backfills_ai_answers_but_not_teacher_edits(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    imp = _create(test_client, teacher, pages=2).json()
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "First?", ["a", "b", "c"], ai=[0]),
            _single("2", "Second?", ["a", "b", "c"], ai=[0]),
            _single("3", "Third?", ["a", "b", "c"], ai=[0]),
        ),
    )
    fake_ai.on(
        _png("key"),
        _page(
            answer_key=[
                {"no": "1", "answer": "B"},
                {"no": "2", "answer": "C"},
                {"no": "3", "answer": "C"},
            ],
            is_answer_page=True,
        ),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))

    # 模擬老師在確認畫面把第 2 題改成 B（C4 寫入的形狀）
    page = (
        shared_test_session.query(ExamImportPage)
        .filter_by(import_id=imp["id"], page_no=1)
        .one()
    )
    cards = json.loads(json.dumps(page.cards))
    q2 = cards[1]["question"]
    q2["correct_indexes"] = [1]
    q2["answer_source"] = "teacher"
    q2["teacher_edited"] = ["correct_indexes"]
    page.cards = cards
    flag_modified(page, "cards")
    shared_test_session.commit()

    _send(test_client, teacher, imp["id"], 2, _png("key"))
    data = test_client.get(f"{BASE}/{imp['id']}", headers=_headers(teacher)).json()
    qs = _all_questions(data)
    assert (
        qs["1"]["correct_indexes"] == [1] and qs["1"]["answer_source"] == "answer_page"
    )
    assert qs["2"]["correct_indexes"] == [1] and qs["2"]["answer_source"] == "teacher"
    assert (
        qs["3"]["correct_indexes"] == [2] and qs["3"]["answer_source"] == "answer_page"
    )
    assert data["known_answers"] == {"1": [1], "2": [2], "3": [2]}


def test_answer_table_on_question_page_applies_to_same_page(
    test_client, teacher, fake_ai, fake_storage
):
    imp = _create(test_client, teacher, pages=1).json()
    fake_ai.on(
        _png("p1"),
        _page(
            _single("5", "Q5?", ["a", "b"], ai=[0]),
            answer_key=[{"no": "5", "answer": "B"}],
        ),
    )
    page = _send(test_client, teacher, imp["id"], 1, _png("p1")).json()["page"]
    assert page["is_answer_page"] is False  # 有題目就不是答案頁
    q = page["cards"][0]["question"]
    assert q["correct_indexes"] == [1] and q["answer_source"] == "answer_page"


# ---------------------------------------------------------------- 重複比對


def _bank_single(s, teacher, stem, options, deleted=False):
    q = Question(
        question_type="multiple_choice",
        stem=stem,
        normalized_stem=normalize_stem(stem),
        teacher_id=teacher.id,
        visibility="public",
        is_active=not deleted,
        deleted_at=datetime.now(timezone.utc) if deleted else None,
    )
    q.options = [
        QuestionOption(order_index=i, text=t, is_correct=i == 0)
        for i, t in enumerate(options)
    ]
    s.add(q)
    s.commit()
    return q


def _bank_group(s, teacher, passage, stems):
    g = QuestionGroup(
        stimulus_type="passage",
        passage_text=passage,
        teacher_id=teacher.id,
        visibility="private",
    )
    s.add(g)
    s.flush()
    for i, stem in enumerate(stems):
        q = Question(
            question_type="reading",
            stem=stem,
            normalized_stem=normalize_stem(stem),
            teacher_id=teacher.id,
            group_id=g.id,
            group_order=i,
        )
        q.options = [
            QuestionOption(order_index=0, text="old A", is_correct=True),
            QuestionOption(order_index=1, text="old B"),
        ]
        s.add(q)
    s.commit()
    return g


def _group_unit(paragraphs, questions):
    return {
        "kind": "group",
        "group_type": "reading",
        "box_2d": [50, 50, 900, 950],
        "title": "A Story",
        "stimulus": {"kind": "text", "paragraphs": paragraphs},
        "questions": questions,
    }


def test_duplicates_against_own_bank(
    test_client, shared_test_session, teacher, other_teacher, fake_ai, fake_storage
):
    s = shared_test_session
    mine = _bank_single(s, teacher, "What time is it?", ["Two.", "Three."])
    _bank_single(s, other_teacher, "Where are you?", ["Home", "School"])  # 別人的：不比
    _bank_single(s, teacher, "Deleted question?", ["a", "b"], deleted=True)  # 已刪：不比
    group = _bank_group(
        s,
        teacher,
        "Tom likes apples. He eats one a day.",
        ["Who is Tom?", "What does he eat?"],
    )
    _bank_group(s, teacher, "Partial passage here.", ["Q one?", "Q two?"])

    imp = _create(test_client, teacher, pages=1).json()
    fake_ai.on(
        _png("p1"),
        _page(
            # 空白／大小寫／標點不同 → 相同
            _single("1", "what  time is it", ["two", "THREE"], ai=[0]),
            # 題目相同但選項不同 → 不同
            _single("2", "What time is it?", ["Two.", "Four."], ai=[0]),
            _single("3", "Where are you?", ["Home", "School"], ai=[0]),
            _single("4", "Deleted question?", ["a", "b"], ai=[0]),
            # 題組：文字＋小題題目相同、選項不同 → 相同
            _group_unit(
                ["Tom likes apples.", "He eats one a day!"],
                [
                    _q("5", "Who is Tom?", ["new a", "new b"], ai=[0]),
                    _q("6", "What does he eat?", ["x", "y"], ai=[0]),
                ],
            ),
            # 只有部分小題相同 → 不算
            _group_unit(
                ["Partial passage here."],
                [
                    _q("7", "Q one?", ["a", "b"], ai=[0]),
                    _q("8", "Another?", ["a", "b"], ai=[0]),
                ],
            ),
            # 同一份匯入內重複第 3 題
            _single("9", "where are you", ["home", "school"], ai=[0]),
        ),
    )
    cards = _send(test_client, teacher, imp["id"], 1, _png("p1")).json()["page"][
        "cards"
    ]
    dups = [c["duplicate_of"] for c in cards]
    assert dups[0] == {"type": "bank", "kind": "single", "id": mine.id}
    assert dups[1] is None
    assert dups[2] is None
    assert dups[3] is None
    assert dups[4] == {"type": "bank", "kind": "group", "id": group.id}
    assert dups[5] is None
    assert dups[6] == {"type": "import", "card_id": cards[2]["card_id"]}


# ---------------------------------------------------------------- 跨頁、重試、放棄、列表


def test_cross_page_group_is_merged(test_client, teacher, fake_ai, fake_storage):
    imp = _create(test_client, teacher, pages=2).json()
    cloze = {
        "kind": "group",
        "group_type": "cloze",
        "box_2d": [500, 50, 990, 950],
        "title": "Cloze",
        "stimulus": {"kind": "text", "paragraphs": ["I {{1}} a cat and {{2}} a dog."]},
        "questions": [
            _q("40", "", ["have", "has"], ai=[0], blank=1),
            _q("41", "", ["walk", "walks"], ai=[0], blank=2),
        ],
    }
    cont = {
        "kind": "group",
        "group_type": "cloze",
        "continues_previous": True,
        "box_2d": [0, 50, 300, 950],
        "stimulus": {"kind": "text", "paragraphs": ["They {{1}} friends."]},
        "questions": [_q("42", "", ["are", "is"], ai=[0], blank=1)],
    }
    fake_ai.on(_png("p1"), _page(_single("39", "Before?", ["a", "b"], ai=[0]), cloze))
    fake_ai.on(_png("p2"), _page(cont, _single("43", "After?", ["a", "b"], ai=[0])))
    # 先送第 2 頁：上一頁還沒處理，先留著
    _send(test_client, teacher, imp["id"], 2, _png("p2"))
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    data = test_client.get(f"{BASE}/{imp['id']}", headers=_headers(teacher)).json()
    p1, p2 = data["pages"]
    merged = p1["cards"][-1]
    assert merged["pages"] == [1, 2]
    assert [q["source_question_no"] for q in merged["group"]["questions"]] == [
        "40",
        "41",
        "42",
    ]
    assert [q["blank"] for q in merged["group"]["questions"]] == [1, 2, 3]
    assert merged["group"]["stimulus"]["paragraphs"][-1] == "They {{3}} friends."
    assert [c["kind"] for c in p2["cards"]] == ["single"]
    assert data["question_count"] == 5


def test_retry_single_question_replaces_card(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    imp = _create(test_client, teacher, pages=1).json()
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "Fine?", ["a", "b"], ai=[0]),
            {
                "kind": "single",
                "question": {
                    "no": "2",
                    "box_2d": [300, 50, 400, 950],
                    "unreadable": True,
                },
            },
        ),
    )
    cards = _send(test_client, teacher, imp["id"], 1, _png("p1")).json()["page"][
        "cards"
    ]
    assert cards[1]["status"] == "failed"
    failed_id = cards[1]["card_id"]

    retry_img = _png("p1-retry")
    fake_ai.on(retry_img, _page(_single("2", "Now readable?", ["yes", "no"], ai=[1])))
    resp = test_client.post(
        f"{BASE}/{imp['id']}/pages/1/retry",
        files={"file": ("page.png", retry_img, "image/png")},
        data={"card_id": failed_id},
        headers=_headers(teacher),
    )
    assert resp.status_code == 200, resp.text
    card = resp.json()["card"]
    assert card["card_id"] == failed_id
    assert card["status"] == "ok"
    assert card["question"]["stem"] == "Now readable?"
    assert 'question number "2"' in fake_ai.prompts[-1]
    calls = (
        shared_test_session.query(ExamImportUsage).order_by(ExamImportUsage.id).all()
    )
    assert [u.call_type for u in calls] == ["extract_page", "retry_question"]


def test_abandon_deletes_pages_and_images(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    imp = _create(test_client, teacher, pages=2).json()
    fake_ai.on(_png("p1"), _page(_single("1", "Q?", ["a", "b"], ai=[0])))
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    resp = test_client.delete(f"{BASE}/{imp['id']}", headers=_headers(teacher))
    assert resp.status_code == 200 and resp.json()["status"] == "abandoned"
    assert fake_storage["deleted"] == [imp["id"]]
    assert (
        shared_test_session.query(ExamImportPage).filter_by(import_id=imp["id"]).count()
        == 0
    )
    # 用量照留（之後算成本）
    assert (
        shared_test_session.query(ExamImportUsage)
        .filter_by(import_id=imp["id"])
        .count()
        == 1
    )
    assert (
        test_client.get(f"{BASE}/{imp['id']}", headers=_headers(teacher)).status_code
        == 404
    )


def test_list_unfinished_within_30_days(
    test_client, shared_test_session, admin, fake_storage
):
    s = shared_test_session
    recent = _create(test_client, admin, tag="recent").json()
    gone = _create(test_client, admin, tag="gone").json()
    test_client.delete(f"{BASE}/{gone['id']}", headers=_headers(admin))
    s.add(
        ExamImport(
            teacher_id=admin.id,
            file_name="ancient.pdf",
            file_hash=_hash("ancient"),
            page_count=1,
            created_at=datetime.now(timezone.utc) - timedelta(days=31),
        )
    )
    s.commit()
    items = test_client.get(BASE, headers=_headers(admin)).json()["items"]
    assert [i["id"] for i in items] == [recent["id"]]
    # 過期未完成的不擋重新上傳
    assert _create(test_client, admin, tag="ancient").status_code == 201
