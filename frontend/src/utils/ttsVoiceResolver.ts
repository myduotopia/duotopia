/** TTS accent options */
export const TTS_ACCENTS = [
  "Random",
  "American English",
  "British English",
  "Indian English",
  "Australian English",
] as const;

/** TTS gender options */
export const TTS_GENDERS = ["Random", "Male", "Female"] as const;

/** TTS speed options */
export const TTS_SPEEDS = ["Slow x0.75", "Normal x1", "Fast x1.5"] as const;

// Derived from TTS_ACCENTS/TTS_GENDERS — no manual sync needed
const ACCENT_CHOICES = TTS_ACCENTS.filter((a) => a !== "Random");
const GENDER_CHOICES = TTS_GENDERS.filter((g) => g !== "Random");

const VOICE_MAP: Record<string, Record<string, string>> = {
  "American English": {
    Male: "en-US-ChristopherNeural",
    Female: "en-US-JennyNeural",
  },
  "British English": {
    Male: "en-GB-RyanNeural",
    Female: "en-GB-SoniaNeural",
  },
  "Indian English": {
    Male: "en-IN-PrabhatNeural",
    Female: "en-IN-NeerjaNeural",
  },
  "Australian English": {
    Male: "en-AU-WilliamNeural",
    Female: "en-AU-NatashaNeural",
  },
};

const RATE_MAP: Record<string, string> = {
  "Slow x0.75": "-25%",
  "Normal x1": "+0%",
  "Fast x1.5": "+50%",
};

/**
 * Resolve Random accent/gender to concrete values.
 * Each call re-randomizes, so batch loops get different values per item.
 */
export function resolveRandomOptions(
  accent: string,
  gender: string,
): { resolvedAccent: string; resolvedGender: string } {
  const resolvedAccent =
    accent === "Random"
      ? ACCENT_CHOICES[Math.floor(Math.random() * ACCENT_CHOICES.length)]
      : accent;
  const resolvedGender =
    gender === "Random"
      ? GENDER_CHOICES[Math.floor(Math.random() * GENDER_CHOICES.length)]
      : gender;
  return { resolvedAccent, resolvedGender };
}

/**
 * Get Azure TTS voice name and rate from accent/gender/speed settings.
 * Resolves "Random" on each call, ensuring batch items get different voices.
 */
export function getVoiceAndRate(
  accent: string,
  gender: string,
  speed: string,
): { voice: string; rate: string } {
  const { resolvedAccent, resolvedGender } = resolveRandomOptions(
    accent,
    gender,
  );
  const voice =
    VOICE_MAP[resolvedAccent]?.[resolvedGender] ?? "en-US-JennyNeural";
  const rate = RATE_MAP[speed] ?? "+0%";
  return { voice, rate };
}
