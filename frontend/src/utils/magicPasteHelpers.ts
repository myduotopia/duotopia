/**
 * 魔術貼上插入時用到的純函式 helper（issue #891）。
 * 抽出成獨立模組方便單元測試（review PR #943 round-3 #4）。
 */

export type DetectedWordLang = "chinese" | "english" | "japanese" | "korean";

/**
 * 偵測一段文字主要是哪種語言，用來決定擷取到的翻譯要放進哪個欄位。
 * 韓文 Hangul / 日文假名 / 中文漢字 / 英文；無內容回 ""，其餘 fallback 中文。
 */
export function detectLang(s: string): DetectedWordLang | "" {
  const v = (s || "").trim();
  if (!v) return "";
  if (/[가-힣]/.test(v)) return "korean";
  if (/[぀-ヿ]/.test(v)) return "japanese";
  if (/[一-鿿]/.test(v)) return "chinese";
  if (/[A-Za-z]/.test(v)) return "english";
  return "chinese";
}

/**
 * 例句是否包含該單字或其變化形。
 * - 片語（含空格）：子字串比對。
 * - 單字：整字相符；或「前綴關係且後綴短」（cats / running / stopped…，
 *   後綴 ≤ 4 字，排除 cat→category 這種只是同開頭的不同字）；或共同字首 ≥ 4
 *   （happy→happier、study→studies…）。
 */
export function exampleContainsWord(word: string, example: string): boolean {
  const w = (word || "").trim().toLowerCase();
  const s = (example || "").toLowerCase();
  if (!w || !s) return false;
  if (w.includes(" ")) return s.includes(w);
  const tokens = s.match(/[a-z]+(?:['-][a-z]+)*/g) || [];
  return tokens.some((tk) => {
    if (tk === w) return true;
    if (tk.startsWith(w) || w.startsWith(tk)) {
      // 前綴關係：較短者 ≥ 3 且長度差 ≤ 4（inflection 後綴多為 s/ed/ing/ning…），
      // 排除 cat→category（差 5）這類只是剛好同開頭的不同字。
      const shorter = Math.min(tk.length, w.length);
      const diff = Math.abs(tk.length - w.length);
      return shorter >= 3 && diff <= 4;
    }
    let common = 0;
    const n = Math.min(tk.length, w.length);
    while (common < n && tk[common] === w[common]) common++;
    return common >= 4;
  });
}

/**
 * 克漏字答案：把單字設為例句中的挖空詞（整字比對、保留例句原始大小寫）。
 * 單字沒完整出現在例句中就回 ""（例如變化形，交給老師手動挑）。
 */
export function deriveClozeAnswer(word: string, example: string): string {
  const w = (word || "").trim();
  if (!w || !example) return "";
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = example.match(new RegExp(`\\b${escaped}\\b`, "i"));
  return m ? m[0] : "";
}
