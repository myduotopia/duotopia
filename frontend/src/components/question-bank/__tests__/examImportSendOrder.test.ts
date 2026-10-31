/**
 * 上傳題本（#1112 C3）純函式測試：送出順序（最後一頁先送、往前遇答案頁／空白頁繼續、再從第 1 頁）
 * 與空白頁判斷（墨跡比例門檻）。
 */

import { describe, it, expect } from "vitest";

import { nextPageToSend } from "../exam-import/sendOrder";
import {
  BLANK_INK_RATIO,
  inkRatio,
  isBlankPixels,
} from "../exam-import/blankPage";
import type { ExamImportPage } from "../exam-import/types";

function page(
  page_no: number,
  status: ExamImportPage["status"] = "pending",
  extra: Partial<ExamImportPage> = {},
): ExamImportPage {
  return {
    page_no,
    status,
    image_url: null,
    is_answer_page: false,
    cards: [],
    error: null,
    blank_skipped: false,
    resend_count: 0,
    processed_at: null,
    ...extra,
  };
}

describe("nextPageToSend", () => {
  it("先送最後一頁", () => {
    expect(nextPageToSend([page(1), page(2), page(3)])).toBe(3);
  });

  it("最後一頁是答案頁 → 往前一頁", () => {
    const pages = [page(1), page(2), page(3, "done", { is_answer_page: true })];
    expect(nextPageToSend(pages)).toBe(2);
  });

  it("往前找答案頁時跳過空白頁", () => {
    const pages = [
      page(1),
      page(2),
      page(3, "done", { blank_skipped: true }),
      page(4, "done", { is_answer_page: true }),
    ];
    expect(nextPageToSend(pages)).toBe(2);
  });

  it("最後一頁是一般頁 → 從第 1 頁依序", () => {
    const pages = [page(1), page(2), page(3, "done")];
    expect(nextPageToSend(pages)).toBe(1);
    expect(nextPageToSend([page(1, "done"), page(2), page(3, "done")])).toBe(2);
  });

  it("失敗、處理中的頁不自動送；全部處理完回 null", () => {
    expect(nextPageToSend([page(1, "failed"), page(2, "done")])).toBeNull();
    expect(nextPageToSend([page(1, "processing"), page(2)])).toBe(2);
    expect(nextPageToSend([page(1, "done"), page(2, "done")])).toBeNull();
  });

  it("這一輪送不出去的頁（skip）不再自動送", () => {
    const pages = [page(1), page(2), page(3)];
    expect(nextPageToSend(pages, new Set([3]))).toBe(1);
    expect(nextPageToSend(pages, new Set([1, 3]))).toBe(2);
  });
});

describe("blank page detection", () => {
  const rgba = (pixels: number, dark: number) => {
    const data = new Uint8ClampedArray(pixels * 4).fill(255);
    for (let i = 0; i < dark; i += 1) {
      data[i * 4] = 0;
      data[i * 4 + 1] = 0;
      data[i * 4 + 2] = 0;
    }
    return data;
  };

  it("全白是空白頁", () => {
    expect(isBlankPixels(rgba(100_000, 0))).toBe(true);
  });

  it("只有零星墨點（頁碼）算空白；超過門檻就不算", () => {
    const total = 1_000_000;
    const below = Math.floor(total * BLANK_INK_RATIO) - 1;
    expect(isBlankPixels(rgba(total, below))).toBe(true);
    expect(isBlankPixels(rgba(total, below + 2))).toBe(false);
  });

  it("淺灰雜訊不算墨跡", () => {
    const data = new Uint8ClampedArray(400).fill(200);
    expect(inkRatio(data)).toBe(0);
  });
});
