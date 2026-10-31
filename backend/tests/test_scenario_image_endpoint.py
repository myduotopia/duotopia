"""情境對話 AI 生圖端點 — Issue #1024 起，#1158 改依老師身分計費。

生圖與儲存全程 mock。這裡驗的是端點的產品決策：什麼時候佔名額／扣點、什麼時候不扣、
被安全過濾擋下要回什麼、額度用完要回什麼。

``demo_teacher`` 沒有訂閱、沒有點數包、不屬於機構 → 計費方式是 ``free_daily``
（每天 3 張）。各身分的扣法細節見 ``tests/test_scenario_image_billing.py``。
"""

import pytest

from services import scenario_image_billing as sib
from services.scenario_dialogue_image import (
    ScenarioImageBlockedError,
    ScenarioImageError,
    ScenarioImageUpstreamError,
)

IMAGE_URL = "/api/teachers/scenario-dialogue/generate-image"
QUOTA_URL = "/api/teachers/scenario-dialogue/image-quota"
SUGGEST_URL = "/api/teachers/scenario-dialogue/suggest-image-description"


def _result(prompt="p"):
    return {
        "image_bytes": b"JPEGDATA",
        "mime_type": "image/jpeg",
        "prompt": prompt,
        "output_tokens": 1120,
        "estimated_cost_usd": 0.04,
    }


@pytest.fixture(autouse=True)
def fixed_day(monkeypatch):
    """固定台灣日期，避免測試剛好跨過午夜。"""
    monkeypatch.setattr(sib, "current_taipei_date", lambda: "2026-10-29")


@pytest.fixture
def mock_image(monkeypatch):
    """生圖成功 + 存檔成功。"""
    calls = {"generate": 0, "store": 0}

    async def fake_generate(self, raw_prompt, kind="question"):
        calls["generate"] += 1
        calls["prompt"] = raw_prompt
        calls["kind"] = kind
        return _result(f"rewritten: {raw_prompt}")

    def fake_store(self, content, content_type, **kwargs):
        calls["store"] += 1
        calls["content_type"] = content_type
        return "https://cdn.example.com/img.jpg"

    from services import scenario_dialogue_image as mod
    from services import image_upload as upload_mod

    monkeypatch.setattr(mod.ScenarioDialogueImageService, "generate", fake_generate)
    monkeypatch.setattr(upload_mod.ImageUploadService, "store_image_bytes", fake_store)
    return calls


def _used_today(test_client, headers):
    status = test_client.get(QUOTA_URL, headers=headers).json()
    return status["limit"] - status["remaining"]


# ---------------------------------------------------------------- 鑑權


def test_generate_image_requires_auth(test_client):
    resp = test_client.post(IMAGE_URL, json={"description": "a park"})
    assert resp.status_code in (401, 403)


def test_quota_requires_auth(test_client):
    assert test_client.get(QUOTA_URL).status_code in (401, 403)


def test_suggest_requires_auth(test_client):
    resp = test_client.post(SUGGEST_URL, json={"scenario_content": "a zoo trip"})
    assert resp.status_code in (401, 403)


# ---------------------------------------------------------------- 正常流程


def test_generate_image_returns_url_and_charges_once(
    test_client, auth_headers_teacher, mock_image
):
    resp = test_client.post(
        IMAGE_URL,
        headers=auth_headers_teacher,
        json={"description": "students talking in a classroom", "kind": "scenario"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["image_url"] == "https://cdn.example.com/img.jpg"
    assert body["kind"] == "scenario"
    assert body["billing"]["billing"] == "free_daily"
    assert body["billing"]["points_used"] == 0
    assert body["quota"]["remaining"] == sib.FREE_DAILY_LIMIT - 1
    assert mock_image["generate"] == 1
    assert mock_image["kind"] == "scenario"
    # 存檔用模型回的 mime type（Gemini 回 JPEG，不是寫死 PNG）
    assert mock_image["content_type"] == "image/jpeg"


def test_kind_defaults_to_question(test_client, auth_headers_teacher, mock_image):
    resp = test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
    )
    assert resp.status_code == 200
    assert mock_image["kind"] == "question"


def test_legacy_image_prompt_field_still_works(
    test_client, auth_headers_teacher, mock_image
):
    """前端改版前還在送 #1024 的 image_prompt，不能因為後端先上線就壞掉。"""
    resp = test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"image_prompt": "a park"}
    )
    assert resp.status_code == 200, resp.text
    assert mock_image["prompt"] == "a park"


def test_description_wins_over_legacy_field(
    test_client, auth_headers_teacher, mock_image
):
    test_client.post(
        IMAGE_URL,
        headers=auth_headers_teacher,
        json={"description": "new", "image_prompt": "old"},
    )
    assert mock_image["prompt"] == "new"


def test_invalid_kind_is_rejected(test_client, auth_headers_teacher, mock_image):
    resp = test_client.post(
        IMAGE_URL,
        headers=auth_headers_teacher,
        json={"description": "a park", "kind": "poster"},
    )
    assert resp.status_code == 422
    assert mock_image["generate"] == 0


def test_quota_endpoint_format(test_client, auth_headers_teacher, mock_image):
    before = test_client.get(QUOTA_URL, headers=auth_headers_teacher).json()
    assert before == {
        "billing": "free_daily",
        "remaining": sib.FREE_DAILY_LIMIT,
        "limit": sib.FREE_DAILY_LIMIT,
        "period": "day",
        "points_per_image_estimate": sib.POINTS_PER_IMAGE_ESTIMATE,
        "can_generate": True,
    }

    test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
    )
    after = test_client.get(QUOTA_URL, headers=auth_headers_teacher).json()
    assert after["remaining"] == sib.FREE_DAILY_LIMIT - 1


# ---------------------------------------------------------------- 不扣額度的情況


def test_blocked_by_safety_filter_returns_422_and_does_not_charge(
    test_client, auth_headers_teacher, monkeypatch
):
    """被安全過濾擋下 → 老師沒拿到圖，不能扣他一次。"""
    from services import scenario_dialogue_image as mod

    async def blocked(self, raw_prompt, kind="question"):
        raise ScenarioImageBlockedError("AI 沒有產出圖片，請換個描述再試")

    monkeypatch.setattr(mod.ScenarioDialogueImageService, "generate", blocked)

    resp = test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
    )
    assert resp.status_code == 422
    assert "換個描述" in resp.json()["detail"]
    assert _used_today(test_client, auth_headers_teacher) == 0


def test_upstream_error_returns_502_and_does_not_charge(
    test_client, auth_headers_teacher, monkeypatch
):
    """Vertex 回 HTTP 錯誤（例如模型下架 404）是我們的問題：502「稍後再試」，不是 400。"""
    from services import scenario_dialogue_image as mod

    async def upstream(self, raw_prompt, kind="question"):
        raise ScenarioImageUpstreamError("Vertex image 404")

    monkeypatch.setattr(mod.ScenarioDialogueImageService, "generate", upstream)

    resp = test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
    )
    assert resp.status_code == 502
    assert _used_today(test_client, auth_headers_teacher) == 0


def test_storage_failure_does_not_charge(
    test_client, auth_headers_teacher, monkeypatch
):
    """圖生出來卻存不進去 —— 老師一樣沒拿到圖，重試不該被罰。"""
    from services import scenario_dialogue_image as mod
    from services import image_upload as upload_mod

    async def ok(self, raw_prompt, kind="question"):
        return _result()

    def boom(self, content, content_type, **kwargs):
        raise RuntimeError("GCS down")

    monkeypatch.setattr(mod.ScenarioDialogueImageService, "generate", ok)
    monkeypatch.setattr(upload_mod.ImageUploadService, "store_image_bytes", boom)

    resp = test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
    )
    assert resp.status_code == 502
    assert _used_today(test_client, auth_headers_teacher) == 0


def test_blank_description_is_rejected_before_touching_quota(
    test_client, auth_headers_teacher, mock_image
):
    """純空白描述要在 Pydantic 就擋掉（422），不該走完「佔名額 → 失敗 → 退款」。"""
    for body in ({"description": "   "}, {"image_prompt": "   "}, {}):
        resp = test_client.post(IMAGE_URL, headers=auth_headers_teacher, json=body)
        assert resp.status_code == 422, body
    assert mock_image["generate"] == 0
    assert _used_today(test_client, auth_headers_teacher) == 0


def test_service_level_invalid_prompt_returns_400(
    test_client, auth_headers_teacher, monkeypatch
):
    from services import scenario_dialogue_image as mod

    async def bad(self, raw_prompt, kind="question"):
        raise ScenarioImageError("生圖描述不合法")

    monkeypatch.setattr(mod.ScenarioDialogueImageService, "generate", bad)

    resp = test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
    )
    assert resp.status_code == 400
    assert _used_today(test_client, auth_headers_teacher) == 0


def test_prompt_too_long_is_rejected_before_calling_ai(
    test_client, auth_headers_teacher, mock_image
):
    resp = test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"description": "x" * 5000}
    )
    assert resp.status_code == 422
    assert mock_image["generate"] == 0


def test_generate_generic_failure_refunds_quota(
    test_client, auth_headers_teacher, monkeypatch
):
    from services import scenario_dialogue_image as mod

    async def boom(self, raw_prompt, kind="question"):
        raise RuntimeError("vertex exploded")

    monkeypatch.setattr(mod.ScenarioDialogueImageService, "generate", boom)

    resp = test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
    )
    assert resp.status_code == 502
    assert _used_today(test_client, auth_headers_teacher) == 0


def test_cancelled_midflight_refunds_quota(
    test_client, auth_headers_teacher, monkeypatch
):
    """老師在生圖跑到一半關掉分頁 → 那個名額要還回去（CancelledError 是 BaseException）。"""
    import asyncio

    from services import scenario_dialogue_image as mod

    async def cancelled(self, raw_prompt, kind="question"):
        raise asyncio.CancelledError()

    monkeypatch.setattr(mod.ScenarioDialogueImageService, "generate", cancelled)

    try:
        test_client.post(
            IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
        )
    except BaseException:
        pass

    assert _used_today(test_client, auth_headers_teacher) == 0


# ---------------------------------------------------------------- 額度用完


def test_daily_quota_exhausted_returns_402_without_calling_ai(
    test_client, auth_headers_teacher, mock_image
):
    """未付費老師每天 3 張，第 4 張在打 AI 之前就擋下。"""
    for _ in range(sib.FREE_DAILY_LIMIT):
        assert (
            test_client.post(
                IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
            ).status_code
            == 200
        )

    resp = test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
    )
    assert resp.status_code == 402
    detail = resp.json()["detail"]
    assert detail["error"] == "SCENARIO_IMAGE_QUOTA_EXCEEDED"
    assert detail["quota"]["can_generate"] is False
    assert "image_url" not in resp.json()
    assert mock_image["generate"] == sib.FREE_DAILY_LIMIT


def test_quota_is_reserved_before_calling_ai(
    test_client, auth_headers_teacher, db_session, monkeypatch
):
    """名額要在打 AI **之前**就被佔走，否則兩個並發請求都會在空窗期通過檢查。

    mock 裡不能再呼叫 test_client（會在 event loop thread 裡丟 RuntimeError），
    直接用 db_session 查計數。
    """
    from models import Teacher
    from services import scenario_dialogue_image as mod
    from services import image_upload as upload_mod

    seen = {}
    teacher = db_session.query(Teacher).first()

    async def check_midflight(self, raw_prompt, kind="question"):
        seen["used"] = sib._daily.get_quota_status(db_session, teacher, "2026-10-29")[
            "used"
        ]
        return _result()

    monkeypatch.setattr(mod.ScenarioDialogueImageService, "generate", check_midflight)
    monkeypatch.setattr(
        upload_mod.ImageUploadService,
        "store_image_bytes",
        lambda self, content, content_type, **kw: "https://cdn/x.jpg",
    )

    resp = test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
    )
    assert resp.status_code == 200, resp.text
    assert seen["used"] == 1, "AI 執行期間名額還沒被佔走 = 並發擋不住"


def test_refund_targets_the_day_that_was_charged(
    test_client, auth_headers_teacher, db_session, monkeypatch
):
    """生圖跨過台灣午夜時，要退回「當初佔的那一天」而不是新的一天。"""
    from models import Teacher
    from services import scenario_dialogue_image as mod

    teacher = db_session.query(Teacher).first()
    days = iter(["2026-10-29"])
    monkeypatch.setattr(sib, "current_taipei_date", lambda: next(days, "2026-10-30"))

    async def boom(self, raw_prompt, kind="question"):
        raise RuntimeError("slow call that straddles midnight")

    monkeypatch.setattr(mod.ScenarioDialogueImageService, "generate", boom)

    resp = test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
    )
    assert resp.status_code == 502
    assert sib._daily.get_quota_status(db_session, teacher, "2026-10-29")["used"] == 0
    assert sib._daily.get_quota_status(db_session, teacher, "2026-10-30")["used"] == 0


# ---------------------------------------------------------------- 同時只能一張


def _in_flight_count(db_session):
    from models import ScenarioImageUsage, Teacher

    teacher = db_session.query(Teacher).first()
    db_session.expire_all()
    row = (
        db_session.query(ScenarioImageUsage)
        .filter(
            ScenarioImageUsage.teacher_id == teacher.id,
            ScenarioImageUsage.year_month == sib.IN_FLIGHT_KEY,
        )
        .first()
    )
    return row.count if row else 0


def test_second_request_while_generating_returns_409(
    test_client, auth_headers_teacher, db_session, monkeypatch
):
    """上一張還在生成時，第二個請求回 409「上一張還在生成」，不佔名額、不打 AI。

    用「生成中標記已被佔住」模擬上一張還沒結束（TestClient 無法真的並發）。
    """
    from models import Teacher

    teacher = db_session.query(Teacher).first()
    sib.acquire_generation_slot(db_session, teacher)

    calls = {"generate": 0}

    async def fake_generate(self, raw_prompt, kind="question"):
        calls["generate"] += 1
        return _result()

    from services import scenario_dialogue_image as mod

    monkeypatch.setattr(mod.ScenarioDialogueImageService, "generate", fake_generate)

    resp = test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
    )
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["error"] == sib.IN_PROGRESS_ERROR
    assert "上一張" in detail["message"]
    assert calls["generate"] == 0
    assert _used_today(test_client, auth_headers_teacher) == 0
    # 409 不能把別人（上一張）的標記放掉
    assert _in_flight_count(db_session) == 1


def test_in_flight_is_held_during_generation_and_released_after(
    test_client, auth_headers_teacher, db_session, monkeypatch
):
    from services import scenario_dialogue_image as mod
    from services import image_upload as upload_mod

    seen = {}

    async def check_midflight(self, raw_prompt, kind="question"):
        seen["in_flight"] = _in_flight_count(db_session)
        return _result()

    monkeypatch.setattr(mod.ScenarioDialogueImageService, "generate", check_midflight)
    monkeypatch.setattr(
        upload_mod.ImageUploadService,
        "store_image_bytes",
        lambda self, content, content_type, **kw: "https://cdn/x.jpg",
    )

    resp = test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
    )
    assert resp.status_code == 200, resp.text
    assert seen["in_flight"] == 1
    assert _in_flight_count(db_session) == 0
    # 放掉之後下一張可以接著生
    resp = test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
    )
    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize(
    "failure",
    ["blocked", "upstream", "generic", "store", "cancelled"],
)
def test_in_flight_is_released_on_every_failure(
    test_client, auth_headers_teacher, db_session, monkeypatch, failure
):
    """被擋、上游錯誤、一般錯誤、存檔失敗、中途取消 —— 都要放掉生成中標記。"""
    import asyncio

    from services import scenario_dialogue_image as mod
    from services import image_upload as upload_mod

    async def gen(self, raw_prompt, kind="question"):
        if failure == "blocked":
            raise ScenarioImageBlockedError("blocked")
        if failure == "upstream":
            raise ScenarioImageUpstreamError("404")
        if failure == "generic":
            raise RuntimeError("boom")
        if failure == "cancelled":
            raise asyncio.CancelledError()
        return _result()

    def store(self, content, content_type, **kwargs):
        raise RuntimeError("GCS down")

    monkeypatch.setattr(mod.ScenarioDialogueImageService, "generate", gen)
    monkeypatch.setattr(upload_mod.ImageUploadService, "store_image_bytes", store)

    try:
        test_client.post(
            IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
        )
    except BaseException:
        pass

    assert _in_flight_count(db_session) == 0


def test_in_flight_is_released_when_quota_exhausted(
    test_client, auth_headers_teacher, db_session, mock_image
):
    """額度用完的 402 也要放掉標記，否則老師買了點數後還是被 409 卡住。"""
    for _ in range(sib.FREE_DAILY_LIMIT):
        test_client.post(
            IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
        )
    resp = test_client.post(
        IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
    )
    assert resp.status_code == 402
    assert _in_flight_count(db_session) == 0


# ---------------------------------------------------------------- 預填描述


def test_suggest_description_returns_text_and_charges_nothing(
    test_client, auth_headers_teacher, monkeypatch
):
    """預填描述不計任何次數：不佔生圖名額、也不佔文字 AI 次數池（#1158 定案）。"""
    from services import scenario_dialogue_ai as ai_mod
    from services import scenario_text_quota as stq

    calls = {}

    async def fake_suggest(self, scenario_content="", question=""):
        calls["scenario"] = scenario_content
        calls["question"] = question
        return {
            "description": "Two adults at a zoo ticket booth.",
            "usage": {"input_tokens": 10, "output_tokens": 10},
            "estimated_cost_usd": 0.0,
        }

    def no_text_quota(*args, **kwargs):
        raise AssertionError("預填描述不可以佔文字 AI 次數池")

    monkeypatch.setattr(
        ai_mod.ScenarioDialogueAIService, "suggest_image_description", fake_suggest
    )
    monkeypatch.setattr(stq, "consume", no_text_quota)

    resp = test_client.post(
        SUGGEST_URL,
        headers=auth_headers_teacher,
        json={"scenario_content": "We visit the zoo."},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["description"] == "Two adults at a zoo ticket booth."
    assert calls["scenario"] == "We visit the zoo."
    assert _used_today(test_client, auth_headers_teacher) == 0


def test_suggest_description_requires_some_input(test_client, auth_headers_teacher):
    """情境與題目都空白 → 400（服務層把關），不打 AI。"""
    resp = test_client.post(SUGGEST_URL, headers=auth_headers_teacher, json={})
    assert resp.status_code == 400


def test_suggest_description_ai_failure_is_502(
    test_client, auth_headers_teacher, monkeypatch
):
    from services import scenario_dialogue_ai as ai_mod

    async def boom(self, scenario_content="", question=""):
        raise RuntimeError("vertex down")

    monkeypatch.setattr(
        ai_mod.ScenarioDialogueAIService, "suggest_image_description", boom
    )
    resp = test_client.post(
        SUGGEST_URL, headers=auth_headers_teacher, json={"scenario_content": "zoo"}
    )
    assert resp.status_code == 502


# ---------------------------------------------------------------- 稽核 log（#1158 修正 B1）

AUDIT_LOGGER = "routers.scenario_dialogue_ai"


def _audit_records(caplog):
    return [
        r
        for r in caplog.records
        if r.name == AUDIT_LOGGER and "scenario_image_generate" in r.getMessage()
    ]


def test_audit_log_is_written_even_when_409(
    test_client, auth_headers_teacher, db_session, mock_image, caplog
):
    """上一張還在生成（409）時也要留下誰、用什麼描述的稽核紀錄。"""
    from models import Teacher

    teacher = db_session.query(Teacher).first()
    sib.acquire_generation_slot(db_session, teacher)

    with caplog.at_level("INFO", logger=AUDIT_LOGGER):
        resp = test_client.post(
            IMAGE_URL, headers=auth_headers_teacher, json={"description": "busy park"}
        )
    assert resp.status_code == 409
    records = _audit_records(caplog)
    assert len(records) == 1
    assert f"teacher_id={teacher.id}" in records[0].getMessage()
    assert "busy park" in records[0].getMessage()


def test_audit_log_is_written_even_when_402(
    test_client, auth_headers_teacher, mock_image, caplog
):
    """額度用完（402）時也要留下稽核紀錄。"""
    for _ in range(sib.FREE_DAILY_LIMIT):
        test_client.post(
            IMAGE_URL, headers=auth_headers_teacher, json={"description": "a park"}
        )

    caplog.clear()
    with caplog.at_level("INFO", logger=AUDIT_LOGGER):
        resp = test_client.post(
            IMAGE_URL, headers=auth_headers_teacher, json={"description": "over quota"}
        )
    assert resp.status_code == 402
    records = _audit_records(caplog)
    assert len(records) == 1
    assert "over quota" in records[0].getMessage()
