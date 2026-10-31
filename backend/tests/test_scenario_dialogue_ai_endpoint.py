"""情境對話 AI 端點測試 — Issue #1021。

AI 呼叫全程 mock。這裡驗的是端點該負責的事：鑑權、參數轉交、錯誤碼對應、
以及**老師填的設定有沒有原封不動送到服務層**（這張單的起因就是它們被丟掉）。
"""

import io

import pytest

from services.scenario_dialogue_ai import ScenarioDialogueAIError


PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8

ARTICLE_URL = "/api/teachers/scenario-dialogue/generate-article"
QUESTIONS_URL = "/api/teachers/scenario-dialogue/generate-questions"
EXTRACT_URL = "/api/teachers/scenario-dialogue/extract-article"


def _png():
    return ("scan.png", io.BytesIO(PNG_BYTES), "image/png")


@pytest.fixture
def captured(monkeypatch):
    """把服務層換成固定回傳，並記下呼叫參數。"""
    calls = {}

    async def fake_article(self, goal, level="", ui_language="zh-TW"):
        calls["article"] = {"goal": goal, "level": level}
        calls["article_ui_language"] = ui_language
        return {
            "content": "It is Monday morning.",
            "usage": {"input_tokens": 10, "output_tokens": 20},
            "estimated_cost_usd": 0.0001,
        }

    async def fake_questions(self, **kwargs):
        calls["questions"] = kwargs
        return {
            "questions": [{"question": "Q1", "translation": "一"}],
            "usage": {"input_tokens": 10, "output_tokens": 20},
            "estimated_cost_usd": 0.0002,
        }

    async def fake_extract(self, file_bytes, mime_type, ui_language="zh-TW"):
        calls["extract"] = {
            "size": len(file_bytes),
            "mime": mime_type,
            "ui_language": ui_language,
        }
        return {
            "content": "Extracted passage.",
            "figures": [{"page": 1, "box_2d": [10, 20, 300, 400]}],
            "suggested_title": "Shopping",
            "truncated": False,
            "usage": {"input_tokens": 5, "output_tokens": 6},
            "estimated_cost_usd": 0.00005,
        }

    from services import scenario_dialogue_ai as mod

    monkeypatch.setattr(mod.ScenarioDialogueAIService, "generate_article", fake_article)
    monkeypatch.setattr(
        mod.ScenarioDialogueAIService, "generate_questions", fake_questions
    )
    monkeypatch.setattr(mod.ScenarioDialogueAIService, "extract_article", fake_extract)
    return calls


# ---------------------------------------------------------------- 鑑權


@pytest.mark.parametrize("url", [ARTICLE_URL, QUESTIONS_URL])
def test_endpoints_require_auth(test_client, url):
    resp = test_client.post(url, json={})
    assert resp.status_code in (401, 403)


def test_extract_requires_auth(test_client):
    resp = test_client.post(EXTRACT_URL, files={"file": _png()})
    assert resp.status_code in (401, 403)


# ---------------------------------------------------------------- 生成文章


def test_generate_article_passes_goal_and_level(
    test_client, auth_headers_teacher, captured
):
    """訓練目標必須原樣送到服務層 —— 舊 stub 就是把它丟了。"""
    resp = test_client.post(
        ARTICLE_URL,
        headers=auth_headers_teacher,
        json={"goal": "這週上課學到的：交通工具與問路", "level": "A2"},
    )
    assert resp.status_code == 200, resp.text
    assert captured["article"] == {
        "goal": "這週上課學到的：交通工具與問路",
        "level": "A2",
    }
    assert resp.json()["content"] == "It is Monday morning."
    # 用量與成本要一起回，方便觀測（這一版不擋配額）
    assert resp.json()["estimated_cost_usd"] == 0.0001


def test_generate_article_invalid_params_return_400(
    test_client, auth_headers_teacher, monkeypatch
):
    from services import scenario_dialogue_ai as mod

    async def boom(self, goal, level="", ui_language="zh-TW"):
        raise ScenarioDialogueAIError("訓練目標不可為空")

    monkeypatch.setattr(mod.ScenarioDialogueAIService, "generate_article", boom)

    resp = test_client.post(
        ARTICLE_URL, headers=auth_headers_teacher, json={"goal": "  "}
    )
    assert resp.status_code == 400
    assert "訓練目標" in resp.json()["detail"]


def test_generate_article_provider_error_returns_502(
    test_client, auth_headers_teacher, monkeypatch
):
    from services import scenario_dialogue_ai as mod

    async def boom(self, goal, level="", ui_language="zh-TW"):
        raise RuntimeError("vertex exploded")

    monkeypatch.setattr(mod.ScenarioDialogueAIService, "generate_article", boom)

    resp = test_client.post(
        ARTICLE_URL, headers=auth_headers_teacher, json={"goal": "g"}
    )
    assert resp.status_code == 502
    # 不把供應商的錯誤訊息漏給前端
    assert "vertex" not in resp.text.lower()


# ---------------------------------------------------------------- 產題


def test_generate_questions_forwards_every_teacher_setting(
    test_client, auth_headers_teacher, captured
):
    """這是 #1021 的核心：面板上填的每一項都要真的送到服務層。"""
    resp = test_client.post(
        QUESTIONS_URL,
        headers=auth_headers_teacher,
        json={
            "scenario_content": "It is Monday morning at school.",
            "count": 5,
            "question_level": "B1",
            "global_tense": {"time": "past", "aspect": "simple"},
            "global_voice": "active",
            "global_rubric": "請用完整句子回答",
            "translate_language": "japanese",
            "existing_questions": ["Old one?"],
        },
    )
    assert resp.status_code == 200, resp.text
    sent = captured["questions"]
    assert sent["scenario_content"] == "It is Monday morning at school."
    assert sent["count"] == 5
    assert sent["question_level"] == "B1"
    assert sent["global_tense"] == {"time": "past", "aspect": "simple"}
    assert sent["global_voice"] == "active"
    assert sent["global_rubric"] == "請用完整句子回答"
    assert sent["translate_language"] == "japanese"
    assert sent["existing_questions"] == ["Old one?"]


def test_generate_questions_defaults_are_harmless(
    test_client, auth_headers_teacher, captured
):
    """只帶必要欄位也要能用（老師可以什麼設定都不選）。"""
    resp = test_client.post(
        QUESTIONS_URL,
        headers=auth_headers_teacher,
        json={"scenario_content": "S", "count": 3},
    )
    assert resp.status_code == 200, resp.text
    sent = captured["questions"]
    assert sent["global_tense"] is None
    assert sent["global_voice"] == ""
    assert sent["existing_questions"] == []


def test_generate_questions_invalid_count_returns_400(
    test_client, auth_headers_teacher, monkeypatch
):
    from services import scenario_dialogue_ai as mod

    async def boom(self, **kwargs):
        raise ScenarioDialogueAIError("題數需介於 3~10，收到 99")

    monkeypatch.setattr(mod.ScenarioDialogueAIService, "generate_questions", boom)

    resp = test_client.post(
        QUESTIONS_URL,
        headers=auth_headers_teacher,
        json={"scenario_content": "S", "count": 99},
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------- 擷取


def test_extract_article_success(test_client, auth_headers_teacher, captured):
    resp = test_client.post(
        EXTRACT_URL, headers=auth_headers_teacher, files={"file": _png()}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["content"] == "Extracted passage."
    assert captured["extract"]["mime"] == "image/png"


def test_extract_article_rejects_oversize(
    test_client, auth_headers_teacher, monkeypatch
):
    """大小要在讀檔階段就擋掉，不能整包讀進記憶體再說。"""
    from services import scenario_dialogue_ai as mod

    monkeypatch.setattr(mod.ScenarioDialogueAIService, "MAX_FILE_BYTES", 10)
    big = ("big.png", io.BytesIO(b"x" * 50), "image/png")

    resp = test_client.post(
        EXTRACT_URL, headers=auth_headers_teacher, files={"file": big}
    )
    assert resp.status_code == 400
    assert "過大" in resp.json()["detail"]


def test_extract_article_rejects_bad_type(test_client, auth_headers_teacher):
    bad = ("notes.csv", io.BytesIO(b"a,b,c"), "text/csv")
    resp = test_client.post(
        EXTRACT_URL, headers=auth_headers_teacher, files={"file": bad}
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------- payload 上限
#
# 這一版沒有配額（見 #1025），送進 prompt 的東西越大成本越高，所以先用寬鬆但有界的
# 上限擋住異常 payload。上限都遠大於面板正常能填出來的量，老師不會撞到。


def test_goal_too_long_is_rejected(test_client, auth_headers_teacher, captured):
    resp = test_client.post(
        ARTICLE_URL,
        headers=auth_headers_teacher,
        json={"goal": "目" * 2000},
    )
    assert resp.status_code == 422
    assert "article" not in captured  # 沒有進到服務層 = 沒有花掉一次 AI 呼叫


def test_scenario_content_too_long_is_rejected(
    test_client, auth_headers_teacher, captured
):
    resp = test_client.post(
        QUESTIONS_URL,
        headers=auth_headers_teacher,
        json={"scenario_content": "x" * 20000, "count": 5},
    )
    assert resp.status_code == 422
    assert "questions" not in captured


def test_too_many_existing_questions_is_rejected(
    test_client, auth_headers_teacher, captured
):
    resp = test_client.post(
        QUESTIONS_URL,
        headers=auth_headers_teacher,
        json={
            "scenario_content": "S",
            "count": 5,
            "existing_questions": [f"Q{i}" for i in range(100)],
        },
    )
    assert resp.status_code == 422
    assert "questions" not in captured


def test_normal_sized_payload_still_passes(test_client, auth_headers_teacher, captured):
    """上限是防呆不是限制：面板填得出來的量都要過得去。"""
    resp = test_client.post(
        QUESTIONS_URL,
        headers=auth_headers_teacher,
        json={
            "scenario_content": "It is Monday morning. " * 100,  # 約 2200 字
            "count": 10,
            "global_rubric": "請用完整句子回答。" * 20,
            "translate_language": "西班牙文",
            "existing_questions": [f"Question {i}?" for i in range(10)],
        },
    )
    assert resp.status_code == 200, resp.text
    assert captured["questions"]["translate_language"] == "西班牙文"


# ------------------------------------------------- 參數錯 vs 模型沒產出（#1023 review）
#
# 兩者對老師的意思完全不同：參數錯是「你填的東西有問題」（400，訊息直接顯示），
# 模型沒產出是「這次不巧，再按一次」（502，通用訊息）。


def test_model_produced_nothing_returns_502_not_400(
    test_client, auth_headers_teacher, monkeypatch
):
    from services import scenario_dialogue_ai as mod

    async def empty(self, **kwargs):
        raise mod.ScenarioDialogueAIOutputError("AI 這次沒有產出可用的題目")

    monkeypatch.setattr(mod.ScenarioDialogueAIService, "generate_questions", empty)

    resp = test_client.post(
        QUESTIONS_URL,
        headers=auth_headers_teacher,
        json={"scenario_content": "S", "count": 5},
    )
    assert resp.status_code == 502
    assert "請稍後再試" in resp.json()["detail"]


def test_bad_params_still_return_400(test_client, auth_headers_teacher, monkeypatch):
    """參數錯不能被新的 502 分支吃掉 —— 老師需要看到是哪裡填錯。"""
    from services import scenario_dialogue_ai as mod

    async def bad(self, **kwargs):
        raise ScenarioDialogueAIError("情境內容不可為空（產題的素材）")

    monkeypatch.setattr(mod.ScenarioDialogueAIService, "generate_questions", bad)

    resp = test_client.post(
        QUESTIONS_URL,
        headers=auth_headers_teacher,
        json={"scenario_content": " ", "count": 5},
    )
    assert resp.status_code == 400
    assert "情境內容" in resp.json()["detail"]


# ---------------------------------------------------------------- #1146


def test_generate_questions_without_scenario_forwards_direction(
    test_client, auth_headers_teacher, captured
):
    """「不需要情境，問日常生活」：沒有情境文章，只帶出題方向也要能出題。"""
    resp = test_client.post(
        QUESTIONS_URL,
        headers=auth_headers_teacher,
        json={
            "direction": "問學生週末通常做什麼",
            "count": 5,
            "ui_language": "en",
        },
    )
    assert resp.status_code == 200, resp.text
    sent = captured["questions"]
    assert sent["scenario_content"] == ""
    assert sent["direction"] == "問學生週末通常做什麼"
    assert sent["scenario_images"] == []
    assert sent["ui_language"] == "en"


def test_generate_questions_forwards_scenario_images(
    test_client, auth_headers_teacher, captured
):
    images = [f"https://storage.googleapis.com/b/images/{i}.png" for i in range(5)]
    resp = test_client.post(
        QUESTIONS_URL,
        headers=auth_headers_teacher,
        json={"scenario_content": "S", "count": 3, "scenario_images": images},
    )
    assert resp.status_code == 200, resp.text
    assert captured["questions"]["scenario_images"] == images


def test_generate_questions_rejects_more_than_five_images(
    test_client, auth_headers_teacher, captured
):
    images = [f"https://storage.googleapis.com/b/images/{i}.png" for i in range(6)]
    resp = test_client.post(
        QUESTIONS_URL,
        headers=auth_headers_teacher,
        json={"scenario_content": "S", "count": 3, "scenario_images": images},
    )
    assert resp.status_code == 422
    assert "questions" not in captured


def test_generate_article_forwards_ui_language(
    test_client, auth_headers_teacher, captured
):
    resp = test_client.post(
        ARTICLE_URL,
        headers=auth_headers_teacher,
        json={"goal": "transport", "ui_language": "en"},
    )
    assert resp.status_code == 200, resp.text
    assert captured["article_ui_language"] == "en"


def test_extract_article_returns_figures(test_client, auth_headers_teacher, captured):
    """擷取要一併回檔內圖片的座標，前端才裁得出情境圖。"""
    resp = test_client.post(
        EXTRACT_URL, headers=auth_headers_teacher, files={"file": _png()}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["figures"] == [{"page": 1, "box_2d": [10, 20, 300, 400]}]


def test_extract_article_returns_suggested_title_and_ui_language(
    test_client, auth_headers_teacher, captured
):
    """#1146 使用者決定 5：擷取同一次呼叫一併建議標題，標題語言跟老師介面語言。"""
    resp = test_client.post(
        EXTRACT_URL,
        headers=auth_headers_teacher,
        files={"file": _png()},
        data={"ui_language": "en"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["suggested_title"] == "Shopping"
    assert captured["extract"]["ui_language"] == "en"
