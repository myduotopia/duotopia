/**
 * 讓 textarea 隨內容長高（文件感：沒有捲軸、沒有固定高度）。
 * 段落／標題區塊（LayoutBlockEditor）與單字註解（GroupCard）共用。
 */

import { useEffect, type RefObject } from "react";

export const DOC_TEXTAREA_CLASS =
  "min-h-0 resize-none overflow-hidden border-0 bg-transparent px-0 py-0.5 shadow-none focus-visible:ring-0";

export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement>,
  value: string,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}
