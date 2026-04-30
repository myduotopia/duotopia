/**
 * 共用題目「通過 / 未通過」判定。
 *
 * 規則：
 * - failed=true（紅）只發生在「老師明確標記不通過」的情境
 *   （teacher_passed === false）。學生在 IN_PROGRESS / SUBMITTED 等狀態
 *   還沒拿到老師判定時，即使 AI 分數低也不算 failed，避免「還沒寫」或
 *   「品質普通」就被視覺上標成「沒過」誤導學生。
 * - passed=true（綠）的兩條路：
 *     1. 老師打勾（teacher_passed === true，任何狀態）。
 *     2. 非 RETURNED/RESUBMITTED 模式 + AI 分數 ≥ 60 的 self-feedback
 *        提示。RETURNED 模式不做 AI fallback —— 老師沒打勾就不算過。
 *
 * passed → 綠 + 在 RETURNED 模式鎖唯讀
 * failed → 紅 + 提示需要訂正（只會在 RETURNED 模式 + 老師打叉時出現）
 * 都不是 → 黃 / 白（由呼叫端再判斷有無錄音 / 分析）
 */
export interface ItemPassFailInput {
  teacherPassed: boolean | null | undefined;
  aiScore: number | null | undefined;
  assignmentStatus: string | null | undefined;
}

export interface ItemPassFailStatus {
  passed: boolean;
  failed: boolean;
}

export function getItemPassFailStatus({
  teacherPassed,
  aiScore,
  assignmentStatus,
}: ItemPassFailInput): ItemPassFailStatus {
  if (teacherPassed === true) return { passed: true, failed: false };
  if (teacherPassed === false) return { passed: false, failed: true };

  // teacher_passed === null / undefined（老師尚未對該題下判定）
  if (assignmentStatus === "RETURNED" || assignmentStatus === "RESUBMITTED") {
    // 訂正模式不做 AI fallback：老師最後沒對這題打勾就不算 passed
    return { passed: false, failed: false };
  }
  // 非訂正模式：AI ≥ 60 給綠（self-feedback），其餘一律「待定」(白/黃)。
  // AI 分數低不再標 failed —— failed 是老師的決定，不是 AI 的決定。
  if (typeof aiScore === "number" && aiScore >= 60) {
    return { passed: true, failed: false };
  }
  return { passed: false, failed: false };
}
