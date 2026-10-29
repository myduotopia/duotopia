/**
 * ExamImportProgress（#1112 第五輪）：0 題的頁要說明原因、頁碼說明、縮圖可放大。
 *
 * - 第 9 頁：小題併入第 8 頁題組 →「已併入第 8 頁的題組（第 31–33 題）」
 * - 第 8 頁：題組跨第 8–9 頁 →「完成・擷取 N 題（跨第 8–9 頁）」
 * - 第 16 頁：封底沒有題目 →「沒有題目」
 * - 併入頁的小題沒題號 → 省略括號（mergedNoRange）
 * - 列表上方灰色小字「頁碼是 PDF 檔的頁序…」
 * - 縮圖是 ZoomableImage（按鈕撐滿縮圖框）
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import ExamImportProgress from "../exam-import/ExamImportProgress";
import type { ExamImportController } from "../exam-import/useExamImport";
import type {
  ExamImportCard,
  ExamImportDetail,
  ExamImportPage,
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
  image_url: string | null = null,
): ExamImportPage {
  return {
    page_no: no,
    status: "done",
    image_url,
    is_answer_page: false,
    cards,
    error: null,
    blank_skipped: false,
    resend_count: 0,
    processed_at: null,
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

function controllerWith(pages: ExamImportPage[]): ExamImportController {
  const detail: ExamImportDetail = {
    id: 1,
    file_name: "paper.pdf",
    file_hash: "a".repeat(64),
    page_count: pages.length,
    status: "ready",
    settings: {},
    tts_accents: ["american"],
    question_count: 0,
    pages_done: pages.length,
    pages_failed: 0,
    pages_blank: 0,
    created_at: null,
    updated_at: null,
    known_answers: {},
    retry_limits: { page_resends: 2, question_retries: 2 },
    pages,
  };
  return {
    detail,
    loadingDetail: false,
    running: false,
    activePage: null,
    pageNotes: {},
    runError: null,
    thumbs: {},
    hasSource: false,
    needsFile: false,
    canResume: false,
    staleProcessing: () => false,
    attachFiles: vi.fn(),
    resume: vi.fn(),
    sendBlankPage: vi.fn(),
    resendPage: vi.fn(),
  } as unknown as ExamImportController;
}

function renderProgress(pages: ExamImportPage[]) {
  return render(
    <ExamImportProgress
      controller={controllerWith(pages)}
      onRequestAbandon={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe("ExamImportProgress 0 題說明", () => {
  it("併入、跨頁、沒有題目三種顯示", () => {
    renderProgress([
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
    expect(span.textContent).toContain(
      "questionBank.examImport.progress.status.doneSpan",
    );
    expect(span.textContent).toContain('"count":4');
    expect(span.textContent).toContain('"from":8');
    expect(span.textContent).toContain('"to":9');

    expect(screen.getByTestId("exam-page-16-empty").textContent).toBe(
      "questionBank.examImport.progress.status.empty",
    );
    // 第 16 頁不是被併入的頁
    expect(screen.queryByTestId("exam-page-16-merged")).toBeNull();
  });

  it("併入頁的小題沒題號 → 不帶括號（mergedNoRange）", () => {
    renderProgress([
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

  it("列表上方顯示頁碼說明；縮圖可點開放大", () => {
    renderProgress([page(1, [], "/page1.png")]);
    expect(
      screen.getByTestId("exam-progress-page-order-hint").textContent,
    ).toBe("questionBank.examImport.progress.pageOrderHint");
    const thumb = screen.getByTestId("exam-page-1-thumb");
    const button = thumb.closest("button");
    expect(button).not.toBeNull();
    expect(button!.className).toContain("cursor-zoom-in");
    expect(button!.className).toContain("h-full");
    expect(button!.className).toContain("w-full");
  });
});
