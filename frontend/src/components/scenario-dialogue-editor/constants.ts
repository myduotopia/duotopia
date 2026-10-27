/**
 * 情境對話老師端（新增／編輯面板）共用常數 —— Issue #1146 從 `ScenarioDialoguePanel.tsx`
 * 搬出來，讓引導式對話、出題設定卡、題目清單共用同一份，不必互相 import 元件檔。
 */
import type { TranslationLanguageOption } from "@/components/shared/BatchTranslateSettings";

/** 情境對話一次最少 3 題、最多 10 題（#864；後端 utils/scenario_dialogue.py 同值） */
export const MIN_ITEMS = 3;
export const MAX_ITEMS = 10;

/** 出題設定卡的題數預設值（#1146：範圍 MIN_ITEMS~MAX_ITEMS） */
export const DEFAULT_GENERATE_COUNT = 5;

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/**
 * 時態＝時間 × 動貌，共 12 種；被動是「語態」，與時態正交，因此獨立成第三個下拉
 * （若併入時態清單會膨脹成 24 項）。時間與動貌兩者都選才組成 chip，避免半套條件。
 *
 * 存的是**穩定代碼**、顯示才走 i18n —— 老師切換介面語言不該改變存進資料庫、
 * 送去給 AI 評分的值。代碼與 `scenarioDialogue.tenseTimes.*` 等 i18n key 一一對應。
 */
export const TENSE_TIMES = ["present", "past", "future"] as const;
export const TENSE_ASPECTS = [
  "simple",
  "progressive",
  "perfect",
  "perfectProgressive",
] as const;
export const VOICES = ["active", "passive"] as const;

/** 與 ReadingAssessmentPanel 相同的輔助語言清單 */
export const TRANSLATION_LANGUAGES: TranslationLanguageOption[] = [
  { value: "chinese", label: "中文", code: "zh-TW" },
  { value: "japanese", label: "日本語", code: "ja" },
  { value: "korean", label: "한국어", code: "ko" },
  { value: "other", label: "Other", code: "" },
];
