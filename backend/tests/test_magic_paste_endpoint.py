"""
魔術貼上 API + 擷取服務測試（issue #891, PR 2）。

AI 呼叫全程 mock，只驗證：驗證、配額、擷取結果整形、成本估算。
"""

import io

import pytest

from services.magic_paste_service import (
    MagicPasteService,
    MagicPasteError,
    EXTRACT_MODE_VOCABULARY,
    EXTRACT_MODE_SENTENCE,
)
from services import magic_paste_quota as mpq


# ---------------------------------------------------------------- service unit


def test_validate_rejects_unsupported_type():
    with pytest.raises(MagicPasteError):
        MagicPasteService.validate_file(b"abc", "text/plain")


def test_validate_rejects_empty():
    with pytest.raises(MagicPasteError):
        MagicPasteService.validate_file(b"", "image/png")


def test_validate_rejects_oversize():
    big = b"x" * (MagicPasteService.MAX_FILE_BYTES + 1)
    with pytest.raises(MagicPasteError):
        MagicPasteService.validate_file(big, "image/png")


def test_validate_accepts_image_and_pdf():
    MagicPasteService.validate_file(b"data", "image/png")
    MagicPasteService.validate_file(b"data", "application/pdf")
    # 帶 charset 參數也要能過
    MagicPasteService.validate_file(b"data", "image/jpeg; charset=binary")


def test_parse_json_valid():
    raw = MagicPasteService._parse_json(
        '{"items": [{"text": "apple", "translation": "蘋果"}]}'
    )
    assert raw["items"][0]["text"] == "apple"


def test_parse_json_strips_markdown_fence():
    raw = MagicPasteService._parse_json('```json\n{"items": [{"text": "run"}]}\n```')
    assert raw["items"][0]["text"] == "run"


def test_parse_json_salvages_truncated_response():
    """token 上限截斷的回應：救回已完整輸出的項目，不整包失敗（#891 502 修復）。"""
    truncated = (
        '{"items": ['
        '{"text": "apple", "translation": "蘋果", "example_sentence": "I eat an apple."},'
        '{"text": "banana", "translation": "香蕉", "example_sentence": "I like banan'
        # 從這裡被截斷：字串未結束、陣列/物件未閉合
    )
    raw = MagicPasteService._parse_json(truncated)
    texts = [it["text"] for it in raw["items"]]
    # 第一個完整項目救回；被截斷的第二個丟棄
    assert "apple" in texts
    assert "banana" not in texts


def test_salvage_ignores_braces_inside_strings():
    """例句若含大括號也不能誤判括號配對。"""
    text = (
        '{"items": ['
        '{"text": "brace", "translation": "括號", "example_sentence": "Use {} here."},'
        '{"text": "next", "transl'  # 截斷
    )
    raw = MagicPasteService._parse_json(text)
    texts = [it["text"] for it in raw["items"]]
    assert texts == ["brace"]


def test_normalize_items_fills_and_drops():
    raw = {
        "items": [
            {"text": "apple", "translation": "蘋果"},
            {"text": "  ", "translation": "空的"},  # 無 text → 丟棄
            {"translation": "沒有 text"},  # 無 text → 丟棄
            {
                "text": "run",
                "part_of_speech": "v.",
                "example_sentence": "I run.",
                "example_sentence_translation": "我跑。",
            },
        ]
    }
    items = MagicPasteService._normalize_items(raw)
    assert [i["text"] for i in items] == ["apple", "run"]
    # 欄位齊全
    assert set(items[0].keys()) == {
        "text",
        "translation",
        "part_of_speech",
        "example_sentence",
        "example_sentence_translation",
    }
    assert items[0]["example_sentence"] == ""


def test_estimate_cost_positive():
    from services.magic_paste_service import FLASH_MODEL

    cost = MagicPasteService._estimate_cost(
        FLASH_MODEL, {"input_tokens": 1_000_000, "output_tokens": 1_000_000}
    )
    assert cost > 0


# ------------------------------------------------- extract_mode（單字集 / 例句集）


def test_vocabulary_prompt_asks_for_words_and_examples():
    prompt = MagicPasteService._build_prompt(
        "image_first", "image_first", "A1", EXTRACT_MODE_VOCABULARY
    )
    assert "vocabulary entry" in prompt
    assert "example_sentence" in prompt
    assert "part_of_speech" in prompt


def test_sentence_prompt_asks_for_sentences_only():
    """例句集：只要句子 + 翻譯，不能要求單字/詞性/例句欄位。"""
    prompt = MagicPasteService._build_prompt(
        "image_first", "image_first", "A1", EXTRACT_MODE_SENTENCE
    )
    assert "English sentence" in prompt
    assert "part_of_speech" not in prompt
    assert "example_sentence" not in prompt
    # 明確禁止輸出非句子的單字
    assert "Do NOT output single words" in prompt


def test_sentence_prompt_respects_ai_translate_mode():
    prompt = MagicPasteService._build_prompt(
        "ai", "image_first", "A1", EXTRACT_MODE_SENTENCE
    )
    assert "IGNORE any translation shown in the file" in prompt


def test_unknown_extract_mode_falls_back_to_vocabulary():
    prompt = MagicPasteService._build_prompt(
        "image_first", "image_first", "A1", "bogus"
    )
    assert "vocabulary entry" in prompt


# ---------------------------------------------------------------- endpoint


@pytest.fixture
def mock_extract(monkeypatch):
    """把 AI 擷取換成固定回傳，避免真的打 AI。"""

    async def fake_extract(self, file_bytes, mime_type, **kwargs):
        return {
            "items": [
                {
                    "text": "apple",
                    "translation": "蘋果",
                    "part_of_speech": "n.",
                    "example_sentence": "I eat an apple.",
                    "example_sentence_translation": "我吃一顆蘋果。",
                }
            ],
            "usage": {"input_tokens": 100, "output_tokens": 50},
            "estimated_cost_usd": 0.0001,
            "provider": "test",
            "model": "test-model",
        }

    monkeypatch.setattr(MagicPasteService, "extract", fake_extract)


def _png():
    return ("word.png", io.BytesIO(b"fake-png-bytes"), "image/png")


def test_endpoint_requires_auth(test_client):
    resp = test_client.post("/api/programs/magic-paste", files={"file": _png()})
    assert resp.status_code == 401


def test_endpoint_rejects_bad_type(test_client, auth_headers_teacher):
    resp = test_client.post(
        "/api/programs/magic-paste",
        headers=auth_headers_teacher,
        files={"file": ("a.txt", io.BytesIO(b"hello"), "text/plain")},
    )
    assert resp.status_code == 400


def test_endpoint_success_decrements_free_quota(
    test_client, auth_headers_teacher, mock_extract
):
    resp = test_client.post(
        "/api/programs/magic-paste",
        headers=auth_headers_teacher,
        files={"file": _png()},
        data={"translate_mode": "image_first", "example_mode": "ai"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["items"][0]["text"] == "apple"
    assert body["charge"]["charged"] == "free"
    assert body["quota"]["free_used"] == 1
    assert body["quota"]["free_remaining"] == mpq.FREE_MONTHLY_LIMIT - 1


def test_endpoint_blocks_when_quota_exhausted(
    test_client, auth_headers_teacher, demo_teacher, shared_test_session, mock_extract
):
    # 先把本月免費額度用光（無點數）
    for _ in range(mpq.FREE_MONTHLY_LIMIT):
        mpq.consume(shared_test_session, demo_teacher)

    resp = test_client.post(
        "/api/programs/magic-paste",
        headers=auth_headers_teacher,
        files={"file": _png()},
    )
    assert resp.status_code == 402
    assert resp.json()["detail"]["error"] == "MAGIC_PASTE_QUOTA_EXCEEDED"


def test_endpoint_passes_extract_mode_to_service(
    test_client, auth_headers_teacher, monkeypatch
):
    """例句集：前端傳的 extract_mode=sentence 要真的傳到 service。"""
    seen = {}

    async def fake_extract(self, file_bytes, mime_type, **kwargs):
        seen.update(kwargs)
        return {
            "items": [{"text": "I eat an apple.", "translation": "我吃一顆蘋果。"}],
            "usage": {"input_tokens": 1, "output_tokens": 1},
            "estimated_cost_usd": 0.0,
            "provider": "test",
            "model": "test-model",
        }

    monkeypatch.setattr(MagicPasteService, "extract", fake_extract)

    resp = test_client.post(
        "/api/programs/magic-paste",
        headers=auth_headers_teacher,
        files={"file": _png()},
        data={"extract_mode": EXTRACT_MODE_SENTENCE},
    )
    assert resp.status_code == 200, resp.text
    assert seen["extract_mode"] == EXTRACT_MODE_SENTENCE
    assert resp.json()["items"][0]["text"] == "I eat an apple."


def test_endpoint_defaults_to_vocabulary_mode(
    test_client, auth_headers_teacher, monkeypatch
):
    seen = {}

    async def fake_extract(self, file_bytes, mime_type, **kwargs):
        seen.update(kwargs)
        return {
            "items": [],
            "usage": {"input_tokens": 1, "output_tokens": 1},
            "estimated_cost_usd": 0.0,
            "provider": "test",
            "model": "test-model",
        }

    monkeypatch.setattr(MagicPasteService, "extract", fake_extract)

    resp = test_client.post(
        "/api/programs/magic-paste",
        headers=auth_headers_teacher,
        files={"file": _png()},
    )
    assert resp.status_code == 200
    assert seen["extract_mode"] == EXTRACT_MODE_VOCABULARY


def test_quota_endpoint(test_client, auth_headers_teacher):
    resp = test_client.get(
        "/api/programs/magic-paste/quota", headers=auth_headers_teacher
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["free_limit"] == mpq.FREE_MONTHLY_LIMIT
    assert body["free_remaining"] == mpq.FREE_MONTHLY_LIMIT
    assert body["can_use"] is True
