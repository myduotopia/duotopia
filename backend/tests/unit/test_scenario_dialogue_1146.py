"""情境對話引導式對話＋情境圖 — Issue #1146。

Vertex 一律 mock（或根本不呼叫）。驗的是：

* ``scenario_settings`` 新欄位的正規化與學生端可見範圍
* 出題 prompt 支援「沒有情境、只有出題方向」與情境圖
* 答非所問（usable / reask）與標題建議的收斂
* 擷取回傳的圖片座標收斂
* 評分 prompt 帶上情境文字與情境圖
* 情境圖網址只接受本站來源（防 SSRF）
"""

import pytest

from services.scenario_context_images import image_mime_for_url, resolve_image_source
from services.scenario_dialogue_ai import (
    ScenarioDialogueAIError,
    ScenarioDialogueAIOutputError,
    ScenarioDialogueAIService,
)
from services.scenario_grading_ai import ScenarioGradingService
from utils import scenario_dialogue as sd

IMG = "https://storage.googleapis.com/bucket/images/a.png"


@pytest.fixture(autouse=True)
def _own_bucket(monkeypatch):
    """本站圖片 bucket 固定為 ``bucket``、用 GCS（正式環境的設定）。"""
    monkeypatch.setenv("GCS_BUCKET_NAME", "bucket")
    monkeypatch.setenv("USE_GCS_STORAGE", "true")


# ============================================================ 設定正規化


class TestSettingsNewFields:
    def test_defaults_for_old_data(self):
        """舊資料沒有新欄位 → 一律空值，不可以爆掉。"""
        settings = sd.normalize_settings({})
        assert settings["scenario_mode"] == ""
        assert settings["question_source"] == ""
        assert settings["goal"] == ""
        assert settings["article_level"] == ""
        assert settings["direction"] == ""
        assert settings["scenario_images"] == []

    def test_full_payload(self):
        settings = sd.normalize_settings(
            {
                "scenario_mode": "ai",
                "question_source": "ai",
                "goal": "交通工具與問路",
                "article_level": "A2",
                "direction": "",
                "scenario_images": [IMG, "  ", IMG + "?2"],
            }
        )
        assert settings["scenario_mode"] == "ai"
        assert settings["question_source"] == "ai"
        assert settings["goal"] == "交通工具與問路"
        assert settings["article_level"] == "A2"
        assert settings["scenario_images"] == [IMG, IMG + "?2"]

    @pytest.mark.parametrize(
        "field,value",
        [
            ("scenario_mode", "maybe"),
            ("question_source", "robot"),
            ("article_level", "Z9"),
        ],
    )
    def test_unknown_codes_rejected(self, field, value):
        with pytest.raises(ValueError):
            sd.normalize_settings({field: value})

    def test_more_than_five_images_rejected(self):
        with pytest.raises(ValueError):
            sd.normalize_settings({"scenario_images": [IMG] * 6})

    @pytest.mark.parametrize(
        "url",
        [
            "https://evil.example.com/images/a.png",
            "http://storage.googleapis.com/bucket/images/a.png",
            "https://storage.googleapis.com/other/images/a.png",
            "https://storage.googleapis.com/bucket/audio/a.webm",
            "https://duotopia.co/static/images/a.png",
            "javascript:alert(1)",
            "https://storage.googleapis.com/bucket/images/" + "x" * 3000,
        ],
    )
    def test_non_own_images_are_dropped(self, url):
        """review 3：存檔只留本站 bucket 的 images/ 網址，其餘丟棄（不擋整份存檔）。"""
        settings = sd.normalize_settings({"scenario_images": [IMG, url]})
        assert settings["scenario_images"] == [IMG]

    def test_local_static_allowed_only_without_gcs(self, monkeypatch):
        local = "http://localhost:8080/static/images/x.png"
        settings = sd.normalize_settings({"scenario_images": [local]})
        assert settings["scenario_images"] == []
        monkeypatch.setenv("USE_GCS_STORAGE", "false")
        settings = sd.normalize_settings({"scenario_images": [local]})
        assert settings["scenario_images"] == [local]

    def test_images_must_be_a_list(self):
        with pytest.raises(ValueError):
            sd.normalize_settings({"scenario_images": IMG})

    def test_student_view_has_images_but_not_authoring_notes(self):
        settings = sd.normalize_settings(
            {
                "scenario_content": "S",
                "scenario_images": [IMG],
                "goal": "內部筆記",
                "direction": "內部方向",
                "scenario_mode": "ai",
            }
        )
        view = sd.public_settings_view(settings)
        assert view["scenario_images"] == [IMG]
        for key in ("goal", "direction", "scenario_mode", "question_source"):
            assert key not in view
        assert "內部筆記" not in str(view)

    def test_student_view_tolerates_old_settings(self):
        assert (
            sd.public_settings_view({"scenario_content": "S"})["scenario_images"] == []
        )

    def test_grading_criteria_carries_scenario(self):
        criteria = sd.grading_criteria(
            "Q?", None, {"scenario_content": "S", "scenario_images": [IMG]}
        )
        assert criteria["scenario_content"] == "S"
        assert criteria["scenario_images"] == [IMG]

    def test_grading_criteria_tolerates_missing_scenario(self):
        criteria = sd.grading_criteria("Q?", None, None)
        assert criteria["scenario_content"] == ""
        assert criteria["scenario_images"] == []


# ============================================================ 出題 prompt


def _q(**kwargs):
    params = {"scenario_content": "", "count": 5}
    params.update(kwargs)
    return ScenarioDialogueAIService.build_question_prompt(**params)


class TestQuestionPromptWithoutScenario:
    def test_direction_alone_is_enough(self):
        prompt = _q(direction="問學生週末通常做什麼")
        assert "問學生週末通常做什麼" in prompt
        assert "their own everyday life" in prompt
        # 沒有情境就不能要求「從情境中答得出來」
        assert "answerable from the scenario" not in prompt

    def test_nothing_at_all_is_rejected(self):
        with pytest.raises(ScenarioDialogueAIError):
            _q(scenario_content="  ", direction="  ")

    def test_direction_triggers_usable_check(self):
        prompt = _q(direction="hello", ui_language="en")
        assert '"usable": false' in prompt
        assert "English" in prompt

    def test_scenario_without_direction_has_no_usable_check(self):
        prompt = _q(scenario_content="It is Monday.")
        assert '"usable": false' not in prompt
        assert "answerable from the scenario" in prompt

    def test_images_are_mentioned(self):
        prompt = _q(scenario_content="It is Monday.", image_count=2)
        assert "2 picture(s)" in prompt

    def test_images_alone_count_as_scenario(self):
        prompt = _q(image_count=1)
        assert "1 picture(s)" in prompt

    def test_title_is_requested(self):
        assert '"title"' in _q(scenario_content="S")


class TestArticlePromptUsable:
    def test_usable_check_and_title(self):
        prompt = ScenarioDialogueAIService.build_article_prompt("交通工具", "A2")
        assert '"usable": false' in prompt
        assert '"title"' in prompt
        assert "Traditional Chinese" in prompt


# ============================================================ 收斂


class TestUsableAndTitle:
    def test_missing_usable_means_usable(self):
        """模型漏了欄位不該把正常輸入擋下來。"""
        assert ScenarioDialogueAIService.read_usable({"content": "x"}, "zh-TW") is None

    def test_unusable_returns_reask(self):
        reask = ScenarioDialogueAIService.read_usable(
            {"usable": False, "reask": "再說一次？\n例如：交通"}, "zh-TW"
        )
        assert reask == "再說一次？ 例如：交通"

    def test_unusable_without_reask_gets_default(self):
        assert ScenarioDialogueAIService.read_usable({"usable": False}, "en")
        assert ScenarioDialogueAIService.read_usable({"usable": False}, "zh-TW")

    def test_title_is_single_line_and_capped(self):
        title = ScenarioDialogueAIService.normalize_title({"title": "週末\n" + "長" * 200})
        assert "\n" not in title
        assert len(title) <= 60

    def test_title_missing_is_empty(self):
        assert ScenarioDialogueAIService.normalize_title({}) == ""
        assert ScenarioDialogueAIService.normalize_title([]) == ""


class TestNormalizeFigures:
    def test_keeps_valid_boxes_with_page(self):
        figures = ScenarioDialogueAIService.normalize_figures(
            {
                "figures": [
                    {"page": 2, "box_2d": [10, 20, 300, 400]},
                    {"box_2d": [0, 0, 1000, 1000]},
                ]
            }
        )
        assert figures == [
            {"page": 2, "box_2d": [10, 20, 300, 400]},
            {"page": 1, "box_2d": [0, 0, 1000, 1000]},
        ]

    @pytest.mark.parametrize(
        "box",
        [None, [1, 2, 3], [300, 20, 10, 400], [0, 0, 1001, 10], ["a", 0, 1, 1]],
    )
    def test_drops_invalid_boxes(self, box):
        assert (
            ScenarioDialogueAIService.normalize_figures({"figures": [{"box_2d": box}]})
            == []
        )

    def test_returns_more_than_five_so_frontend_can_warn(self):
        raw = {"figures": [{"box_2d": [0, 0, 10, 10]}] * 8}
        assert len(ScenarioDialogueAIService.normalize_figures(raw)) == 8

    def test_non_dict_is_empty(self):
        assert ScenarioDialogueAIService.normalize_figures(None) == []


# ============================================================ 評分 prompt


class TestGradingPromptHasScenario:
    def test_scenario_text_and_images_reach_prompt(self):
        prompt = ScenarioGradingService.build_prompt(
            {
                "question": "What is the boy doing?",
                "scenario_content": "Tom is at the park.",
                "scenario_image_count": 2,
            }
        )
        assert "Tom is at the park." in prompt
        assert "2 scenario picture(s)" in prompt

    def test_old_data_without_scenario_has_no_empty_section(self):
        prompt = ScenarioGradingService.build_prompt({"question": "Q?"})
        assert "Scenario the student read" not in prompt
        assert "scenario picture" not in prompt


# ============================================================ 情境圖來源


class TestImageSource:
    def test_own_bucket_uses_gcs_uri(self):
        assert resolve_image_source(IMG, "bucket") == (
            "gcs",
            "gs://bucket/images/a.png",
        )

    def test_other_bucket_is_rejected(self):
        """別的 bucket 交給 Vertex 讀 = 用我們的服務帳號讀別人的東西。"""
        assert resolve_image_source(IMG, "other") is None

    def test_local_static_file_only_without_gcs(self):
        url = "http://localhost:8080/static/images/x.png"
        assert resolve_image_source(url, "bucket", use_gcs=False) == ("local", "x.png")
        # review 3：正式環境（用 GCS）不接受 static 網址
        assert resolve_image_source(url, "bucket", use_gcs=True) is None

    def test_own_bucket_outside_images_prefix_is_rejected(self):
        """同 bucket 還有音檔等其他東西，只開放圖片上傳服務寫的 images/。"""
        url = "https://storage.googleapis.com/bucket/audio/x.webm"
        assert resolve_image_source(url, "bucket") is None

    @pytest.mark.parametrize(
        "url",
        [
            "http://localhost:8080/static/images/../secret.png",
            "https://storage.googleapis.com/bucket/images/../audio/x.webm",
            "http://localhost:8080/static/images/a/b.png",
            "http://169.254.169.254/latest/meta-data",
            "file:///etc/passwd",
            "",
        ],
    )
    def test_other_sources_are_rejected(self, url):
        assert resolve_image_source(url, "bucket", use_gcs=False) is None

    def test_mime_from_extension(self):
        assert image_mime_for_url(IMG) == "image/png"
        assert image_mime_for_url("https://x/y.JPG") == "image/jpeg"
        assert image_mime_for_url("https://x/y") == "image/jpeg"


# ============================================================ 讀圖（build_image_parts）


class _FakePart:
    @staticmethod
    def from_data(data, mime_type):
        return ("data", data, mime_type)

    @staticmethod
    def from_uri(uri, mime_type):
        return ("uri", uri, mime_type)


class _FakeResponse:
    def __init__(self, text):
        self.text = text


def _fake_vertex(monkeypatch, text, sent=None):
    """把 _call_vertex 換掉：記下送出的 prompt 與圖片 Part，回固定文字。"""

    async def fake_call(cls, prompt, max_tokens, file_part=None, extra_parts=None):
        if sent is not None:
            sent["prompt"] = prompt
            sent["parts"] = extra_parts
        return _FakeResponse(text), {"input_tokens": 0, "output_tokens": 0}

    monkeypatch.setattr(
        ScenarioDialogueAIService, "_call_vertex", classmethod(fake_call)
    )


class TestBuildImageParts:
    """review 7：讀圖失敗略過；張數以實際送出的為準。"""

    @pytest.fixture
    def local_dir(self, monkeypatch, tmp_path):
        import services.image_upload as upload_mod
        import vertexai.generative_models as gm

        class FakeUploader:
            bucket_name = "bucket"
            use_gcs = False
            local_image_dir = str(tmp_path)

        monkeypatch.setattr(upload_mod, "get_image_upload_service", FakeUploader)
        monkeypatch.setattr(gm, "Part", _FakePart)
        (tmp_path / "ok.png").write_bytes(b"png")
        return tmp_path

    def test_unreadable_and_foreign_images_are_skipped(self, local_dir):
        from services.scenario_context_images import build_image_parts

        parts = build_image_parts(
            [
                "http://localhost:8080/static/images/ok.png",
                "http://localhost:8080/static/images/missing.png",  # 讀檔失敗
                "https://evil.example.com/x.png",  # 非本站
                "https://storage.googleapis.com/bucket/images/a.jpg",
            ]
        )
        assert parts == [
            ("data", b"png", "image/png"),
            ("uri", "gs://bucket/images/a.jpg", "image/jpeg"),
        ]

    def test_question_prompt_counts_only_images_actually_sent(
        self, local_dir, monkeypatch
    ):
        """叫模型看 2 張圖卻只送 1 張，模型會亂編 —— prompt 張數 = 實際送出張數。"""
        import asyncio

        sent = {}
        _fake_vertex(
            monkeypatch, '{"title": "T", "questions": [{"question": "Q1?"}]}', sent
        )
        asyncio.run(
            ScenarioDialogueAIService().generate_questions(
                scenario_content="S",
                count=3,
                scenario_images=[
                    "http://localhost:8080/static/images/ok.png",
                    "http://localhost:8080/static/images/missing.png",
                ],
            )
        )
        assert len(sent["parts"]) == 1
        assert "1 picture(s)" in sent["prompt"]
        assert "2 picture(s)" not in sent["prompt"]


# ============================================================ 擷取：標題與截斷救援


class TestExtractTitleAndSalvage:
    def test_prompt_asks_title_and_puts_content_last(self):
        prompt = ScenarioDialogueAIService.build_extract_prompt("en")
        assert '"title"' in prompt
        assert "English" in prompt
        # 截斷時斷的是 content 尾巴，所以 content 要放最後
        assert prompt.index('"figures": [') < prompt.index('"content": "<')

    def test_complete_json_is_not_truncated(self):
        raw, truncated = ScenarioDialogueAIService.parse_extract_json(
            '{"title": "T", "figures": [], "content": "Hello."}'
        )
        assert truncated is False
        assert raw["content"] == "Hello."

    def test_truncated_content_is_salvaged_not_502(self):
        """review 4：截斷時保住已輸出的文章、標題與完整的圖片座標。"""
        text = (
            '{"title": "At the park", "figures": [{"page": 1, "box_2d": '
            '[1, 2, 300, 400]}], "content": "Tom is at the park.\\nHe is pla'
        )
        raw, truncated = ScenarioDialogueAIService.parse_extract_json(text)
        assert truncated is True
        assert raw["title"] == "At the park"
        assert raw["content"] == "Tom is at the park.\nHe is pla"
        assert ScenarioDialogueAIService.normalize_figures(raw) == [
            {"page": 1, "box_2d": [1, 2, 300, 400]}
        ]

    def test_truncated_inside_unicode_escape(self):
        text = '{"title": "T", "figures": [], "content": "caf\\u00'
        raw, truncated = ScenarioDialogueAIService.parse_extract_json(text)
        assert truncated is True
        assert raw["content"] == "caf"

    def test_garbage_still_raises(self):
        with pytest.raises(ScenarioDialogueAIOutputError):
            ScenarioDialogueAIService.parse_extract_json("not json at all")

    def test_extract_returns_suggested_title_and_truncated_flag(self, monkeypatch):
        import asyncio
        import vertexai.generative_models as gm

        monkeypatch.setattr(gm, "Part", _FakePart)
        _fake_vertex(
            monkeypatch, '{"title": "Shopping", "figures": [], "content": "I bu'
        )
        out = asyncio.run(
            ScenarioDialogueAIService().extract_article(b"x", "image/png", "en")
        )
        assert out["suggested_title"] == "Shopping"
        assert out["truncated"] is True
        assert out["content"] == "I bu"
