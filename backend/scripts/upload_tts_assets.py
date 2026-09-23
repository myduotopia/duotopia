"""
產生並上傳 TTS 用的音效素材（Issue #1061 題庫）。

目前只有一個：`blank-chime.wav` —— 題幹裡的空格（`____` / `( )`）在語音中用這個柔和的「叮」
取代，避免 Azure 把底線念成 underscore（見 services/tts.py `build_ssml`）。

音檔用純 Python 合成（不需要 ffmpeg）：兩個泛音（880Hz + 1320Hz）疊加、指數衰減、0.5 秒，
音量刻意壓低（峰值約 -12 dBFS）不刺耳。

用法（需 backend/service-account-key.json 或 ADC 有 GCS 寫入權限）：
    cd backend
    PYTHONUTF8=1 venv/Scripts/python.exe scripts/upload_tts_assets.py           # 產生到 static/tts/ 並上傳
    PYTHONUTF8=1 venv/Scripts/python.exe scripts/upload_tts_assets.py --local   # 只產生本地檔，不上傳

Azure SSML 的 <audio src> 需要**公開的 HTTPS 網址**，所以本地開發也要用 GCS 上的那份。
"""

import argparse
import math
import os
import struct
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

CHIME_FILENAME = "blank-chime.wav"
SAMPLE_RATE = 22050
DURATION_S = 0.5


def synth_chime() -> bytes:
    """合成柔和「叮」：880Hz 基音 + 1320Hz 泛音（較小），指數衰減，尾端淡出。"""
    n = int(SAMPLE_RATE * DURATION_S)
    frames = bytearray()
    for i in range(n):
        t = i / SAMPLE_RATE
        env = math.exp(-6.0 * t)  # 0.5s 內衰減到約 5%
        # 最後 30ms 線性淡出，避免喀聲
        tail = max(0.0, min(1.0, (DURATION_S - t) / 0.03))
        s = 0.7 * math.sin(2 * math.pi * 880 * t) + 0.3 * math.sin(
            2 * math.pi * 1320 * t
        )
        v = 0.25 * env * tail * s  # 峰值約 -12 dBFS
        frames += struct.pack("<h", int(max(-1.0, min(1.0, v)) * 32767))
    return bytes(frames)


def write_wav(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(synth_chime())


def upload(path: Path, bucket_name: str) -> str:
    from services.tts import get_tts_service

    client = get_tts_service()._get_storage_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(f"tts/{CHIME_FILENAME}")
    blob.upload_from_filename(str(path), content_type="audio/wav")
    return f"https://storage.googleapis.com/{bucket_name}/tts/{CHIME_FILENAME}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate + upload TTS chime asset")
    parser.add_argument("--local", action="store_true", help="只產生本地檔，不上傳")
    args = parser.parse_args()

    out = Path(__file__).resolve().parent.parent / "static" / "tts" / CHIME_FILENAME
    write_wav(out)
    print(f"generated {out} ({out.stat().st_size} bytes)")
    if args.local:
        return
    bucket = os.getenv("GCS_BUCKET_NAME", "duotopia-audio")
    url = upload(out, bucket)
    print(f"uploaded → {url}")


if __name__ == "__main__":
    main()
