/**
 * 上傳題本核對畫面測試共用的假資料（#1112 C4c 從 ExamImportReview.test.tsx 抽出）：題目卡、頁、
 * 假的 controller（整份設定預設已填齊，`settings` 可覆寫）、存入結果、render。不是測試檔（不含 vi.mock）。
 */
import { vi } from "vitest";
import { render } from "@testing-library/react";

import ExamImportReview from "../exam-import/ExamImportReview";
import type { ExamImportController } from "../exam-import/useExamImport";
import type {
  ExamImportCard,
  ExamImportDetail,
  ExamImportPage,
  ExamImportSaveResult,
} from "../exam-import/types";

/** 整份設定填齊（年段、來源、公開） */
export const COMPLETE_SETTINGS: ExamImportDetail["settings"] = {
  grade_min: 7,
  grade_max: 9,
  source_id: 3,
  visibility: "public",
};

export function group(
  id: string,
  patch: Partial<ExamImportCard> = {},
): ExamImportCard {
  return {
    card_id: id,
    kind: "group",
    page_no: 1,
    pages: [1],
    status: "ok",
    duplicate_of: null,
    rev: 5,
    group: {
      group_type: "reading",
      title: "Passage",
      stimulus: { kind: "text", paragraphs: ["Tom goes to school."] },
      glossary: [],
      questions: [
        {
          source_question_no: "1",
          stem: "Where?",
          options: ["home", "school"],
          correct_indexes: [1],
          status: "ok",
        },
      ],
    },
    ...patch,
  };
}

export function single(
  id: string,
  no: string,
  patch: Partial<ExamImportCard> = {},
  correct: number[] = [1],
): ExamImportCard {
  return {
    card_id: id,
    kind: "single",
    page_no: 1,
    pages: [1],
    status: "ok",
    duplicate_of: null,
    question: {
      source_question_no: no,
      page_no: 1,
      stem: `Question ${no}`,
      options: ["apple", "banana", "cherry", "durian"],
      correct_indexes: correct,
      answer_source: "ai",
      exam_point_codes: ["G-01"],
      status: "ok",
    },
    ...patch,
  };
}

export function page(
  no: number,
  cards: ExamImportCard[],
  status: ExamImportPage["status"] = "done",
): ExamImportPage {
  return {
    page_no: no,
    status,
    image_url: null,
    is_answer_page: false,
    cards,
    error: null,
    blank_skipped: false,
    resend_count: 0,
    processed_at: null,
  };
}

export function controllerWith(
  pages: ExamImportPage[],
  settings: ExamImportDetail["settings"] = COMPLETE_SETTINGS,
) {
  const detail: ExamImportDetail = {
    id: 9,
    file_name: "paper.pdf",
    file_hash: "a".repeat(64),
    page_count: pages.length,
    status: "ready",
    settings,
    tts_accents: ["American English"],
    question_count: 0,
    pages_done: pages.filter((p) => p.status === "done").length,
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
    organizationId: null,
    resendPage: vi.fn(),
    sendBlankPage: vi.fn(),
    reload: vi.fn(async () => detail),
    retryQuestion: vi.fn(),
    replaceCard: vi.fn(),
    setBeforeClose: vi.fn(),
    markSaved: vi.fn(),
  } as unknown as ExamImportController;
}

export function renderReview(controller: ExamImportController) {
  return render(
    <ExamImportReview
      controller={controller}
      programs={[]}
      onRequestAbandon={vi.fn()}
    />,
  );
}

export function saveResult(
  patch: Partial<ExamImportSaveResult>,
): ExamImportSaveResult {
  return {
    saved: [],
    failed: [],
    skipped_duplicate_cards: 0,
    skipped_duplicate_questions: 0,
    completed: false,
    status: "ready",
    import: {} as ExamImportSaveResult["import"],
    ...patch,
  };
}
