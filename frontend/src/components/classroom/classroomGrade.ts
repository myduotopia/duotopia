/**
 * classroomGrade — 班級年級（1–12）共用邏輯（#1097）
 *
 * 個人「我的班級」與機構後台班級管理共用：
 * - 年級選項與篩選值
 * - computeGradeAdjust：批次升／降一級時，算出「會變動」與「略過（含原因）」兩組
 * - formatClassroomDisplayName：組合班名（年級 8＋名稱「12」→「8年12班」／「Grade 8 Class 12」），
 *   學生端各處與老師端派作業、學生管理、班級詳情、作業管理共用；「我的班級」列表本身仍分兩欄
 *
 * 升降計算在前端完成，後端批次端點只負責驗證範圍與權限後寫入。
 * 班級 id 型別不同（個人端 number、機構端 string），所以函式對 id 泛型。
 */
import { GRADE_MAX, GRADE_MIN } from "@/components/shared/GradeRangeSlider";
// 單向依賴：lib/api 不 import 本檔，不會形成循環
import { ApiError } from "@/lib/api";

export { GRADE_MAX, GRADE_MIN };

/** 年級選項 1–12 */
export const GRADE_OPTIONS: readonly number[] = Array.from(
  { length: GRADE_MAX - GRADE_MIN + 1 },
  (_, i) => GRADE_MIN + i,
);

/**
 * 批次設定年級一次最多送出幾個班級。
 * 必須與後端 BATCH_GRADE_MAX_ITEMS（backend/routers/schemas/classroom.py）一致；
 * 超過時對話框停用送出並提示分批，不自動切批。
 */
export const BATCH_GRADE_MAX_ITEMS = 200;

/**
 * 批次設定年級失敗時要顯示的訊息 key：
 * HTTP 403 的 ApiError → 權限專屬提示；其他錯誤 → 一般失敗提示。
 */
export function batchGradeErrorMessageKey(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return "classroomGrade.messages.forbidden";
  }
  return "classroomGrade.messages.saveFailed";
}

/** 篩選值：全部／未設定／"1"–"12" */
export const GRADE_FILTER_ALL = "all";
export const GRADE_FILTER_UNSET = "unset";

/** 是否為有效年級（1–12 整數）；null／undefined／超出範圍都視為「未設定」 */
export function isValidGrade(grade: unknown): grade is number {
  return (
    typeof grade === "number" &&
    Number.isInteger(grade) &&
    grade >= GRADE_MIN &&
    grade <= GRADE_MAX
  );
}

/** 顯示文字：「3 年級」／「Grade 3」；未設定回「未設定」／「Not set」 */
export function formatGradeLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  grade: number | null | undefined,
): string {
  return isValidGrade(grade)
    ? t("classroomGrade.gradeLabel", { grade })
    : t("classroomGrade.unset");
}

/** 名稱已自帶年級／班級字樣時不再組合（中文「年」「班」、英文 grade／class 不分大小寫） */
const DISPLAY_NAME_SKIP_PATTERN = /[年班]|grade|class/i;

/**
 * 組合班名：有效年級（1–12）且名稱未自帶「年／班／Grade／Class」時，
 * 回傳 t("classroomGrade.displayName")（「8年12班」／「Grade 8 Class 12」）；
 * 否則回傳原始名稱。只在畫面渲染時呼叫，不要把結果存進 store（切換語言才會重算）。
 */
export function formatClassroomDisplayName(
  t: (key: string, options?: Record<string, unknown>) => string,
  classroom: { name: string; grade?: number | null },
): string {
  const { name, grade } = classroom;
  const trimmed = (name ?? "").trim();
  if (
    !isValidGrade(grade) ||
    !trimmed ||
    DISPLAY_NAME_SKIP_PATTERN.test(trimmed)
  ) {
    return name;
  }
  return t("classroomGrade.displayName", { grade, name: trimmed });
}

/** 年級是否符合篩選值 */
export function matchesGradeFilter(
  grade: number | null | undefined,
  filter: string,
): boolean {
  if (filter === GRADE_FILTER_ALL) return true;
  if (filter === GRADE_FILTER_UNSET) return !isValidGrade(grade);
  return isValidGrade(grade) && String(grade) === filter;
}

export type GradeAdjustDirection = "up" | "down";

export type GradeSkipReason = "max" | "min" | "unset";

export interface GradeAdjustClassroom<Id> {
  id: Id;
  name: string;
  grade?: number | null;
}

export interface GradeChange<Id> {
  id: Id;
  name: string;
  from: number;
  to: number;
}

export interface GradeSkip<Id> {
  id: Id;
  name: string;
  reason: GradeSkipReason;
}

export interface GradeAdjustResult<Id> {
  changes: GradeChange<Id>[];
  skipped: GradeSkip<Id>[];
}

/** 送給批次 API 前的通用格式；頁面自行轉成 {classroom_id, grade} */
export interface GradeUpdateItem<Id> {
  id: Id;
  grade: number;
}

/**
 * 批次升／降一級。
 * 已是 12 年級要升（max）、已是 1 年級要降（min）、尚未設定年級（unset）的班級略過；
 * 其餘班級保持輸入順序放進 changes。
 */
export function computeGradeAdjust<Id>(
  classrooms: readonly GradeAdjustClassroom<Id>[],
  direction: GradeAdjustDirection,
): GradeAdjustResult<Id> {
  const changes: GradeChange<Id>[] = [];
  const skipped: GradeSkip<Id>[] = [];
  const delta = direction === "up" ? 1 : -1;

  for (const { id, name, grade } of classrooms) {
    if (!isValidGrade(grade)) {
      skipped.push({ id, name, reason: "unset" });
      continue;
    }
    if (direction === "up" && grade >= GRADE_MAX) {
      skipped.push({ id, name, reason: "max" });
      continue;
    }
    if (direction === "down" && grade <= GRADE_MIN) {
      skipped.push({ id, name, reason: "min" });
      continue;
    }
    changes.push({ id, name, from: grade, to: grade + delta });
  }

  return { changes, skipped };
}
