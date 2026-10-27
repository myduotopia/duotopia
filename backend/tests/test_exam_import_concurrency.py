"""
上傳題本匯入 API：C2 review 修正的測試（Issue #1112）。AI 呼叫與 GCS 一律 mock。

- 並發：AI 處理期間答案頁已存好 → AI 回來後用最新已知答案套到新卡、用量加總不被蓋掉
  （SQLite 沒有列鎖，只驗證邏輯與「AI 回來後才鎖、才讀」）
- 同一頁同時送兩次：條件式搶 processing，第二個 409；卡太久的 processing 可以重送
- 已存入的匯入不能放棄（409）
- 跨頁合併過的題組重試：只換那一題；比不到題號 422（用量照記）
- AI 回應被擋：照記用量、頁標失敗
- 重複比對：題庫題目含 ``{{n}}``、選項順序不同也算相同
- 送頁與重試的跨老師 404
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import update
from sqlalchemy.orm import Session

from models import ExamImport, ExamImportPage, ExamImportUsage, Question, QuestionOption
from services import exam_import_service as eis
from services.exam_paper_service import (
    CallUsage,
    ExamPaperService,
    response_text_and_usage,
)
from services.question_bank_service import normalize_stem
from tests.test_exam_import_api import (  # noqa: F401  (fixtures)
    BASE,
    _create,
    _headers,
    _page,
    _png,
    _q,
    _send,
    _single,
    admin,
    fake_ai,
    fake_storage,
    other_teacher,
    teacher,
)


def _retry(client, teacher, import_id, page_no, image, **data):
    return client.post(
        f"{BASE}/{import_id}/pages/{page_no}/retry",
        files={"file": ("page.png", image, "image/png")},
        data=data,
        headers=_headers(teacher),
    )


def _get(client, teacher, import_id):
    return client.get(f"{BASE}/{import_id}", headers=_headers(teacher)).json()


# ---------------------------------------------------------------- 並發


def test_answer_page_saved_during_ai_call_is_applied(
    test_client, shared_test_session, teacher, fake_ai, fake_storage, monkeypatch
):
    """第 1 頁送 AI 的期間，另一個請求已存好答案頁（第 2 頁）並加總用量。"""
    imp = _create(test_client, teacher, pages=2).json()
    import_id = imp["id"]
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "First?", ["a", "b", "c"], ai=[0]),
            _single("2", "Second?", ["a", "b", "c"], ai=[0]),
        ),
    )
    events = []
    real_call = ExamPaperService._call_model

    async def call_while_other_request_commits(self, image_bytes, mime_type, prompt):
        events.append("ai")
        # 另一個連線（另一個請求）在這段時間寫入答案頁與它的用量
        with Session(bind=shared_test_session.get_bind()) as other:
            other.execute(
                update(ExamImport)
                .where(ExamImport.id == import_id)
                .values(
                    known_answers={"1": [2]},
                    ai_call_count=1,
                    input_tokens=1000,
                    output_tokens=200,
                    thinking_tokens=300,
                    estimated_cost_usd=0.01,
                )
            )
            other.execute(
                update(ExamImportPage)
                .where(
                    ExamImportPage.import_id == import_id,
                    ExamImportPage.page_no == 2,
                )
                .values(
                    status="done",
                    is_answer_page=True,
                    answer_key={"1": [2]},
                    cards=[],
                )
            )
            other.commit()
        return await real_call(self, image_bytes, mime_type, prompt)

    real_lock = eis.lock_import

    def spy_lock(db, iid):
        events.append("lock")
        return real_lock(db, iid)

    monkeypatch.setattr(
        ExamPaperService, "_call_model", call_while_other_request_commits
    )
    monkeypatch.setattr(eis, "lock_import", spy_lock)

    resp = _send(test_client, teacher, import_id, 1, _png("p1"))
    assert resp.status_code == 200, resp.text
    assert events == ["ai", "lock"]  # AI 回來後才鎖、才讀最新資料

    cards = resp.json()["page"]["cards"]
    q1, q2 = (c["question"] for c in cards)
    # 本頁 AI 回應裡沒有答案表，仍套用等待期間存好的答案頁答案
    assert q1["correct_indexes"] == [2] and q1["answer_source"] == "answer_page"
    assert q2["correct_indexes"] == [0] and q2["answer_source"] == "ai"

    row = shared_test_session.get(ExamImport, import_id)
    shared_test_session.refresh(row)
    # 加總：另一個請求的 1 次＋本頁 1 次（沒有被舊值蓋掉）
    assert row.ai_call_count == 2
    assert (row.input_tokens, row.output_tokens, row.thinking_tokens) == (
        2000,
        400,
        600,
    )
    assert row.status == "ready"


def test_same_page_sent_twice_second_gets_409(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    imp = _create(test_client, teacher, pages=1).json()
    page = (
        shared_test_session.query(ExamImportPage).filter_by(import_id=imp["id"]).one()
    )
    page.status = "processing"
    page.updated_at = datetime.now(timezone.utc)
    shared_test_session.commit()

    fake_ai.on(_png("p1"), _page(_single("1", "Q?", ["a", "b"], ai=[0])))
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_PAGE_BUSY"
    assert fake_ai.prompts == []  # 沒有送 AI

    # 卡在 processing 太久（請求中途斷掉）→ 可以重送
    page = (
        shared_test_session.query(ExamImportPage).filter_by(import_id=imp["id"]).one()
    )
    page.updated_at = (
        datetime.now(timezone.utc) - eis.STALE_PROCESSING - timedelta(minutes=1)
    )
    shared_test_session.commit()
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 200, resp.text
    assert resp.json()["page"]["status"] == "done"


# ---------------------------------------------------------------- 放棄


def test_saved_import_cannot_be_abandoned(
    test_client, shared_test_session, teacher, fake_storage
):
    imp = _create(test_client, teacher, pages=2).json()
    row = shared_test_session.get(ExamImport, imp["id"])
    row.status = "saved"
    shared_test_session.commit()

    resp = test_client.delete(f"{BASE}/{imp['id']}", headers=_headers(teacher))
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_NOT_ABANDONABLE"
    assert fake_storage["deleted"] == []
    shared_test_session.expire_all()
    assert shared_test_session.get(ExamImport, imp["id"]).status == "saved"
    assert (
        shared_test_session.query(ExamImportPage).filter_by(import_id=imp["id"]).count()
        == 2
    )


# ---------------------------------------------------------------- 重試跨頁題組


def _cross_page_cloze(test_client, teacher, fake_ai):
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
        "questions": [
            {**_q("42", "", ["are", "is"], ai=[0], blank=1), "unreadable": True}
        ],
    }
    fake_ai.on(_png("p1"), _page(cloze))
    fake_ai.on(_png("p2"), _page(cont, _single("43", "After?", ["a", "b"], ai=[0])))
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    _send(test_client, teacher, imp["id"], 2, _png("p2"))
    data = _get(test_client, teacher, imp["id"])
    merged = data["pages"][0]["cards"][-1]
    assert merged["pages"] == [1, 2]
    return imp, merged


def test_retry_question_in_cross_page_group_replaces_only_that_question(
    test_client, teacher, fake_ai, fake_storage
):
    imp, merged = _cross_page_cloze(test_client, teacher, fake_ai)
    assert merged["group"]["questions"][2]["status"] == "failed"

    # 重讀第 2 頁的第 42 題：AI 只回這一頁看得到的局部題組
    retry_img = _png("p2-retry")
    fake_ai.on(
        retry_img,
        _page(
            {
                "kind": "group",
                "group_type": "cloze",
                "continues_previous": True,
                "stimulus": {"kind": "text", "paragraphs": ["They {{1}} friends."]},
                "questions": [_q("42", "", ["are", "is"], ai=[0], blank=1)],
            }
        ),
    )
    resp = _retry(test_client, teacher, imp["id"], 2, retry_img, question_no="42")
    assert resp.status_code == 200, resp.text
    card = resp.json()["card"]
    assert card["card_id"] == merged["card_id"]
    assert card["pages"] == [1, 2]
    qs = card["group"]["questions"]
    assert [q["source_question_no"] for q in qs] == ["40", "41", "42"]
    assert [q["blank"] for q in qs] == [1, 2, 3]
    assert qs[2]["status"] == "ok" and qs[2]["options"] == ["are", "is"]
    # 其他頁併進來的素材保留
    assert card["group"]["stimulus"]["paragraphs"] == [
        "I {{1}} a cat and {{2}} a dog.",
        "They {{3}} friends.",
    ]
    data = _get(test_client, teacher, imp["id"])
    assert [c["kind"] for c in data["pages"][1]["cards"]] == ["single"]


def test_retry_cross_page_group_without_matching_number_is_422(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    imp, merged = _cross_page_cloze(test_client, teacher, fake_ai)
    retry_img = _png("p2-retry-miss")
    fake_ai.on(
        retry_img,
        _page(
            {
                "kind": "group",
                "group_type": "cloze",
                "stimulus": {"kind": "text", "paragraphs": ["They {{1}} friends."]},
                "questions": [_q("99", "", ["are", "is"], ai=[0], blank=1)],
            }
        ),
    )
    resp = _retry(
        test_client,
        teacher,
        imp["id"],
        2,
        retry_img,
        card_id=merged["card_id"],
        question_no="42",
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_RETRY_MERGED"
    # 合併題組沒被局部結果蓋掉，用量照記
    data = _get(test_client, teacher, imp["id"])
    assert data["pages"][0]["cards"][-1]["group"]["questions"][2]["status"] == "failed"
    calls = [u.call_type for u in shared_test_session.query(ExamImportUsage).all()]
    assert calls.count("retry_question") == 1


# ---------------------------------------------------------------- AI 回應被擋


def test_blocked_ai_response_records_usage_and_fails_page(
    test_client, shared_test_session, teacher, fake_storage, monkeypatch
):
    class Meta:
        prompt_token_count = 900
        candidates_token_count = 0
        thoughts_token_count = 100

    class Blocked:
        usage_metadata = Meta()

        @property
        def text(self):
            raise ValueError("blocked by safety filters")

    async def blocked_call(self, image_bytes, mime_type, prompt):
        return response_text_and_usage(Blocked(), "gemini-3.5-flash")

    monkeypatch.setattr(ExamPaperService, "_call_model", blocked_call)
    imp = _create(test_client, teacher, pages=1).json()
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 502
    usage = shared_test_session.query(ExamImportUsage).one()
    assert usage.succeeded is False
    assert (usage.input_tokens, usage.thinking_tokens) == (900, 100)
    page = shared_test_session.query(ExamImportPage).one()
    shared_test_session.refresh(page)
    assert page.status == "failed"
    # 失敗的頁可以整頁重送
    assert _get(test_client, teacher, imp["id"])["pages"][0]["status"] == "failed"


# ---------------------------------------------------------------- 重複比對


def test_bank_question_with_blank_token_and_shuffled_options_is_duplicate(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    s = shared_test_session
    stem = "I {{1}} a cat."
    q = Question(
        question_type="multiple_choice",
        stem=stem,
        normalized_stem=normalize_stem(stem),
        teacher_id=teacher.id,
        visibility="private",
    )
    q.options = [
        QuestionOption(order_index=0, text="have", is_correct=True),
        QuestionOption(order_index=1, text="has"),
    ]
    s.add(q)
    s.commit()

    imp = _create(test_client, teacher, pages=1).json()
    fake_ai.on(
        _png("p1"),
        _page(
            # 空格寫法不同、選項順序不同 → 相同
            _single("1", "I ____ a cat", ["has", "have"], ai=[1]),
            _single("2", "I ____ a dog", ["has", "have"], ai=[1]),
        ),
    )
    cards = _send(test_client, teacher, imp["id"], 1, _png("p1")).json()["page"][
        "cards"
    ]
    assert cards[0]["duplicate_of"] == {"type": "bank", "kind": "single", "id": q.id}
    assert cards[1]["duplicate_of"] is None


# ---------------------------------------------------------------- 跨老師


def test_other_teacher_cannot_send_page_or_retry(
    test_client, teacher, other_teacher, fake_ai, fake_storage
):
    imp = _create(test_client, teacher, pages=1).json()
    fake_ai.on(_png("p1"), _page(_single("1", "Q?", ["a", "b"], ai=[0])))
    assert (
        _send(test_client, other_teacher, imp["id"], 1, _png("p1")).status_code == 404
    )
    assert fake_ai.prompts == []

    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    resp = _retry(test_client, other_teacher, imp["id"], 1, _png("p1"), question_no="1")
    assert resp.status_code == 404
    assert len(fake_ai.prompts) == 1  # 只有老師自己那一次
