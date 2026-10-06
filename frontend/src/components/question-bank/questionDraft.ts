/**
 * 題庫編輯面板的草稿型別與純函式——對外的唯一入口（Issue #1064 / #1082）。
 *
 * QuestionCard / QuestionSheet / QuestionUnitList / 測試一律從這裡匯入；實作分在：
 * - `draftCore.ts`：單題核心（`QuestionDraft` 型別、空白草稿、驗證、payload）。
 * - `groupDraft.ts`：題組（`GroupDraft`／`UnitDraft`、克漏字包裝、文字版、題組 payload）。
 * - `aiDraft.ts`：AI 作答／考點分析的輸入轉換與套用。
 * 本檔只留考卷擷取 → 單題草稿（`draftsFromExtracted`），其餘以 `export *` 轉出。
 * 依賴方向 groupDraft／aiDraft → draftCore，三者都不 import 本檔，沒有循環。
 *
 * 兩種草稿、一種「單元」：
 * - `QuestionDraft`：單題（目前只有選擇題）。每題自己帶：考點（必填）、年段、教材關聯。
 * - `GroupDraft`：題組（閱讀／克漏字…）：主圖文 layout + 多個小題 `QuestionDraft`。
 * - `UnitDraft`：sheet 右欄的一個單元 = 單題或題組；儲存逐單元送出，單題走
 *   createQuestion／updateQuestion，題組走 createQuestionGroup（整組一個交易）。
 *
 * 左側批次設定只是「覆寫所有單元」的捷徑，儲存時仍是逐單元送出各自的值。
 * 驗證函式只回傳 i18n key（不呼叫 t），由呼叫端翻譯。
 *
 * 圖片題組的對話文稿（#1083）：`GroupDraft.segments` 由 AI 擷取、老師不可修改，
 * 有值時文字版由它組成（dialogueTranscript.ts），建立／更新都會帶給後端。
 * `GroupDraft.passage_view` 是純 UI 狀態（主圖文分頁），toCreate／toUpdateGroupInput 不送。
 */

import type { MagicPasteMcItem } from "@/components/shared/MagicPasteInput";
import {
  BASE_OPTION_SLOTS,
  type BatchDefaults,
  MAX_OPTION_SLOTS,
  type OptionDraft,
  type QuestionDraft,
  emptyDraft,
} from "./draftCore";

export * from "./draftCore";
export * from "./groupDraft";
export * from "./aiDraft";

/**
 * 擷取結果裡已裁好並上傳的圖片 URL（#1084）。
 * 外層索引對齊 `items`，`optionUrls` 內層對齊該題的 `options`；沒有圖的位置為 null。
 */
export interface ExtractedQuestionImages {
  stemUrls?: (string | null)[];
  optionUrls?: (string | null)[][];
}

/** 考卷擷取結果 → 題目卡（帶左側批次值；圖上有標的答案直接勾；題幹圖／選項圖已上傳好） */
export function draftsFromExtracted(
  items: MagicPasteMcItem[],
  defaults: BatchDefaults,
  images: ExtractedQuestionImages = {},
): QuestionDraft[] {
  return items.map((it, qi) => {
    const d = emptyDraft(defaults);
    const count = Math.min(it.options.length, MAX_OPTION_SLOTS);
    const slots = Math.max(BASE_OPTION_SLOTS, count);
    const optionUrls = images.optionUrls?.[qi] ?? [];
    const options: OptionDraft[] = Array.from({ length: slots }, (_, i) => ({
      text: it.options[i] ?? "",
      is_correct: it.correct_indexes.includes(i) && i < count,
      // 圖片選項：text 可能是空字串，靠圖認（後端允許「字或圖至少一個」）
      image_url: i < count ? (optionUrls[i] ?? null) : null,
    }));
    return {
      ...d,
      stem: it.stem,
      image_url: images.stemUrls?.[qi] ?? null,
      explanation: it.explanation ?? "",
      options,
      extraOptionsShown: slots > BASE_OPTION_SLOTS,
      allow_multiple: it.correct_indexes.length > 1,
    };
  });
}
