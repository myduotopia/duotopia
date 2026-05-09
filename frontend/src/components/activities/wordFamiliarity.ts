/**
 * Issue #711: 5-tier classification of single-word familiarity, diff-based.
 *
 * Mirrors the SQL ``calculate_assignment_mastery`` function so the
 * preview/demo paths (which never hit the backend) classify words
 * the same way the live student path does.
 *
 * Ladder uses ``diff = correct - incorrect`` — every wrong answer
 * cancels exactly one correct, every tier covers one diff value:
 *
 *   master           (精熟)    diff >= 4
 *   familiar         (熟悉)    diff == 3
 *   medium           (普通)    diff == 2
 *   unfamiliar       (不熟悉)  diff == 1
 *   very_unfamiliar  (非常不熟) diff <= 0  (incl. unpracticed)
 */

export type FamiliarityTier =
  | "master"
  | "familiar"
  | "medium"
  | "unfamiliar"
  | "very_unfamiliar";

export function classifyTier(
  correct: number,
  incorrect: number,
): FamiliarityTier {
  const diff = correct - incorrect;
  if (diff >= 4) return "master";
  if (diff === 3) return "familiar";
  if (diff === 2) return "medium";
  if (diff === 1) return "unfamiliar";
  return "very_unfamiliar";
}

export interface TierCounts {
  master: number;
  familiar: number;
  medium: number;
  unfamiliar: number;
  very_unfamiliar: number;
  total: number;
}

/**
 * Aggregate per-word counts into tier totals. Words not present in ``counts``
 * (i.e., never practiced) fall into ``very_unfamiliar`` via ``totalWords``.
 */
export function aggregateTierCounts(
  counts: Record<number, { correct: number; incorrect: number }>,
  totalWords: number,
): TierCounts {
  let master = 0;
  let familiar = 0;
  let medium = 0;
  let unfamiliar = 0;
  let veryUnfamiliarPracticed = 0; // rows that exist but classify as very_unfamiliar
  for (const { correct, incorrect } of Object.values(counts)) {
    const tier = classifyTier(correct, incorrect);
    if (tier === "master") master += 1;
    else if (tier === "familiar") familiar += 1;
    else if (tier === "medium") medium += 1;
    else if (tier === "unfamiliar") unfamiliar += 1;
    else veryUnfamiliarPracticed += 1;
  }
  const total = totalWords || Object.keys(counts).length;
  // Unpracticed rows (no entry in counts) all fall into very_unfamiliar.
  const accountedFor = master + familiar + medium + unfamiliar;
  const very_unfamiliar = Math.max(0, total - accountedFor) ;
  // Note: practiced very_unfamiliar (correct=0 with errors) is also folded
  // into the same bucket via the subtraction above.
  void veryUnfamiliarPracticed;
  return { master, familiar, medium, unfamiliar, very_unfamiliar, total };
}

/**
 * Per-tier weight applied in the mastery formula (linear).
 */
export const TIER_WEIGHT = {
  master: 1.0,
  familiar: 0.75,
  medium: 0.5,
  unfamiliar: 0.25,
  very_unfamiliar: 0.0,
} as const;

/**
 * Weighted single-assignment mastery, range 0..1.
 *   mastery = (1.0*master + 0.75*familiar + 0.5*medium + 0.25*unfamiliar) / total
 * Mirrors ``calculate_assignment_mastery``. mastery == 1.0 still strictly
 * requires every word at "master" tier.
 */
export function weightedMastery(counts: TierCounts): number {
  if (counts.total === 0) return 0;
  return (
    (TIER_WEIGHT.master * counts.master +
      TIER_WEIGHT.familiar * counts.familiar +
      TIER_WEIGHT.medium * counts.medium +
      TIER_WEIGHT.unfamiliar * counts.unfamiliar) /
    counts.total
  );
}
