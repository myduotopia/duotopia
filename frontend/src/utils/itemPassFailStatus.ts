/**
 * 共用題目「通過 / 未通過」判定（issue #689 後續）。
 *
 * 規則：
 * - RETURNED（待訂正）模式：純看 teacher_passed。老師沒審過 (null) 不會因為
 *   高 AI 分數自動算 passed —— 避免學生重錄高分後題號變綠，誤以為已過關，
 *   分不清這次到底是在訂正哪幾題。
 * - 其他狀態：teacher_passed 優先；老師沒審過時用 AI 分數 fallback (>= 60
 *   → passed) 給學生 self-feedback，幫助判斷是否需要重錄。
 *
 * passed → 綠 + 在 RETURNED 模式鎖唯讀
 * failed → 紅 + 提示需要訂正
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
  if (assignmentStatus === "RETURNED") {
    // 訂正模式不做 AI fallback：老師最後沒對這題打勾就不算 passed
    return { passed: false, failed: false };
  }
  if (typeof aiScore === "number") {
    return aiScore >= 60
      ? { passed: true, failed: false }
      : { passed: false, failed: true };
  }
  return { passed: false, failed: false };
}
