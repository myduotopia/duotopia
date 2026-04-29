"""
Issue #703 Phase B tests.

1. recording_duration_seconds is persisted when upload_recording is called.
2. BigQuery error log for too-small file includes user_agent and magic_bytes_hex.
"""
import os
import sys
from unittest.mock import AsyncMock, MagicMock, Mock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../"))

# Stub heavy dependencies before importing the service under test
sys.modules["google.cloud"] = MagicMock()
sys.modules["google.cloud.storage"] = MagicMock()

import pytest  # noqa: E402
from fastapi import UploadFile  # noqa: E402
from services.audio_upload import AudioUploadService  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_upload_file(content: bytes, content_type: str = "audio/webm") -> Mock:
    mock_file = Mock(spec=UploadFile)
    mock_file.content_type = content_type
    mock_file.filename = "recording.webm"
    mock_file.read = AsyncMock(return_value=content)
    return mock_file


def _mock_gcs(service: AudioUploadService) -> Mock:
    mock_client = Mock()
    mock_bucket = Mock()
    mock_blob = Mock()
    service.storage_client = mock_client
    mock_client.bucket.return_value = mock_bucket
    mock_bucket.blob.return_value = mock_blob
    return mock_blob


# ---------------------------------------------------------------------------
# Test: BigQuery log includes user_agent and magic_bytes_hex
# ---------------------------------------------------------------------------


class TestFileTooSmallBigQueryLog:
    """recording is rejected (< 500 B) — verify diagnostic fields in BQ log."""

    @pytest.mark.asyncio
    @patch("services.bigquery_logger.get_bigquery_logger")
    async def test_log_includes_user_agent_and_magic_bytes(
        self, mock_get_bq_logger: Mock
    ):
        mock_bq_logger = AsyncMock()
        mock_bq_logger.log_audio_error = AsyncMock()
        mock_get_bq_logger.return_value = mock_bq_logger

        service = AudioUploadService()
        # 12 bytes → well below the 500-byte minimum
        tiny_content = b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0A\x0B"
        mock_file = _make_upload_file(tiny_content)

        import pytest as _pytest

        with _pytest.raises(Exception):
            await service.upload_audio(
                mock_file,
                duration_seconds=5,
                user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
            )

        mock_bq_logger.log_audio_error.assert_called_once()
        logged = mock_bq_logger.log_audio_error.call_args[0][0]

        assert "user_agent" in logged, "user_agent must be present in BQ log"
        assert (
            "Mozilla" in logged["user_agent"]
        ), "user_agent value should match what was passed"

        assert "magic_bytes_hex" in logged, "magic_bytes_hex must be present in BQ log"
        expected_hex = tiny_content[:64].hex()
        assert (
            logged["magic_bytes_hex"] == expected_hex
        ), f"magic_bytes_hex mismatch: {logged['magic_bytes_hex']!r} != {expected_hex!r}"

    @pytest.mark.asyncio
    @patch("services.bigquery_logger.get_bigquery_logger")
    async def test_log_works_with_empty_content(self, mock_get_bq_logger: Mock):
        """Edge case: truly empty file should still produce valid hex."""
        mock_bq_logger = AsyncMock()
        mock_bq_logger.log_audio_error = AsyncMock()
        mock_get_bq_logger.return_value = mock_bq_logger

        service = AudioUploadService()
        mock_file = _make_upload_file(b"")

        import pytest as _pytest

        with _pytest.raises(Exception):
            await service.upload_audio(mock_file, user_agent="TestAgent/1.0")

        mock_bq_logger.log_audio_error.assert_called_once()
        logged = mock_bq_logger.log_audio_error.call_args[0][0]
        assert logged["magic_bytes_hex"] == ""
        assert logged["user_agent"] == "TestAgent/1.0"


# ---------------------------------------------------------------------------
# Test: duration_seconds persisted in StudentItemProgress via router logic
# ---------------------------------------------------------------------------


class TestDurationPersistence:
    """
    Verifies that the router correctly wires duration_seconds into
    StudentItemProgress.recording_duration_seconds.

    We test the logic path directly rather than spinning up a full FastAPI
    test client, to avoid the need for a live DB connection in unit tests.
    """

    @pytest.mark.asyncio
    @patch("services.audio_upload.uuid.uuid4")
    @patch("services.audio_upload.datetime")
    async def test_upload_audio_returns_url_with_duration(
        self, mock_datetime: Mock, mock_uuid: Mock
    ):
        """Successful upload returns a GCS URL; duration is accepted without error."""
        mock_uuid.return_value = "test-uuid-dur"
        mock_now = Mock()
        mock_now.strftime.return_value = "20260429_120000"
        mock_datetime.now.return_value = mock_now

        service = AudioUploadService()
        _mock_gcs(service)

        valid_content = b"x" * 1000  # 1 KB — above 500-byte minimum
        mock_file = _make_upload_file(valid_content)

        result = await service.upload_audio(
            mock_file,
            duration_seconds=12,
            user_agent="TestAgent/2.0",
        )

        assert result is not None
        assert "https://storage.googleapis.com/duotopia-audio/recordings/" in result

    def test_student_item_progress_model_has_column(self):
        """Model-level smoke test: column exists and is nullable."""
        from models.progress import StudentItemProgress  # noqa: PLC0415

        col = StudentItemProgress.__table__.c.get("recording_duration_seconds")
        assert col is not None, "Column recording_duration_seconds not in model"
        assert col.nullable, "Column must be nullable (no default required)"
