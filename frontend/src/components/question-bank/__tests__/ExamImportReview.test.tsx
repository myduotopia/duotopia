/**
 * ExamImportReview（#1112 C4b）核對畫面主要流程。API 全部用假的（不連網路）；QuestionCard／頂部設定
 * 換成簡單替身（編輯表單本身有自己的測試）。
 *
 * 1. 載入：依原卷頁碼列出還沒存的卡（已存的不顯示），題號導覽標籤＝原卷題號；缺答案琥珀、
 *    題庫已有藍；處理中的頁有灰色佔位條，「全部儲存」停用並說明「還有 N 頁處理中」
 * 2. 點卡片 → 原位展開編輯 →「完成」：有改才 PATCH（只送有改的欄位＋原卷題號），沒改不送
 * 3. 全部儲存：被退回的卡標出原因；「N 題因題庫已有而略過」；整份存完 → markSaved
 * 4. 點題庫已有的導覽格 → 以 id 抓原題顯示
 * 5. 題組（C4b 審查 1–5、7）：編輯題組 →「完成」送卡片格式＋rev；頁上最後一張題組、下一頁還沒處理完
 *    → 不能編輯並說明；409 CARD_CHANGED → 換成最新卡、編輯收起、提示重新打開；409 CARD_SAVED →
 *    放掉編輯；重複被略過只顯示藍字不加紅字；「全部儲存」連按只送一次
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import ExamImportReview from "../exam-import/ExamImportReview";
import type { ExamImportController } from "../exam-import/useExamImport";
import type {
  ExamImportCard,
  ExamImportDetail,
  ExamImportPage,
  ExamImportSaveResult,
} from "../exam-import/types";
import type { GroupDraft, QuestionDraft } from "../questionDraft";
import { ApiError } from "@/lib/api";

vi.mock("react-i18next", () => {
  const translation = {
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    i18n: { language: "zh-TW" },
  };
  return { useTranslation: () => translation };
});

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const api = vi.hoisted(() => ({
  patchCard: vi.fn(),
  save: vi.fn(),
  skipReview: vi.fn(),
  deleteCard: vi.fn(),
  addCard: vi.fn(),
  patchSettings: vi.fn(),
}));
vi.mock("../exam-import/examImportApi", () => ({ examImportApi: api }));

const getQuestion = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiClient: {
    listExamPoints: vi.fn(async () => ({
      items: [
        {
          id: 7,
          code: "G-01",
          parent_id: null,
          names: { "zh-TW": "現在式" },
          status: "active",
          order_index: 0,
          aliases: [],
        },
      ],
    })),
    getQuestion,
    getQuestionGroup: vi.fn(),
  },
}));

vi.mock("../exam-import/ExamImportReviewTop", () => ({
  default: () => <div data-testid="top-stub" />,
}));

vi.mock("../QuestionCard", () => ({
  default: ({
    draft,
    onChange,
  }: {
    draft: QuestionDraft;
    onChange: (d: QuestionDraft) => void;
  }) => (
    <input
      data-testid="qc-stub-stem"
      value={draft.stem}
      onChange={(e) => onChange({ ...draft, stem: e.target.value })}
    />
  ),
}));

vi.mock("../GroupCard", () => ({
  default: ({
    draft,
    onChange,
  }: {
    draft: GroupDraft;
    onChange: (d: GroupDraft) => void;
  }) => (
    <input
      data-testid="gc-stub-title"
      value={draft.title}
      onChange={(e) => onChange({ ...draft, title: e.target.value })}
    />
  ),
}));

function group(
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

function single(
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

function page(
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

function controllerWith(pages: ExamImportPage[]) {
  const detail: ExamImportDetail = {
    id: 9,
    file_name: "paper.pdf",
    file_hash: "a".repeat(64),
    page_count: pages.length,
    status: "ready",
    settings: {},
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

function renderReview(controller: ExamImportController) {
  return render(
    <ExamImportReview
      controller={controller}
      programs={[]}
      onRequestAbandon={vi.fn()}
    />,
  );
}

function saveResult(
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

beforeEach(() => {
  vi.clearAllMocks();
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
  Element.prototype.scrollIntoView = vi.fn();
});

describe("ExamImportReview：載入", () => {
  it("列出還沒存的卡、導覽標原卷題號與狀態色；處理中的頁有佔位條、全部儲存停用", () => {
    const saved = single("s", "40");
    saved.question!.saved_question_id = 123;
    const controller = controllerWith([
      page(1, [
        saved,
        single("a", "41"),
        single("b", "42", {}, []),
        single("c", "43", {
          duplicate_of: { type: "bank", kind: "single", id: 55 },
        }),
      ]),
      page(2, [], "processing"),
    ]);
    renderReview(controller);

    expect(screen.queryByTestId("exam-card-s-view")).toBeNull();
    expect(screen.getByTestId("exam-card-a-view")).toBeTruthy();
    expect(
      screen.getByTestId("exam-card-a-preview-q-0-number").textContent,
    ).toBe("41.");
    expect(screen.getByTestId("exam-card-a-answer-0").textContent).toContain(
      '"answer":"B"',
    );

    const cell = (k: string) => screen.getByTestId(`exam-review-nav-cell-${k}`);
    expect(cell("a:0").textContent).toBe("41");
    expect(cell("b:0").getAttribute("data-tone")).toBe("warning");
    expect(cell("c:0").getAttribute("data-tone")).toBe("info");
    expect(cell("page-2").getAttribute("data-tone")).toBe("pending");

    expect(screen.getByTestId("exam-page-2-placeholder")).toBeTruthy();
    const save = screen.getByTestId("exam-review-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByTestId("exam-review-save-reason").textContent).toContain(
      "questionBank.examImport.review.saveBlocked",
    );
    // 缺答案 1 題需注意（題庫已有的不算）
    expect(screen.getByTestId("exam-review-attention").textContent).toContain(
      '"count":1',
    );
  });
});

describe("ExamImportReview：編輯", () => {
  it("點卡片展開編輯，改了按完成 → PATCH 只送有改的欄位＋原卷題號", async () => {
    api.patchCard.mockResolvedValue({ card: single("a", "41"), import: {} });
    const controller = controllerWith([page(1, [single("a", "41")])]);
    renderReview(controller);

    fireEvent.click(screen.getByTestId("exam-card-a-view"));
    const stem = await screen.findByTestId("qc-stub-stem");
    fireEvent.change(stem, { target: { value: "New stem" } });
    fireEvent.click(screen.getByTestId("exam-card-a-done"));

    await waitFor(() => expect(api.patchCard).toHaveBeenCalled());
    expect(api.patchCard).toHaveBeenCalledWith(9, "a", {
      question: { stem: "New stem", source_question_no: "41" },
    });
    await waitFor(() =>
      expect(screen.queryByTestId("exam-card-a-editor")).toBeNull(),
    );
    expect(controller.reload).toHaveBeenCalled();
  });

  it("沒改就按完成 → 不送 PATCH", async () => {
    const controller = controllerWith([page(1, [single("a", "41")])]);
    renderReview(controller);
    fireEvent.click(screen.getByTestId("exam-card-a-edit"));
    await screen.findByTestId("qc-stub-stem");
    fireEvent.click(screen.getByTestId("exam-card-a-done"));
    await waitFor(() =>
      expect(screen.queryByTestId("exam-card-a-editor")).toBeNull(),
    );
    expect(api.patchCard).not.toHaveBeenCalled();
  });
});

describe("ExamImportReview：全部儲存", () => {
  it("被退回的卡標原因、顯示「N 題因題庫已有而略過」", async () => {
    api.save.mockResolvedValue(
      saveResult({
        saved: [{ card_id: "a" }],
        failed: [{ card_id: "b", reason: "missing_answer", message: "缺答案" }],
        skipped_duplicate_questions: 2,
      }),
    );
    const controller = controllerWith([
      page(1, [single("a", "41"), single("b", "42", {}, [])]),
    ]);
    renderReview(controller);
    fireEvent.click(screen.getByTestId("exam-review-save"));

    await waitFor(() => expect(api.save).toHaveBeenCalledWith(9));
    expect(
      (await screen.findByTestId("exam-card-b-save-failure")).textContent,
    ).toBe("缺答案");
    expect(controller.markSaved).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it("整份存完 → markSaved（關面板）", async () => {
    api.save.mockResolvedValue(
      saveResult({
        saved: [{ card_id: "a" }],
        completed: true,
        status: "saved",
        skipped_duplicate_questions: 1,
      }),
    );
    const controller = controllerWith([page(1, [single("a", "41")])]);
    renderReview(controller);
    fireEvent.click(screen.getByTestId("exam-review-save"));
    await waitFor(() => expect(controller.markSaved).toHaveBeenCalled());
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining(
        "questionBank.examImport.review.skippedDuplicates",
      ),
    );
  });
});

describe("ExamImportReview：題庫已有", () => {
  it("點藍色導覽格 → 以 id 抓原題", async () => {
    getQuestion.mockResolvedValue({
      id: 55,
      question_type: "multiple_choice",
      stem: "Old one",
      options: [],
      exam_points: [],
      program_links: [],
      sources: [],
      grade_min: null,
      grade_max: null,
      visibility: "private",
      image_url: null,
      stem_audio_url: null,
      explanation: null,
      allow_multiple_answers: false,
    });
    const controller = controllerWith([
      page(1, [
        single("c", "43", {
          duplicate_of: { type: "bank", kind: "single", id: 55 },
        }),
      ]),
    ]);
    renderReview(controller);
    fireEvent.click(screen.getByTestId("exam-review-nav-cell-c:0"));
    await waitFor(() => expect(getQuestion).toHaveBeenCalledWith(55));
    expect(
      await screen.findByTestId("exam-review-duplicate-dialog"),
    ).toBeTruthy();
  });
});

describe("ExamImportReview：題組", () => {
  it("編輯題組標題 →「完成」送卡片格式＋打開時的 rev", async () => {
    api.patchCard.mockResolvedValue({ card: group("g"), import: {} });
    const controller = controllerWith([page(1, [group("g")])]);
    renderReview(controller);
    fireEvent.click(screen.getByTestId("exam-card-g-edit"));
    const title = await screen.findByTestId("gc-stub-title");
    fireEvent.change(title, { target: { value: "New title" } });
    fireEvent.click(screen.getByTestId("exam-card-g-done"));
    await waitFor(() =>
      expect(api.patchCard).toHaveBeenCalledWith(9, "g", {
        rev: 5,
        group: { title: "New title" },
      }),
    );
  });

  it("頁上最後一張題組、下一頁還沒處理完 → 不能編輯並說明", () => {
    const controller = controllerWith([
      page(1, [group("g")]),
      page(2, [], "pending"),
    ]);
    renderReview(controller);
    const edit = screen.getByTestId("exam-card-g-edit") as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.getAttribute("title")).toBe(
      "questionBank.examImport.review.lockedUntilNextPage",
    );
    expect(screen.getByTestId("exam-card-g-locked")).toBeTruthy();
    fireEvent.click(screen.getByTestId("exam-card-g-view"));
    expect(screen.queryByTestId("exam-card-g-editor")).toBeNull();
  });

  it("409 CARD_CHANGED → 換成最新卡、編輯收起、提示重新打開", async () => {
    const latest = group("g", { rev: 6 });
    api.patchCard.mockRejectedValue(
      new ApiError(409, {
        error: "EXAM_IMPORT_CARD_CHANGED",
        message: "changed",
        card: latest,
      } as unknown as { message: string }),
    );
    const controller = controllerWith([page(1, [group("g")])]);
    renderReview(controller);
    fireEvent.click(screen.getByTestId("exam-card-g-edit"));
    fireEvent.change(await screen.findByTestId("gc-stub-title"), {
      target: { value: "Mine" },
    });
    fireEvent.click(screen.getByTestId("exam-card-g-done"));
    await waitFor(() =>
      expect(controller.replaceCard).toHaveBeenCalledWith(latest),
    );
    expect(screen.queryByTestId("exam-card-g-editor")).toBeNull();
    expect(toast.info).toHaveBeenCalledWith(
      "questionBank.examImport.review.cardChanged",
    );
  });

  it("409 CARD_SAVED → 放掉編輯、重抓", async () => {
    api.patchCard.mockRejectedValue(
      new ApiError(409, {
        error: "EXAM_IMPORT_CARD_SAVED",
        message: "saved",
      } as unknown as { message: string }),
    );
    const controller = controllerWith([page(1, [single("a", "41")])]);
    renderReview(controller);
    fireEvent.click(screen.getByTestId("exam-card-a-edit"));
    fireEvent.change(await screen.findByTestId("qc-stub-stem"), {
      target: { value: "Changed" },
    });
    fireEvent.click(screen.getByTestId("exam-card-a-done"));
    await waitFor(() =>
      expect(screen.queryByTestId("exam-card-a-editor")).toBeNull(),
    );
    expect(controller.reload).toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
  });

  it("存入時因重複略過 → 只有藍字，沒有紅字原因", async () => {
    api.save.mockResolvedValue(
      saveResult({
        failed: [{ card_id: "a", reason: "same_stem", message: "重複" }],
      }),
    );
    const controller = controllerWith([page(1, [single("a", "41")])]);
    renderReview(controller);
    fireEvent.click(screen.getByTestId("exam-review-save"));
    expect(
      await screen.findByTestId("exam-card-a-save-duplicate"),
    ).toBeTruthy();
    expect(screen.queryByTestId("exam-card-a-save-failure")).toBeNull();
  });

  it("「全部儲存」連按只送一次", async () => {
    let resolve: (r: ExamImportSaveResult) => void = () => undefined;
    api.save.mockReturnValue(
      new Promise<ExamImportSaveResult>((r) => {
        resolve = r;
      }),
    );
    const controller = controllerWith([page(1, [single("a", "41")])]);
    renderReview(controller);
    const save = screen.getByTestId("exam-review-save");
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    resolve(saveResult({ saved: [{ card_id: "a" }] }));
    await waitFor(() => expect(controller.reload).toHaveBeenCalled());
    expect(api.save).toHaveBeenCalledTimes(1);
  });
});
