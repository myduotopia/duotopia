/**
 * 上傳題本核對畫面的捲動偵測（#1112 C4c cold-read E2）：老師往下捲考卷時，題號下拉的「第 N 題」
 * 跟著目前看到的題更新。
 *
 * - 「目前這題」＝捲動區頂端往下約 1/3 處那條線碰到的題（IntersectionObserver，root＝捲動區，
 *   rootMargin 把觀察範圍縮成那一條線）。同時碰到好幾個時取原卷順序最前面的。
 * - 以題為單位：每一題（題組的每個小題）預覽元素的 DOM id 是 `entryDomId(key)`（卡片 `itemAttrs` 掛上）；
 *   處理中的頁沒有題，不觀察。線落在兩題之間的空白時維持上一題。
 * - 程式捲動（下拉選題、需注意 ‹ ›）期間不改：`pausedAtRef` 記下開始捲的時間，之後 `PAUSE_MS` 內的
 *   變化忽略，免得平滑捲動經過的題把剛選的題蓋掉。
 * - 卡片展開編輯／收合後題目元素會換掉：`version` 變了就重新觀察。
 * - 沒有 IntersectionObserver（舊瀏覽器、測試環境）就不做事。
 */
import { useEffect, useRef, type RefObject } from "react";

import { entryDomId, type ReviewEntry } from "./reviewModel";

const PAUSE_MS = 1000;
/** 觀察線：捲動區頂端往下 1/3 */
const ROOT_MARGIN = "-33% 0px -66% 0px";

interface Options {
  rootRef: RefObject<HTMLElement | null>;
  entries: ReviewEntry[];
  enabled: boolean;
  onCurrent: (key: string) => void;
  pausedAtRef: RefObject<number>;
  /** 換了就重新觀察（例如正在編輯的卡片 id） */
  version?: unknown;
}

export function useReviewScrollSpy({
  rootRef,
  entries,
  enabled,
  onCurrent,
  pausedAtRef,
  version,
}: Options): void {
  const onCurrentRef = useRef(onCurrent);
  onCurrentRef.current = onCurrent;

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root || typeof IntersectionObserver === "undefined")
      return;
    const keyById = new Map<string, string>();
    const order = new Map<string, number>();
    entries.forEach((e, i) => {
      if (!e.cardId) return;
      keyById.set(entryDomId(e.key), e.key);
      order.set(e.key, i);
    });
    const crossing = new Set<string>();
    const observer = new IntersectionObserver(
      (records) => {
        records.forEach((r) => {
          const key = keyById.get((r.target as HTMLElement).id);
          if (!key) return;
          if (r.isIntersecting) crossing.add(key);
          else crossing.delete(key);
        });
        if (Date.now() - (pausedAtRef.current ?? 0) < PAUSE_MS) return;
        const best = [...crossing].sort(
          (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
        )[0];
        if (best !== undefined) onCurrentRef.current(best);
      },
      { root, rootMargin: ROOT_MARGIN, threshold: 0 },
    );
    keyById.forEach((_, id) => {
      const el = document.getElementById(id);
      if (el && root.contains(el)) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [rootRef, entries, enabled, pausedAtRef, version]);
}
