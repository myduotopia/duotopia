/**
 * practiceMode — 前端「作業類型」單一真相來源（對應後端 PracticeMode enum）
 *
 * Issue #830：先前 practice_mode → 標籤/顏色的邏輯散落在多個元件各自硬寫，
 * 且多處把「非 word_selection 的單字模式」預設成 WORD_READING（單字朗讀），
 * 導致 word_spelling / word_cloze 與三種小考（*_quiz）全被誤標成「單字朗讀」。
 * 這裡集中定義，各顯示點改用 helper，避免再漂移。
 *
 * 標籤鍵對應 i18n 的 `classroomDetail.contentTypes.*`；顏色沿用既有 badge 配色。
 *
 * 注意：成績類別（聽說讀寫 score_category）刻意「不」放進這裡 —— 它不是
 * practice_mode 的純函式（還要看 play_audio），且唯一真相在後端
 * `backend/utils/score_category.py`，前端只讀後端算好的值。詳見
 * `docs/design/score-category-mapping.md`。
 */

import {
  Mic,
  Shuffle,
  MousePointerClick,
  Volume2,
  Keyboard,
  FileText,
  BookOpen,
  type LucideIcon,
} from "lucide-react";

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

/**
 * practice_mode → 學生卡 lucide 圖示（component 參照，由呼叫端決定尺寸 className）。
 * 小考沿用其 base 模式圖示；tug_of_war 目前無專屬圖示，沿用既有 BookOpen fallback。
 */
const MODE_ICON: Record<PracticeMode, LucideIcon> = {
  reading: Mic,
  rearrangement: Shuffle,
  word_reading: Volume2,
  word_selection: MousePointerClick,
  word_selection_quiz: MousePointerClick,
  word_spelling: Keyboard,
  word_spelling_quiz: Keyboard,
  word_cloze: FileText,
  word_cloze_quiz: FileText,
  tug_of_war: BookOpen,
};

const MODE_ICON_DEFAULT: LucideIcon = BookOpen;

/** 回傳該 practice_mode 的 lucide 圖示 component（未知回 BookOpen）。 */
export function practiceModeIcon(mode?: string | null): LucideIcon {
  return (mode && MODE_ICON[mode as PracticeMode]) || MODE_ICON_DEFAULT;
}

/**
 * practice_mode → 學生卡左側圖示區「蠟筆」底色 class。
 * 小考沿用其 base 模式底色；tug_of_war 目前無專屬底色，沿用既有灰底 fallback（行為不變）。
 */
const CRAYON_BG_DEFAULT = "bg-gray-50 text-gray-600";

const CRAYON_BG: Record<PracticeMode, string> = {
  reading:
    "crayon-texture bg-gradient-to-b from-orange-100 to-orange-200 text-orange-600",
  rearrangement:
    "crayon-texture bg-gradient-to-b from-blue-100 to-blue-200 text-blue-600",
  word_selection:
    "crayon-texture bg-gradient-to-b from-emerald-100 to-emerald-200 text-emerald-600",
  word_selection_quiz:
    "crayon-texture bg-gradient-to-b from-emerald-100 to-emerald-200 text-emerald-600",
  word_reading:
    "crayon-texture bg-gradient-to-b from-purple-100 to-purple-200 text-purple-600",
  word_spelling:
    "crayon-texture bg-gradient-to-b from-amber-100 to-amber-200 text-amber-600",
  word_spelling_quiz:
    "crayon-texture bg-gradient-to-b from-amber-100 to-amber-200 text-amber-600",
  word_cloze:
    "crayon-texture bg-gradient-to-b from-pink-100 to-pink-200 text-pink-600",
  word_cloze_quiz:
    "crayon-texture bg-gradient-to-b from-pink-100 to-pink-200 text-pink-600",
  tug_of_war: CRAYON_BG_DEFAULT,
};

/** 回傳該 practice_mode 的學生卡蠟筆底色 class（未知回灰底）。 */
export function practiceModeCrayonBg(mode?: string | null): string {
  return (mode && CRAYON_BG[mode as PracticeMode]) || CRAYON_BG_DEFAULT;
}

/**
 * 篩選/顯示用的標準順序（含三種小考）。每個 base 模式後緊接其小考變體，
 * 篩選下拉、按鈕清單都應依此產生，避免各頁各自硬寫且遺漏小考。
 */
export const PRACTICE_MODE_ORDER: PracticeMode[] = [
  "reading",
  "word_reading",
  "rearrangement",
  "word_selection",
  "word_selection_quiz",
  "word_spelling",
  "word_spelling_quiz",
  "word_cloze",
  "word_cloze_quiz",
  "tug_of_war",
];

export interface PracticeModeFilterOption {
  /** 原始 practice_mode 值（作為 select value / 後端 query 參數） */
  mode: PracticeMode;
  /** i18n key（`classroomDetail.contentTypes.*`） */
  labelKey: string;
}

/**
 * 產生作業模式篩選下拉/按鈕的選項清單（依 PRACTICE_MODE_ORDER，含小考）。
 * 不含「全部」選項 —— 由各頁自行加上（key 各自既有）。
 */
export function practiceModeFilterOptions(): PracticeModeFilterOption[] {
  return PRACTICE_MODE_ORDER.map((mode) => ({
    mode,
    labelKey: practiceModeLabelKey(mode),
  }));
}

/**
 * 自動計分模式：系統自動判分、不需 AI 發音批改的模式。
 * = {rearrangement, word_selection, word_spelling, word_cloze, tug_of_war} ∪ 三種小考。
 * 補集為朗讀類（reading / word_reading）—— 需 AI 批改。
 */
const AUTO_SCORED_MODES: ReadonlySet<PracticeMode> = new Set([
  "rearrangement",
  "word_selection",
  "word_spelling",
  "word_cloze",
  "tug_of_war",
]);

export function isAutoScoredMode(mode?: string | null): boolean {
  if (!mode) return false;
  return AUTO_SCORED_MODES.has(mode as PracticeMode) || isQuizMode(mode);
}

/**
 * 可由老師「點進去手動批改/檢視」的模式（StudentStatusPanel 既有 GRADABLE_MODES）。
 * = {reading, word_reading, rearrangement}。語意與 isAutoScoredMode 補集「不」相同，
 * 故獨立定義，維持各自既有行為。
 */
const GRADABLE_MODES: ReadonlySet<PracticeMode> = new Set([
  "reading",
  "word_reading",
  "rearrangement",
]);

export function isGradableMode(mode?: string | null): boolean {
  return !!mode && GRADABLE_MODES.has(mode as PracticeMode);
}
