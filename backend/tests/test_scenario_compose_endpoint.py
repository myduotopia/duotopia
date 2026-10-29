"""情境對話 compose 端點 — Issue #1158 C 段。

老師在對話框打字 → 一次 AI 呼叫判斷意圖（自己打題目／請 AI 出題）並產出。
Vertex 全程 mock（換掉 ``_call_vertex``），所以 prompt 組裝與輸出收斂都會真的跑到。
"""

import json
import logging
from types import SimpleNamespace

import pytest

from services import scenario_dialogue_compose as compose_mod
from services.scenario_dialogue_compose import ScenarioDialogueComposeService

COMPOSE_URL = "/api/teachers/scenario-dialogue/compose"
QUOTA_URL = "/api/teachers/scenario-dialogue/text-quota"

BASE_BODY = {
    "scenario_content": "Tom goes to a night market with his family.",
    "question_level": "A2",
    "translate_language": "Traditional Chinese",
    "ui_language": "zh-TW",
}


def _q(text, **extra):
    return {
        "question": text,
        "translation": extra.get("translation", "翻譯"),
        "keywords": extra.get("keywords", ["market"]),
        "reference_answer": extra.get("reference_answer", "I like it."),
        "image_prompt": extra.get("image_prompt", "A night market."),
    }


@pytest.fixture
def fake_ai(monkeypatch):
    """把 Vertex 換成固定輸出；記下 prompt 與呼叫次數。"""
    state = {"output": {}, "calls": 0, "prompt": None, "extra_parts": None}

    async def fake_call(
        cls, prompt, max_output_tokens, file_part=None, extra_parts=None
    ):
        state["calls"] += 1
        state["prompt"] = prompt
        state["extra_parts"] = extra_parts
        out = state["output"]
        text = out if isinstance(out, str) else json.dumps(out, ensure_ascii=False)
        return SimpleNamespace(text=text), {"input_tokens": 10, "output_tokens": 20}

    monkeypatch.setattr(
        ScenarioDialogueComposeService, "_call_vertex", classmethod(fake_call)
    )
    return state


def _post(client, headers, **body):
    return client.post(COMPOSE_URL, headers=headers, json={**BASE_BODY, **body})


def _used(client, headers):
    return client.get(QUOTA_URL, headers=headers).json()["used"]


# ---------------------------------------------------------------- 鑑權 / 驗證


def test_compose_requires_auth(test_client):
    assert test_client.post(COMPOSE_URL, json={"text": "hi"}).status_code in (401, 403)


def test_blank_text_rejected_before_quota(test_client, auth_headers_teacher, fake_ai):
    resp = _post(test_client, auth_headers_teacher, text="   ")
    assert resp.status_code == 422
    assert fake_ai["calls"] == 0
    assert _used(test_client, auth_headers_teacher) == 0


# ---------------------------------------------------------------- 兩種意圖


def test_add_questions_splits_and_blanks_translation(
    test_client, auth_headers_teacher, fake_ai
):
    fake_ai["output"] = {
        "usable": True,
        "intent": "add_questions",
        "skipped_count": 0,
        "questions": [
            _q("What did Tom eat?", translation="湯姆吃了什麼？"),
            _q("Who went with Tom?"),
        ],
    }
    resp = _post(
        test_client,
        auth_headers_teacher,
        text="1. What did Tom eat?\n2. Who went with Tom?",
    )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["usable"] is True
    assert data["intent"] == "add_questions"
    assert [q["question"] for q in data["questions"]] == [
        "What did Tom eat?",
        "Who went with Tom?",
    ]
    # 自己打的題目不產翻譯，就算模型多給了也清掉
    assert all(q["translation"] == "" for q in data["questions"])
    assert data["questions"][0]["keywords"] == ["market"]
    assert data["questions"][0]["reference_answer"] == "I like it."
    assert data["skipped_count"] == 0
    assert data["truncated_count"] == 0
    assert data["quota"]["used"] == 1
    # 老師原文與設定都有進 prompt
    assert "What did Tom eat?" in fake_ai["prompt"]
    assert "night market" in fake_ai["prompt"]
    assert "CEFR level of the questions: A2" in fake_ai["prompt"]


def test_generate_uses_settings_and_counts_once(
    test_client, auth_headers_teacher, fake_ai
):
    fake_ai["output"] = {
        "usable": True,
        "intent": "generate",
        "skipped_count": 0,
        "questions": [_q("Q1", translation="一"), _q("Q2"), _q("Q3")],
    }
    resp = _post(
        test_client,
        auth_headers_teacher,
        text="再出 3 題關於食物",
        existing_questions=["Old 1", "Old 2"],
        global_tense={"time": "past", "aspect": "simple"},
    )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["intent"] == "generate"
    assert [q["question"] for q in data["questions"]] == ["Q1", "Q2", "Q3"]
    assert data["questions"][0]["translation"] == "一"
    assert data["truncated_count"] == 0
    assert fake_ai["calls"] == 1
    assert _used(test_client, auth_headers_teacher) == 1
    prompt = fake_ai["prompt"]
    # 剩餘 8 題：要求上限與預設題數都寫進 prompt
    assert "at most 8" in prompt
    assert "Otherwise write 5" in prompt
    assert "past simple" in prompt
    assert "- Old 1" in prompt


def test_generate_caps_at_remaining_and_skips_existing(
    test_client, auth_headers_teacher, fake_ai
):
    """generate 請求 min(要求, 剩餘)；模型多給也截到剩餘名額，且不重複既有題。"""
    existing = [f"Old {i}" for i in range(8)]  # 剩 2 題
    fake_ai["output"] = {
        "usable": True,
        "intent": "generate",
        "questions": [_q("Old 1"), _q("N1"), _q("N2"), _q("N3")],
    }
    resp = _post(
        test_client,
        auth_headers_teacher,
        text="give me 5 more",
        existing_questions=existing,
    )

    data = resp.json()
    assert [q["question"] for q in data["questions"]] == ["N1", "N2"]
    assert data["truncated_count"] == 0
    assert "at most 2" in fake_ai["prompt"]
    assert "Otherwise write 2" in fake_ai["prompt"]


def test_no_scenario_no_direction_uses_message_as_direction(
    test_client, auth_headers_teacher, fake_ai
):
    fake_ai["output"] = {"usable": True, "intent": "generate", "questions": [_q("Q")]}
    resp = test_client.post(
        COMPOSE_URL,
        headers=auth_headers_teacher,
        json={"text": "出幾題關於週末活動"},
    )

    assert resp.status_code == 200, resp.text
    assert "use the teacher's message itself as the direction" in fake_ai["prompt"]


# ---------------------------------------------------------------- 無關內容


def test_partially_unrelated_reports_skipped_count(
    test_client, auth_headers_teacher, fake_ai
):
    fake_ai["output"] = {
        "usable": True,
        "intent": "add_questions",
        "skipped_count": 2,
        "questions": [_q("What is Tom buying?")],
    }
    resp = _post(
        test_client,
        auth_headers_teacher,
        text="老師好～\nWhat is Tom buying?\n今天好累",
    )

    data = resp.json()
    assert data["usable"] is True
    assert data["skipped_count"] == 2
    assert len(data["questions"]) == 1
    assert data["quota"]["used"] == 1


def test_fully_unrelated_reasks_and_does_not_burn_quota(
    test_client, auth_headers_teacher, fake_ai, monkeypatch, caplog
):
    from routers import scenario_dialogue_ai as router_mod

    monkeypatch.setattr(router_mod, "_reask_refund_counts", router_mod.Counter())
    fake_ai["output"] = {"usable": False, "reask": "請直接打題目，例如：What did Tom eat?"}

    with caplog.at_level(logging.WARNING):
        resp = _post(test_client, auth_headers_teacher, text="你好")

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["usable"] is False
    assert data["reask"].startswith("請直接打題目")
    assert data["questions"] == []
    assert _used(test_client, auth_headers_teacher) == 0
    logs = [r.getMessage() for r in caplog.records if "reask_refund" in r.getMessage()]
    assert logs and "endpoint=compose" in logs[-1]


def test_usable_but_empty_questions_reasks_without_charge(
    test_client, auth_headers_teacher, fake_ai
):
    fake_ai["output"] = {"usable": True, "intent": "add_questions", "questions": []}
    resp = _post(test_client, auth_headers_teacher, text="???")

    data = resp.json()
    assert data["usable"] is False
    assert data["reask"]
    assert _used(test_client, auth_headers_teacher) == 0


# ---------------------------------------------------------------- 名額


def test_add_questions_over_remaining_not_truncated(
    test_client, auth_headers_teacher, fake_ai
):
    """後端不截斷 add_questions：全部回傳，truncated_count 告訴前端超出幾題。"""
    existing = [f"Old {i}" for i in range(7)]  # 剩 3 題
    fake_ai["output"] = {
        "usable": True,
        "intent": "add_questions",
        "questions": [_q(f"Mine {i}") for i in range(5)],
    }
    resp = _post(
        test_client,
        auth_headers_teacher,
        text="\n".join(f"Mine {i}" for i in range(5)),
        existing_questions=existing,
    )

    data = resp.json()
    assert len(data["questions"]) == 5
    assert data["truncated_count"] == 2


def test_more_than_ten_questions_is_not_rejected_by_save_rule(
    test_client, auth_headers_teacher, fake_ai
):
    """存檔的 3～10 題規則不適用於單次產出。"""
    fake_ai["output"] = {
        "usable": True,
        "intent": "add_questions",
        "questions": [_q(f"Mine {i}") for i in range(12)],
    }
    resp = _post(test_client, auth_headers_teacher, text="many questions")

    assert resp.status_code == 200, resp.text
    assert len(resp.json()["questions"]) == 12
    assert resp.json()["truncated_count"] == 2


def test_full_list_returns_409_without_ai_or_quota(
    test_client, auth_headers_teacher, fake_ai
):
    resp = _post(
        test_client,
        auth_headers_teacher,
        text="再出 2 題",
        existing_questions=[f"Old {i}" for i in range(10)],
    )

    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "SCENARIO_QUESTIONS_FULL"
    assert fake_ai["calls"] == 0
    assert _used(test_client, auth_headers_teacher) == 0


def test_blank_existing_questions_do_not_take_slots(
    test_client, auth_headers_teacher, fake_ai
):
    """只算非空白題：10 格裡有空白題時仍有名額。"""
    fake_ai["output"] = {"usable": True, "intent": "generate", "questions": [_q("Q")]}
    existing = [f"Old {i}" for i in range(9)] + ["   "]
    resp = _post(
        test_client, auth_headers_teacher, text="再出 1 題", existing_questions=existing
    )

    assert resp.status_code == 200, resp.text
    assert "at most 1" in fake_ai["prompt"]


# ---------------------------------------------------------------- 失敗


@pytest.mark.parametrize(
    "output",
    [
        "not json at all",
        {"usable": True, "intent": "something_else", "questions": [_q("Q")]},
        {"usable": True, "intent": "generate"},
    ],
)
def test_bad_output_returns_502_and_refunds(
    test_client, auth_headers_teacher, fake_ai, output
):
    fake_ai["output"] = output
    resp = _post(test_client, auth_headers_teacher, text="What is this?")

    assert resp.status_code == 502
    assert _used(test_client, auth_headers_teacher) == 0


# ---------------------------------------------------------------- 欄位清理


def test_normalize_cleans_fields():
    raw = {
        "usable": True,
        "intent": "generate",
        "skipped_count": "3",  # 不是數字 → 0
        "questions": [
            "not a dict",
            {"question": "   "},
            {
                "question": "  Where is Tom?  ",
                "translation": "湯姆\n在哪？",
                "keywords": "market, Market , , night",
                "reference_answer": "  He is at the market. ",
                "image_prompt": "A boy\n at a market",
            },
            {"question": "Where is Tom?"},  # 重複
        ],
    }
    result = ScenarioDialogueComposeService.normalize_compose(raw, remaining=5)

    assert result["skipped_count"] == 0
    assert result["questions"] == [
        {
            "question": "Where is Tom?",
            "translation": "湯姆 在哪？",
            "keywords": ["market", "night"],
            "reference_answer": "He is at the market.",
            "image_prompt": "A boy at a market",
        }
    ]


def test_truncated_output_recovers_intent_and_questions(fake_ai):
    """輸出被 token 上限截斷時，救回完整題目並撿回 intent。"""
    import asyncio

    fake_ai["output"] = (
        '{"usable": true, "intent": "add_questions", "skipped_count": 0, '
        '"questions": [{"question": "A?", "keywords": []}, {"question": "B'
    )
    service = compose_mod.ScenarioDialogueComposeService()
    result = asyncio.run(service.compose(text="A? B?", remaining=5))

    assert result["intent"] == "add_questions"
    assert [q["question"] for q in result["questions"]] == ["A?"]


def test_scenario_images_are_sent_as_parts(
    test_client, auth_headers_teacher, fake_ai, monkeypatch
):
    from services import scenario_context_images

    monkeypatch.setattr(
        scenario_context_images, "build_image_parts", lambda urls: ["PART"] * len(urls)
    )
    fake_ai["output"] = {"usable": True, "intent": "generate", "questions": [_q("Q")]}
    resp = _post(
        test_client,
        auth_headers_teacher,
        text="出 1 題",
        scenario_images=["/static/a.png"],
    )

    assert resp.status_code == 200, resp.text
    assert fake_ai["extra_parts"] == ["PART"]
    assert "1 picture(s)" in fake_ai["prompt"]
