/**
 * Google Analytics 4 Service - Blog 頁面追蹤
 *
 * GA4 gtag.js 在 index.html 全域載入（send_page_view: false），
 * 這裡只負責在 blog 路由手動發送 page_view。
 */

const GA_MEASUREMENT_ID = "G-4ZR7VPNHX7";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function sendPageView(path: string, title?: string) {
  if (typeof window.gtag !== "function") return;
  window.gtag("event", "page_view", {
    page_path: path,
    page_title: title ?? document.title,
    send_to: GA_MEASUREMENT_ID,
  });
}
