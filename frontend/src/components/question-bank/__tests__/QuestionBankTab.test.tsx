/**
 * QuestionBankTab 測試（Issue #1063）。
 *
 * 所有 render 都包 MemoryRouter（元件用 useSearchParams 存 filter／分頁）。
 *
 * 驗證：列表載入與渲染、scope 對應的 API 參數、機構 scope 沒 organizationId 不打 API、
 * 「新增題目 ▽」下拉只有選擇題可點、搜尋 debounce 後帶 q 重查、空狀態、分頁。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";

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
    listExamPoints: vi.fn().mockResolvedValue({
      items: [
        {
          id: 3,
          code: "grammar.tense.present_perfect",
          names: { "zh-TW": "現在完成式", en: "Present Perfect" },
          parent_id: null,
          status: "active",
          order_index: 0,
          aliases: [],
        },
        {
          id: 7,
          code: "vocab.food",
          names: { "zh-TW": "食物字彙", en: "Food vocabulary" },
          parent_id: null,
          status: "active",
          order_index: 1,
          aliases: [],
        },
      ],
    }),
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

// t 必須是穩定參考：每次 render 回新函式會讓依賴 t 的 useCallback/useEffect 無限重跑
vi.mock("react-i18next", () => {
  const translation = {
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "questionBank.title.mine": "題庫",
        "questionBank.title.organization": "題庫",
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
        "questionBank.pagination": `第 ${opts?.page} / ${opts?.totalPages} 頁`,
        "common.loading": "Loading",
      };
      return map[key] ?? key;
    },
    i18n: { language: "zh-TW" },
  };
  return { useTranslation: () => translation };
});

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
    can_edit: true,
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

/** URL 探針：把目前 search 字串印出來讓測試斷言 */
function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="loc">{loc.search}</span>;
}

function renderTab(ui: React.ReactElement, initialEntries: string[] = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      {ui}
      <LocationProbe />
    </MemoryRouter>,
  );
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
    renderTab(<QuestionBankTab scope="mine" />);

    expect(await screen.findByText("I ___ never been to Japan.")).toBeTruthy();
    expect(screen.getByText("7–9")).toBeTruthy();
    // 平常只顯示值：考點 chip 文字、公開文字；沒有常駐下拉
    expect(screen.getByText("現在完成式")).toBeTruthy();
    expect(screen.getByTestId("qb-row-1-visibility-display").textContent).toBe(
      "私人",
    );
    expect(screen.queryByTestId("qb-row-1-visibility")).toBeNull();
    expect(screen.getByTestId("qb-row-1-sources-trigger")).toBeTruthy();
    expect(screen.getByTestId("qb-check-1")).toBeTruthy();
    expect(screen.queryByTestId("qb-bulk-bar")).toBeNull();
    expect(listQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "mine", page: 1, page_size: 20 }),
    );
  });

  it("機構 scope 會帶 organization_id；沒有 organizationId 時不打 API", async () => {
    listQuestions.mockResolvedValue(respond([]));
    const { unmount } = renderTab(
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
    renderTab(<QuestionBankTab scope="organization" />);
    expect(await screen.findByTestId("question-bank-empty")).toBeTruthy();
    expect(listQuestions).not.toHaveBeenCalled();
  });

  it("「新增題目」下拉只有選擇題可點，其餘 disabled；點選擇題呼叫 onCreateQuestion", async () => {
    listQuestions.mockResolvedValue(respond([]));
    const onCreate = vi.fn();
    const user = userEvent.setup();
    renderTab(<QuestionBankTab scope="mine" onCreateQuestion={onCreate} />);
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
    renderTab(<QuestionBankTab scope="mine" />);
    await screen.findByTestId("question-bank-empty");

    await user.click(screen.getByTestId("question-bank-add"));
    await user.click(
      await screen.findByTestId("question-bank-add-multiple_choice"),
    );
    expect(toastInfo).toHaveBeenCalledWith("editor soon");
  });

  it("canCreate=false 不顯示新增按鈕", async () => {
    listQuestions.mockResolvedValue(respond([]));
    renderTab(<QuestionBankTab scope="mine" canCreate={false} />);
    await screen.findByTestId("question-bank-empty");
    expect(screen.queryByTestId("question-bank-add")).toBeNull();
  });

  it("搜尋字串 debounce 後以 q 重新查詢，並顯示無符合狀態", async () => {
    listQuestions
      .mockResolvedValueOnce(respond([makeQuestion()]))
      .mockResolvedValueOnce(respond([]));
    const user = userEvent.setup();
    renderTab(<QuestionBankTab scope="mine" />);
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
    renderTab(<QuestionBankTab scope="mine" />);
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
    renderTab(<QuestionBankTab scope="mine" />);
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

  it("can_edit=false 的題：勾選後編輯鍵 disabled 並顯示無權限；混勾時 onBulkEdit 只收到可編輯題", async () => {
    listQuestions.mockResolvedValue(
      respond([
        makeQuestion({ id: 1 }),
        makeQuestion({
          id: 2,
          stem: "Q2",
          organization_id: "org-1",
          is_owner: false,
          can_edit: false,
        }),
      ]),
    );
    const onBulkEdit = vi.fn();
    const user = userEvent.setup();
    renderTab(<QuestionBankTab scope="mine" onBulkEdit={onBulkEdit} />);
    await screen.findByText("Q2");
    await user.click(screen.getByTestId("qb-check-2"));
    const editBtn = screen.getByTestId("qb-bulk-edit") as HTMLButtonElement;
    expect(editBtn.disabled).toBe(true);
    expect(editBtn.getAttribute("title")).toBe(
      "questionBank.list.bulkEditNoPermission",
    );
    await user.click(screen.getByTestId("qb-check-1"));
    expect(
      (screen.getByTestId("qb-bulk-edit") as HTMLButtonElement).disabled,
    ).toBe(false);
    await user.click(screen.getByTestId("qb-bulk-edit"));
    expect(onBulkEdit).toHaveBeenCalledTimes(1);
    expect(onBulkEdit.mock.calls[0][0].map((q: Question) => q.id)).toEqual([1]);
  });

  it("快速編輯考點 → 該列自動勾選、變黃；儲存只 PATCH 改過的列並帶三個欄位", async () => {
    listQuestions.mockResolvedValue(
      respond([makeQuestion({ id: 1 }), makeQuestion({ id: 2, stem: "Q2" })]),
    );
    updateQuestion.mockResolvedValue({});
    const user = userEvent.setup();
    renderTab(<QuestionBankTab scope="mine" />);
    await screen.findByText("Q2");

    // 點考點格開選單 → 取消勾選唯一考點 → 視為修改，且選完自動關閉
    await user.click(screen.getByTestId("qb-row-1-exam-points-trigger"));
    await user.click(
      await screen.findByTestId("qb-row-1-exam-points-option-3"),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("qb-row-1-exam-points-search")).toBeNull(),
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
    renderTab(<QuestionBankTab scope="mine" />);
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

  it("考點多選 filter：選一個→exam_point_ids 重查＋URL ep；再選一個→兩個；清除→移除", async () => {
    listQuestions.mockResolvedValue(respond([makeQuestion()]));
    const user = userEvent.setup();
    renderTab(<QuestionBankTab scope="mine" />);
    await screen.findByText("I ___ never been to Japan.");
    expect(listQuestions.mock.calls[0][0].exam_point_ids).toBeUndefined();

    await user.click(screen.getByTestId("qb-exam-point-filter-trigger"));
    await user.click(
      await screen.findByTestId("qb-exam-point-filter-option-3"),
    );
    await waitFor(() =>
      expect(listQuestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ exam_point_ids: [3], page: 1 }),
      ),
    );
    expect(screen.getByTestId("loc").textContent).toContain("ep=3");
    expect(
      screen.getByTestId("qb-exam-point-filter-trigger").textContent,
    ).toContain("現在完成式");

    await user.click(screen.getByTestId("qb-exam-point-filter-option-7"));
    await waitFor(() =>
      expect(listQuestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ exam_point_ids: [3, 7] }),
      ),
    );
    expect(screen.getByTestId("loc").textContent).toContain("ep=3%2C7");

    await user.click(screen.getByTestId("qb-exam-point-clear"));
    await waitFor(() =>
      expect(
        listQuestions.mock.calls[listQuestions.mock.calls.length - 1][0]
          .exam_point_ids,
      ).toBeUndefined(),
    );
    expect(screen.getByTestId("loc").textContent).not.toContain("ep=");
  });

  it("URL 帶 ep=3 進入：首次查詢就帶 exam_point_ids，trigger 顯示考點名稱", async () => {
    listQuestions.mockResolvedValue(respond([makeQuestion()]));
    renderTab(<QuestionBankTab scope="mine" />, ["/?ep=3"]);
    await screen.findByText("I ___ never been to Japan.");
    expect(listQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ exam_point_ids: [3] }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("qb-exam-point-filter-trigger").textContent,
      ).toContain("現在完成式"),
    );
  });

  it("「只看自己的」切換後以 only_own 重新查詢", async () => {
    listQuestions.mockResolvedValue(respond([makeQuestion()]));
    const user = userEvent.setup();
    renderTab(<QuestionBankTab scope="mine" />);
    await screen.findByText("I ___ never been to Japan.");
    expect(listQuestions.mock.calls[0][0].only_own).toBeUndefined();
    await user.click(screen.getByTestId("question-bank-only-own"));
    await waitFor(() =>
      expect(listQuestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ only_own: true, page: 1 }),
      ),
    );
  });
});
