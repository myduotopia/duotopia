/**
 * ExamImportReview（#1112 C4b）核對畫面主要流程。API 全部用假的（不連網路）；QuestionCard／頂部設定
 * 換成簡單替身（編輯表單本身有自己的測試）。
 *
 * 1. 載入：依原卷頁碼列出還沒存的卡（已存的不顯示），卡上編號＝原卷題號；處理中的頁有灰色佔位條，
 *    「全部儲存」停用並說明「還有 N 頁處理中」；需注意不含題庫已有的
 * 2. 點卡片 → 原位展開編輯 →「完成」：有改才 PATCH（只送有改的欄位＋原卷題號），沒改不送
 * 3. 全部儲存：被退回的卡標出原因；「N 題因題庫已有而略過」；整份存完 → markSaved；整份設定缺必填 →
 *    不送、展開設定（C4c E5）
 * 4. 題庫已有：卡片上「看原題」→ 以 id 抓原題顯示（題號下拉只捲動，C4c E4）
 * 5. 題組（C4b 審查 1–5、7）：編輯題組 →「完成」送卡片格式＋rev；頁上最後一張題組、下一頁還沒處理完
 *    → 不能編輯並說明；409 CARD_CHANGED → 換成最新卡、編輯收起、提示重新打開；409 CARD_SAVED →
 *    放掉編輯；重複被略過只顯示藍字不加紅字；「全部儲存」連按只送一次
 * 題號下拉、捲動偵測、需注意 ‹ › 在 ExamImportReviewNav.test.tsx；整頁對照在 ExamImportCompareView.test.tsx。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import type { ExamImportSaveResult } from "../exam-import/types";
import type { GroupDraft, QuestionDraft } from "../questionDraft";
import { ApiError } from "@/lib/api";
import {
  controllerWith,
  group,
  page,
  renderReview,
  saveResult,
  single,
} from "./examImportReviewFixtures";

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
  default: ({
    expanded,
    missing,
    focusRequest,
  }: {
    expanded: boolean;
    missing: string[];
    focusRequest: number;
  }) => (
    <div
      data-testid="top-stub"
      data-expanded={String(expanded)}
      data-missing={missing.join(",")}
      data-focus={String(focusRequest)}
    />
  ),
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

beforeEach(() => {
  vi.clearAllMocks();
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
  Element.prototype.scrollIntoView = vi.fn();
});

describe("ExamImportReview：載入", () => {
  it("列出還沒存的卡、卡上標原卷題號；處理中的頁有佔位條、全部儲存停用", () => {
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

    // 左側題號方格已移除（C4c），改成上方題號下拉
    expect(screen.queryByTestId("exam-review-nav")).toBeNull();
    expect(screen.getByTestId("exam-review-picker")).toBeTruthy();
    // 還沒存的 3 題待核對
    expect(screen.getByTestId("exam-review-remaining").textContent).toContain(
      '"count":3',
    );

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

  it("處理失敗的卡按「手動補這一題」→ 編輯中不顯示「重試」，收合後才回來", async () => {
    const failedCard = single("f", "44", { status: "failed", retry_count: 0 });
    const controller = controllerWith([page(1, [failedCard])]);
    renderReview(controller);

    expect(screen.getByTestId("exam-card-f-retry")).toBeTruthy();
    fireEvent.click(screen.getByTestId("exam-card-f-manual"));
    await screen.findByTestId("exam-card-f-editor");
    expect(screen.queryByTestId("exam-card-f-retry")).toBeNull();

    fireEvent.click(screen.getByTestId("exam-card-f-cancel"));
    await waitFor(() =>
      expect(screen.getByTestId("exam-card-f-retry")).toBeTruthy(),
    );
    expect(controller.retryQuestion).not.toHaveBeenCalled();
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

  it("整份設定缺必填 → 不送存入、展開設定並要求焦點（C4c E5）；略過核對也一樣", () => {
    const controller = controllerWith([page(1, [single("a", "41")])], {
      grade_min: 7,
      grade_max: 9,
      source_id: null,
      visibility: null,
    });
    renderReview(controller);
    const top = screen.getByTestId("top-stub");
    expect(top.getAttribute("data-expanded")).toBe("false");
    expect(top.getAttribute("data-missing")).toBe("source,visibility");

    fireEvent.click(screen.getByTestId("exam-review-save"));
    expect(api.save).not.toHaveBeenCalled();
    expect(top.getAttribute("data-expanded")).toBe("true");
    expect(top.getAttribute("data-focus")).toBe("1");
    expect(toast.info).toHaveBeenCalledWith(
      "questionBank.examImport.errors.settingsIncomplete",
    );

    fireEvent.click(screen.getByTestId("exam-review-skip"));
    expect(top.getAttribute("data-focus")).toBe("2");
    // 確認視窗沒有打開
    expect(
      screen.queryByText("questionBank.examImport.review.skipTitle"),
    ).toBeNull();
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
  it("卡片上「看原題」→ 以 id 抓原題", async () => {
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
    fireEvent.click(screen.getByTestId("exam-card-c-view-original"));
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
