/**
 * pageMergeInfo（#1112 第五輪）：從各頁卡片算出跨頁題組的說明。
 *
 * 資料仿實測的 16 頁題本：第 8–9、10–11 頁是跨頁題組（合併後第 9、11 頁沒卡片），
 * 第 16 頁封底沒有題目。
 */
import { describe, it, expect } from "vitest";

import {
  pageMergeInfo,
  type ExamImportCard,
  type ExamImportPage,
} from "../exam-import/types";

function page(no: number, cards: ExamImportCard[]): ExamImportPage {
  return {
    page_no: no,
    status: "done",
    image_url: null,
    is_answer_page: false,
    cards,
    error: null,
    blank_skipped: false,
    resend_count: 0,
    processed_at: null,
  };
}

function q(no: string | null, pageNo: number) {
  return { source_question_no: no, page_no: pageNo };
}

function group(
  id: string,
  pageNo: number,
  pages: number[],
  questions: ReturnType<typeof q>[],
): ExamImportCard {
  return {
    card_id: id,
    kind: "group",
    page_no: pageNo,
    pages,
    group: { questions },
  };
}

const single = (id: string, no: string, pageNo: number): ExamImportCard => ({
  card_id: id,
  kind: "single",
  page_no: pageNo,
  pages: [pageNo],
  question: q(no, pageNo),
});

describe("pageMergeInfo", () => {
  const pages = [
    page(7, [single("s29", "29", 7)]),
    page(8, [
      group("g8", 8, [8, 9], [q("30", 8), q("31", 9), q("32", 9), q("33", 9)]),
    ]),
    page(9, []),
    page(10, [
      group("g10", 10, [10, 11], [q("34", 11), q("35", 11), q("36", 11)]),
    ]),
    page(11, []),
    page(16, []),
  ];
  const info = pageMergeInfo(pages);

  it("跨頁題組所在頁標 span（跨第 8–9、10–11 頁）", () => {
    expect(info.get(8)).toEqual({ kind: "span", from: 8, to: 9 });
    expect(info.get(10)).toEqual({ kind: "span", from: 10, to: 11 });
  });

  it("被併入的頁標 merged＋目標頁＋該頁小題的題號範圍", () => {
    expect(info.get(9)).toEqual({
      kind: "merged",
      target: 8,
      from: 31,
      to: 33,
    });
    expect(info.get(11)).toEqual({
      kind: "merged",
      target: 10,
      from: 34,
      to: 36,
    });
  });

  it("封底空卡、單題頁、沒在任何 pages 裡的頁都沒有說明", () => {
    expect(info.has(16)).toBe(false);
    expect(info.has(7)).toBe(false);
  });

  it("併入頁的小題沒有題號 → merged 不帶範圍", () => {
    const r = pageMergeInfo([
      page(3, [group("g", 3, [3, 4], [q("1", 3), q(null, 4)])]),
      page(4, []),
    ]);
    expect(r.get(4)).toEqual({ kind: "merged", target: 3 });
  });

  it("單頁題組（pages 只有自己）不算跨頁", () => {
    const r = pageMergeInfo([
      page(5, [group("g", 5, [5], [q("1", 5), q("2", 5)])]),
    ]);
    expect(r.size).toBe(0);
  });

  it("跨三頁：中間與最後一頁都併入起始頁", () => {
    const r = pageMergeInfo([
      page(12, [
        group("g", 12, [12, 13, 14], [q("37", 12), q("38", 13), q("39", 14)]),
      ]),
      page(13, []),
      page(14, []),
    ]);
    expect(r.get(12)).toEqual({ kind: "span", from: 12, to: 14 });
    expect(r.get(13)).toEqual({ kind: "merged", target: 12, from: 38, to: 38 });
    expect(r.get(14)).toEqual({ kind: "merged", target: 12, from: 39, to: 39 });
  });
});

describe("pageMergeInfo：跨頁優先（C4 第五輪遺留）", () => {
  it("同一頁既有小題併入前一頁題組、自己又有跨頁題組 → 標跨頁", () => {
    const info = pageMergeInfo([
      page(8, [group("g8", 8, [8, 9], [q("30", 8), q("31", 9)])]),
      page(9, [group("g9", 9, [9, 10], [q("32", 9), q("33", 10)])]),
      page(10, []),
    ]);
    expect(info.get(9)).toEqual({ kind: "span", from: 9, to: 10 });
    expect(info.get(10)).toMatchObject({ kind: "merged", target: 9 });
  });
});
