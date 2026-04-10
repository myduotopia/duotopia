"""
Vertex AI (Gemini) Service
用於替代 OpenAI GPT 的 AI 服務

支援功能：
- 文字生成（翻譯、例句生成等）
- JSON 格式輸出（詞性分析、干擾選項等）

Model 對應：
- gpt-4o-mini → gemini-2.5-flash（快速、高效能）
- gpt-4 → gemini-2.5-pro（複雜分析）
"""

import os
import json
import re
import logging
import asyncio
import time
from typing import Optional, Literal

logger = logging.getLogger(__name__)

# Model name constants
FLASH_MODEL = "gemini-2.5-flash"
PRO_MODEL = "gemini-2.5-pro"

# Default timeout for Vertex AI calls (seconds)
VERTEX_AI_TIMEOUT = 60


class VertexAIService:
    """Vertex AI (Gemini) 服務封裝"""

    def __init__(self):
        self.project_id = os.getenv("VERTEX_AI_PROJECT_ID", "duotopia-472708")
        self.location = os.getenv("VERTEX_AI_LOCATION", "asia-northeast1")
        self._initialized = False
        # Cached models without system_instruction (for reuse)
        self._flash_model = None
        self._pro_model = None

    def _ensure_initialized(self):
        """Lazy initialization of Vertex AI"""
        if not self._initialized:
            try:
                import vertexai

                vertexai.init(project=self.project_id, location=self.location)
                self._initialized = True
                logger.info(
                    f"Vertex AI initialized: project={self.project_id}, "
                    f"location={self.location}"
                )
            except Exception as e:
                logger.error(f"Failed to initialize Vertex AI: {e}")
                raise

    def _get_model(
        self,
        model_type: Literal["flash", "pro"] = "flash",
        system_instruction: Optional[str] = None,
    ):
        """
        取得 GenerativeModel 實例

        model_type:
        - "flash": gemini-2.5-flash
        - "pro": gemini-2.5-pro（複雜分析）

        當有 system_instruction 時，建立新的 model 實例（Gemini 原生支援）。
        無 system_instruction 時，使用 cached model 以提升效能。
        """
        self._ensure_initialized()
        from vertexai.generative_models import GenerativeModel

        model_name = FLASH_MODEL if model_type == "flash" else PRO_MODEL

        if system_instruction:
            return GenerativeModel(model_name, system_instruction=system_instruction)

        # 無 system_instruction 時使用 cached model
        if model_type == "flash":
            if self._flash_model is None:
                self._flash_model = GenerativeModel(model_name)
            return self._flash_model
        else:
            if self._pro_model is None:
                self._pro_model = GenerativeModel(model_name)
            return self._pro_model

    @staticmethod
    def _set_thinking_budget(config, budget: int):
        """Set thinking budget on GenerationConfig via internal protobuf."""
        try:
            from google.cloud.aiplatform_v1beta1.types.content import (
                GenerationConfig as BetaGenConfig,
            )

            config._raw_generation_config.thinking_config = (
                BetaGenConfig.ThinkingConfig(thinking_budget=budget)
            )
        except Exception as e:
            logger.warning(f"Failed to set thinking_budget: {e}")

    async def generate_text(
        self,
        prompt: str,
        model_type: Literal["flash", "pro"] = "flash",
        max_tokens: int = 1000,
        temperature: float = 0.7,
        system_instruction: Optional[str] = None,
        timeout: Optional[int] = VERTEX_AI_TIMEOUT,
        disable_thinking: bool = False,
    ) -> str:
        """
        統一的文字生成介面

        Args:
            prompt: 提示詞
            model_type: 模型類型 ("flash" 或 "pro")
            max_tokens: 最大輸出 token 數
            temperature: 溫度參數 (0-1)
            system_instruction: 系統指令（使用 Gemini 原生 system_instruction）
            disable_thinking: 關閉 thinking（加速簡單任務如翻譯）

        Returns:
            生成的文字
        """
        from vertexai.generative_models import GenerationConfig

        model = self._get_model(model_type, system_instruction)

        config = GenerationConfig(
            max_output_tokens=max_tokens,
            temperature=temperature,
        )
        if disable_thinking:
            self._set_thinking_budget(config, 0)

        try:
            t0 = time.monotonic()
            logger.info(
                "[PERF] Vertex AI generate_text START | model=%s | region=%s",
                model_type,
                self.location,
            )
            response = await asyncio.wait_for(
                model.generate_content_async(
                    prompt,
                    generation_config=config,
                ),
                timeout=timeout,
            )
            elapsed = time.monotonic() - t0
            logger.info(
                "[PERF] Vertex AI generate_text DONE | model=%s | region=%s | %.2fs",
                model_type,
                self.location,
                elapsed,
            )
            return response.text
        except asyncio.TimeoutError:
            elapsed = time.monotonic() - t0
            logger.error(
                "[PERF] Vertex AI generate_text TIMEOUT | model=%s | region=%s | %.2fs",
                model_type,
                self.location,
                elapsed,
            )
            raise TimeoutError(f"Vertex AI call timed out after {timeout} seconds")
        except Exception as e:
            elapsed = time.monotonic() - t0
            logger.error(
                "[PERF] Vertex AI generate_text ERROR | model=%s | region=%s | %.2fs | %s",
                model_type,
                self.location,
                elapsed,
                e,
            )
            raise

    async def generate_json(
        self,
        prompt: str,
        model_type: Literal["flash", "pro"] = "flash",
        max_tokens: int = 1000,
        temperature: float = 0.3,
        system_instruction: Optional[str] = None,
        timeout: Optional[int] = VERTEX_AI_TIMEOUT,
        disable_thinking: bool = False,
    ) -> dict:
        """
        生成 JSON 格式的回應

        Args:
            prompt: 提示詞（應該要求 JSON 輸出）
            model_type: 模型類型
            max_tokens: 最大輸出 token 數
            temperature: 溫度參數
            system_instruction: 系統指令（使用 Gemini 原生 system_instruction）
            disable_thinking: 關閉 thinking（加速簡單任務如翻譯）

        Returns:
            解析後的 JSON dict
        """
        from vertexai.generative_models import GenerationConfig

        model = self._get_model(model_type, system_instruction)

        config = GenerationConfig(
            max_output_tokens=max_tokens,
            temperature=temperature,
            response_mime_type="application/json",
        )
        if disable_thinking:
            self._set_thinking_budget(config, 0)

        try:
            t0 = time.monotonic()
            logger.info(
                "[PERF] Vertex AI generate_json START | model=%s | region=%s",
                model_type,
                self.location,
            )
            response = await asyncio.wait_for(
                model.generate_content_async(
                    prompt,
                    generation_config=config,
                ),
                timeout=timeout,
            )
            elapsed = time.monotonic() - t0
            logger.info(
                "[PERF] Vertex AI generate_json DONE | model=%s | region=%s | %.2fs",
                model_type,
                self.location,
                elapsed,
            )

            content = response.text.strip()

            # 移除可能的前綴文字和 markdown 代碼塊標記
            # 處理 "Here is the JSON requested:\n```json" 等情況
            content = re.sub(r"^.*?```json\s*", "", content, flags=re.DOTALL)
            content = re.sub(r"^.*?```\s*", "", content, flags=re.DOTALL)
            content = re.sub(r"\s*```$", "", content)
            content = content.strip()

            # 如果清理後仍然無法解析，嘗試找到第一個 [ 或 {
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                # 尋找 JSON 陣列或物件的起始位置
                array_start = content.find("[")
                object_start = content.find("{")

                if array_start >= 0 and (
                    object_start < 0 or array_start < object_start
                ):
                    # JSON 陣列
                    json_content = content[array_start:]
                    # 找到對應的結束括號
                    bracket_count = 0
                    for i, char in enumerate(json_content):
                        if char == "[":
                            bracket_count += 1
                        elif char == "]":
                            bracket_count -= 1
                            if bracket_count == 0:
                                json_content = json_content[: i + 1]
                                break
                    return json.loads(json_content)
                elif object_start >= 0:
                    # JSON 物件
                    json_content = content[object_start:]
                    bracket_count = 0
                    for i, char in enumerate(json_content):
                        if char == "{":
                            bracket_count += 1
                        elif char == "}":
                            bracket_count -= 1
                            if bracket_count == 0:
                                json_content = json_content[: i + 1]
                                break
                    return json.loads(json_content)
                else:
                    raise
        except asyncio.TimeoutError:
            elapsed = time.monotonic() - t0
            logger.error(
                "[PERF] Vertex AI generate_json TIMEOUT | model=%s | region=%s | %.2fs",
                model_type,
                self.location,
                elapsed,
            )
            raise TimeoutError(f"Vertex AI call timed out after {timeout} seconds")
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON from Vertex AI response: {e}")
            logger.error(f"Raw response: {response.text if response else 'None'}")
            raise
        except Exception as e:
            elapsed = time.monotonic() - t0
            logger.error(
                "[PERF] Vertex AI generate_json ERROR | model=%s | region=%s | %.2fs | %s",
                model_type,
                self.location,
                elapsed,
                e,
            )
            raise

    def generate_text_sync(
        self,
        prompt: str,
        model_type: Literal["flash", "pro"] = "flash",
        max_tokens: int = 1000,
        temperature: float = 0.7,
        system_instruction: Optional[str] = None,
    ) -> str:
        """
        同步版本的文字生成介面（用於 cron job 等非異步場景）

        Args:
            prompt: 提示詞
            model_type: 模型類型 ("flash" 或 "pro")
            max_tokens: 最大輸出 token 數
            temperature: 溫度參數 (0-1)
            system_instruction: 系統指令（使用 Gemini 原生 system_instruction）

        Returns:
            生成的文字
        """
        from vertexai.generative_models import GenerationConfig

        model = self._get_model(model_type, system_instruction)

        config = GenerationConfig(
            max_output_tokens=max_tokens,
            temperature=temperature,
        )

        try:
            response = model.generate_content(
                prompt,
                generation_config=config,
            )
            return response.text
        except Exception as e:
            logger.error(f"Vertex AI sync generation failed: {e}")
            raise


# 全局實例（lazy initialization）
_vertex_ai_service: Optional[VertexAIService] = None


def get_vertex_ai_service() -> VertexAIService:
    """取得 Vertex AI 服務實例"""
    global _vertex_ai_service
    if _vertex_ai_service is None:
        _vertex_ai_service = VertexAIService()
    return _vertex_ai_service
