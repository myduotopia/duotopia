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
 * - #854 Stage 6：把 label/desc 的 i18n 收斂到單一 `practiceMode.<mode>.{label,desc}`
 *   命名空間（取代寄生在 `classroomDetail.contentTypes` 的 UPPER enum label，以及散落的
 *   `studentAssignmentList.practiceMode.*` / `analysisDialog.practiceMode.*`）；scoreCategory
 *   文案統一 `practiceMode.scoreCategory.*`。registry `labelKey`/`descKey` 指新 key，舊 key
 *   暫留標 `_deprecated`、零引用後另 PR 刪。只做 zh-TW/en（ja/ko 本就 fallback 到 zh-TW）。
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
  | "tug_of_war"
  | "scenario_dialogue";

/**
 * 可派發的資料集維度。
 *
 * `scenario_dialogue` 是 #1031 加的第三種（#864 當初預告的「口說集」）—— 它的題目是
 * 開放式口說問題，與例句／單字兩種資料集的出題方式都不同，所以自成一類而不是硬塞進
 * 既有兩種。
 */
export type PracticeDataset =
  | "example_sentences"
  | "vocabulary_set"
  | "scenario_dialogue";

/**
 * 成績類別「規則」——鏡射後端 `resolve_score_category`，存規則不存定值，
 * 以免前端硬寫的定值與後端的 play_audio／作答方式分流邏輯漂移。
 * `driverKey` 指出由哪個 setting 驅動，Panel 才能把 score 提示畫在對應控制項旁。
 */
export type ScoreCategoryRule =
  /** 永遠固定，不受 play_audio／作答方式影響（如 reading/word_reading→speaking）。 */
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
  | "is_live_quiz"
  | "shuffle_questions"
  | "show_answer"
  | "play_audio"
  | "target_proficiency"
  | "show_translation"
  | "show_word"
  | "show_image"
  | "show_option_images"
  | "show_example_sentence";

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
  /** 按鈕前綴 emoji（沿用現有外觀，如 🔊/🔇/👁️）。 */
  emoji?: string;
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
  | {
      kind: "select";
      key: SettingKey;
      options: SelectOption[];
      /** Issue #835: 依另一個 setting 的值隱藏此控制項（如 is_live_quiz 開啟時隱藏整卷限時）。 */
      hideWhen?: { key: SettingKey; equals: SettingValue };
    }
  | { kind: "number"; key: SettingKey; min: number; max: number; step: number }
  | {
      kind: "ranked";
      key: SettingKey;
      options: SegmentedOption[];
      min: number;
    };

/** 單一作業類型的完整 metadata（單一真相來源）。 */
export interface ModeConfig {
  // ---- 顯示（backs practiceModeLabelKey / DescKey / BadgeClass / Icon / CrayonBg）----
  /** 模式名稱 i18n key（`practiceMode.<mode>.label`）。 */
  labelKey: string;
  /** 模式描述 i18n key（`practiceMode.<mode>.desc`）。 */
  descKey: string;
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
// Issue #860 / #967: 「顯示例句（答案挖空）」開啟時，挖空例句「就是題目」——
// 題目區不再顯示單字／翻譯，選項固定英文，若同時開播放音檔則改播例句音檔。
// 因為例句取代了圖片題目，與「選項以圖片呈現」(show_option_images) 互斥（二擇一）。
const TOGGLE_SHOW_EXAMPLE_SENTENCE: SettingSpec = {
  kind: "toggle",
  key: "show_example_sentence",
  excludes: ["show_option_images"], // Issue #967 互斥
};
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
  excludes: ["show_image", "show_example_sentence"], // #631 圖片題互斥 / #967 例句題互斥
};
const NUMBER_TARGET_PROFICIENCY: SettingSpec = {
  kind: "number",
  key: "target_proficiency",
  min: 50,
  max: 100,
  step: 5,
};
// 每個模式的單題時間選單選項不同（依作答方式調整）：
/** 例句重組：0(不限)/10/20/30/40，預設 30。 */
const SELECT_TIME_REARRANGEMENT: SettingSpec = {
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
/** 例句朗讀：10/20/30（無不限時），預設 20。 */
const SELECT_TIME_READING: SettingSpec = {
  kind: "select",
  key: "time_limit_per_question",
  options: [
    { value: 10, labelKey: `${PM}.seconds` },
    { value: 20, labelKey: `${PM}.seconds` },
    { value: 30, labelKey: `${PM}.seconds` },
  ],
};
/** 單字選擇：0(不限)/10/20/30，預設 10。 */
const SELECT_TIME_SELECTION: SettingSpec = {
  kind: "select",
  key: "time_limit_per_question",
  options: [
    { value: 0, labelKey: `${PM}.unlimited` },
    { value: 10, labelKey: `${PM}.seconds` },
    { value: 20, labelKey: `${PM}.seconds` },
    { value: 30, labelKey: `${PM}.seconds` },
  ],
};
/** 單字拼寫 / 克漏字（打字作答，給較長時間）：0(不限)/20/30/40，預設 不限時 0。 */
const SELECT_TIME_SPELLING_CLOZE: SettingSpec = {
  kind: "select",
  key: "time_limit_per_question",
  options: [
    { value: 0, labelKey: `${PM}.unlimited` },
    { value: 20, labelKey: `${PM}.seconds` },
    { value: 30, labelKey: `${PM}.seconds` },
    { value: 40, labelKey: `${PM}.seconds` },
  ],
};
const SELECT_QUIZ_TIME: SettingSpec = {
  kind: "select",
  key: "quiz_time_limit_seconds",
  // Issue #835: 老師主控 live 考試無倒數，由老師收卷結束 → 開啟時隱藏整卷限時。
  hideWhen: { key: "is_live_quiz", equals: true },
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
/** Issue #835: 老師主控 live 考試模式（同步開始/收卷，無倒數）—— 只對三種小考顯示。 */
const TOGGLE_LIVE_QUIZ: SettingSpec = { kind: "toggle", key: "is_live_quiz" };
/** 例句重組「播放音檔」雙按鈕（score 提示由規則推導）。 */
const SEGMENTED_PLAY_AUDIO: SettingSpec = {
  kind: "segmented",
  key: "play_audio",
  scoreHint: true,
  options: [
    { value: true, emoji: "🔊", labelKey: `${PM}.playAudioYes` },
    { value: false, emoji: "🔇", labelKey: `${PM}.playAudioNo` },
  ],
};
/** 單字選擇家族「題目呈現方式」：顯示單字 ↔ 播放音檔（連動 play_audio；按鈕底下顯示描述而非 score）。 */
const SEGMENTED_DISPLAY_SELECTION: SettingSpec = {
  kind: "segmented",
  key: "show_word",
  options: [
    {
      value: true,
      emoji: "👁️",
      labelKey: `${PM}.displayWord`,
      descKey: `${PM}.displayWordDesc`,
      patch: { play_audio: false },
    },
    {
      value: false,
      emoji: "🔊",
      labelKey: `${PM}.playAudioWord`,
      descKey: `${PM}.playAudioWordDesc`,
      patch: { play_audio: true },
    },
  ],
};
/** 拼寫/克漏字家族「題目呈現方式」：顯示翻譯 ↔ 播放音檔（連動 play_audio；播音強制 show_answer；按鈕底下顯示描述而非 score）。 */
const SEGMENTED_DISPLAY_TEXT: SettingSpec = {
  kind: "segmented",
  key: "show_translation",
  options: [
    {
      value: true,
      emoji: "👁️",
      labelKey: `${PM}.displayTranslation`,
      descKey: `${PM}.displayTranslationDesc`,
      patch: { play_audio: false },
    },
    {
      value: false,
      emoji: "🔊",
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
    labelKey: "practiceMode.reading.label",
    descKey: "practiceMode.reading.desc",
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
    // #880: 例句朗讀補「顯示句子中文翻譯」開關（時間選單 10/20/30，預設 20）
    settings: [SELECT_TIME_READING, TOGGLE_SHUFFLE, TOGGLE_SHOW_TRANSLATION],
    defaults: { time_limit_per_question: 20 },
    chipTitleKey: `${PM}.reading`,
    chipDescKey: `${PM}.readingDesc`,
    chipSelectedClass: "border-orange-500 bg-orange-50 text-orange-700",
    iconColorClass: "text-orange-600",
  },
  scenario_dialogue: {
    labelKey: "practiceMode.scenario_dialogue.label",
    descKey: "practiceMode.scenario_dialogue.desc",
    badgeClass:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    icon: Mic,
    crayonBg:
      "crayon-texture bg-gradient-to-b from-purple-100 to-purple-200 text-purple-600",
    isQuiz: false,
    isMemoryBased: false,
    baseMode: "scenario_dialogue",
    // 只吃情境對話自己的資料集 —— 題目是開放式口說問題，例句／單字集沒有這種資料
    supportedDatasets: ["scenario_dialogue"],
    // 學生是開口錄音作答，與 reading / word_reading 同屬口說，不受 play_audio 影響。
    // 唯一判定在後端 utils/score_category.py，這裡只是鏡射（CLAUDE.md 規則 6）。
    scoreCategory: { kind: "static", category: "speaking" },
    // 這兩個旗標維持 false，不是漏改：
    //
    // needsAiGrading 的語意是「需 AI **發音**批改」（Azure 發音評測，學生作答時觸發、
    // 要有 reference_text 才比得出「唸得多準」）。情境對話是開放式回答，沒有正解可比，
    // 打開只會把所有與範例不同的回答判成低分。
    //
    // #1035 補上的 AI 評分是**另一條路徑**：老師在批改頁按下才跑，音檔直接交給 Gemini
    // 出逐字稿與語言特徵分數，而且只產生建議、不定案。它不由這個旗標控制，額度也由後端
    // 每題上限管（services/analysis_quota.py）。
    needsAiGrading: false,
    burnsTokens: false,
    autoGraded: false,
    gradable: true,
    settings: [SELECT_TIME_READING, TOGGLE_SHOW_TRANSLATION],
    defaults: { time_limit_per_question: 30 },
    chipTitleKey: `${PM}.scenario_dialogue`,
    chipDescKey: `${PM}.scenario_dialogueDesc`,
    chipSelectedClass: "border-purple-500 bg-purple-50 text-purple-700",
    iconColorClass: "text-purple-600",
  },
  rearrangement: {
    labelKey: "practiceMode.rearrangement.label",
    descKey: "practiceMode.rearrangement.desc",
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
      SELECT_TIME_REARRANGEMENT,
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
    labelKey: "practiceMode.word_reading.label",
    descKey: "practiceMode.word_reading.desc",
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
    labelKey: "practiceMode.word_selection.label",
    descKey: "practiceMode.word_selection.desc",
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
      SELECT_TIME_SELECTION,
      TOGGLE_SHOW_ANSWER,
      TOGGLE_SHOW_EXAMPLE_SENTENCE,
      TOGGLE_SHOW_IMAGE,
      TOGGLE_SHOW_OPTION_IMAGES,
    ],
    defaults: { time_limit_per_question: 10 },
    chipTitleKey: `${PM}.wordSelection`,
    chipDescKey: `${PM}.wordSelectionDesc`,
    chipSelectedClass: "border-emerald-500 bg-emerald-50 text-emerald-700",
    iconColorClass: "text-emerald-600",
  },
  word_selection_quiz: {
    labelKey: "practiceMode.word_selection_quiz.label",
    descKey: "practiceMode.word_selection_quiz.desc",
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
    // #878：移除「顯示答案」—— 小考最終整卷顯示答案，此單題開關無作用
    settings: [
      SEGMENTED_DISPLAY_SELECTION,
      TOGGLE_LIVE_QUIZ,
      SELECT_QUIZ_TIME,
      TOGGLE_SHOW_EXAMPLE_SENTENCE,
      TOGGLE_SHOW_IMAGE,
      TOGGLE_SHOW_OPTION_IMAGES,
    ],
    defaults: { time_limit_per_question: 0 },
    chipTitleKey: `${PM}.wordSelectionQuiz`,
    chipDescKey: `${PM}.wordSelectionQuizDesc`,
    chipSelectedClass: "border-emerald-500 bg-emerald-50 text-emerald-700",
    iconColorClass: "text-emerald-600",
  },
  word_spelling: {
    labelKey: "practiceMode.word_spelling.label",
    descKey: "practiceMode.word_spelling.desc",
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
      SELECT_TIME_SPELLING_CLOZE,
      TOGGLE_SHOW_ANSWER, // play_audio 時鎖定 = runtime，由 Panel context 處理
      TOGGLE_SHOW_IMAGE,
    ],
    defaults: {
      time_limit_per_question: 0,
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
    labelKey: "practiceMode.word_spelling_quiz.label",
    descKey: "practiceMode.word_spelling_quiz.desc",
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
      TOGGLE_LIVE_QUIZ,
      SELECT_QUIZ_TIME,
      // #878 修正：小考整卷結束才揭示答案，移除無作用的單題 show_answer 開關（與 word_selection_quiz 一致）
      TOGGLE_SHOW_IMAGE,
    ],
    defaults: {
      time_limit_per_question: 0,
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
    labelKey: "practiceMode.word_cloze.label",
    descKey: "practiceMode.word_cloze.desc",
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
    // #878：移除「顯示答案」—— 克漏字最終整卷顯示答案，此單題開關無作用
    settings: [
      NUMBER_TARGET_PROFICIENCY,
      SEGMENTED_DISPLAY_TEXT,
      SELECT_TIME_SPELLING_CLOZE,
      TOGGLE_SHOW_ANSWER, // #878 修正：克漏字艾賓浩斯答錯時揭示正解；play_audio 時鎖定由 Panel runtime 處理
      TOGGLE_SHOW_IMAGE,
    ],
    defaults: {
      time_limit_per_question: 0,
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
    labelKey: "practiceMode.word_cloze_quiz.label",
    descKey: "practiceMode.word_cloze_quiz.desc",
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
    // #878：移除「顯示答案」—— 小考最終整卷顯示答案，此單題開關無作用
    settings: [
      SEGMENTED_DISPLAY_TEXT,
      TOGGLE_LIVE_QUIZ,
      SELECT_QUIZ_TIME,
      TOGGLE_SHOW_IMAGE,
    ],
    defaults: {
      time_limit_per_question: 0,
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
    labelKey: "practiceMode.tug_of_war.label",
    descKey: "practiceMode.tug_of_war.desc",
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
  "scenario_dialogue",
];

/**
 * 每個資料集的預設練習模式（老師還沒選模式時用）。
 *
 * 寫成 `Record<PracticeDataset, ...>` 是刻意的：新增資料集時 TypeScript 會強制在這裡
 * 補上一筆。原本 AssignmentDialog 是用「是不是單字集」的二分法決定預設模式，加入
 * 情境對話之後就會落到 else 分支選到 `rearrangement` —— 一個它根本不支援的模式
 * （PR #1034 review round 3）。
 */
export const DEFAULT_MODE_BY_DATASET: Record<PracticeDataset, PracticeMode> = {
  example_sentences: "rearrangement",
  vocabulary_set: "word_reading",
  scenario_dialogue: "scenario_dialogue",
};

/**
 * 每個資料集在提示訊息裡的顯示名稱 key。
 *
 * 同上，窮舉以免新增資料集時訊息說錯 —— 例如購物車裡是情境對話，卻提示「只能選擇
 * 單字集」。
 */
export const DATASET_LABEL_KEY: Record<PracticeDataset, string> = {
  example_sentences: "dialogs.assignmentDialog.contentTypes.EXAMPLE_SENTENCES",
  vocabulary_set: "dialogs.assignmentDialog.contentTypes.VOCABULARY_SET",
  scenario_dialogue: "dialogs.assignmentDialog.contentTypes.SCENARIO_DIALOGUE",
};

/**
 * 這個模式吃得下哪些資料集（回傳 i18n key）。
 *
 * 給「模式與型別不合」的提示用（#1033）。那句提示原本寫死「只能選擇單字集」——
 * 在它還是死碼時看不出問題，一旦讓它真的出得來就會說謊：選了情境對話模式時該說
 * 情境對話，選了朗讀模式去點情境對話時該說例句集與單字集。
 *
 * 名單直接取自 registry 的 supportedDatasets，與畫面上實際擋不擋得住同一個來源 ——
 * 這正是 #1034 學到的：三個資料集之後，任何二分法的猜測都會在某個組合上講錯。
 */
export function datasetLabelKeysForMode(mode: PracticeMode): string[] {
  return PRACTICE_MODE_REGISTRY[mode].supportedDatasets.map(
    (dataset) => DATASET_LABEL_KEY[dataset],
  );
}

/**
 * 每個資料集目前能不能派發 —— 「可派發」的**唯一開關**（Issue #1052）。
 *
 * #1052 的根因：可派發性原本分散兩處 —— chip 列看 `ASSIGNABLE_MODE_ORDER`（沒有任何
 * 開關），教材卡看 `isAssignableContentType`（接 feature flag）。#1030 讓空購物車時
 * chip 列整排消失，碰巧遮住了「開發中的情境對話按鈕沒被擋」這件事；補回 chip 列就會
 * 露出來。
 *
 * 規範：**新增或暫停一個活動的派發，只改這張表**。chip 列（`listModesForDataset` /
 * `listAllDispatchableModes`）與教材卡（`isAssignableContentType`）都由此推導，
 * 不要在元件或其他 helper 另外加判斷。寫成 `Record` 是為了新增資料集時被 TypeScript
 * 強制在這裡明確表態。
 *
 * 注意：這只管「派發」。建立教材入口由 `ENABLE_SCENARIO_DIALOGUE` 控制；既有作業的
 * 顯示／批改仍查 `PRACTICE_MODE_REGISTRY`，不受影響。
 */
export const DATASET_DISPATCH_STATUS: Record<
  PracticeDataset,
  "released" | "in_development"
> = {
  example_sentences: "released",
  vocabulary_set: "released",
  scenario_dialogue: "in_development",
};

export function isDatasetDispatchable(dataset: PracticeDataset): boolean {
  return DATASET_DISPATCH_STATUS[dataset] === "released";
}

/** 模式吃的資料集全部開放，才算可派發。 */
function isModeDispatchable(mode: PracticeMode): boolean {
  return PRACTICE_MODE_REGISTRY[mode].supportedDatasets.every(
    isDatasetDispatchable,
  );
}

/** 依資料集回傳可派發的模式（chip 列），重現 AssignmentDialog 既有過濾：例句集只給非 word_ 模式。 */
export function listModesForDataset(dataset: PracticeDataset): PracticeMode[] {
  return ASSIGNABLE_MODE_ORDER.filter(
    (m) =>
      isModeDispatchable(m) &&
      PRACTICE_MODE_REGISTRY[m].supportedDatasets.includes(dataset),
  );
}

/**
 * 全部可派發的模式（chip 順序）。給「先選方式、再選教材」的路徑（班級頁派發，
 * 購物車還是空的）用 —— #1030 讓空車時不列模式，那條路徑就沒有按鈕可按（#1052）。
 */
export function listAllDispatchableModes(): PracticeMode[] {
  return ASSIGNABLE_MODE_ORDER.filter(isModeDispatchable);
}

/** content.type（大寫 enum 或舊小寫）對應到 PracticeDataset；未知回 null。 */
export function contentTypeToDataset(
  type?: string | null,
): PracticeDataset | null {
  const t = (type ?? "").toUpperCase();
  if (["READING_ASSESSMENT", "EXAMPLE_SENTENCES"].includes(t))
    return "example_sentences";
  if (["SENTENCE_MAKING", "VOCABULARY_SET"].includes(t))
    return "vocabulary_set";
  // Issue #1031: 情境對話自成一類，不再落到 null（#1030 之前是落到單字集）
  if (t === "SCENARIO_DIALOGUE") return "scenario_dialogue";
  return null;
}

/**
 * 即刻練習練習畫面可切換的模式 chip 列。與派發 sheet 同源（`listModesForDataset`）以
 * 保持 chip 名稱/順序一致，另在單字集補上 `tug_of_war`（listModesForDataset 不含它，
 * 因為它不經 AssignmentDialog 派發，但即刻練習要提供）。
 */
export function instantPracticeModesForContentType(
  type?: string | null,
): PracticeMode[] {
  const dataset = contentTypeToDataset(type);
  if (!dataset) return [];
  const modes = listModesForDataset(dataset);
  return dataset === "vocabulary_set" ? [...modes, "tug_of_war"] : modes;
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
 * 回傳該 practice_mode 的名稱 i18n key（`practiceMode.<mode>.label`）。
 * 未知模式回傳空字串，讓呼叫端自行決定 fallback。
 */
export function practiceModeLabelKey(mode?: string | null): string {
  return getModeConfig(mode)?.labelKey ?? "";
}

/**
 * 回傳該 practice_mode 的描述 i18n key（`practiceMode.<mode>.desc`）。
 * 未知模式回傳空字串，讓呼叫端自行決定 fallback。
 */
export function practiceModeDescKey(mode?: string | null): string {
  return getModeConfig(mode)?.descKey ?? "";
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
  /** i18n key（`practiceMode.<mode>.label`） */
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
