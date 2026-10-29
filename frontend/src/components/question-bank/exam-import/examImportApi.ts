/**
 * 上傳題本匯入 API（#1112）。後端：`backend/routers/question_bank_exam_imports.py`（擷取）、
 * `question_bank_exam_import_review.py`（核對畫面，C4a）。
 *
 * - create / list / get / abandon：JSON。`list(organizationId)` 依題庫範圍：不帶＝我的題庫、
 *   帶機構 id＝該機構題庫（C4）；機構題庫建立時 `settings.organization_id` 帶機構 id
 * - sendPage（送一頁擷取）、markBlank（標為空白頁，不呼叫 AI）：multipart 附頁圖
 * - retry（重讀單一題）：multipart 只送 `card_id`、**不附頁圖**，後端用擷取時存好的頁圖（C4a 修正；
 *   找不到存好的頁圖回 409 `EXAM_IMPORT_PAGE_IMAGE_MISSING`）
 * - sendBlank（空白頁「仍要送出這一頁」）：用後端存好的頁圖，不附檔、不算重送次數
 * - 核對畫面（C4）：patchSettings（整份設定）、addCard（手動補一題）、patchCard（收合編輯時存回，
 *   卡片格式＋打開時的 `rev`）、deleteCard、save（全部儲存）、skipReview（略過核對，直接存入）
 *
 * 錯誤一律是 `ApiError`（`detail` 為 `{ error, message, ... }` 或字串），由
 * `examImportErrors.ts` 轉成白話提示。
 */
import { apiClient } from "@/lib/api";
import type {
  CardCreateInput,
  CardPatchInput,
  ExamImportCardResult,
  ExamImportCreateInput,
  ExamImportDetail,
  ExamImportPageResult,
  ExamImportSaveResult,
  ExamImportSettingsPatch,
  ExamImportSummary,
} from "./types";

const BASE = "/api/question-bank/exam-imports";

function pageForm(image: Blob): FormData {
  const form = new FormData();
  const ext = image.type === "image/png" ? "png" : "jpg";
  form.append("file", image, `page.${ext}`);
  return form;
}

export const examImportApi = {
  create: (input: ExamImportCreateInput) =>
    apiClient.post<ExamImportDetail>(BASE, input),
  list: (organizationId?: string | null) =>
    apiClient.get<{ items: ExamImportSummary[] }>(
      organizationId
        ? `${BASE}?organization_id=${encodeURIComponent(organizationId)}`
        : BASE,
    ),
  get: (id: number) => apiClient.get<ExamImportDetail>(`${BASE}/${id}`),
  sendPage: (id: number, pageNo: number, image: Blob) =>
    apiClient.postForm<ExamImportPageResult>(
      `${BASE}/${id}/pages/${pageNo}`,
      pageForm(image),
    ),
  markBlank: (id: number, pageNo: number, image: Blob) =>
    apiClient.postForm<ExamImportPageResult>(
      `${BASE}/${id}/pages/${pageNo}/blank`,
      pageForm(image),
    ),
  sendBlank: (id: number, pageNo: number) =>
    apiClient.post<ExamImportPageResult>(
      `${BASE}/${id}/pages/${pageNo}/send-blank`,
    ),
  retry: (id: number, pageNo: number, cardId: string) => {
    const form = new FormData();
    form.append("card_id", cardId);
    return apiClient.postForm<ExamImportCardResult>(
      `${BASE}/${id}/pages/${pageNo}/retry`,
      form,
    );
  },
  abandon: (id: number) =>
    apiClient.delete<{ id: number; status: string }>(`${BASE}/${id}`),
  patchSettings: (id: number, patch: ExamImportSettingsPatch) =>
    apiClient.patch<ExamImportSummary>(`${BASE}/${id}/settings`, patch),
  addCard: (id: number, input: CardCreateInput) =>
    apiClient.post<ExamImportCardResult>(`${BASE}/${id}/cards`, input),
  patchCard: (id: number, cardId: string, patch: CardPatchInput) =>
    apiClient.patch<ExamImportCardResult>(
      `${BASE}/${id}/cards/${encodeURIComponent(cardId)}`,
      patch,
    ),
  deleteCard: (id: number, cardId: string) =>
    apiClient.delete<{ import: ExamImportSummary }>(
      `${BASE}/${id}/cards/${encodeURIComponent(cardId)}`,
    ),
  save: (id: number, cardIds?: string[]) =>
    apiClient.post<ExamImportSaveResult>(
      `${BASE}/${id}/save`,
      cardIds ? { card_ids: cardIds } : {},
    ),
  skipReview: (id: number) =>
    apiClient.post<ExamImportSaveResult>(`${BASE}/${id}/skip-review`),
};
