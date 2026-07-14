/**
 * #880：克漏字挖空字串產生器（前端版，需與後端 `backend/utils/cloze.py`
 * 的 `build_blank()` 保持一致）。
 *
 * 一個字母一個底線，讓挖空數量等於答案字母數；多字答案每字一組、字間留空
 * （"two pieces of cake" → "___ ______ __ ____"），由 ClozeBlankText 渲染成
 * 一組一組的方格。
 *
 * 後端已直接吐出 blanked_sentence 的模式（word_cloze）不需要用到這裡；
 * 這支給「前端自己組挖空句」的畫面用：word_cloze_quiz（小考）與老師的
 * WordClozeContextPreview。
 */
export function buildClozeBlank(matchedText: string): string {
  const words = matchedText.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "_____";
  return words.map((word) => "_".repeat(word.length)).join(" ");
}
