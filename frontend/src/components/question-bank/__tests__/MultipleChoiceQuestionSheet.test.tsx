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
});
