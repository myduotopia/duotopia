/**
 * Google Analytics 4 Service
 *
 * GA4 gtag.js 在 index.html 全域載入（send_page_view: false），
 * 由 useAnalyticsPageView hook 在 SPA 路由切換時手動觸發 page_view。
 * 若未設定 VITE_GA_MEASUREMENT_ID，所有呼叫會 no-op。
 */

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as
  | string
  | undefined;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function isEnabled(): boolean {
  return Boolean(GA_MEASUREMENT_ID) && typeof window.gtag === "function";
}

export function sendPageView(path: string, title?: string): void {
  if (!isEnabled()) return;
  window.gtag!("event", "page_view", {
    page_path: path,
    page_title: title ?? document.title,
    send_to: GA_MEASUREMENT_ID,
  });
}

export function sendEvent(
  eventName: string,
  params?: Record<string, unknown>,
): void {
  if (!isEnabled()) return;
  window.gtag!("event", eventName, {
    ...params,
    send_to: GA_MEASUREMENT_ID,
  });
}
