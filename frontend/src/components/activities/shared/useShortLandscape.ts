/**
 * useShortLandscape — 偵測「橫向 + 矮視窗」（手機橫放）情境
 *
 * 兩個 word selection 元件共用：題目有圖時用來決定走「圖上選下」(false) 或
 * 「圖左選右」(true) 的排版。桌機/平板橫放高度通常 >700px 仍走直式。
 */

import { useEffect, useState } from "react";

const QUERY = "(orientation: landscape) and (max-height: 700px)";

export function useShortLandscape(): boolean {
  const [match, setMatch] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(QUERY).matches : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setMatch(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return match;
}
