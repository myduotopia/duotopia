/**
 * MultipleChoiceQuestionSheet 測試（Issue #1064）— 單字集同款左欄 + 右欄多題。
 *
 * 驗證：左欄順序與上傳／AI 為即將推出；進階設定預設收起；考點必填、公開必選擋送出；
 * 左側批次覆寫所有卡且新增題帶批次值；編輯模式單卡預填走 updateQuestion（含 source_ids）；
 * 逐題送出與部分失敗；批次編輯中途失敗（#1077：停在失敗題、sheet 不關、該卡顯示後端訊息、
 * toast 部分成功）；readOnly。
 *
 * Radix Select 在 jsdom 難以操作，需要「已選公開設定」的送出流程用編輯模式（值已預填）。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import MultipleChoiceQuestionSheet from "../MultipleChoiceQuestionSheet";
import type { ExamPoint, Question } from "@/types/questionBank";

const createQuestion = vi.fn();
const updateQuestion = vi.fn();
const findSimilarQuestions = vi.fn();
const listExamPoints = vi.fn();
const listSources = vi.fn();
const aiAnswerQuestions = vi.fn();

// 題組擷取（#1084）：MagicPasteInput 換成 stub，按鈕直接觸發 onInsertGroup；裁圖／上傳 mock
const {
  cropImageFileMock,
  cropImageFileManyMock,
  uploadImageFileMock,
  GROUP_RESULT,
  CLOZE_RESULT,
  MC_ITEMS,
} = vi.hoisted(() => ({
  cropImageFileMock: vi.fn(),
  cropImageFileManyMock: vi.fn(),
  uploadImageFileMock: vi.fn(),
  // 單題擷取（#1084）：題幹圖 + 四個「只有圖沒有字」的選項
  MC_ITEMS: [
    {
      stem: "Which picture shows the answer?",
      stem_box_2d: [0, 0, 100, 1000],
      options: ["", "", "", ""],
      option_boxes: [
        [100, 0, 200, 250],
        [100, 250, 200, 500],
        [100, 500, 200, 750],
        [100, 750, 200, 1000],
      ],
      correct_indexes: [1],
      explanation: "",
    },
  ],
  // 克漏字擷取（#1086）：文章有 {{n}}、小題題幹一律是空字串
  CLOZE_RESULT: {
    title: "Santa's Letter",
    stimulus: {
      kind: "text",
      paragraphs: ["Dear Santa, I {{1}} a bike.", "I will {{2}} good."],
      text: "",
      box_2d: null,
      page: null,
      blanks_renumbered: true,
    },
    glossary: [],
    questions: [
      {
        stem: "",
        blank: 1,
        options: ["want", "wants", "wanted", "wanting"],
        correct_indexes: [0],
        explanation: "",
      },
      {
        stem: "",
        blank: 2,
        options: ["be", "being", "been", "to be"],
        correct_indexes: [0],
        explanation: "",
      },
    ],
  },
  GROUP_RESULT: {
    title: "Lantern",
    stimulus: {
      kind: "image",
      paragraphs: [],
      text: "Happy Town Lantern Festival",
      box_2d: [0, 0, 600, 1000],
      page: 1,
    },
    glossary: [{ word: "lantern", zh: "燈籠" }],
    questions: [
      {
        stem: "What is the purpose?",
        options: ["a", "b", "c", "d"],
        correct_indexes: [2],
        explanation: "",
      },
    ],
  },
}));
vi.mock("@/components/shared/MagicPasteInput", () => ({
  __esModule: true,
  default: (props: {
    extractMode?: string;
    onInsertGroup?: (r: unknown, f: File) => void | Promise<void>;
    onInsertQuestions?: (items: unknown[], f: File) => void | Promise<void>;
  }) => (
    <div data-testid="mp-stub" data-mode={props.extractMode ?? "vocabulary"}>
      <button
        type="button"
        data-testid="mp-trigger-group"
        onClick={() =>
          void props.onInsertGroup?.(
            GROUP_RESULT,
            new File(["x"], "paper.png", { type: "image/png" }),
          )
        }
      />
      <button
        type="button"
        data-testid="mp-trigger-cloze"
        onClick={() =>
          void props.onInsertGroup?.(
            CLOZE_RESULT,
            new File(["x"], "paper.png", { type: "image/png" }),
          )
        }
      />
      <button
        type="button"
        data-testid="mp-trigger-mc"
        onClick={() =>
          void props.onInsertQuestions?.(
            MC_ITEMS,
            new File(["x"], "paper.png", { type: "image/png" }),
          )
        }
      />
    </div>
  ),
}));
vi.mock("../cropImage", () => ({
  cropImageFile: (...a: unknown[]) => cropImageFileMock(...a),
  cropImageFileMany: (...a: unknown[]) => cropImageFileManyMock(...a),
}));
vi.mock("../uploadImageFile", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../uploadImageFile")>();
  return {
    ...mod,
    uploadImageFile: (...a: unknown[]) => uploadImageFileMock(...a),
  };
});
vi.mock("@/lib/api", () => ({
  apiClient: {
    createQuestion: (...a: unknown[]) => createQuestion(...a),
    updateQuestion: (...a: unknown[]) => updateQuestion(...a),
    deleteQuestion: vi.fn(),
    findSimilarQuestions: (...a: unknown[]) => findSimilarQuestions(...a),
    listExamPoints: (...a: unknown[]) => listExamPoints(...a),
    listSources: (...a: unknown[]) => listSources(...a),
    aiAnswerQuestions: (...a: unknown[]) => aiAnswerQuestions(...a),
    aiAnalyzeQuestions: vi.fn(),
    createSource: vi.fn(),
    getMagicPasteQuota: vi.fn().mockResolvedValue({
      free_remaining: 5,
      free_limit: 5,
      points: 0,
    }),
    generateTTS: vi.fn(),
    batchGenerateTTS: vi.fn(),
    uploadImage: vi.fn(),
  },
}));

vi.mock("@/contexts/SidebarContext", () => ({
  useSidebar: () => ({ sidebarWidth: 240, setEditorBusy: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "questionBank.form.errors.stemRequired": "stem required",
        "questionBank.form.errors.duplicate": "duplicate",
        "questionBank.form.errors.duplicateInBatch": "dup in batch",
        "questionBank.form.errors.minOptions": "min options",
        "questionBank.form.errors.noCorrect": "no correct",
        "questionBank.form.errors.singleOnly": "single only",
        "questionBank.form.errors.examPointRequired": "exam point required",
        "questionBank.form.errors.visibilityRequired": "visibility required",
        "questionBank.form.errors.atQuestion": `Q${opts?.n}: ${opts?.message}`,
        "questionBank.comingSoon": "coming soon",
      };
      return (
        map[key] ??
        (typeof opts?.defaultValue === "string" ? opts.defaultValue : key)
      );
    },
    i18n: { language: "zh-TW" },
  }),
}));

const EP: ExamPoint = {
  id: 7,
  code: "grammar.tense.present_perfect",
  names: { "zh-TW": "現在完成式" },
  parent_id: null,
  status: "active",
  order_index: 0,
  aliases: [],
};
const noSimilar = { exact_duplicate: null, similar: [] };

function baseQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 5,
    question_type: "multiple_choice",
    stem: "Existing stem",
    explanation: "why",
    image_url: null,
    stem_audio_url: null,
    grade_min: 3,
    grade_max: 5,
    allow_multiple_answers: false,
    show_stem_text: true,
    visibility: "private",
    is_platform: false,
    teacher_id: 1,
    organization_id: null,
    school_id: null,
    group_id: null,
    is_owner: true,
    can_edit: true,
    options: [
      {
        id: 1,
        order_index: 0,
        text: "x",
        is_correct: false,
        audio_url: null,
        image_url: null,
      },
      {
        id: 2,
        order_index: 1,
        text: "y",
        is_correct: true,
        audio_url: null,
        image_url: null,
      },
    ],
    exam_points: [{ id: 7, code: EP.code, names: EP.names, source: "manual" }],
    program_links: [],
    sources: [
      {
        id: 11,
        source_type: "exam",
        name: "113 會考",
        year: 2024,
        organization_id: null,
        teacher_id: 1,
      },
    ],
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

function renderSheet(
  props: Partial<React.ComponentProps<typeof MultipleChoiceQuestionSheet>> = {},
) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <MultipleChoiceQuestionSheet
      open
      onClose={onClose}
      programs={[]}
      onSaved={onSaved}
      {...props}
    />,
  );
  return { onSaved, onClose };
}

type User = ReturnType<typeof userEvent.setup>;

async function fillCard(
  user: User,
  index: number,
  stem: string,
  options: [string, boolean][],
) {
  await user.type(screen.getByTestId(`qc-${index}-stem`), stem);
  for (let i = 0; i < options.length; i++) {
    const [text, correct] = options[i];
    await user.type(screen.getByTestId(`qc-${index}-option-${i}`), text);
    if (correct)
      await user.click(screen.getByTestId(`qc-${index}-correct-${i}`));
  }
}

const saveBtn = () => screen.getByTestId("qb-save") as HTMLButtonElement;

describe("MultipleChoiceQuestionSheet", () => {
  beforeEach(() => {
    // jsdom 沒有 scrollIntoView（元件新增題目／存檔失敗時會捲到該卡）
    Element.prototype.scrollIntoView = vi.fn();
    createQuestion.mockReset();
    updateQuestion.mockReset();
    findSimilarQuestions.mockReset().mockResolvedValue(noSimilar);
    listExamPoints.mockReset().mockResolvedValue({ items: [EP] });
    listSources.mockReset().mockResolvedValue({ items: [] });
    aiAnswerQuestions.mockReset();
  });

  it("左欄：上傳在最上方、AI 兩鍵無題幹時 disabled、批次卡依序、公開必選", () => {
    renderSheet();
    const sheet = screen.getByTestId("qb-sheet");
    const order = [
      "qb-upload",
      "qb-ai-card",
      "qb-batch-grade",
      "qb-batch-program-link",
      "qb-batch-sources",
      "qb-batch-visibility",
    ].map((id) =>
      Array.from(sheet.querySelectorAll("[data-testid]")).findIndex(
        (el) => el.getAttribute("data-testid") === id,
      ),
    );
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(
      (screen.getByTestId("qb-ai-answer") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("qb-ai-analyze") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("右欄：預設一張卡、A–D 四格、E/F 按鈕後出現、進階設定預設收起", async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(screen.queryByTestId("qc-0-option-4")).toBeNull();
    expect(screen.queryByTestId("qc-0-advanced")).toBeNull();
    await user.click(screen.getByTestId("qc-0-add-option"));
    expect(screen.getByTestId("qc-0-option-5")).toBeTruthy();
    await user.click(screen.getByTestId("qc-0-advanced-toggle"));
    expect(screen.getByTestId("qc-0-advanced")).toBeTruthy();
    expect(screen.getByTestId("qc-0-grade")).toBeTruthy();
    // 題幹旁有插圖鈕（#1083），沒圖時沒有預覽
    expect(screen.getByTestId("qc-0-stem-image-button")).toBeTruthy();
    expect(screen.queryByTestId("qc-0-stem-image-preview")).toBeNull();
  });

  it("驗證順序：題幹 → 選項 → 考點 → 公開設定", async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(screen.getByTestId("qb-validation").textContent).toBe(
      "Q1: stem required",
    );
    await fillCard(user, 0, "What?", [
      ["a", true],
      ["b", false],
    ]);
    await waitFor(() =>
      expect(screen.getByTestId("qb-validation").textContent).toBe(
        "Q1: exam point required",
      ),
    );
    await user.click(screen.getByTestId("qc-0-exam-points-trigger"));
    await user.click(await screen.findByTestId("qc-0-exam-points-option-7"));
    await waitFor(() =>
      expect(screen.getByTestId("qb-validation").textContent).toBe(
        "Q1: visibility required",
      ),
    );
    expect(saveBtn().disabled).toBe(true);
  });

  it("考點只在單題設定：右側卡片可挑考點；左側沒有考點批次卡", async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(screen.queryByTestId("qb-batch-exam-points")).toBeNull();
    await user.click(screen.getByTestId("qc-0-exam-points-trigger"));
    await user.click(await screen.findByTestId("qc-0-exam-points-option-7"));
    expect(screen.getByTestId("qc-0-exam-points-chip-7")).toBeTruthy();
  });

  it("題幹語音按鈕同單字集：無語音只有麥克風；有語音出現播放與移除，移除後清掉", async () => {
    const user = userEvent.setup();
    renderSheet({
      questions: [baseQuestion({ stem_audio_url: "http://x/a.mp3" })],
    });
    expect(screen.getByTestId("qc-0-play")).toBeTruthy();
    expect(screen.queryByTestId("qc-0-mic")).toBeNull(); // 有語音 → 沒有麥克風
    await user.click(screen.getByTestId("qc-0-audio-remove"));
    expect(screen.queryByTestId("qc-0-play")).toBeNull();
    expect(screen.queryByTestId("qc-0-audio-remove")).toBeNull();
    expect(screen.getByTestId("qc-0-mic")).toBeTruthy();
  });

  it("批內兩題題幹相同 → 擋送出", async () => {
    const user = userEvent.setup();
    renderSheet();
    await fillCard(user, 0, "Same stem", [
      ["a", true],
      ["b", false],
    ]);
    await user.click(screen.getByTestId("qb-add-question"));
    await fillCard(user, 1, "same STEM!", [
      ["a", true],
      ["b", false],
    ]);
    await waitFor(() =>
      expect(screen.getByTestId("qb-validation").textContent).toBe(
        "Q1: dup in batch",
      ),
    );
  });

  it("後端重複（exact_duplicate）→ 該卡紅字", async () => {
    findSimilarQuestions.mockResolvedValue({
      exact_duplicate: {
        id: 9,
        stem: "Exists",
        visibility: "public",
        is_platform: false,
        is_owner: false,
      },
      similar: [],
    });
    const user = userEvent.setup();
    renderSheet();
    await fillCard(user, 0, "Exists", [["a", true]]);
    expect(await screen.findByTestId("qc-0-duplicate")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("qb-validation").textContent).toBe(
        "Q1: duplicate",
      ),
    );
  });

  it("相似題結果晚到，不會蓋掉查詢期間改的其他欄位", async () => {
    let resolveSimilar: (v: unknown) => void = () => {};
    findSimilarQuestions.mockReturnValue(
      new Promise((r) => {
        resolveSimilar = r;
      }),
    );
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByTestId("qc-0-stem"), "Late stem");
    // 等 debounce 打出 similar 查詢，回應還沒回來時改解析
    await waitFor(() => expect(findSimilarQuestions).toHaveBeenCalled());
    await user.type(screen.getByTestId("qc-0-explanation"), "kept");

    resolveSimilar({
      exact_duplicate: {
        id: 9,
        stem: "Late stem",
        visibility: "public",
        is_platform: false,
        is_owner: false,
      },
      similar: [],
    });
    expect(await screen.findByTestId("qc-0-duplicate")).toBeTruthy();
    expect(
      (screen.getByTestId("qc-0-explanation") as HTMLTextAreaElement).value,
    ).toBe("kept");
  });

  it("編輯模式：單卡預填（含來源 chip、進階設定展開）、沒有新增題目鍵；updateQuestion 帶 source_ids 不帶 organization_id", async () => {
    const existing = baseQuestion();
    updateQuestion.mockResolvedValue(existing);
    const user = userEvent.setup();
    renderSheet({ questions: [existing], organizationId: "org-1" });

    expect((screen.getByTestId("qc-0-stem") as HTMLTextAreaElement).value).toBe(
      "Existing stem",
    );
    expect(screen.getByTestId("qc-0-exam-points-chip-7")).toBeTruthy();
    // 編輯模式左欄只剩來源與公開兩張卡（沒有上傳／語音／AI／年段／教材）
    expect(screen.getByTestId("qb-edit-panel")).toBeTruthy();
    expect(screen.getByTestId("qb-batch-visibility")).toBeTruthy();
    expect(screen.getByTestId("qb-sources-chip-11")).toBeTruthy();
    expect(screen.queryByTestId("qb-upload")).toBeNull();
    expect(screen.queryByTestId("qb-ai-card")).toBeNull();
    expect(screen.queryByTestId("qb-batch-grade")).toBeNull();
    expect(screen.getByTestId("qc-0-advanced")).toBeTruthy(); // 有年段 → 展開
    expect(screen.queryByTestId("qb-add-question")).toBeNull();
    expect(saveBtn().disabled).toBe(false);

    await user.click(saveBtn());
    await waitFor(() => expect(updateQuestion).toHaveBeenCalledTimes(1));
    const [id, payload] = updateQuestion.mock.calls[0];
    expect(id).toBe(5);
    expect(payload.organization_id).toBeUndefined();
    expect(payload.question_type).toBeUndefined();
    expect(payload.grade_min).toBe(3);
    expect(payload.exam_point_ids).toEqual([7]);
    expect(payload.source_ids).toEqual([11]);
    expect(payload.visibility).toBe("private");
    expect(payload.options).toEqual([
      { text: "x", is_correct: false, image_url: null },
      { text: "y", is_correct: true, image_url: null },
    ]);
  });

  it("編輯模式改單題年段（清成不限）→ 送出時帶新值", async () => {
    const existing = baseQuestion();
    updateQuestion.mockResolvedValue(existing);
    const user = userEvent.setup();
    renderSheet({ questions: [existing] });
    await user.click(screen.getByTestId("qc-0-grade-clear"));
    expect(screen.getByTestId("qc-0-grade-label").textContent).toBe(
      "questionBank.form.gradeAny",
    );
    await user.click(saveBtn());
    await waitFor(() => expect(updateQuestion).toHaveBeenCalledTimes(1));
    expect(updateQuestion.mock.calls[0][1].grade_min).toBeNull();
    expect(updateQuestion.mock.calls[0][1].grade_max).toBeNull();
  });

  it("readOnly：沒有儲存鍵與左欄，欄位 disabled", () => {
    renderSheet({
      readOnly: true,
      questions: [
        baseQuestion({
          is_owner: false,
          can_edit: false,
          visibility: "public",
        }),
      ],
    });
    expect(screen.queryByTestId("qb-save")).toBeNull();
    expect(screen.queryByTestId("qb-batch-visibility")).toBeNull();
    expect(
      (screen.getByTestId("qc-0-stem") as HTMLTextAreaElement).disabled,
    ).toBe(true);
  });

  it("預覽（#1082）：無內容時 disabled；兩題依序編號、有選項、不顯示解析；題組模式不出現", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <MultipleChoiceQuestionSheet open onClose={vi.fn()} programs={[]} />,
    );
    const previewBtn = () =>
      screen.getByTestId("qb-preview") as HTMLButtonElement;
    expect(previewBtn().disabled).toBe(true);

    await fillCard(user, 0, "First stem", [
      ["apple", true],
      ["banana", false],
    ]);
    await user.click(screen.getByTestId("qb-add-question"));
    await fillCard(user, 1, "Second stem", [["cat", false]]);
    await user.type(screen.getByTestId("qc-0-explanation"), "SECRET-WHY");
    expect(previewBtn().disabled).toBe(false);

    await user.click(previewBtn());
    const q0 = await screen.findByTestId("qb-preview-panel-questions-q-0");
    expect(
      screen.getByTestId("qb-preview-panel-questions-q-0-number"),
    ).toHaveTextContent("1.");
    expect(q0).toHaveTextContent("First stem");
    expect(q0).toHaveTextContent("(A)apple");
    expect(q0).toHaveTextContent("(B)banana");
    expect(
      screen.getByTestId("qb-preview-panel-questions-q-1"),
    ).toHaveTextContent("Second stem");
    expect(screen.getByTestId("qb-preview-panel-dialog")).not.toHaveTextContent(
      "SECRET-WHY",
    );
    unmount();

    renderSheet({ createType: "reading" });
    expect(screen.queryByTestId("qb-preview")).toBeNull();
  });

  it("批次編輯：N 張卡各自帶值、左欄完整但批次值空白；左欄改公開 → 全部卡；儲存逐題 PATCH", async () => {
    const q1 = baseQuestion({ id: 5, stem: "First", visibility: "private" });
    const q2 = baseQuestion({
      id: 6,
      stem: "Second",
      visibility: "public",
      sources: [],
    });
    updateQuestion.mockResolvedValue(q1);
    const user = userEvent.setup();
    renderSheet({ questions: [q1, q2] });

    expect(screen.getByTestId("qb-sheet").getAttribute("data-mode")).toBe(
      "bulk",
    );
    expect(screen.getByTestId("question-card-1")).toBeTruthy();
    // 左欄完整（不是 editOnly），批次值空白：公開下拉沒選、來源沒 chip
    expect(screen.queryByTestId("qb-edit-panel")).toBeNull();
    expect(screen.getByTestId("qb-upload")).toBeTruthy();
    expect(
      screen.getByTestId("qb-visibility").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(screen.queryByTestId("qb-sources-chip-11")).toBeNull();
    // 批次編輯沒有「新增題目」以外的限制：仍可新增／擷取
    expect(screen.getByTestId("qb-add-question")).toBeTruthy();

    await user.click(saveBtn());
    await waitFor(() => expect(updateQuestion).toHaveBeenCalledTimes(2));
    const payloads = updateQuestion.mock.calls.map((c) => [
      c[0],
      c[1].visibility,
      c[1].source_ids,
    ]);
    expect(payloads).toEqual([
      [5, "private", [11]],
      [6, "public", []],
    ]);
  });

  it("批次編輯中途失敗：第 2 題 PATCH 失敗 → 停在該題、sheet 不關、該卡顯示後端訊息、toast 部分成功", async () => {
    const q1 = baseQuestion({ id: 5, stem: "First" });
    const q2 = baseQuestion({ id: 6, stem: "Second" });
    const q3 = baseQuestion({ id: 7, stem: "Third" });
    updateQuestion
      .mockResolvedValueOnce(q1)
      .mockRejectedValueOnce({ detail: "後端錯誤訊息" })
      .mockResolvedValueOnce(q3);
    const user = userEvent.setup();
    const { onSaved, onClose } = renderSheet({ questions: [q1, q2, q3] });

    await user.click(saveBtn());
    await waitFor(() => expect(updateQuestion).toHaveBeenCalledTimes(2));
    expect(updateQuestion.mock.calls.map((c) => c[0])).toEqual([5, 6]);
    // 失敗後不再送第 3 題
    expect(updateQuestion).toHaveBeenCalledTimes(2);
    // 失敗題（已成功的第 1 題被移出後，它成為第 1 張卡）顯示後端訊息
    expect((await screen.findByTestId("qc-0-error")).textContent).toBe(
      "後端錯誤訊息",
    );
    // toast 部分成功（已存 1、失敗 2）；sheet 不關但已通知上層刷新
    expect(toast.warning).toHaveBeenCalledWith(
      "questionBank.messages.partiallySaved",
    );
    expect(onSaved).toHaveBeenCalledWith(q1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("qb-sheet")).toBeTruthy();
  });

  it("題組模式擷取（#1084）：上傳走 reading_group、裁圖上傳、填進題組卡；再擷取一次要先確認覆蓋", async () => {
    cropImageFileMock.mockReset();
    cropImageFileManyMock
      .mockReset()
      .mockImplementation(async (_f: File, boxes: (number[] | null)[]) =>
        boxes.map((b) =>
          b ? new File(["c"], "crop.png", { type: "image/png" }) : null,
        ),
      );
    uploadImageFileMock.mockReset().mockResolvedValue("https://cdn/crop.png");
    const user = userEvent.setup();
    renderSheet({ createType: "reading" });

    // 左欄上傳區是題組模式；沒有「新增題目」鍵
    expect(
      screen.getByTestId("qb-upload").getAttribute("data-extract-mode"),
    ).toBe("reading_group");
    expect(screen.getByTestId("mp-stub").getAttribute("data-mode")).toBe(
      "reading_group",
    );
    expect(screen.getByTestId("qb-upload-group-hint")).toBeTruthy();
    expect(screen.queryByTestId("qb-add-question")).toBeNull();

    await user.click(screen.getByTestId("mp-trigger-group"));
    await waitFor(() => expect(uploadImageFileMock).toHaveBeenCalledTimes(1));
    // 依 box_2d 裁圖（素材圖在第一個位置，後面是小題題幹／選項的空位），上傳的是裁好的檔
    expect(cropImageFileManyMock).toHaveBeenCalledWith(
      expect.any(File),
      [[0, 0, 600, 1000], null, null, null, null, null],
      "crop",
    );
    expect((uploadImageFileMock.mock.calls[0][0] as File).name).toBe(
      "crop.png",
    );
    // 標題、小題、圖片都進了題組卡
    expect(
      ((await screen.findByTestId("qg-0-title")) as HTMLInputElement).value,
    ).toBe("Lantern");
    expect(
      (screen.getByTestId("qg-0-q-0-stem") as HTMLTextAreaElement).value,
    ).toBe("What is the purpose?");
    expect(
      document.querySelector('img[src="https://cdn/crop.png"]'),
    ).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith(
      "contentEditor.magicPaste.insertedGroup",
    );

    // 已有內容 → 再擷取先問覆蓋；取消不動、確認才套用
    await user.click(screen.getByTestId("mp-trigger-group"));
    expect(await screen.findByTestId("qb-extract-overwrite")).toBeTruthy();
    await user.click(screen.getByTestId("qb-extract-overwrite-cancel"));
    await waitFor(() =>
      expect(screen.queryByTestId("qb-extract-overwrite")).toBeNull(),
    );
    expect(uploadImageFileMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("mp-trigger-group"));
    await user.click(await screen.findByTestId("qb-extract-overwrite-confirm"));
    await waitFor(() => expect(uploadImageFileMock).toHaveBeenCalledTimes(2));
  });

  it("克漏字擷取後（#1086）：小題題幹是空的，AI 作答／考點分析仍可按（題幹由文章承擔）", async () => {
    cropImageFileManyMock.mockReset().mockResolvedValue([]);
    uploadImageFileMock.mockReset();
    const user = userEvent.setup();
    renderSheet({ createType: "cloze" });

    // 擷取前：沒有任何題幹也沒有文章 → 兩鍵 disabled
    expect(
      (screen.getByTestId("qb-ai-answer") as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.click(screen.getByTestId("mp-trigger-cloze"));

    // 擷取後：小題卡只有「空格 n」徽章、沒有題幹文字框，但文章有 {{1}}／{{2}} → 兩鍵要可按
    expect(await screen.findByTestId("qg-0-q-0-blank-badge")).toBeTruthy();
    expect(screen.queryByTestId("qg-0-q-0-stem")).toBeNull();
    await waitFor(() =>
      expect(
        (screen.getByTestId("qb-ai-answer") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByTestId("qb-ai-analyze") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("單題擷取（#1084）：帶原始檔裁題幹圖與選項圖，圖片選項沒有字也填進卡片", async () => {
    cropImageFileManyMock
      .mockReset()
      .mockImplementation(async (_f: File, boxes: (number[] | null)[]) =>
        boxes.map((b) =>
          b ? new File(["c"], "crop.png", { type: "image/png" }) : null,
        ),
      );
    uploadImageFileMock.mockReset().mockResolvedValue("https://cdn/crop.png");
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByTestId("mp-trigger-mc"));

    // 題幹圖 + 四個選項圖，一次解碼、五個 box 一起裁
    await waitFor(() =>
      expect(cropImageFileManyMock).toHaveBeenCalledWith(
        expect.any(File),
        [
          [0, 0, 100, 1000],
          [100, 0, 200, 250],
          [100, 250, 200, 500],
          [100, 500, 200, 750],
          [100, 750, 200, 1000],
        ],
        "crop",
      ),
    );
    expect(uploadImageFileMock).toHaveBeenCalledTimes(5);
    expect(
      ((await screen.findByTestId("qc-0-stem")) as HTMLTextAreaElement).value,
    ).toBe("Which picture shows the answer?");
    expect(screen.getByTestId("qc-0-stem-image-preview")).toBeTruthy();
    // 圖片選項：輸入框是空的，圖已填好
    expect(
      (screen.getByTestId("qc-0-option-0") as HTMLInputElement).value,
    ).toBe("");
    expect(
      document.querySelectorAll('img[src="https://cdn/crop.png"]').length,
    ).toBeGreaterThanOrEqual(2);
  });
});
