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
    ScenarioDialogueAIService,
)
from services.scenario_grading_ai import ScenarioGradingService
from utils import scenario_dialogue as sd

IMG = "https://storage.googleapis.com/bucket/images/a.png"


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

    def test_local_static_file(self):
        assert resolve_image_source(
            "http://localhost:8080/static/images/x.png", "bucket"
        ) == ("local", "x.png")

    @pytest.mark.parametrize(
        "url",
        [
            "http://localhost:8080/static/images/../secret.png",
            "http://localhost:8080/static/images/a/b.png",
            "http://169.254.169.254/latest/meta-data",
            "file:///etc/passwd",
            "",
        ],
    )
    def test_other_sources_are_rejected(self, url):
        assert resolve_image_source(url, "bucket") is None

    def test_mime_from_extension(self):
        assert image_mime_for_url(IMG) == "image/png"
        assert image_mime_for_url("https://x/y.JPG") == "image/jpeg"
        assert image_mime_for_url("https://x/y") == "image/jpeg"
