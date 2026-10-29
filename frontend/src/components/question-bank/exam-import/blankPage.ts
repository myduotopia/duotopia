/**
 * 空白頁判斷（#1112 C3，瀏覽器端，保守門檻：寧可多送 AI，也不要把有字的頁略過）。
 *
 * 算法（設計文件 docs/design/question-bank-exam-import.md「空白頁」同步）：
 * 1. 用送出前的整頁圖（PDF 約 2000px 長邊、照片最長 2400px，**不縮小取樣**——縮小會把細字糊成
 *    淺灰而漏算）逐點算亮度 `0.299R + 0.587G + 0.114B`。
 * 2. 亮度 < `DARK_LUMINANCE`（140）算「墨跡」；淺灰的掃描雜訊、陰影漸層不算。
 * 3. 墨跡點數 / 總點數 < `BLANK_INK_RATIO`（0.01%）才算空白。以 2000px 寬的 A4 估：只有頁碼
 *    （約 0.004%）算空白；一個 12pt 的英文單字（約 0.0125%）就不算空白，照樣送 AI。
 *    整片深色（照片背景、掃描黑邊）一定不算空白。
 * 判斷錯了老師可以在進度畫面看縮圖，按「仍要送出這一頁」。
 */

export const DARK_LUMINANCE = 140;
export const BLANK_INK_RATIO = 0.0001;

/** 墨跡比例（0–1）。`data` 是 RGBA（canvas `getImageData().data`）。 */
export function inkRatio(data: Uint8ClampedArray): number {
  const pixels = Math.floor(data.length / 4);
  if (pixels === 0) return 0;
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue; // 透明（PDF 沒畫到的地方）當白色
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < DARK_LUMINANCE) ink += 1;
  }
  return ink / pixels;
}

export function isBlankPixels(data: Uint8ClampedArray): boolean {
  return inkRatio(data) < BLANK_INK_RATIO;
}
