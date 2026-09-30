/**
 * Issue #1088：批改頁「完成」後跳到下一位待批改學生的純函式。
 *
 * 「待批改」採平台定義：SUBMITTED（學生已完成，待老師批改）或
 * RESUBMITTED（訂正後待批改）。從目前學生的位置往後找（維持 studentList 現有排序），
 * 到底後從頭繞回，跳過目前學生本人；找不到回 null。
 */

export const AWAITING_GRADING_STATUSES: ReadonlySet<string> = new Set([
  "SUBMITTED",
  "RESUBMITTED",
]);

export interface NextStudentCandidate {
  student_id: number;
  status?: string | null;
}

export function findNextUngradedStudent<T extends NextStudentCandidate>(
  list: readonly T[],
  currentStudentId: number | null | undefined,
): T | null {
  if (list.length === 0) return null;
  const currentIndex =
    currentStudentId == null
      ? -1
      : list.findIndex((s) => s.student_id === currentStudentId);
  // 目前學生不在清單內 → 從頭開始找
  const start = currentIndex < 0 ? 0 : currentIndex + 1;
  for (let step = 0; step < list.length; step++) {
    const candidate = list[(start + step) % list.length];
    if (candidate.student_id === currentStudentId) continue;
    if (candidate.status && AWAITING_GRADING_STATUSES.has(candidate.status)) {
      return candidate;
    }
  }
  return null;
}
