/**
 * Issue #711: 3-tier classification of single-word familiarity.
 *
 * Mirrors the SQL ``calculate_assignment_mastery`` function so the
 * preview/demo paths (which never hit the backend) classify words
 * the same way the live student path does.
 *
 * - high   (已熟悉)  : correct >= 5 AND correct/total >= 0.9
 * - medium (普通熟悉): correct >= 3 AND correct/total >= 0.5 (and not high)
 * - low    (不熟)    : everything else, including unpracticed words
 */

export type FamiliarityTier = "high" | "medium" | "low";

export function classifyTier(
  correct: number,
  incorrect: number,
): FamiliarityTier {
  const total = correct + incorrect;
  if (total <= 0) return "low";
  const rate = correct / total;
  if (correct >= 5 && rate >= 0.9) return "high";
  if (correct >= 3 && rate >= 0.5) return "medium";
  return "low";
}

export interface TierCounts {
  high: number;
  medium: number;
  low: number;
  total: number;
}

/**
 * Aggregate per-word counts into tier totals. Unpracticed words (those without
 * a row in ``counts``) fall into ``low`` via ``totalWords``.
 */
export function aggregateTierCounts(
  counts: Record<number, { correct: number; incorrect: number }>,
  totalWords: number,
): TierCounts {
  let high = 0;
  let medium = 0;
  for (const { correct, incorrect } of Object.values(counts)) {
    const tier = classifyTier(correct, incorrect);
    if (tier === "high") high += 1;
    else if (tier === "medium") medium += 1;
  }
  const total = totalWords || Object.keys(counts).length;
  const low = Math.max(0, total - high - medium);
  return { high, medium, low, total };
}

/**
 * Weight applied to medium-tier words in the mastery formula.
 * Issue #711 follow-up: medium counts as half a "high" word so partial
 * progress shows up in the percentage; aligned with the SQL function.
 */
export const MEDIUM_WEIGHT = 0.5;

/**
 * Weighted single-assignment mastery, range 0..1.
 *   mastery = (high + MEDIUM_WEIGHT * medium) / total
 * Mirrors ``calculate_assignment_mastery`` so preview/demo paths match
 * what students see live.
 */
export function weightedMastery(counts: TierCounts): number {
  if (counts.total === 0) return 0;
  return (counts.high + MEDIUM_WEIGHT * counts.medium) / counts.total;
}
