/**
 * classroomInactive — 學生端「班級已停用」錯誤辨識（#1097）
 *
 * 後端學生作業路由（作業內頁、作答、小考）在作業所屬班級停用或已刪除時，
 * 回 HTTP 403、detail = "classroom_inactive"（backend/routers/students/dependencies.py）。
 *
 * 學生作業頁（StudentActivityPage、StudentAssignmentDetail）用 raw fetch 載入，
 * 載入失敗時：
 *   1. 用 throwIfClassroomInactive(response) 把這種回應轉成 ClassroomInactiveError
 *   2. catch 裡用 studentAssignmentErrorKey(error, 預設 key) 取 toast 文案
 *      （「此班級已停用」／"This class has been deactivated"），再導回作業列表
 * 也接受 lib/api 的 ApiError（apiClient 呼叫學生端點時）。
 */
import { ApiError } from "@/lib/api";

export const CLASSROOM_INACTIVE_DETAIL = "classroom_inactive";

export const CLASSROOM_INACTIVE_MESSAGE_KEY =
  "studentAssignmentList.errors.classroomInactive";

export class ClassroomInactiveError extends Error {
  constructor() {
    super(CLASSROOM_INACTIVE_DETAIL);
    this.name = "ClassroomInactiveError";
  }
}

/** fetch 回應是否為「班級已停用」的 403（讀取 clone，不影響原回應的 body） */
export async function isClassroomInactiveResponse(
  response: Response,
): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const body = (await response.clone().json()) as { detail?: unknown };
    return body?.detail === CLASSROOM_INACTIVE_DETAIL;
  } catch {
    return false;
  }
}

/** 回應是「班級已停用」的 403 時丟出 ClassroomInactiveError，否則不做事 */
export async function throwIfClassroomInactive(
  response: Response,
): Promise<void> {
  if (await isClassroomInactiveResponse(response)) {
    throw new ClassroomInactiveError();
  }
}

/** 錯誤是否代表「班級已停用」（ClassroomInactiveError 或 403 classroom_inactive 的 ApiError） */
export function isClassroomInactiveError(error: unknown): boolean {
  if (error instanceof ClassroomInactiveError) return true;
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.detail === CLASSROOM_INACTIVE_DETAIL
  );
}

/** 學生作業頁載入失敗時的 toast key：班級停用 → 專屬提示；其他 → fallbackKey */
export function studentAssignmentErrorKey(
  error: unknown,
  fallbackKey: string,
): string {
  return isClassroomInactiveError(error)
    ? CLASSROOM_INACTIVE_MESSAGE_KEY
    : fallbackKey;
}
