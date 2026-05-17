/**
 * useAnalyticsPageView
 *
 * 監聽 SPA 路由變化，同時觸發 GA4 與 Meta Pixel 的 PageView 事件。
 * 取代舊的 useBlogPageTracking（只追 blog 已不符需求）。
 *
 * 在 App.tsx 內 router 範圍掛載一次即可。
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { sendPageView as gaSendPageView } from "@/services/gaService";
import { trackPageView as pixelTrackPageView } from "@/services/metaPixelService";

export function useAnalyticsPageView(): void {
  const location = useLocation();

  useEffect(() => {
    // 等 react-helmet-async 更新 document.title 後再送，讓 GA 收到正確的 page_title
    const id = requestAnimationFrame(() => {
      const path = location.pathname + location.search;
      gaSendPageView(path);
      pixelTrackPageView();
    });
    return () => cancelAnimationFrame(id);
  }, [location.pathname, location.search]);
}
