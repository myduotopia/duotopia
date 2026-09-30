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
 * 挖空佔位符：一律單一格，不論答案是幾個字。
 * "cake" → "_"；"take pictures" → "_"
 *
 * 與後端 build_blank（#880 一字一格）刻意不同：那是為 word_cloze 的「打字作答」
 * 設計的，字數對打字者是合理提示。但單字選擇是四選一，顯示格數等於洩漏答案字數
 * （看到兩格就能排除所有單字選項），因此收合成一格。後端在 #860 的三個 payload
 * 也用 collapse_to_single_blank() 做同樣收合，兩邊結果一致。
 */
export function buildBlank(_matchedText: string): string {
  return "_";
}

/**
 * 句首大寫還原（Issue #1088，鏡射後端 normalize_cloze_case）：
 * "Told me" 作為選項應顯示 "told me" —— 原形 baseWord 小寫開頭而比對結果大寫開頭時，
 * 首字母改小寫；原形本身大寫開頭（專有名詞）則保留。
 */
export function isSentenceStart(sentence: string, start: number): boolean {
  if (start <= 0) return true;
  const before = sentence.slice(0, start).trimEnd();
  return before.length === 0 || /[.!?]$/.test(before);
}

/**
 * 只在「比對結果大寫開頭、原形小寫開頭、老師存的 cloze_answer 不是大寫開頭、
 * 且位於句首（index 0 或前面是 [.!?]＋空白）」時把首字母小寫；句中大寫（Paris）保留。
 */
export function normalizeClozeCase(
  matched: string,
  baseWord: string | null | undefined,
  sentence = "",
  start = 0,
  persistedAnswer?: string | null,
): string {
  if (!matched || !baseWord) return matched;
  const b = baseWord[0];
  const m = matched[0];
  const baseIsLower = b === b.toLowerCase() && b !== b.toUpperCase();
  const matchIsUpper = m !== m.toLowerCase();
  if (!baseIsLower || !matchIsUpper) return matched;
  const p = (persistedAnswer ?? "").trim()[0];
  if (p && p !== p.toLowerCase()) return matched;
  if (!isSentenceStart(sentence, start)) return matched;
  return m.toLowerCase() + matched.slice(1);
}

/**
 * 例句題型的選項／正解文字（Issue #1088，鏡射後端 answer_text_for_item 的開例句分支）：
 * 先在例句中找 cloze_answer、再找原形（含 apple→apples 前綴比對），取句中實際字形並
 * 做句首大寫還原；都找不到才退回 cloze_answer || text。
 */
export function clozeAnswerText(item: {
  text: string;
  cloze_answer?: string | null;
  example_sentence?: string | null;
}): string {
  const match =
    findClozeMatch(item.cloze_answer, item.example_sentence) ??
    findClozeMatch(item.text, item.example_sentence);
  if (match) {
    return normalizeClozeCase(
      match[2],
      item.text,
      item.example_sentence ?? "",
      match[0],
      item.cloze_answer,
    );
  }
  return item.cloze_answer || item.text;
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

/**
 * Issue #1088：老師改例句後同步挖空字（純函式，VocabularySetPanel.handleUpdateRow 用）。
 * 規則：原挖空字仍在新例句中 → 保留（採句中實際字形）；已對不上 → 取消，改由單字本身
 * 在句中找（含 apple→apples 前綴、片語不做前綴猜測），找不到留空由老師重選。
 */
export function reconcileClozeAnswer(
  row: { text?: string | null; cloze_answer?: string | null },
  newSentence: string | null | undefined,
): string {
  const keep = findClozeMatch(row.cloze_answer, newSentence);
  if (keep) return keep[2];
  const fromWord = findClozeMatch(row.text, newSentence);
  return fromWord ? fromWord[2] : "";
}
