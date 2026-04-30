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
    shouldRetry: (error) => {
      // 只有網路錯誤或暫時性錯誤才重試
      // 408/425/429 are retried because the backend's recording-upload endpoint
      // upserts on (student_assignment_id, content_item_id), so duplicate uploads are safe.
      const retryableErrors = [
        "NetworkError",
        "TimeoutError",
        "AbortError",
        "408", // Request Timeout
        "425", // Too Early (server not ready)
        "429", // Too Many Requests (rate limit)
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
    },
  });
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
