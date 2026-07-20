/**
 * cloze — 前端把例句中的目標單字挖空（Issue #860 單字選擇例句題共用）。
 *
 * 語意必須與後端 `backend/utils/cloze.py` 一致，否則同一筆資料在老師預覽（前端自行
 * 挖空）與學生作答（後端已算好）會長不一樣：
 *   - 先做「整字」比對（支援片語，如 "take pictures"）
 *   - 單字答案再試前綴比對（apple → apples、watch → watching）；片語不做前綴
 *   - 挖空以「每個字一個底線」呈現（build_blank），片語 "two pieces" → "_ _"
 *     （<ClozeBlankText> 每段連續底線渲染成一個色塊，故一字一格、不洩漏字母數）
 *
 * 找不到時回傳原句（不硬塞底線）。呼叫端應優先使用後端給的 blanked_sentence，
 * 這裡主要服務「派發預覽」等只有原始教材、沒有後端算好結果的路徑。
 */

/** 逃脫正則特殊字元（答案可能含 . ' - 等）。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 挖空佔位符：一個字一個底線（鏡射後端 build_blank）。
 * "cake" → "_"；"two pieces of cake" → "_ _ _ _"
 */
export function buildBlank(matchedText: string): string {
  const words = matchedText.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "_";
  return words.map(() => "_").join(" ");
}

/**
 * 在句中找出答案（或其變化形）的位置，鏡射後端 find_cloze_match。
 * 回傳 [start, end, matchedText]，找不到回 null。
 */
export function findClozeMatch(
  answer: string | null | undefined,
  sentence: string | null | undefined,
): [number, number, string] | null {
  if (!answer || !sentence) return null;
  const needle = answer.trim();
  if (!needle) return null;

  const escaped = escapeRegExp(needle);

  // 1. 整字比對（支援多字片語）
  const exact = new RegExp(`\\b${escaped}\\b`, "i").exec(sentence);
  if (exact) return [exact.index, exact.index + exact[0].length, exact[0]];

  // 2. 前綴比對只對單字答案有意義（apple→apples）；片語跳過
  if (!/\s/.test(needle)) {
    const prefix = new RegExp(`\\b${escaped}\\w*\\b`, "i").exec(sentence);
    if (prefix)
      return [prefix.index, prefix.index + prefix[0].length, prefix[0]];
  }

  return null;
}

/**
 * 把例句挖空。依序嘗試 `answer`（老師存的 cloze_answer）→ `fallbackWord`（單字本身），
 * 鏡射後端 extract_cloze_for_item 的 fallback 鏈 —— 教材沒設 cloze_answer 時（如
 * 範例/示範教材、舊資料）仍要挖得出來，否則會整句連答案一起顯示。
 *
 * **Fail closed**：兩者都比不到時回空字串，而不是原句 —— 原句幾乎必然含答案，
 * 退回原句等於把答案直接印在題目上。呼叫端拿到空字串應退回一般題型呈現。
 */
export function buildBlankedSentence(
  sentence: string | null | undefined,
  answer: string | null | undefined,
  fallbackWord?: string | null,
): string {
  if (!sentence) return "";
  const match =
    findClozeMatch(answer, sentence) ?? findClozeMatch(fallbackWord, sentence);
  if (!match) return "";
  const [start, end, matched] = match;
  return sentence.slice(0, start) + buildBlank(matched) + sentence.slice(end);
}
