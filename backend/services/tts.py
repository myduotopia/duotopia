"""
Text-to-Speech service using Azure Speech Service (Official Microsoft TTS)
"""

import asyncio
import tempfile
import os
import hashlib
import logging
from typing import Optional, Dict  # noqa: F401
from google.cloud import storage
from datetime import datetime  # noqa: F401
import azure.cognitiveservices.speech as speechsdk

logger = logging.getLogger(__name__)


class TTSService:
    def __init__(self):
        # 可用的語音列表 (Azure Neural Voices)
        self.voices = {
            "en-US": {
                "male": "en-US-ChristopherNeural",
                "female": "en-US-JennyNeural",
                "child": "en-US-AnaNeural",
            },
            "en-GB": {"male": "en-GB-RyanNeural", "female": "en-GB-SoniaNeural"},
            "en-AU": {"male": "en-AU-WilliamNeural", "female": "en-AU-NatashaNeural"},
            "en-IN": {"male": "en-IN-PrabhatNeural", "female": "en-IN-NeerjaNeural"},
        }

        # Azure Speech 設定
        self.azure_speech_key = os.getenv("AZURE_SPEECH_KEY")
        self.azure_speech_region = os.getenv("AZURE_SPEECH_REGION", "eastasia")

        if not self.azure_speech_key:
            # 不立即拋出錯誤，允許延遲檢查（用於開發環境）
            pass

        # 儲存設定：GCS 或本地檔案系統
        self.use_gcs = os.getenv("USE_GCS_STORAGE", "false").lower() == "true"
        self.bucket_name = os.getenv("GCS_BUCKET_NAME", "duotopia-audio")
        self.storage_client = None

        # Backend URL（用於生成完整的音檔 URL）
        self.backend_url = os.getenv("BACKEND_URL", "").rstrip("/")

        # 本地儲存目錄（當不使用 GCS 時）
        self.local_audio_dir = os.path.join(
            os.path.dirname(__file__), "..", "static", "tts"
        )
        if not self.use_gcs:
            os.makedirs(self.local_audio_dir, exist_ok=True)

        # Cache statistics
        self._cache_hits = 0
        self._cache_misses = 0

    def _get_storage_client(self):
        """延遲初始化 GCS client（使用與 audio_upload.py 相同的認證邏輯）"""
        if not self.storage_client:
            # 方法 1: 嘗試使用 service account key (生產環境)
            backend_dir = os.path.dirname(os.path.dirname(__file__))
            key_path = os.path.join(backend_dir, "service-account-key.json")

            if os.path.exists(key_path):
                # 檢查文件是否為空或無效
                try:
                    import json

                    if os.path.getsize(key_path) > 0:
                        with open(key_path, "r") as f:
                            json.load(f)  # 驗證 JSON 格式
                        # JSON 有效，嘗試使用
                        try:
                            self.storage_client = (
                                storage.Client.from_service_account_json(key_path)
                            )
                            print(
                                "✅ TTS GCS client initialized with service account key"
                            )
                            return self.storage_client
                        except Exception as e:
                            print(f"⚠️  Failed to use service account key: {e}")
                    else:
                        print("⚠️  Service account key file is empty, skipping")
                except (json.JSONDecodeError, ValueError) as e:
                    print(
                        f"⚠️  Service account key file is invalid JSON: {e}, skipping"
                    )

            # 方法 2: 使用 Application Default Credentials (本機開發)
            try:
                # 臨時清除 GOOGLE_APPLICATION_CREDENTIALS 環境變數（如果指向無效文件）
                import google.auth

                original_creds_env = os.environ.pop(
                    "GOOGLE_APPLICATION_CREDENTIALS", None
                )
                try:
                    credentials, project = google.auth.default()
                    self.storage_client = storage.Client(
                        credentials=credentials, project=project
                    )
                    print(
                        "✅ TTS GCS client initialized with Application Default Credentials"
                    )
                    return self.storage_client
                finally:
                    # 恢復環境變數（如果之前存在）
                    if original_creds_env:
                        os.environ[
                            "GOOGLE_APPLICATION_CREDENTIALS"
                        ] = original_creds_env
            except Exception as e:
                print(f"❌ TTS GCS client initialization failed: {e}")
                print("   請執行: gcloud auth application-default login")
                raise ValueError(
                    f"GCS client initialization failed: {e}. "
                    "Please configure GCS credentials (service-account-key.json or gcloud auth)."
                )
        return self.storage_client

    def _convert_rate_to_prosody(self, rate: str) -> str:
        """
        將 rate 字串轉換為 Azure SSML prosody rate
        '+0%' -> '1.0', '+10%' -> '1.1', '-10%' -> '0.9'
        """
        try:
            percent = int(rate.replace("%", "").replace("+", ""))
            prosody_rate = 1.0 + (percent / 100.0)
            return f"{prosody_rate:.2f}"
        except (ValueError, AttributeError):
            return "1.0"

    def _generate_cache_key(self, text: str, voice: str, rate: str, volume: str) -> str:
        """
        Generate a unique cache key for TTS parameters
        Uses hash of text + voice + rate + volume to create deterministic filename
        """
        cache_input = f"{text}|{voice}|{rate}|{volume}"
        hash_object = hashlib.md5(cache_input.encode("utf-8"))
        return hash_object.hexdigest()

    def _get_cached_audio_url(self, cache_key: str) -> Optional[str]:
        """
        Check if audio file exists in GCS for given cache key
        Returns GCS URL if exists, None otherwise
        """
        try:
            client = self._get_storage_client()
            bucket = client.bucket(self.bucket_name)
            blob_name = f"tts/cached_{cache_key}.mp3"
            blob = bucket.blob(blob_name)

            if blob.exists():
                logger.debug(f"Cache HIT: Found cached audio for key {cache_key}")
                return f"https://storage.googleapis.com/{self.bucket_name}/{blob_name}"
            else:
                logger.debug(f"Cache MISS: No cached audio for key {cache_key}")
                return None
        except Exception as e:
            logger.warning(f"Error checking cache: {e}")
            return None

    async def generate_tts(
        self,
        text: str,
        voice: str = "en-US-JennyNeural",
        rate: str = "+0%",
        volume: str = "+0%",
    ) -> str:
        """
        生成 TTS 音檔並上傳到 GCS (使用 Azure Speech Service)
        Implements caching to reduce API costs and improve performance

        Args:
            text: 要轉換的文字
            voice: 語音名稱
            rate: 語速調整 (e.g., '+10%', '-10%')
            volume: 音量調整 (e.g., '+10%', '-10%')

        Returns:
            音檔 GCS URL
        """
        try:
            # Generate cache key
            cache_key = self._generate_cache_key(text, voice, rate, volume)

            # Check if audio already exists in GCS
            cached_url = self._get_cached_audio_url(cache_key)
            if cached_url:
                self._cache_hits += 1
                logger.info(
                    f"TTS cache HIT for '{text[:30]}...' (voice={voice}, rate={rate}). "
                    f"Total hits: {self._cache_hits}, misses: {self._cache_misses}"
                )
                return cached_url

            # Cache miss - generate new audio
            self._cache_misses += 1
            logger.info(
                f"TTS cache MISS for '{text[:30]}...' (voice={voice}, rate={rate}). "
                f"Generating new audio. Total hits: {self._cache_hits}, misses: {self._cache_misses}"
            )

            # 檢查 Azure Speech 配置
            if not self.azure_speech_key:
                raise ValueError(
                    "AZURE_SPEECH_KEY environment variable is not set. "
                    "Please configure Azure Speech Service credentials."
                )

            # 配置 Azure Speech
            speech_config = speechsdk.SpeechConfig(
                subscription=self.azure_speech_key, region=self.azure_speech_region
            )
            speech_config.speech_synthesis_voice_name = voice

            # Use cache key as filename for deterministic naming
            filename = f"cached_{cache_key}.mp3"

            # 創建臨時檔案（在 with 區塊外保持打開）
            tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
            tmp_file_path = tmp_file.name
            tmp_file.close()  # 關閉文件句柄，但保留文件

            try:
                # 配置音檔輸出
                audio_config = speechsdk.audio.AudioOutputConfig(filename=tmp_file_path)
                synthesizer = speechsdk.SpeechSynthesizer(
                    speech_config=speech_config, audio_config=audio_config
                )

                # 生成 TTS（同步操作，需在 executor 中執行）
                loop = asyncio.get_event_loop()
                # 直接傳遞方法調用，不需要 lambda
                result = await loop.run_in_executor(None, synthesizer.speak_text, text)

                # 檢查結果
                if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
                    if self.use_gcs:
                        # 上傳到 GCS
                        client = self._get_storage_client()
                        bucket = client.bucket(self.bucket_name)
                        blob = bucket.blob(f"tts/{filename}")
                        blob.upload_from_filename(tmp_file_path)

                        # 返回公開 URL (bucket 已設定為 public，無需 make_public())
                        return f"https://storage.googleapis.com/{self.bucket_name}/tts/{filename}"
                    else:
                        # 本地儲存
                        import shutil

                        local_path = os.path.join(self.local_audio_dir, filename)
                        shutil.copy(tmp_file_path, local_path)

                        # 返回本地 URL
                        if self.backend_url:
                            return f"{self.backend_url}/static/tts/{filename}"
                        else:
                            return f"/static/tts/{filename}"
                else:
                    cancellation_details = speechsdk.CancellationDetails(result)
                    error_msg = f"Azure TTS failed: {result.reason}"
                    if (
                        cancellation_details.reason
                        == speechsdk.CancellationReason.Error
                    ):
                        error_msg += f" - {cancellation_details.error_details}"
                    raise Exception(error_msg)
            finally:
                # 確保清理臨時檔案
                if os.path.exists(tmp_file_path):
                    try:
                        os.unlink(tmp_file_path)
                    except Exception as e:
                        print(
                            f"Warning: Failed to delete temp file {tmp_file_path}: {e}"
                        )

        except Exception as e:
            raise Exception(f"TTS generation failed: {str(e)}")

    async def batch_generate_tts(
        self,
        texts: list[str],
        voice: str = "en-US-JennyNeural",
        rate: str = "+0%",
        volume: str = "+0%",
    ) -> list[str]:
        """
        批次生成 TTS

        Args:
            texts: 文字列表
            voice: 語音名稱
            rate: 語速調整
            volume: 音量調整

        Returns:
            音檔 URL 列表
        """
        tasks = [self.generate_tts(text, voice, rate, volume) for text in texts]

        # 使用 return_exceptions=True 來捕獲個別任務的錯誤
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # 檢查是否有錯誤
        errors = [r for r in results if isinstance(r, Exception)]
        if errors:
            # 如果有錯誤，拋出第一個錯誤（包含更多上下文）
            error_msg = (
                f"Batch TTS generation failed: {len(errors)} out of {len(texts)} "
                f"failed. First error: {str(errors[0])}"
            )
            raise Exception(error_msg)

        return results

    async def get_available_voices(self, language: str = "en") -> list[dict]:
        """
        取得可用的語音列表 (Azure Speech)

        Args:
            language: 語言代碼 (e.g., 'en', 'zh')

        Returns:
            語音列表
        """
        # Azure Speech 語音列表（精選常用語音）
        all_voices = [
            {
                "name": "en-US-JennyNeural",
                "display_name": "Jenny (US Female)",
                "gender": "Female",
                "locale": "en-US",
            },
            {
                "name": "en-US-ChristopherNeural",
                "display_name": "Christopher (US Male)",
                "gender": "Male",
                "locale": "en-US",
            },
            {
                "name": "en-US-AnaNeural",
                "display_name": "Ana (US Child)",
                "gender": "Female",
                "locale": "en-US",
            },
            {
                "name": "en-GB-SoniaNeural",
                "display_name": "Sonia (UK Female)",
                "gender": "Female",
                "locale": "en-GB",
            },
            {
                "name": "en-GB-RyanNeural",
                "display_name": "Ryan (UK Male)",
                "gender": "Male",
                "locale": "en-GB",
            },
            {
                "name": "en-AU-NatashaNeural",
                "display_name": "Natasha (AU Female)",
                "gender": "Female",
                "locale": "en-AU",
            },
            {
                "name": "en-AU-WilliamNeural",
                "display_name": "William (AU Male)",
                "gender": "Male",
                "locale": "en-AU",
            },
            {
                "name": "en-IN-NeerjaNeural",
                "display_name": "Neerja (IN Female)",
                "gender": "Female",
                "locale": "en-IN",
            },
            {
                "name": "en-IN-PrabhatNeural",
                "display_name": "Prabhat (IN Male)",
                "gender": "Male",
                "locale": "en-IN",
            },
        ]

        # 過濾指定語言的語音
        filtered_voices = [v for v in all_voices if v["locale"].startswith(language)]

        return filtered_voices

    def get_cache_stats(self) -> Dict[str, any]:
        """
        Get cache statistics for monitoring

        Returns:
            Dictionary with cache hit/miss rates and other metrics
        """
        total_calls = self._cache_hits + self._cache_misses
        hit_rate = (self._cache_hits / total_calls * 100) if total_calls > 0 else 0

        return {
            "cache_hits": self._cache_hits,
            "cache_misses": self._cache_misses,
            "total_calls": total_calls,
            "hit_rate_percent": round(hit_rate, 2),
            "estimated_api_calls_saved": self._cache_hits,
            "estimated_cost_savings_usd": round(
                self._cache_hits * 0.016, 2
            ),  # Azure TTS ~$16/1M chars, avg ~1000 chars
        }

    def clear_cache(self):
        """Clear the cache statistics (GCS files remain for persistence)"""
        self._cache_hits = 0
        self._cache_misses = 0
        logger.info("TTS cache statistics cleared")


# 單例模式
_tts_service = None


def get_tts_service() -> TTSService:
    global _tts_service
    if _tts_service is None:
        _tts_service = TTSService()
    return _tts_service
