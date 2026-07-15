/**
 * #880：克漏字挖空字串產生器（前端版，需與後端 `backend/utils/cloze.py`
 * 的 `build_blank()` 保持一致）。
 *
 * 一個單字一個底線，讓挖空格數等於答案的「單字數量」（不是字母數）；片語答案
 * 每字一格、字間留空（"two pieces of cake" → "_ _ _ _"，四格），由 ClozeBlankText
 * 每個底線串渲染成一個方格。
 *
 * 後端已直接吐出 blanked_sentence 的模式（word_cloze）不需要用到這裡；
 * 這支給「前端自己組挖空句」的畫面用：word_cloze_quiz（小考）與老師的
 * WordClozeContextPreview。
 */
export function buildClozeBlank(matchedText: string): string {
  const words = matchedText.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "_";
  return words.map(() => "_").join(" ");
}
