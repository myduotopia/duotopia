"""情境對話文字 AI 的端點配額 — Issue #1025。

Gemini 全程 mock。這裡驗的是端點的產品決策：什麼時候扣額度、什麼時候不扣、
額度用完回什麼。

三個端點共用同一個池（`scenario_text_quota`），生圖另有一池。
"""

import io
import logging

import pytest

from services import scenario_text_quota as stq
from services.scenario_dialogue_ai import (
    ScenarioDialogueAIError,
    ScenarioDialogueAIOutputError,
)

ARTICLE_URL = "/api/teachers/scenario-dialogue/generate-article"
QUESTIONS_URL = "/api/teachers/scenario-dialogue/generate-questions"
EXTRACT_URL = "/api/teachers/scenario-dialogue/extract-article"
QUOTA_URL = "/api/teachers/scenario-dialogue/text-quota"

ARTICLE_BODY = {"goal": "ordering food at a restaurant", "level": "B1"}
QUESTIONS_BODY = {
    "scenario_content": "You are at a restaurant.",
    "count": 5,
    "question_level": "B1",
}


@pytest.fixture
def mock_ai(monkeypatch):
    """三個端點都成功。"""
    calls = {"article": 0, "questions": 0, "extract": 0}

    async def fake_article(self, **kwargs):
        calls["article"] += 1
        return {"scenario_content": "An article.", "usage": {}, "estimated_cost_usd": 0}

    async def fake_questions(self, **kwargs):
        calls["questions"] += 1
        return {"questions": [], "usage": {}, "estimated_cost_usd": 0}

    async def fake_extract(self, **kwargs):
        calls["extract"] += 1
        return {"scenario_content": "Extracted.", "usage": {}, "estimated_cost_usd": 0}

    from services import scenario_dialogue_ai as mod

    monkeypatch.setattr(mod.ScenarioDialogueAIService, "generate_article", fake_article)
    monkeypatch.setattr(
        mod.ScenarioDialogueAIService, "generate_questions", fake_questions
    )
    monkeypatch.setattr(mod.ScenarioDialogueAIService, "extract_article", fake_extract)
    return calls


def _pdf():
    return {"file": ("a.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")}


# ---------------------------------------------------------------- 鑑權


def test_text_quota_requires_auth(test_client):
    assert test_client.get(QUOTA_URL).status_code in (401, 403)


# ---------------------------------------------------------------- 正常流程


def test_generate_article_charges_once(test_client, auth_headers_teacher, mock_ai):
    resp = test_client.post(
        ARTICLE_URL, headers=auth_headers_teacher, json=ARTICLE_BODY
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["quota"]["charged"] == "free"
    assert resp.json()["quota"]["used"] == 1
    assert mock_ai["article"] == 1


def test_generate_questions_charges_once(test_client, auth_headers_teacher, mock_ai):
    resp = test_client.post(
        QUESTIONS_URL, headers=auth_headers_teacher, json=QUESTIONS_BODY
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["quota"]["used"] == 1


def test_extract_article_charges_once(test_client, auth_headers_teacher, mock_ai):
    resp = test_client.post(EXTRACT_URL, headers=auth_headers_teacher, files=_pdf())

    assert resp.status_code == 200, resp.text
    assert resp.json()["quota"]["used"] == 1


def test_all_three_endpoints_share_one_pool(test_client, auth_headers_teacher, mock_ai):
    """三個端點是同一個池 —— 否則老師可以靠換端點繞過上限。"""
    test_client.post(ARTICLE_URL, headers=auth_headers_teacher, json=ARTICLE_BODY)
    test_client.post(QUESTIONS_URL, headers=auth_headers_teacher, json=QUESTIONS_BODY)
    test_client.post(EXTRACT_URL, headers=auth_headers_teacher, files=_pdf())

    assert test_client.get(QUOTA_URL, headers=auth_headers_teacher).json()["used"] == 3


def test_batch_of_ten_questions_still_counts_as_one(
    test_client, auth_headers_teacher, mock_ai
):
    """不按題數加權是刻意的 —— 鼓勵批次產題，要擋的是連按重產單題。"""
    resp = test_client.post(
        QUESTIONS_URL,
        headers=auth_headers_teacher,
        json={**QUESTIONS_BODY, "count": 10},
    )

    assert resp.json()["quota"]["used"] == 1


# ---------------------------------------------------------------- 額度用完


def test_quota_exceeded_returns_402_before_calling_ai(
    test_client, auth_headers_teacher, mock_ai, monkeypatch
):
    """額度用完要在**打 AI 之前**就擋 —— 不能先花錢再回 402。"""
    monkeypatch.setattr(stq, "FREE_MONTHLY_LIMIT", 1)

    first = test_client.post(
        ARTICLE_URL, headers=auth_headers_teacher, json=ARTICLE_BODY
    )
    assert first.status_code == 200
    assert mock_ai["article"] == 1

    second = test_client.post(
        ARTICLE_URL, headers=auth_headers_teacher, json=ARTICLE_BODY
    )
    assert second.status_code == 402
    assert second.json()["detail"]["error"] == "SCENARIO_TEXT_QUOTA_EXCEEDED"
    # 關鍵：第二次沒有再打 AI
    assert mock_ai["article"] == 1


def test_one_endpoint_exhausting_the_pool_blocks_the_others(
    test_client, auth_headers_teacher, mock_ai, monkeypatch
):
    monkeypatch.setattr(stq, "FREE_MONTHLY_LIMIT", 1)

    test_client.post(ARTICLE_URL, headers=auth_headers_teacher, json=ARTICLE_BODY)

    blocked = test_client.post(
        QUESTIONS_URL, headers=auth_headers_teacher, json=QUESTIONS_BODY
    )
    assert blocked.status_code == 402
    assert mock_ai["questions"] == 0


def test_second_request_at_limit_is_blocked_even_if_status_check_passed(
    test_client, auth_headers_teacher, mock_ai, monkeypatch
):
    """先查 status 再送出也擋得住 —— 閘門是 consume，不是那次查詢。"""
    monkeypatch.setattr(stq, "FREE_MONTHLY_LIMIT", 1)

    assert test_client.get(QUOTA_URL, headers=auth_headers_teacher).json()["can_use"]
    assert (
        test_client.post(
            ARTICLE_URL, headers=auth_headers_teacher, json=ARTICLE_BODY
        ).status_code
        == 200
    )
    assert (
        test_client.post(
            ARTICLE_URL, headers=auth_headers_teacher, json=ARTICLE_BODY
        ).status_code
        == 402
    )


# ---------------------------------------------------------------- 失敗不扣額


@pytest.mark.parametrize(
    "exc,expected_status",
    [
        (ScenarioDialogueAIOutputError("模型沒給出可用的東西"), 502),
        (ScenarioDialogueAIError("訓練目標不可為空"), 400),
        (RuntimeError("boom"), 502),
    ],
)
def test_failures_do_not_burn_quota(
    test_client, auth_headers_teacher, monkeypatch, exc, expected_status
):
    """老師沒拿到東西就不該被算一次 —— 扣他一次只會讓他不敢再試。"""

    async def boom(self, **kwargs):
        raise exc

    from services import scenario_dialogue_ai as mod

    monkeypatch.setattr(mod.ScenarioDialogueAIService, "generate_article", boom)

    resp = test_client.post(
        ARTICLE_URL, headers=auth_headers_teacher, json=ARTICLE_BODY
    )
    assert resp.status_code == expected_status

    assert test_client.get(QUOTA_URL, headers=auth_headers_teacher).json()["used"] == 0


def test_oversized_file_does_not_burn_quota(test_client, auth_headers_teacher, mock_ai):
    """檔案過大是還沒用到 AI 就被擋，不該扣額度。"""
    from services.scenario_dialogue_ai import get_scenario_dialogue_ai_service

    too_big = b"x" * (get_scenario_dialogue_ai_service().MAX_FILE_BYTES + 10)
    resp = test_client.post(
        EXTRACT_URL,
        headers=auth_headers_teacher,
        files={"file": ("big.pdf", io.BytesIO(too_big), "application/pdf")},
    )

    assert resp.status_code == 400
    assert mock_ai["extract"] == 0
    assert test_client.get(QUOTA_URL, headers=auth_headers_teacher).json()["used"] == 0


# ---------------------------------------------------------------- 與生圖分開


def test_text_and_image_pools_are_independent(
    test_client, auth_headers_teacher, mock_ai
):
    test_client.post(ARTICLE_URL, headers=auth_headers_teacher, json=ARTICLE_BODY)

    image_quota = test_client.get(
        "/api/teachers/scenario-dialogue/image-quota", headers=auth_headers_teacher
    ).json()
    assert image_quota["used"] == 0


def test_refunded_failure_is_logged_as_not_consumed(
    test_client, auth_headers_teacher, monkeypatch, caplog
):
    """log 要印退款**後**的用量。

    這些 log 是日後用來校準 FREE_MONTHLY_LIMIT 的依據（服務模組的說明就是這樣寫的）。
    印退款前的值會讓每個失敗都被記成一次消耗，校準出來的數字會偏高。
    """
    import logging

    async def boom(self, **kwargs):
        raise RuntimeError("boom")

    from services import scenario_dialogue_ai as mod

    monkeypatch.setattr(mod.ScenarioDialogueAIService, "generate_article", boom)

    with caplog.at_level(logging.INFO):
        test_client.post(ARTICLE_URL, headers=auth_headers_teacher, json=ARTICLE_BODY)

    quota_logs = [
        r.getMessage()
        for r in caplog.records
        if "scenario_text_quota" in r.getMessage()
    ]
    assert quota_logs, "沒有配額 log"
    assert "delivered=False" in quota_logs[-1]
    # 退款後是 0，不是 1
    assert "used=0/" in quota_logs[-1]


# ---------------------------------------------------------------- #1146 答非所問


@pytest.mark.parametrize("which", ["article", "questions"])
def test_unusable_input_does_not_burn_quota(
    test_client, auth_headers_teacher, monkeypatch, which
):
    """答非所問（usable=False）沒有產出內容，只回一句重問 —— 不該扣額度。"""

    async def reask(self, **kwargs):
        return {
            "usable": False,
            "reask": "可以再具體一點嗎？例如：交通工具與問路。",
            "suggested_title": "",
            "content": "",
            "questions": [],
            "usage": {},
            "estimated_cost_usd": 0,
        }

    from services import scenario_dialogue_ai as mod

    method = "generate_article" if which == "article" else "generate_questions"
    monkeypatch.setattr(mod.ScenarioDialogueAIService, method, reask)

    url, body = (
        (ARTICLE_URL, ARTICLE_BODY)
        if which == "article"
        else (QUESTIONS_URL, {"direction": "hello", "count": 5})
    )
    resp = test_client.post(url, headers=auth_headers_teacher, json=body)
    assert resp.status_code == 200, resp.text
    assert resp.json()["usable"] is False
    assert resp.json()["reask"]
    assert test_client.get(QUOTA_URL, headers=auth_headers_teacher).json()["used"] == 0


def test_unusable_input_refund_is_logged_per_teacher(
    test_client, auth_headers_teacher, monkeypatch, caplog
):
    """#1146 review 9：答非所問退額度只記 log（teacher_id、端點、次數），不設上限。"""

    async def reask(self, **kwargs):
        return {"usable": False, "reask": "再具體一點", "usage": {}}

    from routers import scenario_dialogue_ai as router_mod
    from services import scenario_dialogue_ai as mod

    monkeypatch.setattr(mod.ScenarioDialogueAIService, "generate_article", reask)
    monkeypatch.setattr(router_mod, "_reask_refund_counts", router_mod.Counter())

    with caplog.at_level(logging.WARNING):
        for _ in range(2):
            resp = test_client.post(
                ARTICLE_URL, headers=auth_headers_teacher, json=ARTICLE_BODY
            )
            assert resp.status_code == 200, resp.text

    logs = [r.getMessage() for r in caplog.records if "reask_refund" in r.getMessage()]
    assert len(logs) == 2
    assert "endpoint=generate-article" in logs[-1]
    assert "count=2" in logs[-1]
    assert "teacher_id=" in logs[-1]
    # 不設上限：第三次照樣回重問，不是 429
    resp = test_client.post(
        ARTICLE_URL, headers=auth_headers_teacher, json=ARTICLE_BODY
    )
    assert resp.status_code == 200
