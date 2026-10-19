/**
 * 「這個練習模式能不能用在這些內容上」——派發流程的最後一道守衛。
 *
 * ## 為什麼需要這一道
 *
 * 夥伴在 staging 回報：情境對話的教材按派發，練習模式那一步會出現單字選擇等模式。
 * 追下去發現比「清單顯示錯」嚴重得多 —— **可以真的派出一份學生打不開的作業**：
 *
 * 1. 教材卡／樹狀圖按派發時**不檢查可派發性**，內容照樣進購物車；
 * 2. 有預選內容時，「選擇內容」那一步**被整個跳過**（`hasPreSelectedContents &&
 *    needsClassroomStep`）—— 而 #1030／#1033 的反灰守衛就住在那一步；
 * 3. 模式清單 `listModesForDataset("scenario_dialogue")` 回 `[]`（#1052 標為開發中），
 *    但 `formData.practice_mode` 仍停在對話框開啟時的預設 `word_selection`；
 * 4. 第 1 步的 `canProceed()` 只檢查「有沒有選模式」→ 放行；
 * 5. 後端 `_collect_contents_missing_examples` 對非單字集型別直接 `continue` → 不驗。
 *
 * 於是情境對話內容被派成「單字選擇」作業，學生端拿到一個不認得的資料形狀。
 *
 * 前面那幾道（教材卡反灰、選內容那步反灰）是**讓老師看得懂**；這一道是
 * **結構性的**：只要選中的模式不在該內容實際可用的清單裡，就不準往下走。
 * 任何新的入口或被跳過的步驟都繞不過它。
 *
 * ## 規則只有一條來源
 *
 * 可用模式一律查 `listModesForDataset`（它背後是 `DATASET_DISPATCH_STATUS`，
 * #1052 定的唯一開關）。這裡**不列舉任何型別** —— 日後新增資料集或把情境對話改成
 * 開放，都不必回來改這個函式。
 */

import {
  contentTypeToDataset,
  listModesForDataset,
  type PracticeMode,
} from "./practiceMode";

/**
 * `mode` 能不能用在 `contentTypes` 這些內容上。
 *
 * `contentTypes` 空陣列代表購物車還沒有東西（「先選方式、再選教材」的班級頁路徑）——
 * 此時不介入，由「選擇內容」那一步負責擋（它會把不相容的卡片反灰）。
 */
export function canUseModeForContentTypes(
  mode: PracticeMode | "" | null | undefined,
  contentTypes: Array<string | null | undefined>,
): boolean {
  if (!mode) return false;
  if (contentTypes.length === 0) return true;

  return contentTypes.every((type) => {
    const dataset = contentTypeToDataset(type);
    // 未知型別：白名單語意，一律擋下
    if (dataset === null) return false;
    return listModesForDataset(dataset).includes(mode);
  });
}
