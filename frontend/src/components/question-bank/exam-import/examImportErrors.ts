/**
 * 上傳題本（#1112）錯誤 → 白話提示的 i18n key（`questionBank.examImport.errors.*`，中英都有）。
 *
 * 後端錯誤碼（`detail.error`）優先；沒有錯誤碼時依 HTTP 狀態（400 圖片過大／格式、422 資料格式、
 * 502 AI 擷取失敗、504 逾時、0 網路中斷）。瀏覽器端的錯誤（PDF 讀不出來、超過 20 頁、PDF 和照片
 * 混選、雜湊不符…）用 `ClientError`，`key` 直接是 errors 底下的名稱。
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
};

const STATUS_KEYS: Record<number, string> = {
  0: "network",
  400: "badImage",
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
    return {
      code,
      status: err.status,
      key: CODE_KEYS[code] ?? STATUS_KEYS[err.status] ?? "unknown",
      params: {},
      existingImportId: typeof existing === "number" ? existing : undefined,
    };
  }
  return { code: "", status: -1, key: "unknown", params: {} };
}

export const errorKey = (key: string) =>
  `questionBank.examImport.errors.${key}`;
