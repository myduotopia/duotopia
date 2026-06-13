/**
 * useShrinkToFit — content-aware 字級縮放 hook
 *
 * 目的（#842）：選項文字過長時自動縮字確保完整顯示，而非以 ... 截斷。
 * 純 CSS clamp(cqh/cqw) 只看容器、不看文字長度 → 長文字一樣 overflow。
 *
 * 設計重點：
 * - `useLayoutEffect` + `opacity-0` 直到 ready：paint 前完成量測，避免閃過大字
 * - 等 `document.fonts.ready`：避免 fallback 字型量寬偏差
 * - max 由 parent 動態算（maxRatio.h × clientH、maxRatio.w × clientW），對齊原 clamp(cqh/cqw) 行為
 * - rAF 內二分搜尋字級（最多 5 圈）；read 與 write 分到不同 frame 避免 layout thrashing
 * - ResizeObserver 觀察 parent 尺寸變化 → 重算
 *
 * 元件端要求：
 * - ref 指到要量的文字 element，需為 block / inline-block（inline 量不到 overflow）
 * - 該 element 需有 `max-h-full max-w-full overflow-hidden`，讓 scrollH > clientH 偵測 overflow
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

interface Options {
  maxRatio: { h: number; w: number }; // 對齊 cqh/cqw（例如 {h:0.2, w:0.14}）
  minFontSize: number; // px
  deps?: unknown[]; // 內容變動時觸發重算
}

interface Result {
  fontSize: number;
  ready: boolean;
}

export function useShrinkToFit(
  ref: RefObject<HTMLElement | null>,
  { maxRatio, minFontSize, deps = [] }: Options,
): Result {
  const [fontSize, setFontSize] = useState(minFontSize);
  const [ready, setReady] = useState(false);
  const rafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    let cancelled = false;

    const isOverflow = () =>
      el.scrollHeight > el.clientHeight + 1 ||
      el.scrollWidth > el.clientWidth + 1;

    const computeMax = () => {
      const ph = parent.clientHeight;
      const pw = parent.clientWidth;
      return Math.max(
        minFontSize,
        Math.floor(Math.min(ph * maxRatio.h, pw * maxRatio.w)),
      );
    };

    const measure = () => {
      if (cancelled) return;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (cancelled || !ref.current) return;
        const maxFs = computeMax();
        // 先試 max
        el.style.fontSize = `${maxFs}px`;
        if (!isOverflow()) {
          setFontSize(maxFs);
          setReady(true);
          return;
        }
        // 二分搜尋能放下的最大字級
        let lo = minFontSize;
        let hi = maxFs;
        let best = minFontSize;
        for (let i = 0; i < 6 && lo <= hi; i++) {
          const mid = Math.floor((lo + hi) / 2);
          el.style.fontSize = `${mid}px`;
          if (isOverflow()) {
            hi = mid - 1;
          } else {
            best = mid;
            lo = mid + 1;
          }
        }
        el.style.fontSize = `${best}px`;
        setFontSize(best);
        setReady(true);
      });
    };

    // 等字型載完才量；fonts API 不支援的瀏覽器直接量
    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    fontsReady.then(() => {
      if (!cancelled) measure();
    });

    const ro = new ResizeObserver(measure);
    ro.observe(parent);

    return () => {
      cancelled = true;
      ro.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, maxRatio.h, maxRatio.w, minFontSize, ...deps]);

  return { fontSize, ready };
}
