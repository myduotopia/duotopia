/**
 * startMaterialGuide (#989)
 *
 * Builds the "you just got this material — here's how to use it" walkthrough
 * shown after a demo visitor registers and their resource pack is copied:
 * the new material card → its first lesson → the orange 即刻練習 button.
 *
 * The lesson step is skipped when the material keeps its contents directly
 * under the program (#587 program-direct content), because then there is no
 * lesson to open.
 */

import type { TFunction } from "i18next";

import type { HighlightStep } from "./useHighlightGuide";

interface GuideTargets {
  programId: number;
  /** First lesson of the copied program, if it has lessons. */
  firstLessonId?: number | null;
  /** First content the teacher can practise — under the lesson or the program. */
  firstContentId?: number | null;
}

export function buildMaterialGuideSteps(
  targets: GuideTargets,
  t: TFunction,
): HighlightStep[] {
  const steps: HighlightStep[] = [
    {
      guideId: `program-${targets.programId}`,
      title: t("guide.material.program.title"),
      description: t("guide.material.program.description"),
    },
  ];

  if (targets.firstLessonId) {
    steps.push({
      guideId: `lesson-${targets.firstLessonId}`,
      title: t("guide.material.lesson.title"),
      description: t("guide.material.lesson.description"),
    });
  }

  if (targets.firstContentId) {
    steps.push({
      guideId: `instant-practice-${targets.firstContentId}`,
      title: t("guide.material.instantPractice.title"),
      description: t("guide.material.instantPractice.description"),
    });
  }

  return steps;
}
