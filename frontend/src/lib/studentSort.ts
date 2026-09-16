/**
 * 學生排序（issue #1046）。
 *
 * 全站一致的規則：有座號的依座號小到大（數字感知，所以 "2" 排在 "10" 前面），
 * 沒有座號的排在全部有座號的學生之後，彼此再依姓名排序。
 *
 * 座號沿用既有的 `student_number` 欄位，本專案沒有另外的座號欄位。
 */

export interface SortableStudent {
  name: string;
  student_number?: string | null;
}

export function compareStudentsBySeat(
  a: SortableStudent,
  b: SortableStudent,
): number {
  const aSeat = a.student_number?.trim();
  const bSeat = b.student_number?.trim();

  if (aSeat && bSeat) {
    const bySeat = aSeat.localeCompare(bSeat, undefined, { numeric: true });
    // 座號相同（例如兩班合併後撞號）時仍要有穩定的次序，退回姓名。
    return bySeat !== 0 ? bySeat : (a.name || "").localeCompare(b.name || "");
  }
  if (aSeat) return -1;
  if (bSeat) return 1;
  return (a.name || "").localeCompare(b.name || "");
}

/** 回傳排序後的新陣列，不動原本的。 */
export function sortStudentsBySeat<T extends SortableStudent>(
  students: T[],
): T[] {
  return [...students].sort(compareStudentsBySeat);
}
