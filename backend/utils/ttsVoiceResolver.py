"""
TTS voice resolver — mirrors frontend ttsVoiceResolver.ts logic.

Converts accent/gender/speed settings to Azure TTS voice name and rate.
"""

import random

VOICE_MAP = {
    "American English": {
        "Male": "en-US-ChristopherNeural",
        "Female": "en-US-JennyNeural",
    },
    "British English": {
        "Male": "en-GB-RyanNeural",
        "Female": "en-GB-SoniaNeural",
    },
    "Indian English": {
        "Male": "en-IN-PrabhatNeural",
        "Female": "en-IN-NeerjaNeural",
    },
    "Australian English": {
        "Male": "en-AU-WilliamNeural",
        "Female": "en-AU-NatashaNeural",
    },
}

RATE_MAP = {
    "Slow x0.75": "-25%",
    "Normal x1": "+0%",
    "Fast x1.5": "+50%",
}

ACCENT_CHOICES = [a for a in VOICE_MAP.keys()]
GENDER_CHOICES = ["Male", "Female"]


def get_voice_and_rate(
    accent: str = "American English",
    gender: str = "Male",
    speed: str = "Normal x1",
) -> tuple:
    """Return (voice, rate) tuple for Azure TTS.

    Resolves "Random" accent/gender on each call.
    """
    resolved_accent = (
        random.choice(ACCENT_CHOICES) if accent == "Random" else accent
    )
    resolved_gender = (
        random.choice(GENDER_CHOICES) if gender == "Random" else gender
    )
    voice = (
        VOICE_MAP.get(resolved_accent, {}).get(resolved_gender)
        or "en-US-JennyNeural"
    )
    rate = RATE_MAP.get(speed, "+0%")
    return voice, rate
