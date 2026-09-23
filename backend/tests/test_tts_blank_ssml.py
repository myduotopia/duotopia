"""
題幹空格 → SSML 訊號音（Issue #1061）：純函式測試，不打 Azure。

- `____`（≥2 底線）與 `( )` 視為空格 → <audio src=chime><break/></audio>；單一 `_` 不算
- 其餘文字 XML escape；voice / rate 進 SSML
- 含空格的題幹 cache key 帶版本字串，與不含空格的不同
"""

from services import tts as tts_mod
from services.tts import BLANK_SSML_VERSION, build_ssml, has_blanks


def test_has_blanks():
    assert has_blanks("I ____ never been to Japan.")
    assert has_blanks("I __ never")
    assert has_blanks("Fill ( ) here")
    assert has_blanks("Fill (  ) here")
    assert not has_blanks("snake_case is not a blank")
    assert not has_blanks("")
    assert not has_blanks("plain sentence.")


def test_build_ssml_replaces_each_blank_with_one_chime():
    ssml = build_ssml(
        "I ____ never ( ) been & <there>.",
        "en-US-JennyNeural",
        "1.10",
        chime_url="https://example.com/chime.wav",
    )
    assert ssml.count('<audio src="https://example.com/chime.wav">') == 2
    assert ssml.count('<break time="600ms"/>') == 2  # 備援
    assert "underscore" not in ssml and "____" not in ssml and "( )" not in ssml
    assert "&amp; &lt;there&gt;." in ssml  # XML escape
    assert '<voice name="en-US-JennyNeural">' in ssml
    assert '<prosody rate="1.10">' in ssml
    assert ssml.startswith("<speak") and ssml.endswith("</speak>")


def test_build_ssml_volume_only_when_set():
    assert 'volume="' not in build_ssml("a ____ b", "v", "1.0", volume="+0%")
    assert 'volume="+10%"' in build_ssml("a ____ b", "v", "1.0", volume="+10%")


def test_cache_key_versioned_for_blank_text():
    svc = tts_mod.TTSService.__new__(tts_mod.TTSService)  # 不跑 __init__（不需 Azure 設定）
    plain = svc._generate_cache_key("I have never", "v", "+0%", "+0%")
    blank = svc._generate_cache_key("I ____ never", "v", "+0%", "+0%")
    assert plain != blank
    # 版本字串有參與 hash：改版本 → key 不同
    import hashlib

    expected = hashlib.md5(
        f"I ____ never|v|+0%|+0%|{BLANK_SSML_VERSION}".encode("utf-8")
    ).hexdigest()
    assert blank == expected
