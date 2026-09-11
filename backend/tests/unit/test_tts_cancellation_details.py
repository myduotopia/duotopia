"""TTS 合成失敗時，必須把 Azure 真正的錯誤原因往外拋（Issue #1047）

過去用 `speechsdk.CancellationDetails(result)` 解析「合成」結果，但那個 class
只吃辨識結果（內部呼叫 result_get_reason_canceled），對合成結果會直接丟
SPXERR_INVALID_ARG —— 錯誤處理自己先炸掉，把 Azure 真正的錯誤蓋掉，
production 查了半天只看得到誤導人的 INVALID_ARG。
"""
import asyncio
from unittest.mock import MagicMock, patch

import pytest


AZURE_ERROR = (
    "Connection failed (no connection to the remote host). "
    "Internal error: 1. Error details: Failed with error: "
    "WS_OPEN_ERROR_UNDERLYING_IO_OPEN_FAILED"
)


def _canceled_speechsdk():
    """組出一個「合成被取消」的假 speechsdk 模組"""
    sdk = MagicMock()
    sdk.ResultReason.SynthesizingAudioCompleted = "completed"
    sdk.CancellationReason.Error = "error"

    result = MagicMock()
    result.reason = "canceled"
    sdk.SpeechSynthesizer.return_value.speak_text.return_value = result

    details = MagicMock()
    details.reason = "error"
    details.error_code = "ConnectionFailure"
    details.error_details = AZURE_ERROR
    sdk.SpeechSynthesisCancellationDetails.return_value = details

    # 誤用辨識用的 CancellationDetails 會像真的 SDK 一樣爆掉
    sdk.CancellationDetails.side_effect = RuntimeError(
        "Exception with an error code: 0x5 (SPXERR_INVALID_ARG)"
    )
    return sdk, result


@pytest.fixture
def tts_service():
    from services.tts import TTSService

    service = TTSService()
    service.azure_speech_key = "fake-key"
    service.azure_speech_region = "japaneast"
    service.use_gcs = False
    return service


def test_canceled_synthesis_surfaces_azure_error_details(tts_service):
    """合成被取消時，例外訊息要帶著 Azure 的真實原因，而不是 SPXERR_INVALID_ARG"""
    sdk, _ = _canceled_speechsdk()

    with patch("services.tts.speechsdk", sdk), patch.object(
        tts_service, "_get_cached_audio_url", return_value=None
    ):
        with pytest.raises(Exception) as exc_info:
            asyncio.run(tts_service.generate_tts("hello", "en-US-JennyNeural"))

    message = str(exc_info.value)
    assert AZURE_ERROR in message, f"Azure 錯誤原因被吃掉了: {message}"
    assert "ConnectionFailure" in message, f"缺少 error_code: {message}"
    assert "SPXERR_INVALID_ARG" not in message


def test_uses_synthesis_specific_cancellation_details(tts_service):
    """必須用 SpeechSynthesisCancellationDetails，不能用辨識用的 CancellationDetails"""
    sdk, result = _canceled_speechsdk()

    with patch("services.tts.speechsdk", sdk), patch.object(
        tts_service, "_get_cached_audio_url", return_value=None
    ):
        with pytest.raises(Exception):
            asyncio.run(tts_service.generate_tts("hello", "en-US-JennyNeural"))

    sdk.SpeechSynthesisCancellationDetails.assert_called_once_with(result)
    sdk.CancellationDetails.assert_not_called()
