/**
 * MultipleChoiceQuestionSheet 測試（Issue #1064）。
 *
 * 驗證表單規則：少於 2 選項、未勾正確答案、單選勾兩個、題幹重複 → 儲存鍵 disabled 且顯示原因；
 * 合法時送出 createQuestion 的 payload 只含填了字的選項；編輯模式走 updateQuestion。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  },
}));

vi.mock("@/contexts/SidebarContext", () => ({
  useSidebar: () => ({ sidebarWidth: 240 }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "questionBank.form.errors.stemRequired": "stem required",
        "questionBank.form.errors.duplicate": "duplicate",
        "questionBank.form.errors.minOptions": `min ${opts?.min}`,
        "questionBank.form.errors.noCorrect": "no correct",
        "questionBank.form.errors.singleOnly": "single only",
        "questionBank.form.errors.gradeRange": "grade range",
        "questionBank.form.markCorrect": `correct ${opts?.index}`,
        "questionBank.form.optionPlaceholder": `Option ${opts?.index}`,
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

function renderDialog(
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

async function fillStem(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
) {
  await user.type(screen.getByTestId("qb-stem"), text);
}

async function fillOption(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  text: string,
  correct = false,
) {
  await user.type(screen.getByTestId(`qb-option-text-${index}`), text);
  if (correct)
    await user.click(screen.getByTestId(`qb-option-correct-${index}`));
}

describe("MultipleChoiceQuestionSheet", () => {
  beforeEach(() => {
    createQuestion.mockReset();
    updateQuestion.mockReset();
    findSimilarQuestions.mockReset().mockResolvedValue(noSimilar);
  });

  it("空表單：儲存 disabled，提示需要題目", () => {
    renderDialog();
    expect((screen.getByTestId("qb-save") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByTestId("qb-validation").textContent).toBe(
      "stem required",
    );
  });

  it("少於 2 個選項 → 擋；沒勾正確答案 → 擋；單選勾兩個 → 擋", async () => {
    const user = userEvent.setup();
    renderDialog();
    await fillStem(user, "What is it?");
    await fillOption(user, 0, "a", true);
    expect(screen.getByTestId("qb-validation").textContent).toBe("min 2");

    await fillOption(user, 1, "b");
    // 現在有 2 選項且 a 已勾 → 合法
    await waitFor(() =>
      expect(
        (screen.getByTestId("qb-save") as HTMLButtonElement).disabled,
      ).toBe(false),
    );

    // 取消 a 的勾 → 沒正確答案
    await user.click(screen.getByTestId("qb-option-correct-0"));
    expect(screen.getByTestId("qb-validation").textContent).toBe("no correct");

    // 單選模式下勾 a 再勾 b：b 取代 a（不會同時兩個）
    await user.click(screen.getByTestId("qb-option-correct-0"));
    await user.click(screen.getByTestId("qb-option-correct-1"));
    expect(
      (
        screen.getByTestId("qb-option-correct-0") as HTMLButtonElement
      ).getAttribute("data-state"),
    ).toBe("unchecked");
    expect(
      (
        screen.getByTestId("qb-option-correct-1") as HTMLButtonElement
      ).getAttribute("data-state"),
    ).toBe("checked");
  });

  it("題幹與既有題目重複 → 顯示重複警告並擋送出", async () => {
    findSimilarQuestions.mockResolvedValue({
      exact_duplicate: {
        id: 9,
        stem: "What is it?",
        visibility: "public",
        is_platform: false,
        is_owner: false,
      },
      similar: [],
    });
    const user = userEvent.setup();
    renderDialog();
    await fillStem(user, "What is it?");
    await fillOption(user, 0, "a", true);
    await fillOption(user, 1, "b");
    expect(await screen.findByTestId("qb-duplicate")).toBeTruthy();
    expect(screen.getByTestId("qb-validation").textContent).toBe("duplicate");
    expect((screen.getByTestId("qb-save") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("合法送出：只送有填字的選項，並回呼 onSaved + onClose", async () => {
    createQuestion.mockResolvedValue({ id: 1 });
    const user = userEvent.setup();
    const { onSaved, onClose } = renderDialog({ organizationId: "org-1" });
    await fillStem(user, "  Pick one  ");
    await fillOption(user, 0, "alpha", true);
    await fillOption(user, 2, "gamma");
    await waitFor(() =>
      expect(
        (screen.getByTestId("qb-save") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    await user.click(screen.getByTestId("qb-save"));

    await waitFor(() => expect(createQuestion).toHaveBeenCalledTimes(1));
    const payload = createQuestion.mock.calls[0][0];
    expect(payload.stem).toBe("Pick one");
    expect(payload.options).toEqual([
      { text: "alpha", is_correct: true },
      { text: "gamma", is_correct: false },
    ]);
    expect(payload.organization_id).toBe("org-1");
    expect(payload.allow_multiple_answers).toBe(false);
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("編輯模式：帶入既有資料並走 updateQuestion，不送 organization_id", async () => {
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
    renderDialog({ question: existing });

    expect((screen.getByTestId("qb-stem") as HTMLTextAreaElement).value).toBe(
      "Existing stem",
    );
    expect(
      (screen.getByTestId("qb-option-text-1") as HTMLInputElement).value,
    ).toBe("y");
    expect((screen.getByTestId("qb-save") as HTMLButtonElement).disabled).toBe(
      false,
    );

    await user.click(screen.getByTestId("qb-save"));
    await waitFor(() => expect(updateQuestion).toHaveBeenCalledTimes(1));
    const [id, payload] = updateQuestion.mock.calls[0];
    expect(id).toBe(5);
    expect(payload.organization_id).toBeUndefined();
    expect(payload.question_type).toBeUndefined();
    expect(payload.options).toEqual([
      { text: "x", is_correct: false },
      { text: "y", is_correct: true },
    ]);
  });

  it("readOnly：沒有儲存鍵、欄位 disabled", () => {
    renderDialog({
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
    expect(
      (screen.getByTestId("qb-stem") as HTMLTextAreaElement).disabled,
    ).toBe(true);
  });
});
