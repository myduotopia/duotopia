/**
 * useMediaQuery — 回傳 CSS media query 目前是否成立，視窗大小改變時跟著更新。
 *
 * 給「只靠 CSS 藏不夠、要改行為」的地方用（例如手機寬度時自動收起浮動工具列、窄螢幕不開整頁對照分頁）。
 * 沒有 `matchMedia` 的環境（SSR、部分測試）一律回傳 false。
 */
import { useEffect, useState } from "react";

const read = (query: string): boolean =>
  typeof window !== "undefined" && !!window.matchMedia?.(query)?.matches;

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => read(query));
  useEffect(() => {
    const mql = typeof window !== "undefined" && window.matchMedia?.(query);
    if (!mql) return;
    const update = () => setMatches(!!mql.matches);
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}
