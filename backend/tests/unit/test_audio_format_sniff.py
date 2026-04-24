"""Tests for audio format magic-byte detection in convert_audio_to_wav.

The prod issue: iOS Safari MediaRecorder produces M4A (ISO BMFF) bytes but
the client labels content_type as `audio/webm`. The old code forced
`format="webm"` and ffmpeg rejected the M4A bytes with error 183.

Fix: sniff the magic bytes of audio_data first; only fall back to
content_type when sniff is inconclusive.
"""
from unittest.mock import patch, MagicMock

import pytest

from routers.speech_assessment import convert_audio_to_wav, sniff_audio_format


class TestSniffAudioFormat:
    """Magic-byte detection of actual audio container format."""

    def test_detects_webm_from_ebml_magic(self):
        # Matroska/WebM: EBML header starts with 0x1A 0x45 0xDF 0xA3
        data = b"\x1a\x45\xdf\xa3" + b"\x00" * 20
        assert sniff_audio_format(data) == "webm"

    def test_detects_mp4_from_ftyp_box(self):
        # ISO Base Media (MP4/M4A): ftyp box at bytes 4-8
        data = b"\x00\x00\x00\x20" + b"ftypiso5" + b"\x00" * 16
        assert sniff_audio_format(data) == "mp4"

    def test_detects_mp4_with_any_brand(self):
        # Different brand (e.g., "M4A ", "mp42") should still be mp4
        data = b"\x00\x00\x00\x18" + b"ftypM4A " + b"\x00" * 16
        assert sniff_audio_format(data) == "mp4"

    def test_detects_wav_from_riff(self):
        data = b"RIFF" + b"\x00\x00\x00\x00" + b"WAVE" + b"\x00" * 16
        assert sniff_audio_format(data) == "wav"

    def test_detects_mp3_from_id3(self):
        data = b"ID3" + b"\x00" * 24
        assert sniff_audio_format(data) == "mp3"

    def test_detects_mp3_from_sync_frame(self):
        # MP3 sync frame: 0xFF 0xFB / 0xFF 0xF3 / 0xFF 0xF2
        data = b"\xff\xfb" + b"\x00" * 24
        assert sniff_audio_format(data) == "mp3"

    def test_returns_none_for_unknown_bytes(self):
        data = b"\x00" * 32
        assert sniff_audio_format(data) is None

    def test_returns_none_for_short_data(self):
        assert sniff_audio_format(b"") is None
        assert sniff_audio_format(b"\x1a\x45") is None


class TestConvertAudioToWavFormatDetection:
    """Integration: convert_audio_to_wav must prefer magic-byte sniff over
    the client-supplied content_type."""

    @patch("routers.speech_assessment.AudioSegment")
    def test_m4a_data_with_webm_content_type_uses_mp4(self, mock_audio_segment):
        """Regression for Jeneybeh's iOS Safari case: M4A bytes uploaded with
        `audio/webm` content-type. Must decode as mp4, not webm."""
        m4a_bytes = b"\x00\x00\x00\x20" + b"ftypiso5" + b"\x00" * 16 + b"X" * 100

        mock_audio = MagicMock()
        mock_audio.set_frame_rate.return_value = mock_audio
        mock_audio.set_channels.return_value = mock_audio
        mock_audio.set_sample_width.return_value = mock_audio
        mock_audio_segment.from_file.return_value = mock_audio

        convert_audio_to_wav(m4a_bytes, "audio/webm")

        # Must have used mp4 format, NOT webm
        call_kwargs = mock_audio_segment.from_file.call_args.kwargs
        assert call_kwargs.get("format") == "mp4", (
            "M4A bytes with webm content-type should still be decoded as mp4 "
            "via magic-byte sniffing"
        )

    @patch("routers.speech_assessment.AudioSegment")
    def test_valid_webm_uses_webm(self, mock_audio_segment):
        webm_bytes = b"\x1a\x45\xdf\xa3" + b"\x00" * 20 + b"X" * 100

        mock_audio = MagicMock()
        mock_audio.set_frame_rate.return_value = mock_audio
        mock_audio.set_channels.return_value = mock_audio
        mock_audio.set_sample_width.return_value = mock_audio
        mock_audio_segment.from_file.return_value = mock_audio

        convert_audio_to_wav(webm_bytes, "audio/webm")

        assert mock_audio_segment.from_file.call_args.kwargs.get("format") == "webm"

    @patch("routers.speech_assessment.AudioSegment")
    def test_valid_mp4_uses_mp4(self, mock_audio_segment):
        mp4_bytes = b"\x00\x00\x00\x20" + b"ftypiso5" + b"\x00" * 16 + b"X" * 100

        mock_audio = MagicMock()
        mock_audio.set_frame_rate.return_value = mock_audio
        mock_audio.set_channels.return_value = mock_audio
        mock_audio.set_sample_width.return_value = mock_audio
        mock_audio_segment.from_file.return_value = mock_audio

        convert_audio_to_wav(mp4_bytes, "audio/mp4")

        assert mock_audio_segment.from_file.call_args.kwargs.get("format") == "mp4"

    @patch("routers.speech_assessment.AudioSegment")
    def test_unknown_bytes_with_no_content_type_falls_back_to_autodetect(
        self, mock_audio_segment
    ):
        unknown_bytes = b"\x00" * 32 + b"X" * 100

        mock_audio = MagicMock()
        mock_audio.set_frame_rate.return_value = mock_audio
        mock_audio.set_channels.return_value = mock_audio
        mock_audio.set_sample_width.return_value = mock_audio
        mock_audio_segment.from_file.return_value = mock_audio

        convert_audio_to_wav(unknown_bytes, "application/octet-stream")

        # auto-detect = from_file called without explicit `format` kwarg
        assert "format" not in mock_audio_segment.from_file.call_args.kwargs

    @patch("routers.speech_assessment.AudioSegment")
    def test_sniff_overrides_mismatched_content_type_both_directions(
        self, mock_audio_segment
    ):
        """Regression: webm bytes with content-type=audio/mp4 (rare but
        possible) should still be decoded as webm based on the magic bytes."""
        webm_bytes = b"\x1a\x45\xdf\xa3" + b"\x00" * 20 + b"X" * 100

        mock_audio = MagicMock()
        mock_audio.set_frame_rate.return_value = mock_audio
        mock_audio.set_channels.return_value = mock_audio
        mock_audio.set_sample_width.return_value = mock_audio
        mock_audio_segment.from_file.return_value = mock_audio

        convert_audio_to_wav(webm_bytes, "audio/mp4")

        assert mock_audio_segment.from_file.call_args.kwargs.get("format") == "webm"
