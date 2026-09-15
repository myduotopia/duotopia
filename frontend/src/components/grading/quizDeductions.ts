/**
 * quizDeductions — 小考批改頁每題扣分計算（#1045）
 *
 * 公式與後端 `compute_quiz_score`（backend/routers/students/quiz_assignments.py）一致：
 *   - 單題扣分 = 100 / 題數（不先捨入）
 *   - 答對預設扣 0、答錯（含未作答）預設扣單題分
 *   - 總分 = round1(max(0, 100 − Σ扣分))，只在總分捨入到一位小數
 * 老師已存的扣分（deduction）優先於預設值。
 */

/** 四捨五入到一位小數，並把 -0 正規化成 0。 */
export function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** 單題扣分（不先捨入）；題數 0 回 0。 */
export function perQuestionDeduction(total: number): number {
  return total > 0 ? 100 / total : 0;
}

/** 每題預設扣分：答對 0、答錯單題分。 */
export function defaultDeduction(isCorrect: boolean, total: number): number {
  return isCorrect ? 0 : perQuestionDeduction(total);
}

export interface DeductionSource {
  content_item_id?: number;
  is_correct?: boolean;
  deduction?: number | null;
}

/**
 * 依題目建立 {content_item_id → 扣分}；已存 deduction 優先，否則用預設。
 *
 * DB 欄位 teacher_review_score 為 DECIMAL(5,2)，存 100/30 會變 3.33；若直接採用，
 * 30 題加總 99.9 → 總分 0.1 與後端 0 不一致。故已存值與預設值差 < 0.005 時視為
 * 「未改動的預設」，改回精確值。
 */
export function initialDeductions(
  items: DeductionSource[],
  total: number,
): Record<number, number> {
  const result: Record<number, number> = {};
  for (const item of items) {
    if (item.content_item_id == null) continue;
    const fallback = defaultDeduction(item.is_correct === true, total);
    result[item.content_item_id] =
      item.deduction != null && Math.abs(item.deduction - fallback) >= 0.005
        ? item.deduction
        : fallback;
  }
  return result;
}

/** 由扣分表算總分：round1(max(0, 100 − Σ扣分))。 */
export function scoreFromDeductions(
  deductions: Record<number, number>,
): number {
  const sum = Object.values(deductions).reduce((acc, d) => acc + d, 0);
  return round1(Math.max(0, 100 - sum));
}
