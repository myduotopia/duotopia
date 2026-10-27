"""
上傳題本匯入：C2 第三輪修正的測試（Issue #1112）。AI 呼叫與 GCS 一律 mock。

1. AI 處理期間匯入被放棄（頁已刪掉）→ 用量照記、409 ``EXAM_IMPORT_CLOSED``
2. 卡在 processing 又用完重送次數 → 409 ``EXAM_IMPORT_RETRY_LIMIT``，頁改失敗「處理逾時」、匯入可變 ready
3. 重試必須指定既有卡（card_id 或題號）：只給 bbox → 422、題號比不到卡 → 404，都不呼叫 AI
4. 搶頁前先 ``lock_import``；匯入已結束 → 409 ``EXAM_IMPORT_CLOSED``
5. 逾時 log 標示用量記 0 token（不估算）
6. 單頁克漏字寫入時重編 1..k
7. router 直接用 ``exam_import_retry.retry_question``
8. AI 供應商錯誤也算一次重試
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from models import ExamImport, ExamImportPage, ExamImportUsage
from services import exam_import_service as eis
from services import exam_paper_service as eps
from services.exam_import_retry import retry_question
from services.exam_paper_service import CallUsage, ExamPaperService
from tests.test_exam_import_api import (  # noqa: F401  (fixtures)
    BASE,
    _create,
    _headers,
    _page,
    _png,
    _q,
    _send,
    _single,
    fake_ai,
    fake_storage,
    teacher,
)
from tests.test_exam_import_retry_limits import (
    _get,
    _one_failed_card_page,
    _page_row,
    _retry,
    _usage,
)


def _import_row(session, import_id):
    session.expire_all()
    return session.get(ExamImport, import_id)


# ---------------------------------------------------------------- 1. 處理中被放棄


def test_abandoned_during_ai_call_records_usage_and_is_closed(
    test_client, shared_test_session, teacher, fake_ai, fake_storage, monkeypatch
):
    imp = _create(test_client, teacher, pages=1).json()
    fake_ai.on(_png("p1"), _page(_single("1", "Q?", ["a", "b"], ai=[0])))
    real = fake_ai.call

    async def abandoned(_self, image_bytes, mime_type, prompt):
        # 模擬：等 AI 期間老師按了放棄（匯入改 abandoned、草稿頁刪掉）
        with Session(bind=shared_test_session.get_bind()) as other:
            other.execute(
                update(ExamImport)
                .where(ExamImport.id == imp["id"])
                .values(status="abandoned")
            )
            other.execute(
                delete(ExamImportPage).where(ExamImportPage.import_id == imp["id"])
            )
            other.commit()
        return await real(_self, image_bytes, mime_type, prompt)

    monkeypatch.setattr(fake_ai, "call", abandoned)
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_CLOSED"
    (usage,) = _usage(shared_test_session)
    assert usage.succeeded is False and usage.input_tokens == 1000
    row = _import_row(shared_test_session, imp["id"])
    assert row.status == "abandoned" and row.ai_call_count == 1


# ---------------------------------------------------------------- 2. 卡住又用完次數


def test_stale_page_over_limit_is_marked_failed_and_import_becomes_ready(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    imp = _create(test_client, teacher, pages=1).json()
    page = _page_row(shared_test_session, imp["id"])
    page.status = "processing"
    page.claim_id = "lost-request"
    page.resend_count = 2
    page.updated_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    shared_test_session.commit()

    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_RETRY_LIMIT"
    assert fake_ai.prompts == []

    page = _page_row(shared_test_session, imp["id"])
    assert page.status == "failed" and page.error == "處理逾時"
    assert page.claim_id is None and page.resend_count == 2
    assert _import_row(shared_test_session, imp["id"]).status == "ready"


def test_fresh_processing_page_over_limit_stays_processing(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    imp = _create(test_client, teacher, pages=1).json()
    page = _page_row(shared_test_session, imp["id"])
    page.status = "processing"
    page.claim_id = "in-flight"
    page.resend_count = 2
    page.updated_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    shared_test_session.commit()

    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_PAGE_BUSY"
    page = _page_row(shared_test_session, imp["id"])
    assert page.status == "processing" and page.claim_id == "in-flight"
    assert _import_row(shared_test_session, imp["id"]).status == "processing"


# ---------------------------------------------------------------- 3. 重試必須指定既有卡


def test_retry_with_only_bbox_is_rejected_without_ai(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    imp, _failed = _one_failed_card_page(test_client, teacher, fake_ai)
    prompts = len(fake_ai.prompts)
    resp = _retry(
        test_client,
        teacher,
        imp["id"],
        1,
        _png("p1-box"),
        bbox=json.dumps([500, 50, 600, 950]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_RETRY_TARGET"
    assert len(fake_ai.prompts) == prompts
    assert len(_get(test_client, teacher, imp["id"])["pages"][0]["cards"]) == 2
    assert [u.call_type for u in _usage(shared_test_session)] == ["extract_page"]


def test_retry_with_unknown_number_is_404_and_adds_no_card(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    imp, _failed = _one_failed_card_page(test_client, teacher, fake_ai)
    prompts = len(fake_ai.prompts)
    resp = _retry(
        test_client,
        teacher,
        imp["id"],
        1,
        _png("p1-missing"),
        question_no="9",
        bbox=json.dumps([500, 50, 600, 950]),
    )
    assert resp.status_code == 404
    detail = resp.json()["detail"]
    assert detail["error"] == "EXAM_IMPORT_CARD_NOT_FOUND"
    assert "手動補這一題" in detail["message"]
    assert len(fake_ai.prompts) == prompts
    assert len(_get(test_client, teacher, imp["id"])["pages"][0]["cards"]) == 2


def test_service_rejects_bbox_only_retry(
    test_client, shared_test_session, teacher, fake_ai, fake_storage
):
    imp, _failed = _one_failed_card_page(test_client, teacher, fake_ai)
    row = _import_row(shared_test_session, imp["id"])
    with pytest.raises(eis.ExamImportError) as exc:
        asyncio.run(
            retry_question(
                shared_test_session,
                row,
                1,
                _png("p1-box"),
                "image/png",
                bbox=[500, 50, 600, 950],
            )
        )
    assert exc.value.status_code == 422
    assert exc.value.detail["error"] == "EXAM_IMPORT_RETRY_TARGET"


# ---------------------------------------------------------------- 4. 搶頁前先鎖


def test_claim_locks_import_before_updating_page(
    test_client, shared_test_session, teacher, fake_ai, fake_storage, monkeypatch
):
    imp = _create(test_client, teacher, pages=1).json()
    fake_ai.on(_png("p1"), _page(_single("1", "Q?", ["a", "b"], ai=[0])))
    seen = []
    real_lock = eis.lock_import

    def spy(db, import_id):
        with Session(bind=shared_test_session.get_bind()) as other:
            seen.append(
                other.query(ExamImportPage.status)
                .filter_by(import_id=import_id, page_no=1)
                .scalar()
            )
        return real_lock(db, import_id)

    monkeypatch.setattr(eis, "lock_import", spy)
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 200, resp.text
    # 第一次上鎖（搶頁）時頁還是 pending；第二次（寫入結果）時已是 processing
    assert seen[:2] == ["pending", "processing"]


def test_claim_on_closed_import_is_409(shared_test_session, test_client, teacher):
    imp = _create(test_client, teacher, pages=1).json()
    row = _import_row(shared_test_session, imp["id"])
    page_id = row.pages[0].id
    row.status = "saved"
    shared_test_session.commit()
    with pytest.raises(eis.ExamImportError) as exc:
        eis._claim_page(shared_test_session, imp["id"], page_id, 1)
    assert exc.value.detail["error"] == "EXAM_IMPORT_CLOSED"
    assert _page_row(shared_test_session, imp["id"]).status == "pending"


# ---------------------------------------------------------------- 5. 逾時 log


def test_timeout_log_marks_usage_as_zero_not_estimated(
    test_client, teacher, fake_storage, monkeypatch, caplog
):
    monkeypatch.setattr(eps, "AI_CALL_TIMEOUT_SECONDS", 0.05)

    async def slow(self, image_bytes, mime_type, prompt):
        await asyncio.sleep(2)

    monkeypatch.setattr(ExamPaperService, "_call_model", slow)
    imp = _create(test_client, teacher, pages=1).json()
    with caplog.at_level(logging.WARNING, logger=eps.logger.name):
        resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 504
    assert "TIMEOUT_USAGE_UNKNOWN" in caplog.text
    assert "0 tokens" in caplog.text


# ---------------------------------------------------------------- 6. 單頁克漏字重編


def test_single_page_cloze_is_renumbered_from_one(
    test_client, teacher, fake_ai, fake_storage
):
    imp = _create(test_client, teacher, pages=1).json()
    cloze = {
        "kind": "group",
        "group_type": "cloze",
        "box_2d": [100, 50, 900, 950],
        "title": "Cloze",
        "stimulus": {"kind": "text", "paragraphs": ["I {{41}} a cat, {{42}} a dog."]},
        "questions": [
            _q("41", "", ["have", "has"], ai=[0], blank=41),
            _q("42", "", ["walk", "walks"], ai=[0], blank=42),
        ],
    }
    fake_ai.on(_png("p1"), _page(cloze))
    resp = _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 200, resp.text
    (card,) = _get(test_client, teacher, imp["id"])["pages"][0]["cards"]
    group = card["group"]
    assert group["stimulus"]["paragraphs"] == ["I {{1}} a cat, {{2}} a dog."]
    assert [q["blank"] for q in group["questions"]] == [1, 2]
    assert [q["source_question_no"] for q in group["questions"]] == ["41", "42"]


# ---------------------------------------------------------------- 7. router 匯入


def test_router_uses_retry_module_directly():
    from routers import question_bank_exam_imports as router_module
    from services import exam_import_retry

    assert router_module.retry_question is exam_import_retry.retry_question


# ---------------------------------------------------------------- 8. 供應商錯誤


def test_provider_error_counts_as_one_retry(
    test_client, shared_test_session, teacher, fake_ai, fake_storage, monkeypatch
):
    imp, failed = _one_failed_card_page(test_client, teacher, fake_ai)

    async def provider_down(self, image_bytes, mime_type, prompt):
        raise RuntimeError("503 Service Unavailable")

    monkeypatch.setattr(ExamPaperService, "_call_model", provider_down)
    resp = _retry(
        test_client, teacher, imp["id"], 1, _png("p1-r"), card_id=failed["card_id"]
    )
    assert resp.status_code == 502
    card = _get(test_client, teacher, imp["id"])["pages"][0]["cards"][1]
    assert card["retry_count"] == 1 and card["status"] == "failed"
    # 供應商錯誤沒有回應、沒有 usage：不寫用量列
    assert [u.call_type for u in _usage(shared_test_session)] == ["extract_page"]
    assert shared_test_session.query(ExamImportUsage).count() == 1
