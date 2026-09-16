/**
 * optionLabels — 選擇題選項標號（A/B/C/D）單一來源
 *
 * #1045：學生作答、檢討、老師預覽、批改頁、列印與 tug-of-war 鍵盤提示共用，
 * 確保各處標號順序一致（index 0 → "A"）。
 */
export const OPTION_LABELS = ["A", "B", "C", "D"] as const;

/** 取第 index 個選項的標號；超出 A-D 範圍回 undefined（呼叫端不顯示角標）。 */
export function optionLabelAt(index: number): string | undefined {
  return OPTION_LABELS[index];
}
