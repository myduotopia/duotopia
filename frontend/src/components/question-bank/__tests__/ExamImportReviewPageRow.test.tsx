/**
 * ExamImportReviewPageRow（#1112 第五輪 → C4 搬進核對畫面「原卷第 N 頁」那一行；原
 * ExamImportProgress 測試）：0 題的頁要說明原因、縮圖可放大、各頁按鈕。
 *
 * - 第 9 頁：小題併入第 8 頁題組 →「已併入第 8 頁的題組（第 31–33 題）」
 * - 第 8 頁：題組跨第 8–9 頁 →「完成・擷取 N 題（跨第 8–9 頁）」
 * - 第 16 頁：封底沒有題目 →「沒有題目」
 * - 併入頁的小題沒題號 → 省略括號（mergedNoRange）
 * - 縮圖是 ZoomableImage（按鈕撐滿縮圖框）
 * - 失敗頁有檔案 →「重送這一頁」；重送次數用完 →「這一頁讀不出來，請手動補題」＋「手動補一題」
 * - 空白頁 →「仍要送出這一頁」；處理中 → 灰色佔位條
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import ExamImportReviewPageRow from "../exam-import/ExamImportReviewPageRow";
import type { ExamImportController } from "../exam-import/useExamImport";
import {
  pageMergeInfo,
  type ExamImportCard,
  type ExamImportPage,
} from "../exam-import/types";

vi.mock("react-i18next", () => {
  const translation = {
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    i18n: { language: "zh-TW" },
  };
  return { useTranslation: () => translation };
});

function page(
  no: number,
  cards: ExamImportCard[],
  patch: Partial<ExamImportPage> = {},
): ExamImportPage {
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
    ...patch,
  };
}

function group(
  pageNo: number,
  pages: number[],
  questions: { source_question_no: string | null; page_no: number }[],
): ExamImportCard {
  return {
    card_id: `g${pageNo}`,
    kind: "group",
    page_no: pageNo,
    pages,
    group: { questions },
  };
}

function controller(
  patch: Partial<Record<string, unknown>> = {},
): ExamImportController {
  return {
    detail: { retry_limits: { page_resends: 2, question_retries: 2 } },
    running: false,
    activePage: null,
    pageNotes: {},
    thumbs: {},
    hasSource: true,
    staleProcessing: () => false,
    sendBlankPage: vi.fn(),
    resendPage: vi.fn(),
    ...patch,
  } as unknown as ExamImportController;
}

function renderRows(pages: ExamImportPage[], ctrl = controller()) {
  const info = pageMergeInfo(pages);
  const onAdd = vi.fn();
  render(
    <div>
      {pages.map((p) => (
        <ExamImportReviewPageRow
          key={p.page_no}
          page={p}
          hasCards={p.cards.length > 0}
          merge={info.get(p.page_no)}
          controller={ctrl}
          onAddCard={onAdd}
        />
      ))}
    </div>,
  );
  return { onAdd, ctrl };
}

describe("ExamImportReviewPageRow 0 題說明", () => {
  it("併入、跨頁、沒有題目三種顯示", () => {
    renderRows([
      page(8, [
        group(
          8,
          [8, 9],
          [
            { source_question_no: "30", page_no: 8 },
            { source_question_no: "31", page_no: 9 },
            { source_question_no: "32", page_no: 9 },
            { source_question_no: "33", page_no: 9 },
          ],
        ),
      ]),
      page(9, []),
      page(16, []),
    ]);

    const merged = screen.getByTestId("exam-page-9-merged");
    expect(merged.textContent).toContain(
      "questionBank.examImport.progress.status.merged ",
    );
    expect(merged.textContent).toContain('"target":8');
    expect(merged.textContent).toContain('"range":"31–33"');

    const span = screen.getByTestId("exam-page-8-span");
    expect(span.textContent).toContain('"count":4');
    expect(span.textContent).toContain('"from":8');
    expect(span.textContent).toContain('"to":9');

    expect(screen.getByTestId("exam-page-16-empty").textContent).toBe(
      "questionBank.examImport.progress.status.empty",
    );
    expect(screen.queryByTestId("exam-page-16-merged")).toBeNull();
  });

  it("併入頁的小題沒題號 → 不帶括號（mergedNoRange）", () => {
    renderRows([
      page(3, [
        group(
          3,
          [3, 4],
          [
            { source_question_no: "1", page_no: 3 },
            { source_question_no: null, page_no: 4 },
          ],
        ),
      ]),
      page(4, []),
    ]);
    expect(screen.getByTestId("exam-page-4-merged").textContent).toContain(
      "questionBank.examImport.progress.status.mergedNoRange",
    );
  });

  it("縮圖可點開放大（按鈕撐滿縮圖框）", () => {
    renderRows([page(1, [], { image_url: "/page1.png" })]);
    const thumb = screen.getByTestId("exam-page-1-thumb");
    const button = thumb.closest("button");
    expect(button).not.toBeNull();
    expect(button!.className).toContain("cursor-zoom-in");
    expect(button!.className).toContain("h-full");
    expect(button!.className).toContain("w-full");
  });
});

describe("ExamImportReviewPageRow 按鈕", () => {
  it("失敗頁有檔案 → 重送這一頁", () => {
    const { ctrl } = renderRows([page(2, [], { status: "failed" })]);
    fireEvent.click(screen.getByTestId("exam-page-2-resend"));
    expect(ctrl.resendPage).toHaveBeenCalledWith(2);
  });

  it("重送次數用完 → 請手動補題＋手動補一題", () => {
    const { onAdd } = renderRows([
      page(2, [], { status: "failed", resend_count: 2 }),
    ]);
    expect(screen.queryByTestId("exam-page-2-resend")).toBeNull();
    expect(screen.getByTestId("exam-page-2-manual-fill")).toBeTruthy();
    fireEvent.click(screen.getByTestId("exam-page-2-add"));
    expect(onAdd).toHaveBeenCalledWith(2);
  });

  it("空白頁 → 仍要送出這一頁；處理中 → 灰色佔位條", () => {
    const { ctrl } = renderRows([
      page(5, [], { blank_skipped: true }),
      page(6, [], { status: "processing" }),
    ]);
    fireEvent.click(screen.getByTestId("exam-page-5-send-blank"));
    expect(ctrl.sendBlankPage).toHaveBeenCalledWith(5);
    expect(screen.getByTestId("exam-page-6-placeholder")).toBeTruthy();
  });
});
