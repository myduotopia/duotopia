/**
 * 上傳題本（#1112 C3）送出順序（純函式，好測）。
 *
 * 規則（設計文件第三節、計畫檔定案 17 與 C3 cold-read）：
 * 1. **先往後找答案頁**：從最後一頁開始往前。還沒處理的頁就送（空白頁改成標記略過）；送完是
 *    答案頁、或是空白頁，就再往前一頁；遇到一般頁（或失敗、處理中的頁）就停。
 * 2. **再從第 1 頁依序**送其餘還沒處理的頁。
 * 一次只送一頁（呼叫端依序 await），不並行。
 *
 * `nextPageToSend` 每次依最新的頁狀態算出「下一頁要送哪一頁」，處理完一頁、重抓整份後再問一次；
 * 回傳 null 代表沒有可以自動送的頁了（失敗、處理中的頁留給老師按「重送這一頁」）。
 */
import type { ExamImportPage } from "./types";

/** 第一階段（往前找答案頁）會跳過繼續往前的頁：答案頁、空白頁略過 */
function passThrough(p: ExamImportPage): boolean {
  return p.status === "done" && (p.is_answer_page || p.blank_skipped);
}

/**
 * @param pages      目前各頁狀態（依 page_no）
 * @param skip       這一輪已經送過但仍是 pending 的頁（例如圖片過大被擋），不再自動送
 */
export function nextPageToSend(
  pages: ExamImportPage[],
  skip: ReadonlySet<number> = new Set(),
): number | null {
  const sorted = [...pages].sort((a, b) => b.page_no - a.page_no);
  for (const p of sorted) {
    if (p.status === "pending") {
      if (skip.has(p.page_no)) break;
      return p.page_no;
    }
    if (!passThrough(p)) break;
  }
  const forward = [...pages].sort((a, b) => a.page_no - b.page_no);
  const next = forward.find(
    (p) => p.status === "pending" && !skip.has(p.page_no),
  );
  return next ? next.page_no : null;
}
