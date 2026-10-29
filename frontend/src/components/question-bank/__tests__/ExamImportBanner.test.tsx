/**
 * ExamImportBanner（#1112 C4）：未完成匯入提示列。
 * - 處理中的匯入顯示頁數進度；已處理完等核對（ready）顯示「待核對」
 * - 「繼續」直接打開那一份（openImport → 核對畫面）；「放棄」先跳確認（requestAbandon）
 * - 多份：「查看」展開每份
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import ExamImportBanner from "../exam-import/ExamImportBanner";
import type { ExamImportController } from "../exam-import/useExamImport";
import type { ExamImportSummary } from "../exam-import/types";

vi.mock("react-i18next", () => {
  const translation = {
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    i18n: { language: "zh-TW" },
  };
  return { useTranslation: () => translation };
});

function item(
  id: number,
  status: ExamImportSummary["status"],
): ExamImportSummary {
  return {
    id,
    file_name: `paper-${id}.pdf`,
    file_hash: "a".repeat(64),
    page_count: 4,
    status,
    settings: {},
    tts_accents: [],
    question_count: 3,
    pages_done: status === "ready" ? 4 : 2,
    pages_failed: 0,
    pages_blank: 0,
    created_at: "2026-10-29T00:00:00Z",
    updated_at: null,
  };
}

function controller(items: ExamImportSummary[]) {
  return {
    unfinished: items,
    openImport: vi.fn(),
    requestAbandon: vi.fn(),
  } as unknown as ExamImportController;
}

describe("ExamImportBanner", () => {
  it("沒有未完成的匯入就不顯示", () => {
    const { container } = render(
      <ExamImportBanner controller={controller([])} />,
    );
    expect(container.textContent).toBe("");
  });

  it("ready 顯示「待核對」，繼續直接打開核對畫面", () => {
    const c = controller([item(1, "ready")]);
    render(<ExamImportBanner controller={c} />);
    expect(screen.getByTestId("exam-import-banner").textContent).toContain(
      "questionBank.examImport.banner.ready",
    );
    fireEvent.click(screen.getByTestId("exam-banner-continue-1"));
    expect(c.openImport).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByTestId("exam-banner-abandon-1"));
    expect(c.requestAbandon).toHaveBeenCalledWith(1);
  });

  it("處理中顯示頁數；多份可展開", () => {
    const c = controller([item(1, "processing"), item(2, "ready")]);
    render(<ExamImportBanner controller={c} />);
    fireEvent.click(screen.getByTestId("exam-banner-toggle"));
    expect(screen.getByTestId("exam-banner-item-1").textContent).toContain(
      "questionBank.examImport.progress.count",
    );
    expect(screen.getByTestId("exam-banner-item-2").textContent).toContain(
      "questionBank.examImport.banner.ready",
    );
  });
});
