/**
 * QuestionBankTab 測試（Issue #1063）。
 *
 * 驗證：列表載入與渲染、scope 對應的 API 參數、機構 scope 沒 organizationId 不打 API、
 * 「新增題目 ▽」下拉只有選擇題可點、搜尋 debounce 後帶 q 重查、空狀態、分頁。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import QuestionBankTab from "../QuestionBankTab";
import type { Question, QuestionListResponse } from "@/types/questionBank";

const listQuestions = vi.fn();
const updateQuestion = vi.fn();
const deleteQuestion = vi.fn();
vi.mock("@/lib/api", () => ({
  apiClient: {
    listQuestions: (...args: unknown[]) => listQuestions(...args),
    updateQuestion: (...args: unknown[]) => updateQuestion(...args),
    deleteQuestion: (...args: unknown[]) => deleteQuestion(...args),
    listSources: vi.fn().mockResolvedValue({ items: [] }),
    createSource: vi.fn(),
    listExamPoints: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

vi.mock("@/contexts/SidebarContext", () => ({
  useSidebar: () => ({ sidebarWidth: 240 }),
}));

const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: (...a: unknown[]) => toastInfo(...a),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "questionBank.title.mine": "我的題庫",
        "questionBank.title.organization": "機構題庫",
        "questionBank.buttons.addQuestion": "新增題目",
        "questionBank.types.multiple_choice": "選擇題",
        "questionBank.types.reading": "閱讀測驗",
        "questionBank.types.cloze": "克漏字",
        "questionBank.types.fill_in": "填充題",
        "questionBank.types.listening": "聽力選擇",
        "questionBank.types.listening_image": "圖片聽力",
        "questionBank.empty.noQuestions": "還沒有題目",
        "questionBank.empty.noMatch": "沒有符合的題目",
        "questionBank.messages.editorComingSoon": "editor soon",
        "questionBank.visibility.private": "私人",
        "questionBank.visibility.public": "公開",
        "questionBank.list.selected": `selected ${opts?.count}`,
        "questionBank.list.confirmDelete": `delete ${opts?.count}?`,
        "questionBank.gradeRange": `${opts?.min}–${opts?.max} 年級`,
        "questionBank.gradeSingle": `${opts?.grade} 年級`,
        "questionBank.pagination": `第 ${opts?.page} / ${opts?.totalPages} 頁`,
        "common.loading": "Loading",
      };
      return map[key] ?? key;
    },
    i18n: { language: "zh-TW" },
  }),
}));

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 1,
    question_type: "multiple_choice",
    stem: "I ___ never been to Japan.",
    explanation: null,
    image_url: null,
    stem_audio_url: null,
    grade_min: 7,
    grade_max: 9,
    allow_multiple_answers: false,
    show_stem_text: true,
    visibility: "private",
    is_platform: false,
    teacher_id: 1,
    organization_id: null,
    school_id: null,
    group_id: null,
    is_owner: true,
    options: [],
    exam_points: [
      {
        id: 3,
        code: "grammar.tense.present_perfect",
        names: { "zh-TW": "現在完成式", en: "Present Perfect" },
        source: "manual",
      },
    ],
    program_links: [],
    sources: [],
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

function respond(
  items: Question[],
  total = items.length,
): QuestionListResponse {
  return { items, total, page: 1, page_size: 20 };
}

describe("QuestionBankTab", () => {
  beforeEach(() => {
    listQuestions.mockReset();
    updateQuestion.mockReset();
    deleteQuestion.mockReset();
    toastInfo.mockReset();
  });

  it("載入並渲染題目列表（題幹、年級、考點 chip、公開下拉、來源下拉、checkbox）", async () => {
    listQuestions.mockResolvedValue(respond([makeQuestion()]));
    render(<QuestionBankTab scope="mine" />);

    expect(await screen.findByText("I ___ never been to Japan.")).toBeTruthy();
    expect(screen.getByText("7–9 年級")).toBeTruthy();
    expect(screen.getByTestId("qb-row-1-exam-points-chip-3")).toBeTruthy();
    expect(screen.getByTestId("qb-row-1-visibility")).toBeTruthy();
    expect(screen.getByTestId("qb-row-1-sources")).toBeTruthy();
    expect(screen.getByTestId("qb-check-1")).toBeTruthy();
    expect(screen.queryByTestId("qb-bulk-bar")).toBeNull();
    expect(listQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "mine", page: 1, page_size: 20 }),
    );
  });

  it("機構 scope 會帶 organization_id；沒有 organizationId 時不打 API", async () => {
    listQuestions.mockResolvedValue(respond([]));
    const { unmount } = render(
      <QuestionBankTab scope="organization" organizationId="org-1" />,
    );
    await waitFor(() =>
      expect(listQuestions).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "organization",
          organization_id: "org-1",
        }),
      ),
    );
    unmount();

    listQuestions.mockClear();
    render(<QuestionBankTab scope="organization" />);
    expect(await screen.findByTestId("question-bank-empty")).toBeTruthy();
    expect(listQuestions).not.toHaveBeenCalled();
  });

  it("「新增題目」下拉只有選擇題可點，其餘 disabled；點選擇題呼叫 onCreateQuestion", async () => {
    listQuestions.mockResolvedValue(respond([]));
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(<QuestionBankTab scope="mine" onCreateQuestion={onCreate} />);
    await screen.findByTestId("question-bank-empty");

    await user.click(screen.getByTestId("question-bank-add"));
    const mc = await screen.findByTestId("question-bank-add-multiple_choice");
    const reading = screen.getByTestId("question-bank-add-reading");
    expect(reading.getAttribute("data-disabled")).not.toBeNull();
    expect(mc.getAttribute("data-disabled")).toBeNull();

    await user.click(mc);
    expect(onCreate).toHaveBeenCalledWith("multiple_choice");
  });

  it("沒傳 onCreateQuestion 時點選擇題顯示提示", async () => {
    listQuestions.mockResolvedValue(respond([]));
    const user = userEvent.setup();
    render(<QuestionBankTab scope="mine" />);
    await screen.findByTestId("question-bank-empty");

    await user.click(screen.getByTestId("question-bank-add"));
    await user.click(
      await screen.findByTestId("question-bank-add-multiple_choice"),
    );
    expect(toastInfo).toHaveBeenCalledWith("editor soon");
  });

  it("canCreate=false 不顯示新增按鈕", async () => {
    listQuestions.mockResolvedValue(respond([]));
    render(<QuestionBankTab scope="mine" canCreate={false} />);
    await screen.findByTestId("question-bank-empty");
    expect(screen.queryByTestId("question-bank-add")).toBeNull();
  });

  it("搜尋字串 debounce 後以 q 重新查詢，並顯示無符合狀態", async () => {
    listQuestions
      .mockResolvedValueOnce(respond([makeQuestion()]))
      .mockResolvedValueOnce(respond([]));
    const user = userEvent.setup();
    render(<QuestionBankTab scope="mine" />);
    await screen.findByText("I ___ never been to Japan.");

    await user.type(screen.getByTestId("question-bank-search"), "nothing");
    await waitFor(() =>
      expect(listQuestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "nothing", page: 1 }),
      ),
    );
    expect(await screen.findByText("沒有符合的題目")).toBeTruthy();
  });

  it("超過一頁時顯示分頁並可翻頁", async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      makeQuestion({ id: i + 1, stem: `Q${i + 1}` }),
    );
    listQuestions
      .mockResolvedValueOnce(respond(items, 45))
      .mockResolvedValueOnce(
        respond([makeQuestion({ id: 21, stem: "Q21" })], 45),
      );
    const user = userEvent.setup();
    render(<QuestionBankTab scope="mine" />);
    await screen.findByText("Q1");
    expect(screen.getByText("第 1 / 3 頁")).toBeTruthy();

    await user.click(screen.getByLabelText("questionBank.buttons.nextPage"));
    await waitFor(() =>
      expect(listQuestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    );
    expect(await screen.findByText("Q21")).toBeTruthy();
  });

  it("全選／取消全選；勾選後底部動作列出現", async () => {
    listQuestions.mockResolvedValue(
      respond([makeQuestion({ id: 1 }), makeQuestion({ id: 2, stem: "Q2" })]),
    );
    const user = userEvent.setup();
    render(<QuestionBankTab scope="mine" />);
    await screen.findByText("Q2");
    await user.click(screen.getByTestId("qb-check-all"));
    expect(screen.getByTestId("qb-bulk-bar").textContent).toContain(
      "selected 2",
    );
    await user.click(screen.getByTestId("qb-check-all"));
    expect(screen.queryByTestId("qb-bulk-bar")).toBeNull();
    await user.click(screen.getByTestId("qb-check-2"));
    expect(screen.getByTestId("qb-bulk-bar").textContent).toContain(
      "selected 1",
    );
  });

  it("快速編輯考點 → 該列自動勾選、變黃；儲存只 PATCH 改過的列並帶三個欄位", async () => {
    listQuestions.mockResolvedValue(
      respond([makeQuestion({ id: 1 }), makeQuestion({ id: 2, stem: "Q2" })]),
    );
    updateQuestion.mockResolvedValue({});
    const user = userEvent.setup();
    render(<QuestionBankTab scope="mine" />);
    await screen.findByText("Q2");

    // 移除第 1 題唯一的考點 chip → 視為修改
    await user.click(
      screen
        .getByTestId("qb-row-1-exam-points-chip-3")
        .querySelector("button")!,
    );
    expect(
      screen.getByTestId("question-row-1").getAttribute("data-dirty"),
    ).toBe("true");
    expect(
      screen.getByTestId("question-row-2").getAttribute("data-dirty"),
    ).toBeNull();
    expect(screen.getByTestId("qb-bulk-bar")).toBeTruthy();

    await user.click(screen.getByTestId("qb-bulk-save"));
    await waitFor(() => expect(updateQuestion).toHaveBeenCalledTimes(1));
    expect(updateQuestion).toHaveBeenCalledWith(1, {
      exam_point_ids: [],
      source_ids: [],
      visibility: "private",
    });
  });

  it("刪除：confirm 後逐列 DELETE 勾選的題；取消 confirm 不刪", async () => {
    listQuestions.mockResolvedValue(
      respond([makeQuestion({ id: 1 }), makeQuestion({ id: 2, stem: "Q2" })]),
    );
    deleteQuestion.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<QuestionBankTab scope="mine" />);
    await screen.findByText("Q2");
    await user.click(screen.getByTestId("qb-check-all"));

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(screen.getByTestId("qb-bulk-delete"));
    expect(deleteQuestion).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByTestId("qb-bulk-delete"));
    await waitFor(() => expect(deleteQuestion).toHaveBeenCalledTimes(2));
    expect(confirmSpy).toHaveBeenLastCalledWith("delete 2?");
    confirmSpy.mockRestore();
  });
});
