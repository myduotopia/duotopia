/**
 * MultipleChoiceQuestionSheet 測試（Issue #1064）— 兩欄批次編輯器。
 *
 * 驗證：新增多題逐題送出且帶共用設定；批內重複擋；E/F 預設隱藏、按鈕後出現；
 * AI 兩顆在沒題幹時 disabled；編輯模式單卡預填走 updateQuestion；readOnly。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MultipleChoiceQuestionSheet from "../MultipleChoiceQuestionSheet";
import type { Question } from "@/types/questionBank";

const createQuestion = vi.fn();
const updateQuestion = vi.fn();
const findSimilarQuestions = vi.fn();
vi.mock("@/lib/api", () => ({
  apiClient: {
    createQuestion: (...a: unknown[]) => createQuestion(...a),
    updateQuestion: (...a: unknown[]) => updateQuestion(...a),
    deleteQuestion: vi.fn(),
    findSimilarQuestions: (...a: unknown[]) => findSimilarQuestions(...a),
    listExamPoints: vi.fn().mockResolvedValue({ items: [] }),
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
        "questionBank.form.errors.gradeRange": "grade range",
        "questionBank.form.errors.atQuestion": `Q${opts?.n}: ${opts?.message}`,
        "questionBank.form.addQuestion": "add question",
        "questionBank.form.addOption": "add option",
      };
      return (
        map[key] ??
        (typeof opts?.defaultValue === "string" ? opts.defaultValue : key)
      );
    },
    i18n: { language: "zh-TW" },
  }),
}));

const noSimilar = { exact_duplicate: null, similar: [] };

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
    createQuestion.mockReset();
    updateQuestion.mockReset();
    findSimilarQuestions.mockReset().mockResolvedValue(noSimilar);
  });

  it("預設一張卡、A–D 四格、E/F 按「新增選項」才出現；儲存 disabled 且提示第 1 題", async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(screen.getByTestId("question-card-0")).toBeTruthy();
    expect(screen.queryByTestId("qc-0-option-4")).toBeNull();
    expect(saveBtn().disabled).toBe(true);
    expect(screen.getByTestId("qb-validation").textContent).toBe(
      "Q1: stem required",
    );

    await user.click(screen.getByTestId("qc-0-add-option"));
    expect(screen.getByTestId("qc-0-option-4")).toBeTruthy();
    expect(screen.getByTestId("qc-0-option-5")).toBeTruthy();
    expect(screen.queryByTestId("qc-0-add-option")).toBeNull();
  });

  it("AI 兩顆與上傳在沒題幹時 disabled（且本輪尚未實作維持 disabled）", async () => {
    const user = userEvent.setup();
    renderSheet();
    const ai = screen.getByTestId("qb-ai-answer") as HTMLButtonElement;
    expect(ai.disabled).toBe(true);
    await user.type(screen.getByTestId("qc-0-stem"), "Q");
    // 後端未接（沒傳 onAiAnswer）→ 仍 disabled
    expect(ai.disabled).toBe(true);
    expect(
      (screen.getByTestId("qb-upload") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("多題逐題送出，共用設定併入每題，完成後 onSaved + onClose", async () => {
    createQuestion.mockResolvedValue({ id: 1 });
    const user = userEvent.setup();
    const { onSaved, onClose } = renderSheet({ organizationId: "org-1" });

    await fillCard(user, 0, "First question", [
      ["a", true],
      ["b", false],
    ]);
    await user.click(screen.getByTestId("qb-add-question"));
    await fillCard(user, 1, "Second question", [
      ["c", false],
      ["d", true],
    ]);
    await waitFor(() => expect(saveBtn().disabled).toBe(false));

    await user.click(saveBtn());
    await waitFor(() => expect(createQuestion).toHaveBeenCalledTimes(2));
    const [p1, p2] = createQuestion.mock.calls.map((c) => c[0]);
    expect(p1.stem).toBe("First question");
    expect(p1.options).toEqual([
      { text: "a", is_correct: true, image_url: null },
      { text: "b", is_correct: false, image_url: null },
    ]);
    expect(p2.stem).toBe("Second question");
    expect(p2.options[1].is_correct).toBe(true);
    expect(p1.organization_id).toBe("org-1");
    expect(p2.organization_id).toBe("org-1");
    expect(p1.visibility).toBe("private");
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
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
    expect(saveBtn().disabled).toBe(true);
  });

  it("後端重複（exact_duplicate）→ 該卡紅字、儲存 disabled", async () => {
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
    await fillCard(user, 0, "Exists", [
      ["a", true],
      ["b", false],
    ]);
    expect(await screen.findByTestId("qc-0-duplicate")).toBeTruthy();
    await waitFor(() => expect(saveBtn().disabled).toBe(true));
    expect(screen.getByTestId("qb-validation").textContent).toBe(
      "Q1: duplicate",
    );
  });

  it("中途失敗：第 2 題 409 → 第 1 題保留、第 2 題顯示後端訊息、onSaved 仍呼叫、不關閉", async () => {
    createQuestion
      .mockResolvedValueOnce({ id: 1 })
      .mockRejectedValueOnce({ detail: { message: "題目已存在" } });
    const user = userEvent.setup();
    const { onSaved, onClose } = renderSheet();
    await fillCard(user, 0, "Q one", [
      ["a", true],
      ["b", false],
    ]);
    await user.click(screen.getByTestId("qb-add-question"));
    await fillCard(user, 1, "Q two", [
      ["a", true],
      ["b", false],
    ]);
    await waitFor(() => expect(saveBtn().disabled).toBe(false));
    await user.click(saveBtn());

    await waitFor(() => expect(createQuestion).toHaveBeenCalledTimes(2));
    // 只剩失敗的那張卡，並帶錯誤訊息
    await waitFor(() =>
      expect(screen.queryByTestId("question-card-1")).toBeNull(),
    );
    expect(screen.getByTestId("qc-0-error").textContent).toBe("題目已存在");
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("編輯模式：單卡預填、沒有新增題目鍵、走 updateQuestion 不送 organization_id", async () => {
    const existing: Question = {
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
      exam_points: [],
      program_links: [],
      created_at: null,
      updated_at: null,
    };
    updateQuestion.mockResolvedValue(existing);
    const user = userEvent.setup();
    renderSheet({ question: existing, organizationId: "org-1" });

    expect((screen.getByTestId("qc-0-stem") as HTMLTextAreaElement).value).toBe(
      "Existing stem",
    );
    expect(
      (screen.getByTestId("qc-0-option-1") as HTMLInputElement).value,
    ).toBe("y");
    expect(screen.queryByTestId("qb-add-question")).toBeNull();
    expect(screen.queryByTestId("qc-0-remove")).toBeNull();
    expect(saveBtn().disabled).toBe(false);

    await user.click(saveBtn());
    await waitFor(() => expect(updateQuestion).toHaveBeenCalledTimes(1));
    const [id, payload] = updateQuestion.mock.calls[0];
    expect(id).toBe(5);
    expect(payload.organization_id).toBeUndefined();
    expect(payload.question_type).toBeUndefined();
    expect(payload.grade_min).toBe(3);
    expect(payload.options).toEqual([
      { text: "x", is_correct: false, image_url: null },
      { text: "y", is_correct: true, image_url: null },
    ]);
  });

  it("readOnly：沒有儲存鍵與工具區，欄位 disabled", () => {
    renderSheet({
      readOnly: true,
      question: {
        id: 7,
        question_type: "multiple_choice",
        stem: "Someone else's",
        explanation: null,
        image_url: null,
        stem_audio_url: null,
        grade_min: null,
        grade_max: null,
        allow_multiple_answers: false,
        show_stem_text: true,
        visibility: "public",
        is_platform: true,
        teacher_id: 2,
        organization_id: null,
        school_id: null,
        group_id: null,
        is_owner: false,
        options: [],
        exam_points: [],
        program_links: [],
        created_at: null,
        updated_at: null,
      },
    });
    expect(screen.queryByTestId("qb-save")).toBeNull();
    expect(screen.queryByTestId("qb-tools")).toBeNull();
    expect(
      (screen.getByTestId("qc-0-stem") as HTMLTextAreaElement).disabled,
    ).toBe(true);
    const card = within(screen.getByTestId("question-card-0"));
    expect(card.queryByTestId("qc-0-add-option")).toBeNull();
  });
});
