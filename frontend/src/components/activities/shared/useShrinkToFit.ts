/**
 * useShrinkToFit — content-aware 字級「撐滿格子」hook
 *
 * 目的（#842 / #844）：選項文字字級自動貼合選項框——
 *   - 字少：放大到剛好塞滿格子的最大字級（上限 maxFontSize）→ 不再一小行浮在中間
 *   - 字多：自動縮小到剛好放得下（一般下限 minFontSize），而非以 ... 截斷
 *   - anti-clip：若連 minFontSize 都塞不下，再往下縮到 hardMinFontSize（保證完整顯示、
 *     永不變「...」）；長選項可讀性主要靠呼叫端用版面給足寬度，而非靠抬高下限
 *   兩者由同一套二分搜尋決定：short 往上長、long 往下縮，各自獨立、互不拖累。
 *   （#844：原本用 maxRatio 比例當上限，比例偏低 → 短文字撐不大；改為
 *    「在 [min,max] 內取不 overflow 的最大字級」，純 fit-to-box，短字自然填滿框。）
 *
 * 設計重點：
 * - useLayoutEffect + opacity-0 直到 ready：paint 前完成量測，避免閃過大字
 * - 等 document.fonts.ready：避免 fallback 字型量寬偏差
 * - rAF 內二分搜尋字級（read 與 write 分到不同 frame 避免 layout thrashing）
 * - ResizeObserver 觀察 parent 尺寸變化 → 重算
 *
 * 元件端要求：
 * - ref 指到要量的文字 element，需為 block / inline-block（inline 量不到 overflow）
 * - 該 element 需有 `max-h-full max-w-full overflow-hidden`，讓 scrollH > clientH 偵測 overflow
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

interface Options {
  maxFontSize: number; // px 上限：字少時最多放到這麼大（撐滿格子）
  minFontSize: number; // px 一般下限：字多時優先縮到這裡（守住可讀性）
  hardMinFontSize?: number; // px 硬底：minFontSize 仍塞不下時才再往下縮到這，保證「不裁字」（預設 = minFontSize）
  deps?: unknown[]; // 內容變動時觸發重算
}

interface Result {
  fontSize: number;
  ready: boolean;
}

export function useShrinkToFit(
  ref: RefObject<HTMLElement | null>,
  { maxFontSize, minFontSize, hardMinFontSize, deps = [] }: Options,
): Result {
  const hardMin = Math.min(minFontSize, hardMinFontSize ?? minFontSize);
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

    const measure = () => {
      if (cancelled) return;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (cancelled || !ref.current) return;
        const hi0 = Math.max(minFontSize, maxFontSize);
        // 先試上限：字少 + 框夠大時直接放到最大，省去搜尋
        el.style.fontSize = `${hi0}px`;
        if (!isOverflow()) {
          setFontSize(hi0);
          setReady(true);
          return;
        }
        // 二分搜尋 [min, max] 取「不 overflow 的最大字級」→ 撐滿框
        let lo = minFontSize;
        let hi = hi0;
        let best = minFontSize;
        let found = false;
        for (let i = 0; i < 7 && lo <= hi; i++) {
          const mid = Math.floor((lo + hi) / 2);
          el.style.fontSize = `${mid}px`;
          if (isOverflow()) {
            hi = mid - 1;
          } else {
            best = mid;
            found = true;
            lo = mid + 1;
          }
        }
        // anti-clip：連 minFontSize 都塞不下時，往下縮到 hardMin 保證完整顯示
        // （縮字級而非裁字 → 永遠不會變「...」）；長選項可讀性靠版面給寬度，不靠這條
        if (!found && hardMin < minFontSize) {
          let f = minFontSize;
          while (f > hardMin) {
            f -= 1;
            el.style.fontSize = `${f}px`;
            if (!isOverflow()) break;
          }
          best = f;
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
  }, [ref, maxFontSize, minFontSize, hardMin, ...deps]);

  return { fontSize, ready };
}
