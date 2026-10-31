"""
上傳題本匯入：C2 第二輪修正的測試（Issue #1112，定案 18）。AI 呼叫與 GCS 一律 mock。

1. 送 AI 前 commit 釋放 DB 連線（整頁擷取與重試單一題）
2. AI 逾時 2 分鐘 → 該頁失敗、用量照記（504）；處理中超過 3 分鐘才可重送；claim_id：
   頁已被別的請求重搶時，舊請求只記用量、不寫結果也不把頁標失敗
   整頁重送每頁最多 2 次、重試單一題每張卡最多 2 次 → 409 ``EXAM_IMPORT_RETRY_LIMIT``
3. 鎖內整理結果出錯 → rollback → 標失敗並記用量
4. 重試指定題號、AI 回傳沒有那一題 → 422 ``EXAM_IMPORT_RETRY_EMPTY``；card_id＋題號不符 → 422
（第 5 條克漏字重編號在 tests/unit/test_exam_paper_cards.py）
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update
from sqlalchemy.orm import Session

from models import ExamImportPage, ExamImportUsage
from services import exam_import_service as eis
from services import exam_paper_service as eps
from services.exam_import_retry import MAX_QUESTION_RETRIES
from services.exam_paper_service import CallUsage, ExamPaperService
from tests.test_exam_import_api import (  # noqa: F401  (fixtures)
    BASE,
    _create,
    _headers,
    _page,
    _png,
    _send,
    _single,
    fake_ai,
    fake_storage,
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


def _page_row(session, import_id, page_no=1):
    session.expire_all()
    return (
        session.query(ExamImportPage)
        .filter_by(import_id=import_id, page_no=page_no)
        .one()
    )


def _usage(session):
    session.expire_all()
    return session.query(ExamImportUsage).order_by(ExamImportUsage.id).all()


@pytest.fixture
def broken_ai(monkeypatch):
    """每次都回無法解析的內容（AI 有回應、token 照算）。"""
    calls = []

    async def call(self, image_bytes, mime_type, prompt):
        calls.append(prompt)
        return "not json", CallUsage(model="gemini-3.5-flash", input_tokens=10)

    monkeypatch.setattr(ExamPaperService, "_call_model", call)
    return calls


def _one_failed_card_page(test_client, teacher, fake_ai):
    """一頁兩題：第 1 題正常、第 2 題讀不出來（失敗卡）。回傳 (匯入, 失敗卡)。"""
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
    return imp, cards[1]


# ---------------------------------------------------------------- 1. 釋放連線


def test_connection_released_before_ai_call(
    test_client, shared_test_session, teacher, fake_ai, fake_storage, monkeypatch
):
    in_tx = []
    real = fake_ai.call

    async def spy(_self, image_bytes, mime_type, prompt):
        in_tx.append(shared_test_session.in_transaction())
        return await real(_self, image_bytes, mime_type, prompt)

    monkeypatch.setattr(fake_ai, "call", spy)
    imp, failed = _one_failed_card_page(test_client, teacher, fake_ai)
    retry_img = _png("p1-retry")
    fake_ai.on(retry_img, _page(_single("2", "Now?", ["yes", "no"], ai=[1])))
    resp = _retry(
        test_client, teacher, imp["id"], 1, retry_img, card_id=failed["card_id"]
    )
    assert resp.status_code == 200, resp.text
    # 整頁擷取、重試單一題：呼叫 AI 時都沒有開著的交易（連線已還給連線池）
    assert in_tx == [False, False]


# ---------------------------------------------------------------- 2. 逾時


def test_ai_timeout_fails_page_and_records_usage(
    test_client, shared_test_session, teacher, fake_storage, monkeypatch
):
    assert eps.AI_CALL_TIMEOUT_SECONDS == 120
    monkeypatch.setattr(eps, "AI_CALL_TIMEOUT_SECONDS", 0.05)

    async def slow(self, image_bytes, mime_type, prompt):
        await asyncio.sleep(2)
        return json.dumps(_page()), CallUsage(model="gemini-3.5-flash")

    monkeypatch.setattr(ExamPaperService, "_call_model", slow)
    imp = _create(test_client, teacher, pages=1).json()
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 504
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_AI_TIMEOUT"

    page = _page_row(shared_test_session, imp["id"])
    assert page.status == "failed" and page.error == "AI 處理逾時"
    assert page.claim_id is None
    (usage,) = _usage(shared_test_session)
    assert usage.succeeded is False
    assert (usage.input_tokens, usage.output_tokens, usage.thinking_tokens) == (0, 0, 0)


def test_retry_timeout_counts_and_records_usage(
    test_client, shared_test_session, teacher, fake_ai, fake_storage, monkeypatch
):
    imp, failed = _one_failed_card_page(test_client, teacher, fake_ai)
    monkeypatch.setattr(eps, "AI_CALL_TIMEOUT_SECONDS", 0.05)

    async def slow(self, image_bytes, mime_type, prompt):
        await asyncio.sleep(2)

    monkeypatch.setattr(ExamPaperService, "_call_model", slow)
    resp = _retry(
        test_client, teacher, imp["id"], 1, _png("p1-r"), card_id=failed["card_id"]
    )
    assert resp.status_code == 504
    card = _get(test_client, teacher, imp["id"])["pages"][0]["cards"][1]
    assert card["retry_count"] == 1 and card["status"] == "failed"
    assert [(u.call_type, u.succeeded) for u in _usage(shared_test_session)] == [
        ("extract_page", True),
        ("retry_question", False),
    ]


def test_processing_page_can_be_resent_only_after_three_minutes(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    assert eis.STALE_PROCESSING == timedelta(minutes=3)
    imp = _create(test_client, teacher, pages=1).json()
    fake_ai.on(_png("p1"), _page(_single("1", "Q?", ["a", "b"], ai=[0])))

    page = _page_row(shared_test_session, imp["id"])
    page.status = "processing"
    page.updated_at = datetime.now(timezone.utc) - timedelta(minutes=2)
    shared_test_session.commit()
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_PAGE_BUSY"

    page = _page_row(shared_test_session, imp["id"])
    page.updated_at = datetime.now(timezone.utc) - timedelta(minutes=4)
    shared_test_session.commit()
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 200, resp.text
    # 過期後再送算一次重送
    assert resp.json()["page"]["resend_count"] == 1


# ---------------------------------------------------------------- 2. claim_id


def _steal_page_during_ai(shared_test_session, import_id):
    """模擬：這次請求等 AI 太久，頁被另一個請求重搶（claim_id 換掉）。"""
    with Session(bind=shared_test_session.get_bind()) as other:
        other.execute(
            update(ExamImportPage)
            .where(ExamImportPage.import_id == import_id, ExamImportPage.page_no == 1)
            .values(claim_id="someone-else", status="processing")
        )
        other.commit()


def test_stale_request_does_not_write_after_page_was_reclaimed(
    test_client, shared_test_session, teacher, fake_ai, fake_storage, monkeypatch
):
    imp = _create(test_client, teacher, pages=1).json()
    fake_ai.on(_png("p1"), _page(_single("1", "Q?", ["a", "b"], ai=[0])))
    real = fake_ai.call

    async def stolen(_self, image_bytes, mime_type, prompt):
        _steal_page_during_ai(shared_test_session, imp["id"])
        return await real(_self, image_bytes, mime_type, prompt)

    monkeypatch.setattr(fake_ai, "call", stolen)
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_PAGE_BUSY"

    page = _page_row(shared_test_session, imp["id"])
    # 結果丟掉：沒有寫卡片、仍是接手的那次請求在處理
    assert page.status == "processing" and page.claim_id == "someone-else"
    assert page.cards == []
    (usage,) = _usage(shared_test_session)
    assert usage.succeeded is False and usage.input_tokens == 1000


def test_stale_request_failure_does_not_fail_reclaimed_page(
    test_client, shared_test_session, teacher, fake_storage, monkeypatch
):
    imp = _create(test_client, teacher, pages=1).json()

    async def stolen_then_broken(self, image_bytes, mime_type, prompt):
        _steal_page_during_ai(shared_test_session, imp["id"])
        return "not json", CallUsage(model="gemini-3.5-flash", input_tokens=10)

    monkeypatch.setattr(ExamPaperService, "_call_model", stolen_then_broken)
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 502
    page = _page_row(shared_test_session, imp["id"])
    assert page.status == "processing" and page.claim_id == "someone-else"
    (usage,) = _usage(shared_test_session)
    assert usage.succeeded is False and usage.input_tokens == 10


# ---------------------------------------------------------------- 2. 重送上限


def test_page_resend_limit(
    test_client, shared_test_session, teacher, fake_storage, broken_ai
):
    imp = _create(test_client, teacher, pages=1).json()
    # 第一次處理（不算重送）＋重送 2 次，三次都失敗
    for expected_resends in (0, 1, 2):
        resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
        assert resp.status_code == 502
        assert _page_row(shared_test_session, imp["id"]).resend_count == (
            expected_resends
        )
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["error"] == "EXAM_IMPORT_RETRY_LIMIT"
    assert detail["retry_limit"] == eis.MAX_PAGE_RESENDS == 2
    assert len(broken_ai) == 3  # 第四次沒有呼叫 AI
    data = _get(test_client, teacher, imp["id"])
    assert data["pages"][0]["resend_count"] == 2
    assert data["pages"][0]["status"] == "failed"
    assert data["retry_limits"] == {"page_resends": 2, "question_retries": 2}


def test_stale_processing_page_over_limit_is_retry_limit(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    imp = _create(test_client, teacher, pages=1).json()
    page = _page_row(shared_test_session, imp["id"])
    page.status = "processing"
    page.resend_count = 2
    page.updated_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    shared_test_session.commit()
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_RETRY_LIMIT"
    assert fake_ai.prompts == []


def test_question_retry_limit_counts_every_ai_call(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    imp, failed = _one_failed_card_page(test_client, teacher, fake_ai)
    # 第 1 次：AI 沒讀到第 2 題（422）也算一次
    miss = _png("p1-miss")
    fake_ai.on(miss, _page(_single("1", "Fine?", ["a", "b"], ai=[0])))
    resp = _retry(test_client, teacher, imp["id"], 1, miss, card_id=failed["card_id"])
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_RETRY_EMPTY"
    # 第 2 次：成功
    ok = _png("p1-ok")
    fake_ai.on(ok, _page(_single("2", "Now?", ["yes", "no"], ai=[1])))
    resp = _retry(test_client, teacher, imp["id"], 1, ok, card_id=failed["card_id"])
    assert resp.status_code == 200, resp.text
    assert resp.json()["card"]["retry_count"] == 2
    # 第 3 次：超過上限，不呼叫 AI
    prompts = len(fake_ai.prompts)
    resp = _retry(test_client, teacher, imp["id"], 1, ok, card_id=failed["card_id"])
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["error"] == "EXAM_IMPORT_RETRY_LIMIT"
    assert detail["retry_limit"] == MAX_QUESTION_RETRIES == 2
    assert len(fake_ai.prompts) == prompts
    calls = [u.call_type for u in _usage(shared_test_session)]
    assert calls == ["extract_page", "retry_question", "retry_question"]


# ---------------------------------------------------------------- 3. 鎖內出錯


def test_error_while_writing_page_result_fails_page_and_records_usage(
    test_client, shared_test_session, teacher, fake_ai, fake_storage, monkeypatch
):
    imp = _create(test_client, teacher, pages=1).json()
    fake_ai.on(_png("p1"), _page(_single("1", "Q?", ["a", "b"], ai=[0])))

    def boom(db, imp):
        raise RuntimeError("dedup exploded")

    monkeypatch.setattr(eis, "_refresh_duplicates", boom)
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 502
    page = _page_row(shared_test_session, imp["id"])
    assert page.status == "failed" and page.error == "整理擷取結果失敗"
    assert page.cards == []
    # 只有一列（失敗），鎖內先記的那一列已隨 rollback 消失
    (usage,) = _usage(shared_test_session)
    assert usage.succeeded is False and usage.input_tokens == 1000
    row = shared_test_session.get(eis.ExamImport, imp["id"])
    assert row.ai_call_count == 1


def test_error_while_writing_retry_result_records_usage(
    test_client, shared_test_session, teacher, fake_ai, fake_storage, monkeypatch
):
    imp, failed = _one_failed_card_page(test_client, teacher, fake_ai)
    retry_img = _png("p1-retry")
    fake_ai.on(retry_img, _page(_single("2", "Now?", ["yes", "no"], ai=[1])))

    def boom(db, imp):
        raise RuntimeError("dedup exploded")

    monkeypatch.setattr(eis, "_refresh_duplicates", boom)
    resp = _retry(
        test_client, teacher, imp["id"], 1, retry_img, card_id=failed["card_id"]
    )
    assert resp.status_code == 502
    card = _get(test_client, teacher, imp["id"])["pages"][0]["cards"][1]
    assert card["status"] == "failed" and card["retry_count"] == 1
    assert [(u.call_type, u.succeeded) for u in _usage(shared_test_session)] == [
        ("extract_page", True),
        ("retry_question", False),
    ]


# ---------------------------------------------------------------- 4. 題號不符


def test_retry_with_number_not_returned_by_ai_is_422(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    imp, failed = _one_failed_card_page(test_client, teacher, fake_ai)
    other = _png("p1-other")
    fake_ai.on(other, _page(_single("1", "Fine again?", ["a", "b"], ai=[1])))
    resp = _retry(test_client, teacher, imp["id"], 1, other, question_no="2")
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_RETRY_EMPTY"
    cards = _get(test_client, teacher, imp["id"])["pages"][0]["cards"]
    # 沒有拿第 1 題頂替第 2 題，第 1 題也沒被改
    assert cards[0]["question"]["stem"] == "Fine?"
    assert cards[1]["status"] == "failed"


def test_retry_card_id_with_mismatched_number_is_422_without_ai(
    test_client, teacher, fake_ai, fake_storage
):
    imp, failed = _one_failed_card_page(test_client, teacher, fake_ai)
    prompts = len(fake_ai.prompts)
    resp = _retry(
        test_client,
        teacher,
        imp["id"],
        1,
        _png("p1"),
        card_id=failed["card_id"],
        question_no="1",
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_RETRY_TARGET"
    assert len(fake_ai.prompts) == prompts


def test_retry_question_still_importable_from_service_module():
    from services.exam_import_retry import retry_question
    from services.exam_import_service import retry_question as legacy

    assert legacy is retry_question
