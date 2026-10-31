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
  isDatasetDispatchable,
  listModesForDataset,
  DEFAULT_MODE_BY_DATASET,
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

  return contentTypes.every((type) => isContentTypeUsableForMode(mode, type));
}

/**
 * 單一內容能不能用在這個模式上（上面那條規則的單筆版本）。
 *
 * 切換模式時要把不相容的內容請出購物車，用的必須是同一條規則。原本那段清理寫成
 * 「模式是 word_* 就只留單字集」—— 手寫列舉，新增資料集時**不會有任何訊號**，
 * 而且它的語意其實是反過來的：不是「word 模式只收單字集」，是「每個模式只收它
 * `supportedDatasets` 裡的資料集」。
 */
export function isContentTypeUsableForMode(
  mode: PracticeMode,
  contentType: string | null | undefined,
): boolean {
  const dataset = contentTypeToDataset(contentType);
  // 未知型別：白名單語意，一律擋下
  if (dataset === null) return false;
  return listModesForDataset(dataset).includes(mode);
}

/**
 * 「帶著內容開啟派發對話框」時該用哪個練習模式；`null` = 推導不出來，沿用預設。
 *
 * ## 這是哪個 bug
 *
 * 派發對話框開啟時一律把 `practice_mode` reset 成寫死的 `word_selection`，而購物車
 * 在同一個 render 就已經裝進預選內容了。接著那段清理 effect 看到 word 模式，把
 * **非單字集的內容整批請出購物車** —— 老師從教材卡派發情境對話或例句集，內容在
 * 他看到畫面之前就已經不見了，而且沒有任何提示。
 *
 * 班級頁派發沒事，是因為那條路徑購物車一開始是空的：老師先選模式、再選教材，
 * 清理 effect 跑的時候模式已經對了。
 *
 * 所以初始模式不能寫死 —— 有預選內容時就從內容的資料集推導（查
 * `DEFAULT_MODE_BY_DATASET`，不另寫對照表）。
 *
 * 資料集目前不可派發（per-environment 旗標關著）時回 `null`：那種情況本來就該被
 * 前面的守衛擋下，這裡不要幫忙選一個派不出去的模式。
 */
export function initialModeForContentTypes(
  contentTypes: Array<string | null | undefined>,
): PracticeMode | null {
  if (contentTypes.length === 0) return null;

  const datasets = contentTypes.map(contentTypeToDataset);
  const [first] = datasets;
  if (first === null) return null;
  // 混型別（理論上進不來）：挑誰都是錯的，交給守衛擋
  if (!datasets.every((d) => d === first)) return null;
  if (!isDatasetDispatchable(first)) return null;

  return DEFAULT_MODE_BY_DATASET[first];
}
