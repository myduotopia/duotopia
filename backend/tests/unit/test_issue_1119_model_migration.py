"""Issue #1119: Gemini 模型汰換迴歸測試。

背景：`gemini-2.5-flash` / `gemini-2.5-pro` 於 2026-10-20 退役，
`imagen-3.0-generate-002` 已經 404。這份測試守住汰換後不該退回去的幾件事。

為什麼要有「不是 2.5」這種看起來很笨的斷言
--------------------------------------------
模型 ID 之前散落在 4 個檔案各寫一份字面值（vertex_ai、scenario_dialogue_ai、
magic_paste_service、scenario_grading_ai）。只要有人複製舊寫法就會悄悄把退役
模型帶回來，而且在 2026-10-20 之前完全測不出問題。

thinking 的斷言為什麼要驗 config 內容
--------------------------------------
`_set_thinking_budget()` 是直接寫 protobuf 的 hack，外層 `except Exception`
只印 warning —— 失敗是**靜默**的。既有的
`tests/test_vertex_disable_thinking.py` 只驗證 `disable_thinking=True` 有往下傳，
抓不到「有傳但沒套上」。實測 gemini-3.5-flash 不設 thinking 時
thoughts=284、實際輸出只有 1 個 token（finish=MAX_TOKENS），正是 #874 的症狀，
所以這裡要驗「budget 真的落在 GenerationConfig 上」。
"""

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

# 退役模型清單（2026-10-20 退役 / 已 404）
RETIRED_MODELS = {
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite",
    "imagen-3.0-generate-002",
}


@pytest.mark.unit
class TestNoRetiredModelIds:
    """所有服務用的模型 ID 都不可以是已退役的。"""

    def test_vertex_ai_models_not_retired(self):
        with patch.dict("sys.modules", {"vertexai": MagicMock()}):
            from services.vertex_ai import FLASH_MODEL, PRO_MODEL

        assert FLASH_MODEL not in RETIRED_MODELS
        assert PRO_MODEL not in RETIRED_MODELS

    def test_scenario_dialogue_model_not_retired(self):
        with patch.dict("sys.modules", {"vertexai": MagicMock()}):
            from services.scenario_dialogue_ai import FLASH_MODEL

        assert FLASH_MODEL not in RETIRED_MODELS

    def test_magic_paste_model_not_retired(self):
        with patch.dict("sys.modules", {"vertexai": MagicMock()}):
            from services.magic_paste_service import FLASH_MODEL

        assert FLASH_MODEL not in RETIRED_MODELS

    def test_grading_model_not_retired(self):
        with patch.dict("sys.modules", {"vertexai": MagicMock()}):
            from services.scenario_grading_ai import MODEL

        assert MODEL not in RETIRED_MODELS


@pytest.mark.unit
class TestModelIdsComeFromSettings:
    """模型 ID 收斂為單一來源（settings），不再各檔案寫死字面值。"""

    def test_all_services_share_the_configured_flash_model(self):
        from core.config import settings

        with patch.dict("sys.modules", {"vertexai": MagicMock()}):
            from services.magic_paste_service import FLASH_MODEL as magic_model
            from services.scenario_dialogue_ai import FLASH_MODEL as dialogue_model
            from services.scenario_grading_ai import MODEL as grading_model
            from services.vertex_ai import FLASH_MODEL as wrapper_model

        configured = settings.VERTEX_AI_FLASH_MODEL
        assert wrapper_model == configured
        assert dialogue_model == configured
        assert magic_model == configured
        assert grading_model == configured


@pytest.mark.unit
class TestPricingCoversConfiguredModel:
    """價格表以模型名為 key —— 換模型但忘了加價格會讓成本統計靜默變 0。"""

    def test_dialogue_pricing_has_entry(self):
        with patch.dict("sys.modules", {"vertexai": MagicMock()}):
            from services.scenario_dialogue_ai import (
                FLASH_MODEL,
                _PRICING_USD_PER_1M,
            )

        assert FLASH_MODEL in _PRICING_USD_PER_1M

    def test_magic_paste_pricing_has_entry(self):
        with patch.dict("sys.modules", {"vertexai": MagicMock()}):
            from services.magic_paste_service import (
                FLASH_MODEL,
                _PRICING_USD_PER_1M,
            )

        assert FLASH_MODEL in _PRICING_USD_PER_1M

    def test_grading_pricing_has_entry(self):
        with patch.dict("sys.modules", {"vertexai": MagicMock()}):
            from services.scenario_grading_ai import MODEL, _PRICING_USD_PER_1M

        assert MODEL in _PRICING_USD_PER_1M

    def test_grading_cost_is_non_zero_for_real_usage(self):
        """實際有用量時成本不能算成 0（價格表 key 不匹配的徵狀）。"""
        with patch.dict("sys.modules", {"vertexai": MagicMock()}):
            from services.scenario_grading_ai import ScenarioGradingService

        cost = ScenarioGradingService.estimate_cost(
            {"input_tokens": 1000, "output_tokens": 500}
        )
        assert cost > 0


@pytest.mark.unit
class TestThinkingTokensCounted:
    """thinking token 以輸出價計費，必須算進成本（gemini-3.5-flash 的 thinking 量很大）。"""

    def test_grading_usage_includes_thought_tokens(self):
        with patch.dict("sys.modules", {"vertexai": MagicMock()}):
            from services.scenario_grading_ai import ScenarioGradingService

        response = MagicMock()
        response.usage_metadata.prompt_token_count = 100
        response.usage_metadata.candidates_token_count = 50
        response.usage_metadata.thoughts_token_count = 300

        usage = ScenarioGradingService._usage_of(response)

        # thinking 以輸出價計費 → 必須併入 output_tokens，否則嚴重低估
        assert usage["output_tokens"] == 350
        assert usage["input_tokens"] == 100

    def test_grading_usage_without_thought_tokens_still_works(self):
        """舊 response 沒有 thoughts_token_count 時不可壞掉。"""
        with patch.dict("sys.modules", {"vertexai": MagicMock()}):
            from services.scenario_grading_ai import ScenarioGradingService

        response = MagicMock(spec=["usage_metadata"])
        response.usage_metadata = MagicMock(
            spec=["prompt_token_count", "candidates_token_count"]
        )
        response.usage_metadata.prompt_token_count = 100
        response.usage_metadata.candidates_token_count = 50

        usage = ScenarioGradingService._usage_of(response)
        assert usage["output_tokens"] == 50


@pytest.mark.unit
class TestThinkingBudgetActuallyApplied:
    """守住「hack 靜默失敗」這個洞：驗證 budget 真的落在 GenerationConfig 上。"""

    def test_set_thinking_budget_lands_on_config(self):
        with patch.dict("sys.modules", {"vertexai": MagicMock()}):
            from services.vertex_ai import VertexAIService

        config = MagicMock()
        VertexAIService._set_thinking_budget(config, 0)

        applied = config._raw_generation_config.thinking_config
        assert applied is not None
        assert getattr(applied, "thinking_budget", None) == 0

    def test_set_thinking_budget_failure_is_visible_in_logs(self):
        """套用失敗只印 warning（不丟例外），但至少要留下 log 讓我們查得到。"""
        with patch.dict("sys.modules", {"vertexai": MagicMock()}):
            from services.vertex_ai import VertexAIService

        class BrokenConfig:
            """模擬 SDK 改版後 protobuf 結構變了的情況。"""

            @property
            def _raw_generation_config(self):
                raise AttributeError("_raw_generation_config gone")

        with patch("services.vertex_ai.logger") as mock_logger:
            # 不可以往外丟例外（會把整個生成請求弄掛）
            VertexAIService._set_thinking_budget(BrokenConfig(), 0)
            assert mock_logger.warning.called, (
                "hack 失敗時必須留下 warning —— 否則 thinking 默默開著，" "重現 #874 卻沒人查得到原因"
            )


@pytest.mark.unit
class TestDataResidencyNotRegressed:
    """Issue #959 合規：學生學習資料不得離開亞洲。

    教育部 115 年校園徵求案的對外連線清單寫的是 asia-northeast1（東京）。
    改成 `global` 會讓請求被導到全球任意 region —— 那是合規決策，不是技術選擇，
    不可以在一般 PR 裡順手改掉。
    """

    def test_default_location_stays_in_asia(self):
        import importlib

        env_without_loc = {
            k: v for k, v in os.environ.items() if k != "VERTEX_AI_LOCATION"
        }
        try:
            with patch.dict(os.environ, env_without_loc, clear=True), patch(
                "dotenv.load_dotenv"
            ):
                import core.config

                importlib.reload(core.config)
                location = core.config.settings.VERTEX_AI_LOCATION
        finally:
            # 還原，避免影響後續測試（斷言失敗也要執行）
            importlib.reload(core.config)

        assert location.startswith("asia-"), (
            f"VERTEX_AI_LOCATION={location!r} 不在亞洲 —— 這會違反 #959 "
            "對教育部徵求案的資料出境承諾，必須先取得合規確認"
        )
