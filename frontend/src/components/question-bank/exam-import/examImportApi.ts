/**
 * 上傳題本匯入 API（#1112）。後端：`backend/routers/question_bank_exam_imports.py`。
 *
 * - create / list / get / abandon：JSON
 * - sendPage（送一頁擷取）、markBlank（標為空白頁，不呼叫 AI）：multipart 附頁圖
 * - sendBlank（空白頁「仍要送出這一頁」）：用後端存好的頁圖，不附檔、不算重送次數
 *
 * 錯誤一律是 `ApiError`（`detail` 為 `{ error, message, ... }` 或字串），由
 * `examImportErrors.ts` 轉成白話提示。
 */
import { apiClient } from "@/lib/api";
import type {
  ExamImportCreateInput,
  ExamImportDetail,
  ExamImportPageResult,
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
  list: () => apiClient.get<{ items: ExamImportSummary[] }>(BASE),
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
  abandon: (id: number) =>
    apiClient.delete<{ id: number; status: string }>(`${BASE}/${id}`),
};
