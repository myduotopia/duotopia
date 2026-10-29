/**
 * 上傳題本（#1112）錯誤 → 白話提示的 i18n key（`questionBank.examImport.errors.*`，中英都有）。
 *
 * 後端錯誤碼（`detail.error`）優先；沒有錯誤碼時依 HTTP 狀態（400 圖片過大／格式、403 不是機構成員、
 * 422 資料格式、502 AI 擷取失敗、504 逾時、0 網路中斷）。瀏覽器端的錯誤（PDF 讀不出來、超過 20 頁、
 * PDF 和照片混選、雜湊不符…）用 `ClientError`，`key` 直接是 errors 底下的名稱。
 *
 * C4：核對畫面的錯誤碼（已存進題庫的卡、整份設定沒填完／不合法、教材或來源不能用）；409 同一份題本
 * 已匯入過另帶那次匯入所在的題庫（`existingOrganizationId`／`existingSchoolId`），前端據此切到
 * 那個題庫再打開；422 SETTINGS_INCOMPLETE 的 `missing` 轉成 `params.missing`（逗號串起來的欄位名）。
 */
import { ApiError } from "@/lib/api";

/** 後端錯誤碼 → errors 底下的 key */
const CODE_KEYS: Record<string, string> = {
  EXAM_IMPORT_DUPLICATE: "duplicate",
  EXAM_IMPORT_DAILY_LIMIT: "dailyLimit",
  EXAM_IMPORT_AI_TIMEOUT: "aiTimeout",
  EXAM_IMPORT_PAGE_BUSY: "pageBusy",
  EXAM_IMPORT_RETRY_LIMIT: "retryLimit",
  EXAM_IMPORT_PAGE_DONE: "pageDone",
  EXAM_IMPORT_CLOSED: "closed",
  EXAM_IMPORT_NOT_FOUND: "notFound",
  EXAM_IMPORT_PAGE_NOT_FOUND: "pageNotFound",
  EXAM_IMPORT_NOT_ABANDONABLE: "notAbandonable",
  EXAM_IMPORT_NOT_BLANK: "notBlank",
  EXAM_IMPORT_PAGE_IMAGE_MISSING: "pageImageMissing",
  EXAM_IMPORT_PAGE_NOT_DONE: "pageNotDone",
  EXAM_IMPORT_RETRY_TARGET: "retryTarget",
  EXAM_IMPORT_RETRY_EMPTY: "retryEmpty",
  EXAM_IMPORT_RETRY_MERGED: "retryMerged",
  EXAM_IMPORT_CARD_NOT_FOUND: "cardNotFound",
  EXAM_IMPORT_CARD_SAVED: "cardSaved",
  EXAM_IMPORT_SETTINGS_INCOMPLETE: "settingsIncomplete",
  EXAM_IMPORT_SETTINGS_INVALID: "settingsInvalid",
  EXAM_IMPORT_PROGRAM_LINK_INVALID: "programLinkInvalid",
  EXAM_IMPORT_SOURCE_INVALID: "sourceInvalid",
};

const STATUS_KEYS: Record<number, string> = {
  0: "network",
  400: "badImage",
  403: "forbidden",
  404: "notFound",
  422: "invalid",
  429: "dailyLimit",
  502: "aiFailed",
  504: "aiTimeout",
};

/** 瀏覽器端錯誤（key ＝ errors 底下的名稱） */
export class ClientError extends Error {
  constructor(
    public key: string,
    public params: Record<string, string | number> = {},
  ) {
    super(key);
    this.name = "ClientError";
  }
}

export interface ExamImportErrorInfo {
  /** 後端錯誤碼（沒有時為空字串） */
  code: string;
  status: number;
  /** `questionBank.examImport.errors.<key>` */
  key: string;
  params: Record<string, string | number>;
  /** 409 EXAM_IMPORT_DUPLICATE：那次匯入的 id */
  existingImportId?: number;
  /** 那次匯入存進的機構／學校題庫（都沒有＝我的題庫） */
  existingOrganizationId?: string | null;
  existingSchoolId?: string | null;
}

export function errorInfo(err: unknown): ExamImportErrorInfo {
  if (err instanceof ClientError) {
    return { code: "", status: -1, key: err.key, params: err.params };
  }
  if (err instanceof ApiError) {
    const detail = err.detail as unknown;
    const obj =
      detail && typeof detail === "object" && !Array.isArray(detail)
        ? (detail as Record<string, unknown>)
        : null;
    const code = typeof obj?.error === "string" ? obj.error : "";
    const existing = obj?.existing_import_id;
    const missing = Array.isArray(obj?.missing) ? obj.missing.join(",") : "";
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    return {
      code,
      status: err.status,
      key: CODE_KEYS[code] ?? STATUS_KEYS[err.status] ?? "unknown",
      params: missing ? { missing } : {},
      existingImportId: typeof existing === "number" ? existing : undefined,
      existingOrganizationId: str(obj?.existing_organization_id),
      existingSchoolId: str(obj?.existing_school_id),
    };
  }
  return { code: "", status: -1, key: "unknown", params: {} };
}

export const errorKey = (key: string) =>
  `questionBank.examImport.errors.${key}`;
