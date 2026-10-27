/**
 * 重試機制配置選項
 */
interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  onRetry?: (attempt: number, error: Error) => void;
  shouldRetry?: (error: Error) => boolean;
}

/**
 * 帶有指數退避的重試機制
 * @param fn 要執行的異步函數
 * @param options 重試配置選項
 * @returns Promise 包含函數執行結果
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    onRetry,
    shouldRetry = () => true,
  } = options;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // 檢查是否應該重試
      if (!shouldRetry(lastError)) {
        throw lastError;
      }

      // 如果是最後一次嘗試，直接拋出錯誤
      if (attempt === maxRetries) {
        throw lastError;
      }

      // 呼叫重試回調
      if (onRetry) {
        onRetry(attempt, lastError);
      }

      // 計算延遲時間（指數退避）
      const delay = Math.min(
        initialDelay * Math.pow(backoffMultiplier, attempt - 1),
        maxDelay,
      );

      // 等待指定時間後重試
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

/**
 * 針對音頻上傳的重試包裝函數
 */
export async function retryAudioUpload<T>(
  uploadFn: () => Promise<T>,
  onRetry?: (attempt: number, error: Error) => void,
  /**
   * 覆寫「要不要重試」。
   *
   * 預設那套是比對**錯誤訊息字串**（含 "500"、"503"… 就重試），而那會誤判：後端
   * 「錄音太短」的訊息是 `Must be at least 500 bytes`，裡面就有 "500" —— 一個確定不會
   * 成功的 400 會被重試 3 次（1s+2s+4s），學生白等才看到訊息（#1140 PR #1148 review）。
   *
   * 呼叫端若拿得到 HTTP status，就用這個參數依 status 判斷，不要靠訊息猜。
   */
  shouldRetry?: (error: Error) => boolean,
): Promise<T> {
  return retryWithBackoff(uploadFn, {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 5000,
    backoffMultiplier: 2,
    onRetry: (attempt, error) => {
      console.log(`音頻上傳失敗，正在重試... (第 ${attempt} 次)`, error);
      if (onRetry) {
        onRetry(attempt, error);
      }
    },
    shouldRetry: shouldRetry ?? isRetryableUploadError,
  });
}

/**
 * 上傳時「值得重試」的 4xx。
 *
 * 其餘 4xx（錄音太長／太短／太大）重試幾次都一樣。這三個是暫時性的，而上傳端對
 * (student_assignment_id, content_item_id) 是 upsert、重複上傳安全 —— 所以傳
 * `shouldRetry` 覆寫時**不可以把它們一併擋掉**（PR #1148 review 第 1 點：我原本的
 * 覆寫就是對所有 4xx 都回 false，把這三個也擋了）。
 */
export const RETRYABLE_UPLOAD_STATUSES: ReadonlySet<number> = new Set([
  408, // Request Timeout
  425, // Too Early (server not ready)
  429, // Too Many Requests (rate limit)
]);

/**
 * 預設的「這個上傳錯誤值不值得重試」—— 比對錯誤訊息字串。
 *
 * 匯出是為了讓覆寫 `shouldRetry` 的呼叫端能**對非 HTTP 錯誤沿用這一套**，而不是自己
 * 寫一個更寬的版本（review 第 2 點：我的覆寫一度讓任何非 4xx 的錯誤都重試）。
 *
 * ⚠️ **拿得到 HTTP status 的錯誤不要走這條。** 它比對的是錯誤訊息字串，而後端的訊息
 * 可能剛好含數字 —— 例如「錄音太短」的 detail 是 `Must be at least 500 bytes`，
 * 裡面的 "500" 會讓一個確定失敗的 400 被判成可重試（#1148 就是這樣白等 7 秒）。
 * 有 status 就依 status 判斷。
 */
export function isRetryableUploadError(error: Error): boolean {
  // 只有網路錯誤或暫時性錯誤才重試
  const retryableErrors = [
    "NetworkError",
    "TimeoutError",
    "AbortError",
    "408",
    "425",
    "429",
    "500",
    "502",
    "503",
    "504",
    "ECONNRESET",
    "ETIMEDOUT",
  ];
  const errorMessage = error.message || "";
  return retryableErrors.some((retryableError) =>
    errorMessage.includes(retryableError),
  );
}

/**
 * 針對 AI 分析的重試包裝函數
 */
export async function retryAIAnalysis<T>(
  analysisFn: () => Promise<T>,
  onRetry?: (attempt: number, error: Error) => void,
): Promise<T> {
  return retryWithBackoff(analysisFn, {
    maxRetries: 3,
    initialDelay: 2000,
    maxDelay: 10000,
    backoffMultiplier: 2,
    onRetry: (attempt, error) => {
      console.log(`AI 分析失敗，正在重試... (第 ${attempt} 次)`, error);
      if (onRetry) {
        onRetry(attempt, error);
      }
    },
    shouldRetry: (error) => {
      // AI 分析可能因為負載過高或暫時性問題失敗
      const retryableErrors = [
        "NetworkError",
        "TimeoutError",
        "429", // Too Many Requests
        "500",
        "502",
        "503",
        "504",
        "ECONNRESET",
        "ETIMEDOUT",
        "rate limit",
        "quota exceeded",
      ];

      const errorMessage = error.message?.toLowerCase() || "";
      return retryableErrors.some((retryableError) =>
        errorMessage.includes(retryableError.toLowerCase()),
      );
    },
  });
}
