"""
魔術貼上 API + 擷取服務測試（issue #891, PR 2）。

AI 呼叫全程 mock，只驗證：驗證、配額、擷取結果整形、成本估算。
"""

import io
import json

import pytest

from services.magic_paste_service import (
    MagicPasteService,
    MagicPasteError,
    EXTRACT_MODE_VOCABULARY,
    EXTRACT_MODE_SENTENCE,
    EXTRACT_MODE_READING_GROUP,
    GROUP_TITLE_MAX_CHARS,
    FIGURE_CAPTION_MAX_CHARS,
    MC_MAX_OPTIONS,
)
from services import magic_paste_quota as mpq


# ---------------------------------------------------------------- service unit

# 各類型的最小合法檔頭（magic bytes）
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 8
PDF_BYTES = b"%PDF-1.4\n" + b"\x00" * 8


def test_validate_rejects_unsupported_type():
    with pytest.raises(MagicPasteError):
        MagicPasteService.validate_file(PNG_BYTES, "text/plain")


def test_validate_rejects_empty():
    with pytest.raises(MagicPasteError):
        MagicPasteService.validate_file(b"", "image/png")


def test_validate_rejects_oversize():
    big = b"x" * (MagicPasteService.MAX_FILE_BYTES + 1)
    with pytest.raises(MagicPasteError):
        MagicPasteService.validate_file(big, "image/png")


def test_validate_rejects_spoofed_content_type():
    """content-type 宣稱 image/png 但實際位元組不是任何支援簽章 → 擋下（round-4 #1）。"""
    with pytest.raises(MagicPasteError):
        MagicPasteService.validate_file(b"totally-not-an-image", "image/png")


def test_validate_accepts_image_and_pdf():
    MagicPasteService.validate_file(PNG_BYTES, "image/png")
    MagicPasteService.validate_file(PDF_BYTES, "application/pdf")
    # 帶 charset 參數也要能過
    MagicPasteService.validate_file(JPEG_BYTES, "image/jpeg; charset=binary")


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
    prompt = MagicPasteService._build_prompt("A1", EXTRACT_MODE_VOCABULARY)
    assert "vocabulary entry" in prompt
    assert "example_sentence" in prompt
    assert "part_of_speech" in prompt


def test_sentence_prompt_asks_for_sentences_only():
    """例句集：只要句子 + 翻譯，不能要求單字/詞性/例句欄位。"""
    prompt = MagicPasteService._build_prompt("A1", EXTRACT_MODE_SENTENCE)
    assert "English sentence" in prompt
    assert "part_of_speech" not in prompt
    assert "example_sentence" not in prompt
    # 明確禁止輸出非句子的單字
    assert "Do NOT output single words" in prompt


def test_prompt_never_asks_ai_to_generate():
    """擷取一律只抄圖上有的，不得指示 AI 生成翻譯/例句（改由插入時補洞）。"""
    for mode in (EXTRACT_MODE_VOCABULARY, EXTRACT_MODE_SENTENCE):
        prompt = MagicPasteService._build_prompt("A1", mode)
        assert "Do NOT generate" in prompt
        assert "copy ONLY" in prompt
        # 不得出現「請 AI 生成」類指示
        assert "generate the Traditional Chinese translation" not in prompt
        assert "generate a natural CEFR" not in prompt


def test_unknown_extract_mode_falls_back_to_vocabulary():
    prompt = MagicPasteService._build_prompt("A1", "bogus")
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
    return ("word.png", io.BytesIO(PNG_BYTES), "image/png")


def test_endpoint_requires_auth(test_client):
    resp = test_client.post("/api/programs/magic-paste", files={"file": _png()})
    assert resp.status_code == 401


def test_endpoint_rejects_oversize(test_client, auth_headers_teacher, monkeypatch):
    """超過大小上限的檔案 → 400（且只讀到 上限+1 bytes，不整包載入）。"""
    monkeypatch.setattr(MagicPasteService, "MAX_FILE_BYTES", 10)
    resp = test_client.post(
        "/api/programs/magic-paste",
        headers=auth_headers_teacher,
        files={"file": ("big.png", io.BytesIO(b"x" * 50), "image/png")},
    )
    assert resp.status_code == 400


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
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["items"][0]["text"] == "apple"
    assert body["charge"]["charged"] == "free"
    assert body["quota"]["free_used"] == 1
    assert body["quota"]["free_remaining"] == mpq.FREE_MONTHLY_LIMIT - 1


def test_endpoint_zero_items_does_not_consume_quota(
    test_client, auth_headers_teacher, monkeypatch
):
    """擷取到 0 項（模糊圖/非教材圖）→ 不扣配額（round-3 #2）。"""

    async def fake_extract(self, file_bytes, mime_type, **kwargs):
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
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["items"] == []
    assert body["charge"] is None
    # 免費額度未被扣（仍是滿的）
    assert body["quota"]["free_used"] == 0
    assert body["quota"]["free_remaining"] == mpq.FREE_MONTHLY_LIMIT


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


# ---------------------------------------------------- reading_group（#1084 一份檔→一個題組）


def test_reading_group_prompt_asks_for_stimulus_box_and_questions():
    prompt = MagicPasteService._build_prompt("A1", EXTRACT_MODE_READING_GROUP)
    assert "box_2d" in prompt
    assert "[ymin, xmin, ymax, xmax]" in prompt
    assert '"kind": "text" | "image"' in prompt
    assert "glossary" in prompt
    assert "Never guess" in prompt


def test_reading_group_prompt_requires_a_title_even_without_printed_one():
    prompt = MagicPasteService._build_prompt("A1", EXTRACT_MODE_READING_GROUP)
    assert "ALWAYS return a title" in prompt
    assert "at most 8 words" in prompt
    # 沒印刷標題時要自己下標，而不是留空
    assert 'otherwise ""' not in prompt.split("`stimulus.kind`")[0]


def test_normalize_reading_group_truncates_long_title_and_allows_empty():
    long_title = "A" * 260
    g = MagicPasteService._normalize_reading_group(
        {"title": long_title, "stimulus": {"kind": "text", "paragraphs": ["p"]}}
    )[0]
    assert len(g["title"]) == GROUP_TITLE_MAX_CHARS
    assert g["title"] == "A" * GROUP_TITLE_MAX_CHARS

    # 模型偶爾不給 title：仍是合法結果，只是空字串
    no_title = MagicPasteService._normalize_reading_group(
        {"stimulus": {"kind": "text", "paragraphs": ["p"]}}
    )[0]
    assert no_title["title"] == ""


def test_normalize_reading_group_text_kind():
    raw = {
        "title": " Vivaldi ",
        "stimulus": {
            "kind": "text",
            "paragraphs": ["  Antonio Vivaldi was a violin player. ", "", "Sadly..."],
            "text": "",
            "box_2d": [0, 0, 500, 1000],
        },
        "glossary": [
            {"word": "timeline", "zh": "時間軸"},
            {"word": "", "zh": "空"},
            {"word": "only", "zh": ""},
        ],
        "questions": [
            {"stem": "25. Which is the best title?", "options": ["A", "B", "C", "D"]},
            {"stem": "", "options": ["x", "y"]},
            {"stem": "too few", "options": ["only one"]},
        ],
    }
    items = MagicPasteService._normalize_reading_group(raw)
    assert len(items) == 1
    g = items[0]
    assert g["title"] == "Vivaldi"
    assert g["stimulus"]["kind"] == "text"
    assert g["stimulus"]["paragraphs"] == [
        "Antonio Vivaldi was a violin player.",
        "Sadly...",
    ]
    # text 模式不帶座標
    assert g["stimulus"]["box_2d"] is None
    assert g["glossary"] == [{"word": "timeline", "zh": "時間軸"}]
    assert [q["stem"] for q in g["questions"]] == ["25. Which is the best title?"]


def test_normalize_reading_group_image_kind_and_bad_box():
    good = {
        "stimulus": {
            "kind": "image",
            "paragraphs": ["ignored for image"],
            "text": "Happy Town Lantern Festival",
            "box_2d": [12.4, 0, 640, 1000],
            "page": 1,
        },
        "questions": [],
    }
    g = MagicPasteService._normalize_reading_group(good)[0]
    assert g["stimulus"]["kind"] == "image"
    assert g["stimulus"]["paragraphs"] == []
    assert g["stimulus"]["box_2d"] == [12, 0, 640, 1000]
    assert g["stimulus"]["page"] == 1
    assert g["stimulus"]["text"] == "Happy Town Lantern Festival"
    assert g["questions"] == []

    for bad_box in (
        [0, 0, 0, 1000],
        [1, 2, 3],
        [0, 0, 1200, 1000],
        "nope",
        [True, 0, 1, 1],
    ):
        raw = {"stimulus": {"kind": "image", "text": "t", "box_2d": bad_box}}
        g = MagicPasteService._normalize_reading_group(raw)[0]
        assert g["stimulus"]["box_2d"] is None, bad_box


def test_normalize_reading_group_infers_kind_and_drops_empty():
    inferred = MagicPasteService._normalize_reading_group(
        {"stimulus": {"paragraphs": ["p1"]}, "questions": []}
    )
    assert inferred[0]["stimulus"]["kind"] == "text"
    # 沒素材也沒小題 → 不回傳（endpoint 不扣配額）
    assert MagicPasteService._normalize_reading_group({"stimulus": {}}) == []
    assert MagicPasteService._normalize_reading_group("garbage") == []


def test_endpoint_reading_group_mode_returns_single_group_and_charges_once(
    test_client, auth_headers_teacher, monkeypatch
):
    seen = {}

    async def fake_extract(self, file_bytes, mime_type, **kwargs):
        seen["extract_mode"] = kwargs.get("extract_mode")
        return {
            "items": [
                {
                    "title": "",
                    "stimulus": {
                        "kind": "image",
                        "paragraphs": [],
                        "text": "poster text",
                        "box_2d": [0, 0, 600, 1000],
                        "page": 1,
                    },
                    "glossary": [],
                    "questions": [
                        {
                            "stem": "What is the purpose?",
                            "options": ["a", "b", "c", "d"],
                            "correct_indexes": [],
                            "explanation": "",
                        }
                    ],
                }
            ],
            "usage": {"input_tokens": 10, "output_tokens": 5},
            "estimated_cost_usd": 0.0,
            "provider": "test",
            "model": "test-model",
        }

    monkeypatch.setattr(MagicPasteService, "extract", fake_extract)
    resp = test_client.post(
        "/api/programs/magic-paste",
        headers=auth_headers_teacher,
        files={"file": _png()},
        data={"extract_mode": EXTRACT_MODE_READING_GROUP},
    )
    assert resp.status_code == 200, resp.text
    assert seen["extract_mode"] == EXTRACT_MODE_READING_GROUP
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["stimulus"]["box_2d"] == [0, 0, 600, 1000]
    assert body["charge"]["charged"] == "free"
    assert body["quota"]["free_used"] == 1


# ------------------------------------- 插圖 / 題幹圖 / 選項圖 / 克漏字空格（#1084 / #1086）


def test_reading_group_prompt_asks_for_figures_blanks_and_option_boxes():
    prompt = MagicPasteService._build_prompt("A1", EXTRACT_MODE_READING_GROUP)
    # 文章內插圖：座標 + 在第幾段之後
    assert "`stimulus.figures`" in prompt
    assert "after_paragraph" in prompt
    # 克漏字：印刷空格重編為 {{n}}
    assert "{{n}}" in prompt
    assert "blanks_renumbered" in prompt
    assert "`questions[i].blank`" in prompt
    # 題幹圖與選項圖
    assert "`questions[i].stem_box_2d`" in prompt
    assert "`questions[i].option_boxes`" in prompt
    # 圖片選項不准編字
    assert "never invent words for a picture choice" in prompt


def test_multiple_choice_prompt_asks_for_stem_and_option_boxes():
    from services.magic_paste_service import EXTRACT_MODE_MULTIPLE_CHOICE

    prompt = MagicPasteService._build_prompt("A1", EXTRACT_MODE_MULTIPLE_CHOICE)
    assert "`stem_box_2d`" in prompt
    assert "`option_boxes`" in prompt
    assert "[ymin, xmin, ymax, xmax]" in prompt


def test_normalize_mc_items_keeps_image_only_options():
    """四個圖片選項（題本第 29 題）：text 全空字串，靠 option_boxes 認。"""
    items = MagicPasteService._normalize_mc_items(
        {
            "items": [
                {
                    "stem": "Which picture shows the answer?",
                    "stem_box_2d": [10, 10, 100, 200],
                    "options": ["", "", "", ""],
                    "option_boxes": [
                        [100, 0, 200, 250],
                        [100, 250, 200, 500],
                        [100, 500, 200, 750],
                        [100, 750, 200, 1000],
                    ],
                    "correct_indexes": [2],
                }
            ]
        }
    )
    assert len(items) == 1
    it = items[0]
    assert it["options"] == ["", "", "", ""]
    assert it["stem_box_2d"] == [10, 10, 100, 200]
    assert it["option_boxes"][1] == [100, 250, 200, 500]
    assert it["correct_indexes"] == [2]


def test_normalize_mc_items_drops_options_without_text_or_box():
    """沒字也沒圖的位置不算選項；剩不到兩個就整題丟掉。"""
    items = MagicPasteService._normalize_mc_items(
        {
            "items": [
                {
                    "stem": "mixed",
                    "options": ["cat", "", "dog", ""],
                    "option_boxes": [None, [0, 0, 10, 10], None],
                },
                {"stem": "too few", "options": ["", ""], "option_boxes": []},
            ]
        }
    )
    assert len(items) == 1
    assert items[0]["options"] == ["cat", "", "dog"]
    assert items[0]["option_boxes"] == [None, [0, 0, 10, 10], None]


def test_normalize_mc_items_drops_bad_boxes_but_keeps_question():
    items = MagicPasteService._normalize_mc_items(
        {
            "items": [
                {
                    "stem": "bad boxes",
                    "stem_box_2d": [500, 0, 100, 1000],  # ymin >= ymax
                    "options": ["a", "b"],
                    "option_boxes": [[0, 0, 10, 2000], "nope"],  # 超範圍 / 非 list
                }
            ]
        }
    )
    assert len(items) == 1
    assert items[0]["stem_box_2d"] is None
    assert items[0]["option_boxes"] == [None, None]


def test_normalize_mc_items_keeps_empty_stem_only_for_cloze_or_stem_image():
    """克漏字小題題本上只印選項（題幹真的是空字串），不能被當成壞題丟掉。"""
    items = MagicPasteService._normalize_mc_items(
        {
            "items": [
                {"stem": "", "blank": 2, "options": ["in", "on", "at", "by"]},
                {
                    "stem": "",
                    "stem_box_2d": [0, 0, 100, 100],
                    "options": ["a", "b"],
                },
                {"stem": "", "options": ["a", "b"]},  # 沒 blank 沒圖 → 丟掉
            ]
        }
    )
    assert len(items) == 2
    assert items[0]["blank"] == 2
    assert items[1]["stem_box_2d"] == [0, 0, 100, 100]


@pytest.mark.parametrize("bad", [0, -1, 1000, "3", True, None, 2.5e9])
def test_normalize_blank_index_rejects_out_of_range(bad):
    assert MagicPasteService._normalize_blank_index(bad) is None


def test_normalize_reading_group_figures_clamped_to_paragraphs():
    raw = {
        "stimulus": {
            "kind": "text",
            "paragraphs": ["First paragraph.", "Second paragraph."],
            "figures": [
                {
                    "box_2d": [0, 600, 300, 1000],
                    "after_paragraph": 0,
                    "caption": " 聖誕老人 ",
                },
                {"box_2d": [400, 600, 600, 1000], "after_paragraph": 9},  # 夾到最後一段
                {"box_2d": [700, 0, 800, 100], "after_paragraph": -5},  # 夾到文章前
                {"box_2d": [0, 0, 0, 0]},  # 面積 0 → 丟掉
                {"after_paragraph": 1},  # 沒座標 → 丟掉
                "garbage",
            ],
        },
        "questions": [],
    }
    g = MagicPasteService._normalize_reading_group(raw)[0]
    figures = g["stimulus"]["figures"]
    assert [f["after_paragraph"] for f in figures] == [0, 1, -1]
    assert figures[0]["caption"] == "聖誕老人"
    assert figures[1]["caption"] == ""


def test_normalize_reading_group_cloze_blanks_and_renumber_flag():
    raw = {
        "title": "Santa's Letter",
        "stimulus": {
            "kind": "text",
            "paragraphs": ["Dear Santa, I {{1}} a bike.", "I will {{2}} good."],
            "blanks_renumbered": True,
        },
        "questions": [
            {"stem": "", "blank": 1, "options": ["want", "wants", "wanted", "wanting"]},
            {"stem": "", "blank": 2, "options": ["be", "being", "been", "to be"]},
        ],
    }
    g = MagicPasteService._normalize_reading_group(raw)[0]
    assert g["stimulus"]["blanks_renumbered"] is True
    assert [q["blank"] for q in g["questions"]] == [1, 2]
    # 連號檢查交前端驗證：normalize 不改寫段落文字
    assert g["stimulus"]["paragraphs"][0] == "Dear Santa, I {{1}} a bike."


def test_normalize_reading_group_image_kind_drops_figures():
    raw = {
        "stimulus": {
            "kind": "image",
            "text": "poster text",
            "box_2d": [0, 0, 500, 1000],
            "figures": [{"box_2d": [0, 0, 100, 100], "after_paragraph": 0}],
        },
        "questions": [],
    }
    g = MagicPasteService._normalize_reading_group(raw)[0]
    assert g["stimulus"]["figures"] == []
    assert g["stimulus"]["blanks_renumbered"] is False


def test_normalize_mc_items_remaps_correct_indexes_after_compaction():
    """選項壓縮（丟掉無字無 box 的位置）後，correct_indexes 要指回新位置（#1084）。"""
    raw = {
        "stem": "Which picture?",
        "stem_box_2d": [10, 10, 100, 200],
        "options": ["", "", "", ""],
        # 第 2 個 box 壞掉 → 該位置無字無圖被丟掉，存活 3 個選項
        "option_boxes": [
            [100, 0, 200, 250],
            "nope",
            [100, 500, 200, 750],
            [100, 750, 200, 1000],
        ],
    }
    it = MagicPasteService._normalize_mc_items(
        {"items": [{**raw, "correct_indexes": [2]}]}
    )[0]
    assert len(it["options"]) == 3
    assert it["correct_indexes"] == [1]

    it = MagicPasteService._normalize_mc_items(
        {"items": [{**raw, "correct_indexes": [3]}]}
    )[0]
    assert it["correct_indexes"] == [2]

    # 被丟掉的位置本身是答案 → 排除（寧可沒答案，也不要指到別的選項）
    it = MagicPasteService._normalize_mc_items(
        {"items": [{**raw, "correct_indexes": [1]}]}
    )[0]
    assert it["correct_indexes"] == []


def test_normalize_mc_items_remaps_correct_indexes_for_text_options():
    it = MagicPasteService._normalize_mc_items(
        {
            "items": [
                {
                    "stem": "text options",
                    "options": ["cat", "", "dog", "bird"],
                    "correct_indexes": [3],
                }
            ]
        }
    )[0]
    assert it["options"] == ["cat", "dog", "bird"]
    assert it["correct_indexes"] == [2]


def test_normalize_mc_items_drops_correct_index_beyond_max_options():
    """超過 MC_MAX_OPTIONS 被截掉的位置不能留在 correct_indexes。"""
    it = MagicPasteService._normalize_mc_items(
        {
            "items": [
                {
                    "stem": "seven options",
                    "options": ["a", "b", "c", "d", "e", "f", "g"],
                    "correct_indexes": [6],
                }
            ]
        }
    )[0]
    assert len(it["options"]) == MC_MAX_OPTIONS
    assert it["correct_indexes"] == []


def test_normalize_figures_truncates_long_caption():
    raw = {
        "stimulus": {
            "kind": "text",
            "paragraphs": ["Only paragraph."],
            "figures": [{"box_2d": [0, 0, 100, 100], "caption": "長" * 500}],
        },
        "questions": [],
    }
    caption = MagicPasteService._normalize_reading_group(raw)[0]["stimulus"]["figures"][
        0
    ]["caption"]
    assert len(caption) == FIGURE_CAPTION_MAX_CHARS == 300


def test_normalize_handles_non_finite_numbers():
    """`json.loads` 預設吃得下 NaN／Infinity；一律當沒給，不能拋例外（#1084）。"""
    payload = json.loads(
        """
        {
          "stimulus": {
            "kind": "text",
            "paragraphs": ["Only paragraph."],
            "page": NaN,
            "figures": [
              {"box_2d": [0, 0, 100, Infinity], "after_paragraph": 0},
              {"box_2d": [0, 0, 100, 100], "after_paragraph": NaN}
            ]
          },
          "questions": [
            {
              "stem": "",
              "blank": Infinity,
              "stem_box_2d": [0, 0, 100, 100],
              "options": ["a", "b"],
              "correct_indexes": [NaN, 1]
            }
          ]
        }
        """
    )
    g = MagicPasteService._normalize_reading_group(payload)[0]
    assert g["stimulus"]["page"] is None
    # 含 Infinity 的座標整項丟掉；after_paragraph 是 NaN 退回 -1
    figures = g["stimulus"]["figures"]
    assert len(figures) == 1
    assert figures[0]["after_paragraph"] == -1
    assert g["questions"][0]["blank"] is None
    assert g["questions"][0]["correct_indexes"] == [1]


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_normalize_blank_index_rejects_non_finite(bad):
    assert MagicPasteService._normalize_blank_index(bad) is None
