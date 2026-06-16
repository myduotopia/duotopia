/**
 * practiceMode — 前端「作業類型」單一真相來源（對應後端 PracticeMode enum）
 *
 * Issue #830：先前 practice_mode → 標籤/顏色的邏輯散落在多個元件各自硬寫，
 * 且多處把「非 word_selection 的單字模式」預設成 WORD_READING（單字朗讀），
 * 導致 word_spelling / word_cloze 與三種小考（*_quiz）全被誤標成「單字朗讀」。
 * 這裡集中定義，各顯示點改用 helper，避免再漂移。
 *
 * 標籤鍵對應 i18n 的 `classroomDetail.contentTypes.*`；顏色沿用既有 badge 配色。
 */

export type PracticeMode =
  | "reading"
  | "rearrangement"
  | "word_reading"
  | "word_selection"
  | "word_selection_quiz"
  | "word_spelling"
  | "word_spelling_quiz"
  | "word_cloze"
  | "word_cloze_quiz"
  | "tug_of_war";

/** practice_mode → `classroomDetail.contentTypes` 子鍵 */
const LABEL_SUBKEY: Record<PracticeMode, string> = {
  reading: "SPEAKING", // 例句朗讀
  rearrangement: "REARRANGEMENT",
  word_reading: "WORD_READING",
  word_selection: "WORD_SELECTION",
  word_selection_quiz: "WORD_SELECTION_QUIZ",
  word_spelling: "WORD_SPELLING",
  word_spelling_quiz: "WORD_SPELLING_QUIZ",
  word_cloze: "WORD_CLOZE",
  word_cloze_quiz: "WORD_CLOZE_QUIZ",
  tug_of_war: "TUG_OF_WAR",
};

/** practice_mode → badge 顏色（小考沿用其 base 模式色；「·小考」字樣已能區分） */
const BADGE_CLASS: Record<PracticeMode, string> = {
  reading: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  rearrangement:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  word_reading:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  word_selection:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  word_selection_quiz:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  word_spelling:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  word_spelling_quiz:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  word_cloze:
    "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  word_cloze_quiz:
    "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  tug_of_war:
    "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

const BADGE_CLASS_DEFAULT =
  "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";

export const QUIZ_PRACTICE_MODES: PracticeMode[] = [
  "word_selection_quiz",
  "word_spelling_quiz",
  "word_cloze_quiz",
];

export function isQuizMode(mode?: string | null): boolean {
  return !!mode && mode.endsWith("_quiz");
}

/**
 * 回傳該 practice_mode 的完整 i18n key（`classroomDetail.contentTypes.*`）。
 * 未知模式回傳空字串，讓呼叫端自行決定 fallback。
 */
export function practiceModeLabelKey(mode?: string | null): string {
  const sub = mode ? LABEL_SUBKEY[mode as PracticeMode] : undefined;
  return sub ? `classroomDetail.contentTypes.${sub}` : "";
}

/** 回傳該 practice_mode 的 badge className（未知回中性灰）。 */
export function practiceModeBadgeClass(mode?: string | null): string {
  return (mode && BADGE_CLASS[mode as PracticeMode]) || BADGE_CLASS_DEFAULT;
}
