/**
 * Meta Pixel Service
 *
 * Pixel base code 在 index.html 全域載入並執行 fbq('init', ...)。
 * 這個 service 封裝後續事件呼叫，提供型別安全的 API。
 *
 * 若未設定 VITE_META_PIXEL_ID，所有呼叫會 no-op（不報錯）。
 */

const PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID as string | undefined;

type FbqFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    fbq?: FbqFn;
  }
}

function isEnabled(): boolean {
  return Boolean(PIXEL_ID) && typeof window.fbq === "function";
}

export function trackPageView(): void {
  if (!isEnabled()) return;
  window.fbq!("track", "PageView");
}

export function trackEvent(
  eventName: string,
  params?: Record<string, unknown>,
): void {
  if (!isEnabled()) return;
  if (params) {
    window.fbq!("track", eventName, params);
  } else {
    window.fbq!("track", eventName);
  }
}

/**
 * 註冊完成事件。teacher 註冊送出表單成功時呼叫（不等 email 驗證）。
 * 是 Facebook 廣告最佳化目標的標準事件名稱。
 */
export function trackCompleteRegistration(params?: {
  content_name?: string;
  status?: string;
}): void {
  trackEvent("CompleteRegistration", params);
}
