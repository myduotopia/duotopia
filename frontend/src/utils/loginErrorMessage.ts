import { ApiError } from "../lib/api";

/**
 * 把登入失敗的 error 對應到正確的 i18n key。
 *
 * 為什麼需要：登入頁原本用 blanket catch，一律顯示「登入失敗，請檢查帳號密碼」。
 * 當 CORS 或網路問題讓請求根本沒送到後端時，使用者會被誤導成帳密打錯
 * （www.duotopia.co 不在 CORS 白名單那次事故就是這樣被誤判方向的）。
 *
 * `ApiClient.request` 會把 fetch 拋出的 TypeError（含 CORS 被擋）包成
 * `ApiError` 且 `status === 0`，所以這裡以 status 0 判定連線問題。
 *
 * @param fallbackKey 呼叫端原本的訊息 key，用於真正的帳密錯誤（401）與其他未分類情況。
 */
export function resolveLoginErrorKey(
  err: unknown,
  fallbackKey: string,
): string {
  const status =
    err instanceof ApiError
      ? err.status
      : // 沒經過 ApiClient 的裸 fetch（例如 Google/1Campus 流程）
        err instanceof TypeError
        ? 0
        : undefined;

  if (status === 0) return "common.errors.networkError";
  if (status === 429) return "common.errors.rateLimited";
  if (status !== undefined && status >= 500) return "common.errors.serverError";

  return fallbackKey;
}
