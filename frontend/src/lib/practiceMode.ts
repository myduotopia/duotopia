/**
 * practiceMode — 前端「作業類型」單一真相來源（對應後端 PracticeMode enum）
 *
 * 歷史：
 * - #830 先建了一批 helper（label/color/icon/predicate），消除「非 word_selection
 *   單字模式被誤標成單字朗讀」的 bug。
 * - #843（PR #870）把各顯示點（ClassroomDetail / AssignmentManagementPage /
 *   StudentAssignmentList / GradingPage …）全部改吃這些 helper。
 * - #878 Stage 1（本次）把原本散成多張 map（LABEL_SUBKEY / BADGE_CLASS / MODE_ICON /
 *   CRAYON_BG / AUTO_SCORED_MODES / GRADABLE_MODES）**收斂成單一 `PRACTICE_MODE_REGISTRY`
 *   物件**，並新增 #864（口說集）/ #854 Stage 3（共用條件設定區 Panel）要靠的接點：
 *   `scoreCategory`（規則）、`settings`（typed SettingSpec[]）、`defaults`、
 *   `supportedDatasets`，以及 helper `getModeConfig` / `listModesForDataset` /
 *   `resolveScoreCategoryFE` / `applyModeDefaults`。
 *
 * 設計原則：純加法，既有 export 簽名不變、改由 registry 算出，對 10 個 consumer 無感。
 *
 * 成績類別（聽說讀寫 score_category）改以**規則**（`ScoreCategoryRule`）存放，鏡射後端
 * `backend/utils/score_category.py` 的 `resolve_score_category`（唯一真相仍在後端；前端只在
 * 派發 UI 的 score 提示用 `resolveScoreCategoryFE` 預覽，並由測試斷言與後端對照表等價）。
 * 詳見 `docs/design/score-category-mapping.md`。
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
import type { ScoreCategory } from "@/utils/scoreCategory";

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

/** 可派發的資料集維度（#864 口說集會新增第三種 "speaking"，屆時擴此 union 即可）。 */
export type PracticeDataset = "example_sentences" | "vocabulary_set";

/**
 * 成績類別「規則」——鏡射後端 `resolve_score_category`，存規則不存定值，
 * 以免前端硬寫的定值與後端的 play_audio／作答方式分流邏輯漂移。
 * `driverKey` 指出由哪個 setting 驅動，Panel 才能把 score 提示畫在對應控制項旁。
 */
export type ScoreCategoryRule =
  /** 永遠固定（reading/word_reading→speaking；word_cloze(_quiz)→reading）。 */
  | { kind: "static"; category: ScoreCategory }
  /** 看 play_audio：on→listening、off→whenSilent（rearrangement 的 whenSilent=reading，其餘=writing）。 */
  | { kind: "audio-based"; driverKey: "play_audio"; whenSilent: ScoreCategory }
  /** 看作答方式：語音→whenVoice、打字→whenText。#864 口說預留，現有模式不使用。 */
  | {
      kind: "input-based";
      driverKey: "response_mode";
      whenVoice: ScoreCategory;
      whenText: ScoreCategory;
    };

/** 派發進階條件的設定 key（formData 欄位子集）。 */
export type SettingKey =
  | "time_limit_per_question"
  | "quiz_time_limit_seconds"
  | "shuffle_questions"
  | "show_answer"
  | "play_audio"
  | "target_proficiency"
  | "show_translation"
  | "show_word"
  | "show_image"
  | "show_option_images";

export type SettingValue = boolean | number | string;

/** 一組設定的部分覆寫（chip onClick 預設、segmented 按鈕一次設多個 key 都用這個形狀）。 */
export type SettingPatch = Partial<Record<SettingKey, SettingValue>>;

interface SelectOption {
  value: number;
  /** 特殊值（如 0=unlimited）的 i18n key；數值秒/分鐘選項的完整呈現由 Panel 組裝。 */
  labelKey?: string;
  /** 無 i18n key 的既有硬寫字串（如小考分鐘選項），Stage 6 再收斂。 */
  label?: string;
}

interface SegmentedOption {
  /** 此按鈕代表的 `key` 值。 */
  value: SettingValue;
  labelKey: string;
  descKey?: string;
  /** 此按鈕額外連動設定的其他 key（多 key 耦合，如「播放音檔」同時關 show_word）。 */
  patch?: SettingPatch;
}

/**
 * 進階條件控制項規格（typed）。Stage 3 的 `PracticeModeSettingsPanel` 依 `kind` 分派 renderer；
 * 新增模式只在 registry 加 setting，不改 Panel。`segmented`/`ranked` 為 #864 預留型態。
 *
 * 注意：靜態限制（互斥 `excludes`）放這裡；runtime 限制（`locked` 學生已開始、
 * `hasMissingImage` 依已選教材 disable、spelling/cloze 在 play_audio 時鎖 show_answer）
 * 不進 registry，由 Panel 的 context props 處理。
 */
export type SettingSpec =
  | { kind: "toggle"; key: SettingKey; excludes?: SettingKey[] }
  | {
      kind: "segmented";
      key: SettingKey;
      options: SegmentedOption[];
      /** 各按鈕的 score 提示由 `resolveScoreCategoryFE` 推導（取代硬寫「→聽力/→寫作」）。 */
      scoreHint?: boolean;
    }
  | { kind: "select"; key: SettingKey; options: SelectOption[] }
  | { kind: "number"; key: SettingKey; min: number; max: number; step: number }
  | {
      kind: "ranked";
      key: SettingKey;
      options: SegmentedOption[];
      min: number;
    };

/** 單一作業類型的完整 metadata（單一真相來源）。 */
export interface ModeConfig {
  // ---- 顯示（backs practiceModeLabelKey / BadgeClass / Icon / CrayonBg）----
  /** 完整 i18n key（`classroomDetail.contentTypes.*`）。 */
  labelKey: string;
  /** badge className。 */
  badgeClass: string;
  /** 學生卡 lucide icon component。 */
  icon: LucideIcon;
  /** 學生卡左側「蠟筆」底色 class。 */
  crayonBg: string;

  // ---- 分類 ----
  /** 小考變體。 */
  isQuiz: boolean;
  /** 採艾賓浩斯記憶曲線。 */
  isMemoryBased: boolean;
  /** base 模式（小考→其 base；其餘→自身）。 */
  baseMode: PracticeMode;

  // ---- 資料集相容性 ----
  /** 可派發於哪些資料集。 */
  supportedDatasets: PracticeDataset[];
  /** 最多可選幾個集（#864 口說「最多 1 集」=1）；undefined=不限。 */
  maxDatasets?: number;

  // ---- 計分 ----
  /** 成績類別規則（鏡射後端）。 */
  scoreCategory: ScoreCategoryRule;
  /** 需 AI 發音批改（= 燒 token）。 */
  needsAiGrading: boolean;
  /** 燒 AI token（目前 === needsAiGrading）。 */
  burnsTokens: boolean;
  /** 系統自動判分、不需 AI（backs isAutoScoredMode）。 */
  autoGraded: boolean;
  /** 老師可點進去手動批改/檢視（backs isGradableMode）。 */
  gradable: boolean;

  // ---- 派發 UI ----
  /** 進階條件控制項規格（Stage 3 Panel 消費）。 */
  settings: SettingSpec[];
  /** 選此模式時套用的 per-mode 預設覆寫（Stage 2 取代 chip onClick 硬寫）。 */
  defaults: SettingPatch;
  /** 派發 chip 的 i18n 與配色（僅可派發模式有；Stage 2 消費）。 */
  chipTitleKey?: string;
  chipDescKey?: string;
  chipSelectedClass?: string;
  iconColorClass?: string;
}

const PM = "dialogs.assignmentDialog.practiceMode";

// ---- 可重用的 SettingSpec 片段（read-only 資料，跨模式共用同一參照無妨）----
const TOGGLE_SHUFFLE: SettingSpec = {
  kind: "toggle",
  key: "shuffle_questions",
};
const TOGGLE_SHOW_ANSWER: SettingSpec = { kind: "toggle", key: "show_answer" };
const TOGGLE_SHOW_TRANSLATION: SettingSpec = {
  kind: "toggle",
  key: "show_translation",
};
const TOGGLE_SHOW_IMAGE: SettingSpec = {
  kind: "toggle",
  key: "show_image",
  excludes: ["show_option_images"], // Issue #631 互斥
};
const TOGGLE_SHOW_OPTION_IMAGES: SettingSpec = {
  kind: "toggle",
  key: "show_option_images",
  excludes: ["show_image"], // Issue #631 互斥
};
const NUMBER_TARGET_PROFICIENCY: SettingSpec = {
  kind: "number",
  key: "target_proficiency",
  min: 50,
  max: 100,
  step: 5,
};
const SELECT_TIME_LIMIT: SettingSpec = {
  kind: "select",
  key: "time_limit_per_question",
  options: [
    { value: 0, labelKey: `${PM}.unlimited` },
    { value: 10, labelKey: `${PM}.seconds` },
    { value: 20, labelKey: `${PM}.seconds` },
    { value: 30, labelKey: `${PM}.seconds` },
    { value: 40, labelKey: `${PM}.seconds` },
  ],
};
const SELECT_QUIZ_TIME: SettingSpec = {
  kind: "select",
  key: "quiz_time_limit_seconds",
  options: [
    { value: 0, labelKey: `${PM}.unlimited` },
    { value: 180, label: "3 分鐘" },
    { value: 300, label: "5 分鐘" },
    { value: 600, label: "10 分鐘" },
    { value: 900, label: "15 分鐘" },
    { value: 1200, label: "20 分鐘" },
    { value: 1800, label: "30 分鐘" },
  ],
};
/** 例句重組「播放音檔」雙按鈕（score 提示由規則推導）。 */
const SEGMENTED_PLAY_AUDIO: SettingSpec = {
  kind: "segmented",
  key: "play_audio",
  scoreHint: true,
  options: [
    { value: true, labelKey: `${PM}.playAudioYes` },
    { value: false, labelKey: `${PM}.playAudioNo` },
  ],
};
/** 單字選擇家族「題目呈現方式」：顯示單字 ↔ 播放音檔（連動 play_audio）。 */
const SEGMENTED_DISPLAY_SELECTION: SettingSpec = {
  kind: "segmented",
  key: "show_word",
  scoreHint: true,
  options: [
    {
      value: true,
      labelKey: `${PM}.displayWord`,
      descKey: `${PM}.displayWordDesc`,
      patch: { play_audio: false },
    },
    {
      value: false,
      labelKey: `${PM}.playAudioWord`,
      descKey: `${PM}.playAudioWordDesc`,
      patch: { play_audio: true },
    },
  ],
};
/** 拼寫/克漏字家族「題目呈現方式」：顯示翻譯 ↔ 播放音檔（連動 play_audio；播音強制 show_answer）。 */
const SEGMENTED_DISPLAY_TEXT: SettingSpec = {
  kind: "segmented",
  key: "show_translation",
  scoreHint: true,
  options: [
    {
      value: true,
      labelKey: `${PM}.displayTranslation`,
      descKey: `${PM}.displayTranslationDesc`,
      patch: { play_audio: false },
    },
    {
      value: false,
      labelKey: `${PM}.playAudioWord`,
      descKey: `${PM}.playAudioFillDesc`,
      patch: { play_audio: true, show_answer: true },
    },
  ],
};

const BADGE_CLASS_DEFAULT =
  "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
const MODE_ICON_DEFAULT: LucideIcon = BookOpen;
const CRAYON_BG_DEFAULT = "bg-gray-50 text-gray-600";

/**
 * 作業類型單一真相來源。新增模式只在這裡加一筆，並（視需要）在 Stage 4 的畫面目錄
 * 補對應作答/預覽積木。
 */
export const PRACTICE_MODE_REGISTRY: Record<PracticeMode, ModeConfig> = {
  reading: {
    labelKey: "classroomDetail.contentTypes.SPEAKING",
    badgeClass:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    icon: Mic,
    crayonBg:
      "crayon-texture bg-gradient-to-b from-orange-100 to-orange-200 text-orange-600",
    isQuiz: false,
    isMemoryBased: false,
    baseMode: "reading",
    supportedDatasets: ["example_sentences", "vocabulary_set"],
    scoreCategory: { kind: "static", category: "speaking" },
    needsAiGrading: true,
    burnsTokens: true,
    autoGraded: false,
    gradable: true,
    settings: [TOGGLE_SHUFFLE], // 時間固定 30 秒，不顯示選擇器
    defaults: { time_limit_per_question: 30 },
    chipTitleKey: `${PM}.reading`,
    chipDescKey: `${PM}.readingDesc`,
    chipSelectedClass: "border-orange-500 bg-orange-50 text-orange-700",
    iconColorClass: "text-orange-600",
  },
  rearrangement: {
    labelKey: "classroomDetail.contentTypes.REARRANGEMENT",
    badgeClass:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    icon: Shuffle,
    crayonBg:
      "crayon-texture bg-gradient-to-b from-blue-100 to-blue-200 text-blue-600",
    isQuiz: false,
    isMemoryBased: false,
    baseMode: "rearrangement",
    supportedDatasets: ["example_sentences", "vocabulary_set"],
    scoreCategory: {
      kind: "audio-based",
      driverKey: "play_audio",
      whenSilent: "reading",
    },
    needsAiGrading: false,
    burnsTokens: false,
    autoGraded: true,
    gradable: true,
    settings: [
      SELECT_TIME_LIMIT,
      TOGGLE_SHUFFLE,
      TOGGLE_SHOW_ANSWER,
      SEGMENTED_PLAY_AUDIO,
    ],
    defaults: {},
    chipTitleKey: `${PM}.rearrangement`,
    chipDescKey: `${PM}.rearrangementDesc`,
    chipSelectedClass: "border-blue-500 bg-blue-50 text-blue-700",
    iconColorClass: "text-blue-600",
  },
  word_reading: {
    labelKey: "classroomDetail.contentTypes.WORD_READING",
    badgeClass:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    icon: Volume2,
    crayonBg:
      "crayon-texture bg-gradient-to-b from-purple-100 to-purple-200 text-purple-600",
    isQuiz: false,
    isMemoryBased: false,
    baseMode: "word_reading",
    supportedDatasets: ["vocabulary_set"],
    scoreCategory: { kind: "static", category: "speaking" },
    needsAiGrading: true,
    burnsTokens: true,
    autoGraded: false,
    gradable: true,
    settings: [TOGGLE_SHUFFLE, TOGGLE_SHOW_TRANSLATION, TOGGLE_SHOW_IMAGE], // 時間固定 10 秒
    defaults: { time_limit_per_question: 10 },
    chipTitleKey: `${PM}.wordReading`,
    chipDescKey: `${PM}.wordReadingDesc`,
    chipSelectedClass: "border-purple-500 bg-purple-50 text-purple-700",
    iconColorClass: "text-purple-600",
  },
  word_selection: {
    labelKey: "classroomDetail.contentTypes.WORD_SELECTION",
    badgeClass:
      "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
    icon: MousePointerClick,
    crayonBg:
      "crayon-texture bg-gradient-to-b from-emerald-100 to-emerald-200 text-emerald-600",
    isQuiz: false,
    isMemoryBased: true,
    baseMode: "word_selection",
    supportedDatasets: ["vocabulary_set"],
    // #878：無音檔＝看字選義（閱讀理解）→ reading；有音檔→ listening
    scoreCategory: {
      kind: "audio-based",
      driverKey: "play_audio",
      whenSilent: "reading",
    },
    needsAiGrading: false,
    burnsTokens: false,
    autoGraded: true,
    gradable: false,
    settings: [
      NUMBER_TARGET_PROFICIENCY,
      SEGMENTED_DISPLAY_SELECTION,
      SELECT_TIME_LIMIT,
      TOGGLE_SHOW_ANSWER,
      TOGGLE_SHOW_IMAGE,
      TOGGLE_SHOW_OPTION_IMAGES,
    ],
    defaults: { time_limit_per_question: 30 },
    chipTitleKey: `${PM}.wordSelection`,
    chipDescKey: `${PM}.wordSelectionDesc`,
    chipSelectedClass: "border-emerald-500 bg-emerald-50 text-emerald-700",
    iconColorClass: "text-emerald-600",
  },
  word_selection_quiz: {
    labelKey: "classroomDetail.contentTypes.WORD_SELECTION_QUIZ",
    badgeClass:
      "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
    icon: MousePointerClick,
    crayonBg:
      "crayon-texture bg-gradient-to-b from-emerald-100 to-emerald-200 text-emerald-600",
    isQuiz: true,
    isMemoryBased: false,
    baseMode: "word_selection",
    supportedDatasets: ["vocabulary_set"],
    // #878：同 word_selection，無音檔→ reading、有音檔→ listening
    scoreCategory: {
      kind: "audio-based",
      driverKey: "play_audio",
      whenSilent: "reading",
    },
    needsAiGrading: false,
    burnsTokens: false,
    autoGraded: true,
    gradable: false,
    settings: [
      SEGMENTED_DISPLAY_SELECTION,
      SELECT_QUIZ_TIME,
      TOGGLE_SHOW_ANSWER,
      TOGGLE_SHOW_IMAGE,
      TOGGLE_SHOW_OPTION_IMAGES,
    ],
    defaults: { time_limit_per_question: 30 },
    chipTitleKey: `${PM}.wordSelectionQuiz`,
    chipDescKey: `${PM}.wordSelectionQuizDesc`,
    chipSelectedClass: "border-emerald-500 bg-emerald-50 text-emerald-700",
    iconColorClass: "text-emerald-600",
  },
  word_spelling: {
    labelKey: "classroomDetail.contentTypes.WORD_SPELLING",
    badgeClass:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    icon: Keyboard,
    crayonBg:
      "crayon-texture bg-gradient-to-b from-amber-100 to-amber-200 text-amber-600",
    isQuiz: false,
    isMemoryBased: true,
    baseMode: "word_spelling",
    supportedDatasets: ["vocabulary_set"],
    scoreCategory: {
      kind: "audio-based",
      driverKey: "play_audio",
      whenSilent: "writing",
    },
    needsAiGrading: false,
    burnsTokens: false,
    autoGraded: true,
    gradable: false,
    settings: [
      NUMBER_TARGET_PROFICIENCY,
      SEGMENTED_DISPLAY_TEXT,
      SELECT_TIME_LIMIT,
      TOGGLE_SHOW_ANSWER, // play_audio 時鎖定 = runtime，由 Panel context 處理
      TOGGLE_SHOW_IMAGE,
    ],
    defaults: {
      time_limit_per_question: 30,
      show_translation: true,
      play_audio: false,
      show_answer: false,
      target_proficiency: 80,
      shuffle_questions: false,
    },
    chipTitleKey: `${PM}.wordSpelling`,
    chipDescKey: `${PM}.wordSpellingDesc`,
    chipSelectedClass: "border-amber-500 bg-amber-50 text-amber-700",
    iconColorClass: "text-amber-600",
  },
  word_spelling_quiz: {
    labelKey: "classroomDetail.contentTypes.WORD_SPELLING_QUIZ",
    badgeClass:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    icon: Keyboard,
    crayonBg:
      "crayon-texture bg-gradient-to-b from-amber-100 to-amber-200 text-amber-600",
    isQuiz: true,
    isMemoryBased: false,
    baseMode: "word_spelling",
    supportedDatasets: ["vocabulary_set"],
    scoreCategory: {
      kind: "audio-based",
      driverKey: "play_audio",
      whenSilent: "writing",
    },
    needsAiGrading: false,
    burnsTokens: false,
    autoGraded: true,
    gradable: false,
    settings: [
      SEGMENTED_DISPLAY_TEXT,
      SELECT_QUIZ_TIME,
      TOGGLE_SHOW_ANSWER,
      TOGGLE_SHOW_IMAGE,
    ],
    defaults: {
      time_limit_per_question: 30,
      show_translation: true,
      play_audio: false,
      show_answer: false,
      shuffle_questions: false,
    },
    chipTitleKey: `${PM}.wordSpellingQuiz`,
    chipDescKey: `${PM}.wordSpellingQuizDesc`,
    chipSelectedClass: "border-amber-500 bg-amber-50 text-amber-700",
    iconColorClass: "text-amber-600",
  },
  word_cloze: {
    labelKey: "classroomDetail.contentTypes.WORD_CLOZE",
    badgeClass:
      "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
    icon: FileText,
    crayonBg:
      "crayon-texture bg-gradient-to-b from-pink-100 to-pink-200 text-pink-600",
    isQuiz: false,
    isMemoryBased: true,
    baseMode: "word_cloze",
    supportedDatasets: ["vocabulary_set"],
    // #878：打字填空＝產出文字 → 無音檔 writing、有音檔 listening（不再恆 reading）
    scoreCategory: {
      kind: "audio-based",
      driverKey: "play_audio",
      whenSilent: "writing",
    },
    needsAiGrading: false,
    burnsTokens: false,
    autoGraded: true,
    gradable: false,
    settings: [
      NUMBER_TARGET_PROFICIENCY,
      SEGMENTED_DISPLAY_TEXT,
      SELECT_TIME_LIMIT,
      TOGGLE_SHOW_ANSWER,
      TOGGLE_SHOW_IMAGE,
    ],
    defaults: {
      time_limit_per_question: 30,
      show_translation: true,
      play_audio: false,
      show_answer: false,
      target_proficiency: 80,
      shuffle_questions: false,
    },
    chipTitleKey: `${PM}.wordCloze`,
    chipDescKey: `${PM}.wordClozeDesc`,
    chipSelectedClass: "border-pink-500 bg-pink-50 text-pink-700",
    iconColorClass: "text-pink-600",
  },
  word_cloze_quiz: {
    labelKey: "classroomDetail.contentTypes.WORD_CLOZE_QUIZ",
    badgeClass:
      "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
    icon: FileText,
    crayonBg:
      "crayon-texture bg-gradient-to-b from-pink-100 to-pink-200 text-pink-600",
    isQuiz: true,
    isMemoryBased: false,
    baseMode: "word_cloze",
    supportedDatasets: ["vocabulary_set"],
    // #878：打字填空＝產出文字 → 無音檔 writing、有音檔 listening（不再恆 reading）
    scoreCategory: {
      kind: "audio-based",
      driverKey: "play_audio",
      whenSilent: "writing",
    },
    needsAiGrading: false,
    burnsTokens: false,
    autoGraded: true,
    gradable: false,
    settings: [
      SEGMENTED_DISPLAY_TEXT,
      SELECT_QUIZ_TIME,
      TOGGLE_SHOW_ANSWER,
      TOGGLE_SHOW_IMAGE,
    ],
    defaults: {
      time_limit_per_question: 30,
      show_translation: true,
      play_audio: false,
      show_answer: false,
      shuffle_questions: false,
    },
    chipTitleKey: `${PM}.wordClozeQuiz`,
    chipDescKey: `${PM}.wordClozeQuizDesc`,
    chipSelectedClass: "border-pink-500 bg-pink-50 text-pink-700",
    iconColorClass: "text-pink-600",
  },
  tug_of_war: {
    labelKey: "classroomDetail.contentTypes.TUG_OF_WAR",
    badgeClass:
      "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
    icon: BookOpen, // 目前無專屬圖示，沿用 fallback
    crayonBg: CRAYON_BG_DEFAULT, // 目前無專屬底色，沿用灰底 fallback（行為不變）
    isQuiz: false,
    isMemoryBased: false,
    baseMode: "tug_of_war",
    supportedDatasets: ["vocabulary_set"],
    scoreCategory: {
      kind: "audio-based",
      driverKey: "play_audio",
      whenSilent: "writing",
    },
    needsAiGrading: false,
    burnsTokens: false,
    autoGraded: true,
    gradable: false,
    settings: [], // 非經 AssignmentDialog 派發
    defaults: {},
  },
};

/** 取得該 practice_mode 的完整 metadata（未知/空回 undefined）。不做大小寫正規化，保持顯示函式既有行為。 */
export function getModeConfig(mode?: string | null): ModeConfig | undefined {
  if (!mode) return undefined;
  return PRACTICE_MODE_REGISTRY[mode as PracticeMode];
}

/**
 * AssignmentDialog chip 列的顯示順序（base 模式後緊接其小考）。tug_of_war 不經 dialog 派發，
 * 故不在此清單；`listModesForDataset` 也據此排除。
 */
const ASSIGNABLE_MODE_ORDER: PracticeMode[] = [
  "reading",
  "rearrangement",
  "word_reading",
  "word_selection",
  "word_selection_quiz",
  "word_spelling",
  "word_spelling_quiz",
  "word_cloze",
  "word_cloze_quiz",
];

/** 依資料集回傳可派發的模式（chip 列），重現 AssignmentDialog 既有過濾：例句集只給非 word_ 模式。 */
export function listModesForDataset(dataset: PracticeDataset): PracticeMode[] {
  return ASSIGNABLE_MODE_ORDER.filter((m) =>
    PRACTICE_MODE_REGISTRY[m].supportedDatasets.includes(dataset),
  );
}

/**
 * 前端版成績類別解析，鏡射後端 `resolve_score_category`（唯一真相仍在後端）。
 * 僅用於派發 UI 的 score 提示預覽；測試斷言與後端對照表逐格等價。
 * `responseMode` 為 #864 `input-based` 預留（現有模式不使用，預設 voice）。
 */
export function resolveScoreCategoryFE(
  mode?: string | null,
  playAudio?: boolean | null,
  responseMode?: "voice" | "text" | null,
): ScoreCategory {
  const normalized = (mode ?? "").trim().toLowerCase();
  const config = PRACTICE_MODE_REGISTRY[normalized as PracticeMode];
  const audioOn = Boolean(playAudio);
  if (!config) return audioOn ? "listening" : "writing"; // 鏡射後端 unknown/empty fallback
  const rule = config.scoreCategory;
  switch (rule.kind) {
    case "static":
      return rule.category;
    case "audio-based":
      return audioOn ? "listening" : rule.whenSilent;
    case "input-based":
      return responseMode === "text" ? rule.whenText : rule.whenVoice;
  }
}

/** 選此模式時要套用的 formData patch（取代 chip onClick 散寫的 per-mode 預設）。 */
export function applyModeDefaults(
  mode: PracticeMode,
): { practice_mode: PracticeMode } & SettingPatch {
  return { practice_mode: mode, ...PRACTICE_MODE_REGISTRY[mode].defaults };
}

// ============================================================================
// 既有 export —— 簽名不變，改由 registry 算出（對既有 consumer 無感）
// ============================================================================

export const QUIZ_PRACTICE_MODES: PracticeMode[] = (
  Object.keys(PRACTICE_MODE_REGISTRY) as PracticeMode[]
).filter((m) => PRACTICE_MODE_REGISTRY[m].isQuiz);

export function isQuizMode(mode?: string | null): boolean {
  return !!mode && mode.endsWith("_quiz");
}

/**
 * 回傳該 practice_mode 的完整 i18n key（`classroomDetail.contentTypes.*`）。
 * 未知模式回傳空字串，讓呼叫端自行決定 fallback。
 */
export function practiceModeLabelKey(mode?: string | null): string {
  return getModeConfig(mode)?.labelKey ?? "";
}

/** 回傳該 practice_mode 的 badge className（未知回中性灰）。 */
export function practiceModeBadgeClass(mode?: string | null): string {
  return getModeConfig(mode)?.badgeClass ?? BADGE_CLASS_DEFAULT;
}

/**
 * practice_mode → 學生卡 lucide 圖示（component 參照，由呼叫端決定尺寸 className）。
 * 未知模式回 BookOpen。
 */
export function practiceModeIcon(mode?: string | null): LucideIcon {
  return getModeConfig(mode)?.icon ?? MODE_ICON_DEFAULT;
}

/** 回傳該 practice_mode 的學生卡蠟筆底色 class（未知回灰底）。 */
export function practiceModeCrayonBg(mode?: string | null): string {
  return getModeConfig(mode)?.crayonBg ?? CRAYON_BG_DEFAULT;
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
 * 補集為朗讀類（reading / word_reading）—— 需 AI 批改。
 * 對未知字串維持舊行為（`*_quiz` → true）。
 */
export function isAutoScoredMode(mode?: string | null): boolean {
  return getModeConfig(mode)?.autoGraded ?? isQuizMode(mode);
}

/**
 * 可由老師「點進去手動批改/檢視」的模式（= reading / word_reading / rearrangement）。
 * 語意與 isAutoScoredMode 補集「不」相同，故獨立判定。
 */
export function isGradableMode(mode?: string | null): boolean {
  return getModeConfig(mode)?.gradable ?? false;
}
