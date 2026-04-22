"""
Audio upload service 單元測試 - 修正版本，完全 mock 外部依賴
"""
import os
import sys
from unittest.mock import Mock, patch, AsyncMock, MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

# noqa: E402
import pytest  # noqa: E402
from fastapi import HTTPException, UploadFile  # noqa: E402


# Mock google.cloud.storage before importing service
sys.modules["google.cloud"] = MagicMock()
sys.modules["google.cloud.storage"] = MagicMock()

# noqa: E402
from services.audio_upload import (  # noqa: E402
    AudioUploadService,
    get_audio_upload_service,
)


class TestAudioUploadService:
    """測試 AudioUploadService"""

    @pytest.fixture
    def service(self):
        """創建測試用 service"""
        return AudioUploadService()

    @pytest.fixture
    def mock_upload_file(self):
        """創建 mock UploadFile"""
        mock_file = Mock(spec=UploadFile)
        mock_file.content_type = "audio/webm"
        mock_file.read = AsyncMock(return_value=b"test audio content")
        return mock_file

    def test_init(self):
        """測試初始化"""
        service = AudioUploadService()
        assert service.bucket_name == "duotopia-audio"
        assert service.storage_client is None
        assert service.max_file_size == 2 * 1024 * 1024
        assert "audio/webm" in service.allowed_formats

    @patch.dict(os.environ, {"GCS_BUCKET_NAME": "custom-bucket"})
    def test_init_with_custom_bucket(self):
        """測試自定義 bucket 名稱"""
        service = AudioUploadService()
        assert service.bucket_name == "custom-bucket"

    def test_get_storage_client_cached(self):
        """測試 client 快取機制"""
        service = AudioUploadService()
        mock_client = Mock()
        service.storage_client = mock_client

        result = service._get_storage_client()
        assert result == mock_client

    @pytest.mark.asyncio
    async def test_upload_audio_invalid_content_type(self, service):
        """測試無效的檔案類型"""
        mock_file = Mock(spec=UploadFile)
        mock_file.content_type = "text/plain"

        with pytest.raises(HTTPException) as exc_info:
            await service.upload_audio(mock_file)

        assert exc_info.value.status_code == 400
        assert "Invalid file type" in exc_info.value.detail

    @pytest.mark.asyncio
    @patch("services.audio_upload.uuid.uuid4")
    @patch("services.audio_upload.datetime")
    async def test_upload_audio_video_mp4_safari(
        self, mock_datetime, mock_uuid, service
    ):
        """測試 Safari 的 video/mp4 格式 (Issue #109)"""
        mock_uuid.return_value = "test-uuid"
        mock_now = Mock()
        mock_now.strftime.return_value = "20240101_120000"
        mock_datetime.now.return_value = mock_now

        mock_client = Mock()
        mock_bucket = Mock()
        mock_blob = Mock()
        service.storage_client = mock_client
        mock_client.bucket.return_value = mock_bucket
        mock_bucket.blob.return_value = mock_blob

        mock_file = Mock(spec=UploadFile)
        mock_file.content_type = "video/mp4"
        mock_file.filename = "recording.mp4"
        mock_file.read = AsyncMock(return_value=b"test audio" * 1000)

        result = await service.upload_audio(mock_file, duration_seconds=20)

        assert "mp4" in result
        mock_blob.upload_from_string.assert_called_once()

    @pytest.mark.asyncio
    @patch("services.audio_upload.uuid.uuid4")
    @patch("services.audio_upload.datetime")
    async def test_upload_audio_mp4_with_codecs(
        self, mock_datetime, mock_uuid, service
    ):
        """測試帶 codecs 參數的 audio/mp4 格式 (Issue #109)"""
        mock_uuid.return_value = "test-uuid"
        mock_now = Mock()
        mock_now.strftime.return_value = "20240101_120000"
        mock_datetime.now.return_value = mock_now

        mock_client = Mock()
        mock_bucket = Mock()
        mock_blob = Mock()
        service.storage_client = mock_client
        mock_client.bucket.return_value = mock_bucket
        mock_bucket.blob.return_value = mock_blob

        mock_file = Mock(spec=UploadFile)
        mock_file.content_type = "audio/mp4;codecs=aac"
        mock_file.filename = "recording.m4a"
        mock_file.read = AsyncMock(return_value=b"test audio" * 1000)

        result = await service.upload_audio(mock_file, duration_seconds=20)

        assert result is not None
        mock_blob.upload_from_string.assert_called_once()

    @pytest.mark.asyncio
    async def test_upload_audio_file_too_large(self, service):
        """測試檔案過大"""
        mock_file = Mock(spec=UploadFile)
        mock_file.content_type = "audio/webm"
        mock_file.read = AsyncMock(return_value=b"x" * (3 * 1024 * 1024))

        with pytest.raises(HTTPException) as exc_info:
            await service.upload_audio(mock_file)

        assert exc_info.value.status_code == 400
        assert "File too large" in exc_info.value.detail

    @pytest.mark.asyncio
    @patch("services.bigquery_logger.get_bigquery_logger")
    async def test_upload_audio_file_too_small(self, mock_get_bq_logger, service):
        """測試檔案過小（邊界：499 bytes < 500 bytes 最小值）"""
        mock_bq_logger = AsyncMock()
        mock_bq_logger.log_audio_error = AsyncMock()
        mock_get_bq_logger.return_value = mock_bq_logger

        mock_file = Mock(spec=UploadFile)
        mock_file.content_type = "audio/webm"
        mock_file.filename = "test.webm"
        mock_file.read = AsyncMock(return_value=b"x" * 499)

        with pytest.raises(HTTPException) as exc_info:
            await service.upload_audio(mock_file)

        assert exc_info.value.status_code == 400
        assert "too small" in exc_info.value.detail
        mock_bq_logger.log_audio_error.assert_called_once()

    @pytest.mark.asyncio
    @patch("services.bigquery_logger.get_bigquery_logger")
    async def test_upload_audio_file_at_min_boundary(self, mock_get_bq_logger, service):
        """測試檔案剛好達到最小值（邊界：500 bytes 應通過大小檢查，不被 'too small' 拒絕）"""
        mock_bq_logger = AsyncMock()
        mock_bq_logger.log_audio_error = AsyncMock()
        mock_get_bq_logger.return_value = mock_bq_logger

        mock_file = Mock(spec=UploadFile)
        mock_file.content_type = "audio/webm"
        mock_file.filename = "test.webm"
        mock_file.read = AsyncMock(return_value=b"x" * 500)

        # 500 bytes 應通過大小檢查，不被 "too small" 拒絕
        # 後續行為視環境而定（有 GCS 憑證 → 成功返回 URL；無憑證 → 500 錯誤）
        # 重點：不應因 "too small" 被擋
        raised_exception = None
        try:
            await service.upload_audio(mock_file, duration_seconds=20)
        except HTTPException as e:
            raised_exception = e

        if raised_exception is not None:
            # 若有錯誤，確認不是因為檔案太小
            assert "too small" not in raised_exception.detail
        # 無論是否拋出例外，BigQuery logger 的 log_audio_error 都不應被呼叫（那是 too-small 路徑）
        mock_bq_logger.log_audio_error.assert_not_called()

    @pytest.mark.asyncio
    async def test_upload_audio_duration_too_long(self, service):
        """測試音檔過長"""
        mock_file = Mock(spec=UploadFile)
        mock_file.content_type = "audio/webm"
        mock_file.filename = "test.webm"
        mock_file.read = AsyncMock(return_value=b"test audio" * 1000)  # ~10KB

        with pytest.raises(HTTPException) as exc_info:
            await service.upload_audio(mock_file, duration_seconds=31)

        assert exc_info.value.status_code == 400
        assert "Recording too long" in exc_info.value.detail

    @pytest.mark.asyncio
    @patch("services.audio_upload.uuid.uuid4")
    @patch("services.audio_upload.datetime")
    async def test_upload_audio_success(self, mock_datetime, mock_uuid, service):
        """測試成功上傳"""
        # Setup mocks
        mock_uuid.return_value = "test-uuid"
        mock_now = Mock()
        mock_now.strftime.return_value = "20240101_120000"
        mock_datetime.now.return_value = mock_now

        # Mock GCS client
        mock_client = Mock()
        mock_bucket = Mock()
        mock_blob = Mock()
        service.storage_client = mock_client
        mock_client.bucket.return_value = mock_bucket
        mock_bucket.blob.return_value = mock_blob

        # Mock upload file (需要至少 5KB)
        mock_file = Mock(spec=UploadFile)
        mock_file.content_type = "audio/webm"
        mock_file.filename = "test.webm"
        mock_file.read = AsyncMock(return_value=b"test audio" * 1000)  # ~10KB

        result = await service.upload_audio(mock_file, duration_seconds=20)

        expected_url = (
            "https://storage.googleapis.com/duotopia-audio/recordings/"
            "recording_20240101_120000_test-uuid.webm"
        )
        assert result == expected_url

        mock_blob.upload_from_string.assert_called_once_with(
            b"test audio" * 1000, content_type="audio/webm"
        )
        # make_public() 已移除，bucket 已預設為 public

    @pytest.mark.asyncio
    async def test_upload_audio_no_gcs_client(self, service):
        """測試 GCS client 無法初始化"""
        service.storage_client = None
        service._get_storage_client = Mock(return_value=None)

        mock_file = Mock(spec=UploadFile)
        mock_file.content_type = "audio/webm"
        mock_file.filename = "test.webm"
        mock_file.read = AsyncMock(return_value=b"test audio" * 1000)  # ~10KB

        with pytest.raises(HTTPException) as exc_info:
            await service.upload_audio(mock_file)

        assert exc_info.value.status_code == 500
        assert "GCS service unavailable" in exc_info.value.detail

    @pytest.mark.asyncio
    @patch("services.audio_upload.uuid.uuid4")
    @patch("services.audio_upload.datetime")
    async def test_upload_audio_gcs_failure(self, mock_datetime, mock_uuid, service):
        """測試 GCS 上傳失敗"""
        mock_uuid.return_value = "test-uuid"
        mock_now = Mock()
        mock_now.strftime.return_value = "20240101_120000"
        mock_datetime.now.return_value = mock_now

        mock_client = Mock()
        mock_bucket = Mock()
        mock_blob = Mock()
        service.storage_client = mock_client
        mock_client.bucket.return_value = mock_bucket
        mock_bucket.blob.return_value = mock_blob
        mock_blob.upload_from_string.side_effect = Exception("Upload failed")

        mock_file = Mock(spec=UploadFile)
        mock_file.content_type = "audio/webm"
        mock_file.filename = "test.webm"
        mock_file.read = AsyncMock(return_value=b"test audio" * 1000)  # ~10KB

        with pytest.raises(HTTPException) as exc_info:
            await service.upload_audio(mock_file)

        assert exc_info.value.status_code == 500
        assert "Failed to upload recording" in exc_info.value.detail


class TestAudioUploadServiceConcurrency:
    """測試併發上傳"""

    @pytest.fixture
    def service(self):
        """創建測試用 service"""
        return AudioUploadService()

    def create_mock_file(self, size_kb=100):
        """創建指定大小的 mock 檔案"""
        mock_file = Mock(spec=UploadFile)
        mock_file.content_type = "audio/webm"
        mock_file.filename = "test.webm"
        mock_file.read = AsyncMock(return_value=b"x" * (size_kb * 1024))
        return mock_file

    @pytest.mark.asyncio
    @patch("services.audio_upload.uuid.uuid4")
    @patch("services.audio_upload.datetime")
    async def test_concurrent_upload_10_files(self, mock_datetime, mock_uuid, service):
        """測試 10 個併發上傳"""
        # Setup mocks
        mock_uuid.side_effect = [f"uuid-{i}" for i in range(10)]
        mock_now = Mock()
        mock_now.strftime.return_value = "20240101_120000"
        mock_datetime.now.return_value = mock_now

        # Mock GCS client
        mock_client = Mock()
        mock_bucket = Mock()
        service.storage_client = mock_client
        mock_client.bucket.return_value = mock_bucket

        # Create mock blobs
        mock_blobs = []
        for i in range(10):
            mock_blob = Mock()
            mock_blob.upload_from_string = Mock()
            mock_blobs.append(mock_blob)

        mock_bucket.blob.side_effect = mock_blobs

        # Create 10 mock files (100KB each)
        files = [self.create_mock_file(100) for _ in range(10)]

        # Upload concurrently
        import asyncio
        import time

        start_time = time.time()
        results = await asyncio.gather(
            *[service.upload_audio(file, duration_seconds=20) for file in files]
        )
        elapsed_time = time.time() - start_time

        # Verify all uploads succeeded
        assert len(results) == 10
        for i, result in enumerate(results):
            assert "https://storage.googleapis.com/duotopia-audio/recordings/" in result
            assert f"uuid-{i}" in result

        # Verify all blobs were uploaded
        for mock_blob in mock_blobs:
            mock_blob.upload_from_string.assert_called_once()

        # Performance check: concurrent uploads should be fast (<2s)
        assert (
            elapsed_time < 2.0
        ), f"Concurrent uploads took {elapsed_time:.2f}s (expected <2s)"

    @pytest.mark.asyncio
    @patch("services.audio_upload.uuid.uuid4")
    @patch("services.audio_upload.datetime")
    async def test_concurrent_upload_large_files(
        self, mock_datetime, mock_uuid, service
    ):
        """測試併發上傳大檔案 (接近 2MB 上限)"""
        # Setup mocks
        mock_uuid.side_effect = [f"uuid-large-{i}" for i in range(10)]
        mock_now = Mock()
        mock_now.strftime.return_value = "20240101_120000"
        mock_datetime.now.return_value = mock_now

        # Mock GCS client
        mock_client = Mock()
        mock_bucket = Mock()
        service.storage_client = mock_client
        mock_client.bucket.return_value = mock_bucket

        # Create mock blobs
        mock_blobs = []
        for i in range(10):
            mock_blob = Mock()
            mock_blob.upload_from_string = Mock()
            mock_blobs.append(mock_blob)

        mock_bucket.blob.side_effect = mock_blobs

        # Create 10 large files (1.9MB each)
        files = [self.create_mock_file(1900) for _ in range(10)]

        # Upload concurrently
        import asyncio

        results = await asyncio.gather(
            *[service.upload_audio(file, duration_seconds=25) for file in files]
        )

        # Verify all uploads succeeded
        assert len(results) == 10

    @pytest.mark.asyncio
    @patch("services.audio_upload.uuid.uuid4")
    @patch("services.audio_upload.datetime")
    async def test_concurrent_upload_mixed_sizes(
        self, mock_datetime, mock_uuid, service
    ):
        """測試併發上傳混合大小檔案"""
        # Setup mocks
        mock_uuid.side_effect = [f"uuid-mixed-{i}" for i in range(10)]
        mock_now = Mock()
        mock_now.strftime.return_value = "20240101_120000"
        mock_datetime.now.return_value = mock_now

        # Mock GCS client
        mock_client = Mock()
        mock_bucket = Mock()
        service.storage_client = mock_client
        mock_client.bucket.return_value = mock_bucket

        # Create mock blobs
        mock_blobs = []
        for i in range(10):
            mock_blob = Mock()
            mock_blob.upload_from_string = Mock()
            mock_blobs.append(mock_blob)

        mock_bucket.blob.side_effect = mock_blobs

        # Create files of different sizes
        sizes = [10, 50, 100, 200, 500, 800, 1000, 1200, 1500, 1900]
        files = [self.create_mock_file(size) for size in sizes]

        # Upload concurrently
        import asyncio

        results = await asyncio.gather(
            *[service.upload_audio(file, duration_seconds=20) for file in files]
        )

        # Verify all uploads succeeded
        assert len(results) == 10


class TestAudioUploadServiceSingleton:
    """測試 service singleton pattern"""

    def test_get_audio_upload_service_singleton(self):
        """測試 singleton 實例"""
        service1 = get_audio_upload_service()
        service2 = get_audio_upload_service()
        assert service1 is service2

    @patch.dict(os.environ, {"GCS_BUCKET_NAME": "test-bucket"})
    def test_get_audio_upload_service_with_env(self):
        """測試環境變數設定"""
        # Reset singleton
        import services.audio_upload

        services.audio_upload._audio_upload_service = None

        service = get_audio_upload_service()
        assert service.bucket_name == "test-bucket"
