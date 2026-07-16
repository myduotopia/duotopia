/**
 * cloze — 前端把例句中的目標單字挖空（Issue #860 單字選擇例句題共用）。
 *
 * 與後端 utils/cloze.py 的挖空語意一致：找到答案在句中第一次出現的位置（大小寫不敏感），
 * 換成固定長度底線 "_____"。找不到時原句照回（不硬塞底線，避免顯示怪異）。
 * 底線交給 <ClozeBlankText> 渲染成圓角色塊。
 */
export const CLOZE_BLANK = "_____";

export function buildBlankedSentence(
  sentence: string | null | undefined,
  answer: string | null | undefined,
): string {
  if (!sentence) return "";
  if (!answer) return sentence;
  const idx = sentence.toLowerCase().indexOf(answer.toLowerCase());
  if (idx < 0) return sentence;
  return `${sentence.slice(0, idx)}${CLOZE_BLANK}${sentence.slice(
    idx + answer.length,
  )}`;
}
