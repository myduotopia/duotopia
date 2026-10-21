/**
 * batchEditClassrooms — 「批次編輯」視窗（BatchEditClassroomsDialog）的純邏輯（#1139）
 *
 * 個人「我的班級」與機構後台班級管理共用；班級 id 型別不同（number／string），函式對 id 泛型。
 *
 * - makeBatchEditRows：打開視窗時把勾選的班級轉成表格列，保留原值（originalName／originalGrade）。
 * - 「改過」一律與打開視窗時的原值比較（名稱先去頭尾空白）；改回原值就不算變動、標記消失。
 * - 每格記錄最後是誰改的（manual／ai）：AI 改過的格子用另一種標記，人工再改後換回人工標記
 *   （第二階段 AI 助手經 applyBatchEditChanges(…, "ai") 填入）。
 * - 年級不能清回「未設定」（D9）：applyBatchEditChanges 只接受 1–12；唯一例外是打開視窗時
 *   本來就未設定的列（originalGrade === null），可用 null 還原回未設定（例如先「全部年級設為」
 *   再把這列改回空白）。setAllBatchEditGrades 只接受 1–12。
 * - buildBatchEditItems：只送有變動的列，且每列只帶有變動的欄位（名稱已去空白）。
 * - 名稱驗證：去頭尾空白後 1–100 字，與後端 ClassroomName 一致；只檢查有變動的列。
 */
import { isValidGrade } from "./classroomGrade";

/** 班級名稱上限，與後端 CLASSROOM_NAME_MAX_LENGTH（DB String(100)）一致 */
export const CLASSROOM_NAME_MAX_LENGTH = 100;

/** 這一格最後是人工改的還是 AI 改的 */
export type BatchEditCellSource = "manual" | "ai";

export interface BatchEditClassroom<Id> {
  id: Id;
  name: string;
  grade?: number | null;
  /** false＝停用（表格沿用停用標記） */
  is_active?: boolean;
}

export interface BatchEditRow<Id> {
  id: Id;
  originalName: string;
  originalGrade: number | null;
  name: string;
  grade: number | null;
  inactive: boolean;
  nameSource: BatchEditCellSource;
  gradeSource: BatchEditCellSource;
}

/** 要寫入表格的變更（名稱、年級至少一項）；不在表格裡的 id 會被忽略 */
export interface BatchEditChange<Id> {
  id: Id;
  name?: string;
  /** null＝還原回未設定，只對原本未設定的列有效（D9） */
  grade?: number | null;
}

/** 送給批次端點前的通用格式；頁面自行轉成 {classroom_id, name?, grade?} */
export interface BatchEditUpdateItem<Id> {
  id: Id;
  name?: string;
  grade?: number;
}

export type ClassroomNameError = "required" | "tooLong";

export function makeBatchEditRows<Id>(
  classrooms: readonly BatchEditClassroom<Id>[],
): BatchEditRow<Id>[] {
  return classrooms.map((c) => {
    const grade = isValidGrade(c.grade) ? c.grade : null;
    return {
      id: c.id,
      originalName: c.name ?? "",
      originalGrade: grade,
      name: c.name ?? "",
      grade,
      inactive: c.is_active === false,
      nameSource: "manual",
      gradeSource: "manual",
    };
  });
}

export function isBatchEditNameChanged<Id>(row: BatchEditRow<Id>): boolean {
  return row.name.trim() !== row.originalName.trim();
}

export function isBatchEditGradeChanged<Id>(row: BatchEditRow<Id>): boolean {
  return row.grade !== row.originalGrade;
}

export function isBatchEditRowChanged<Id>(row: BatchEditRow<Id>): boolean {
  return isBatchEditNameChanged(row) || isBatchEditGradeChanged(row);
}

/** 有變動的格子中，是否有 AI 改的（用來決定該列標記） */
export function isBatchEditRowAiChanged<Id>(row: BatchEditRow<Id>): boolean {
  return (
    (isBatchEditNameChanged(row) && row.nameSource === "ai") ||
    (isBatchEditGradeChanged(row) && row.gradeSource === "ai")
  );
}

/** 名稱驗證：去頭尾空白後 1–100 字 */
export function validateClassroomName(name: string): ClassroomNameError | null {
  const trimmed = name.trim();
  if (!trimmed) return "required";
  if (trimmed.length > CLASSROOM_NAME_MAX_LENGTH) return "tooLong";
  return null;
}

/** 有變動的列名稱驗證失敗 → 不能儲存（沒變動的列沿用原名，不擋） */
export function batchEditRowNameError<Id>(
  row: BatchEditRow<Id>,
): ClassroomNameError | null {
  return isBatchEditNameChanged(row) ? validateClassroomName(row.name) : null;
}

/**
 * 把變更寫進表格：只動 id 在表格裡的列，只改名稱與年級。
 * 年級只接受 1–12；null 只在該列原本未設定時接受（還原回未設定），其餘忽略（D9）。
 * 同一 id 出現多次以最後一筆為準。
 */
export function applyBatchEditChanges<Id>(
  rows: readonly BatchEditRow<Id>[],
  changes: readonly BatchEditChange<Id>[],
  source: BatchEditCellSource,
): BatchEditRow<Id>[] {
  const byId = new Map<Id, BatchEditChange<Id>>();
  for (const change of changes) {
    const prev = byId.get(change.id);
    byId.set(change.id, { ...prev, ...change });
  }
  return rows.map((row) => {
    const change = byId.get(row.id);
    if (!change) return row;
    const next = { ...row };
    if (typeof change.name === "string") {
      next.name = change.name;
      next.nameSource = source;
    }
    if (isValidGrade(change.grade)) {
      next.grade = change.grade;
      next.gradeSource = source;
    } else if (change.grade === null && row.originalGrade === null) {
      next.grade = null;
      next.gradeSource = source;
    }
    return next;
  });
}

/** 「全部年級設為 N」：套到所有列（含原本未設定），只改年級、不碰名稱 */
export function setAllBatchEditGrades<Id>(
  rows: readonly BatchEditRow<Id>[],
  grade: number,
  source: BatchEditCellSource = "manual",
): BatchEditRow<Id>[] {
  return applyBatchEditChanges(
    rows,
    rows.map((row) => ({ id: row.id, grade })),
    source,
  );
}

/** 只送有變動的列；每列只帶有變動的欄位（名稱已去頭尾空白） */
export function buildBatchEditItems<Id>(
  rows: readonly BatchEditRow<Id>[],
): BatchEditUpdateItem<Id>[] {
  const items: BatchEditUpdateItem<Id>[] = [];
  for (const row of rows) {
    const item: BatchEditUpdateItem<Id> = { id: row.id };
    if (isBatchEditNameChanged(row)) item.name = row.name.trim();
    if (isBatchEditGradeChanged(row) && isValidGrade(row.grade)) {
      item.grade = row.grade;
    }
    if (item.name !== undefined || item.grade !== undefined) items.push(item);
  }
  return items;
}
