import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { sendPageView } from "@/services/gaService";

/**
 * 只在 /blog 開頭的路由發送 GA4 page_view 事件。
 * 放在 App 層級，每次路由變化自動判斷。
 */
export function useBlogPageTracking() {
  const location = useLocation();

  useEffect(() => {
    if (location.pathname.startsWith("/blog")) {
      sendPageView(location.pathname);
    }
  }, [location.pathname]);
}
