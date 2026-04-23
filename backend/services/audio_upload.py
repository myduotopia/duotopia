"""
Audio upload service for recording files
"""

import asyncio
import os
import uuid
import json
from datetime import datetime  # noqa: F401
from typing import Optional  # noqa: F401
from fastapi import UploadFile, HTTPException
from google.cloud import storage


class AudioUploadService:
    def __init__(self):
        # GCS 設定
        self.bucket_name = os.getenv("GCS_BUCKET_NAME", "duotopia-audio")
        self.storage_client = None
        self.max_file_size = 2 * 1024 * 1024  # 2MB 限制
        self.allowed_formats = [
            "audio/webm",
            "audio/webm;codecs=opus",  # 支援帶 codecs 的 webm
            "audio/mp3",
            "audio/wav",
            "audio/mpeg",
            "audio/mp4",
            "audio/ogg",
            "audio/opus",
            "audio/x-m4a",
            "video/webm",  # 某些瀏覽器會將 webm 音檔標記為 video/webm
            "video/mp4",  # Safari (macOS/iOS) 可能使用 video/mp4
        ]
        self.environment = os.getenv("ENVIRONMENT", "development")

    def _get_storage_client(self):
        """延遲初始化 GCS client（使用與 tts.py 相同的認證邏輯）"""
        if not self.storage_client:
            # 檢查必要的環境變數
            if not self.bucket_name:
                raise ValueError("GCS_BUCKET_NAME environment variable is not set")

            # 方法 1: 嘗試使用 service account key (生產環境)
            backend_dir = os.path.dirname(os.path.dirname(__file__))
            key_path = os.path.join(backend_dir, "service-account-key.json")

            if os.path.exists(key_path):
                # 檢查文件是否為空或無效
                try:
                    if os.path.getsize(key_path) > 0:
                        with open(key_path, "r") as f:
                            json.load(f)  # 驗證 JSON 格式
                        # JSON 有效，嘗試使用
                        try:
                            self.storage_client = (
                                storage.Client.from_service_account_json(key_path)
                            )
                            print(
                                "✅ Audio Upload GCS client initialized with service account key"
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
            # 臨時清除 GOOGLE_APPLICATION_CREDENTIALS 環境變數（如果它指向無效的 key 文件）
            original_creds = os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
            try:
                self.storage_client = storage.Client()
                print(
                    "✅ Audio Upload GCS client initialized with Application Default Credentials"
                )
                print("   (使用 gcloud auth application-default login 認證)")
                return self.storage_client
            except Exception as e:
                print(f"❌ Audio Upload GCS client initialization failed: {e}")
                print("   請執行: gcloud auth application-default login")
                # 如果原本有 GOOGLE_APPLICATION_CREDENTIALS，恢復它
                if original_creds:
                    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = original_creds
                return None
            finally:
                # 如果原本有 GOOGLE_APPLICATION_CREDENTIALS，恢復它
                if original_creds:
                    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = original_creds

        return self.storage_client

    async def upload_audio(
        self,
        file: UploadFile,
        duration_seconds: int = 30,
        content_id: int = None,
        item_index: int = None,
        assignment_id: int = None,
        student_id: int = None,
    ) -> str:
        """
        上傳音檔到 GCS

        Args:
            file: 上傳的音檔
            duration_seconds: 音檔長度（秒）

        Returns:
            音檔 URL
        """
        try:
            # 檢查檔案類型（支援帶 codecs 參數的 MIME type，如 audio/mp4;codecs=aac）
            content_type = file.content_type or ""
            # 提取基本 MIME type（去掉 codecs 等參數）
            base_content_type = content_type.split(";")[0].strip()

            # 檢查完整匹配或基本類型匹配
            is_allowed = (
                content_type in self.allowed_formats
                or base_content_type in self.allowed_formats
                or any(
                    content_type.startswith(fmt.split(";")[0])
                    for fmt in self.allowed_formats
                )
            )

            if not is_allowed:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid file type '{content_type}'. Allowed: {', '.join(self.allowed_formats)}",
                )

            # 讀取檔案內容
            content = await file.read()

            # 檢查檔案大小（至少 500B，最多 2MB）
            min_file_size = 500  # 500B
            if len(content) < min_file_size:
                # 記錄到 BigQuery
                from services.bigquery_logger import get_bigquery_logger

                logger = get_bigquery_logger()
                await logger.log_audio_error(
                    {
                        "error_type": "backend_validation_file_too_small",
                        "error_message": f"File size {len(content)} bytes < minimum {min_file_size} bytes",
                        "audio_url": file.filename or "unknown",
                        "audio_size": len(content),
                        "content_type": file.content_type,
                        "assignment_id": assignment_id,
                        "student_id": student_id,
                    }
                )

                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Recording file too small ({len(content)} bytes). "
                        f"Must be at least {min_file_size} bytes for valid audio."
                    ),
                )

            if len(content) > self.max_file_size:
                raise HTTPException(
                    status_code=400,
                    detail=f"File too large. Maximum size: {self.max_file_size / 1024 / 1024}MB",
                )

            # 檢查錄音長度
            if duration_seconds > 30:
                raise HTTPException(
                    status_code=400,
                    detail="Recording too long. Maximum duration: 30 seconds",
                )

            # 生成唯一檔名（包含 content_id 和 item_index 以便追蹤）
            file_id = str(uuid.uuid4())
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

            # 根據 content type 決定擴展名
            ext_map = {
                "audio/webm": "webm",
                "video/webm": "webm",
                "audio/mp4": "m4a",
                "video/mp4": "mp4",  # Safari 可能使用 video/mp4
                "audio/ogg": "ogg",
                "audio/opus": "opus",
                "audio/mpeg": "mp3",
                "audio/wav": "wav",
            }
            extension = ext_map.get(file.content_type, "webm")

            # 如果有 content_id 和 item_index，加入檔名中
            if content_id and item_index is not None:
                filename = f"recording_c{content_id}_i{item_index}_{timestamp}_{file_id}.{extension}"
            else:
                filename = f"recording_{timestamp}_{file_id}.{extension}"

            # 上傳到 GCS
            client = self._get_storage_client()
            if not client:
                raise HTTPException(
                    status_code=500,
                    detail="GCS service unavailable. Cannot save recordings.",
                )

            try:
                bucket = client.bucket(self.bucket_name)
                blob = bucket.blob(f"recordings/{filename}")

                # 上傳檔案並設定正確的 content type (使用 asyncio.to_thread 避免阻塞)
                await asyncio.to_thread(
                    blob.upload_from_string, content, content_type=file.content_type
                )

                # 返回公開 URL (bucket 已設定為 public，無需 make_public())
                return f"https://storage.googleapis.com/{self.bucket_name}/recordings/{filename}"

            except Exception as e:
                print(f"GCS upload failed: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to upload recording to cloud storage: {str(e)}",
                )

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


# 單例模式
_audio_upload_service = None


def get_audio_upload_service() -> AudioUploadService:
    global _audio_upload_service
    if _audio_upload_service is None:
        _audio_upload_service = AudioUploadService()
    return _audio_upload_service
