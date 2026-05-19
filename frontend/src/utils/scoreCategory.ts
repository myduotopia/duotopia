export type ScoreCategory = "speaking" | "listening" | "reading" | "writing";

export function getScoreCategory(
  practiceMode: string | undefined | null,
  playAudio: boolean | undefined | null,
): ScoreCategory {
  const mode = (practiceMode ?? "").trim().toLowerCase();
  const audioOn = Boolean(playAudio);

  if (mode === "reading" || mode === "word_reading") return "speaking";
  if (mode === "word_cloze") return "reading";
  if (mode === "rearrangement" && !audioOn) return "reading";
  return audioOn ? "listening" : "writing";
}
