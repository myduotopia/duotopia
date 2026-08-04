import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import {
  render,
  waitFor,
  fireEvent,
  screen,
  act,
} from "@testing-library/react";
import VocabularySetPanel from "../VocabularySetPanel";
import { SidebarProvider } from "@/contexts/SidebarContext";

const wrapper = ({ children }: { children: ReactNode }) => (
  <SidebarProvider>{children}</SidebarProvider>
);

// Mock apiClient.getContentDetail
const mockGetContentDetail = vi.fn();
// #957: 可控 resolve 時機的翻譯 mock，用來重現「await 期間 rows 被改動」的競態
const mockTranslateText = vi.fn();
// #957: 例句翻譯改走整句翻譯路徑（translateSentence），不再走單字翻譯（translateText）
const mockTranslateSentence = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    getContentDetail: (...args: unknown[]) => mockGetContentDetail(...args),
    generateTTS: vi.fn(),
    uploadAudio: vi.fn(),
    translateText: (...args: unknown[]) => mockTranslateText(...args),
    translateSentence: (...args: unknown[]) => mockTranslateSentence(...args),
    translateWithPos: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

vi.mock("@/config/api", () => ({
  API_URL: "http://localhost:8000",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Mock dnd-kit to avoid complex setup
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => children,
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: () => [],
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => children,
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  sortableKeyboardCoordinates: vi.fn(),
  arrayMove: (arr: unknown[]) => arr,
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => "" } },
}));

describe("VocabularySetPanel data loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call getContentDetail when content.id is provided", async () => {
    mockGetContentDetail.mockResolvedValue({
      title: "Test Vocabulary",
      items: [
        { text: "apple", translation: "蘋果" },
        { text: "banana", translation: "香蕉" },
      ],
    });

    render(<VocabularySetPanel content={{ id: 123 }} />, { wrapper });

    await waitFor(() => {
      expect(mockGetContentDetail).toHaveBeenCalledWith(123);
    });
  });

  it("should NOT call getContentDetail when content is undefined", async () => {
    render(<VocabularySetPanel />, { wrapper });

    // Give time for any potential async calls
    await new Promise((r) => setTimeout(r, 100));

    expect(mockGetContentDetail).not.toHaveBeenCalled();
  });

  it("should NOT call getContentDetail when content.id is undefined", async () => {
    render(<VocabularySetPanel content={{}} />, { wrapper });

    await new Promise((r) => setTimeout(r, 100));

    expect(mockGetContentDetail).not.toHaveBeenCalled();
  });

  it("should handle empty items response gracefully", async () => {
    mockGetContentDetail.mockResolvedValue({
      title: "Empty Set",
      items: [],
    });

    const { container } = render(<VocabularySetPanel content={{ id: 456 }} />, {
      wrapper,
    });

    await waitFor(() => {
      expect(mockGetContentDetail).toHaveBeenCalledWith(456);
    });

    // Should render without errors
    expect(container).toBeTruthy();
  });

  it("should handle API error gracefully", async () => {
    mockGetContentDetail.mockRejectedValue(new Error("Network error"));

    const { container } = render(<VocabularySetPanel content={{ id: 789 }} />, {
      wrapper,
    });

    await waitFor(() => {
      expect(mockGetContentDetail).toHaveBeenCalledWith(789);
    });

    // Should render without crashing
    expect(container).toBeTruthy();
  });
});

// Issue #729: distractor edit panel must not stringify objects as [object Object]
// and must preserve image_url when user edits text. Regression from PR #707 (#631).
describe("VocabularySetPanel distractor edit panel (assignment copy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders distractor text from new object shape, not '[object Object]'", async () => {
    mockGetContentDetail.mockResolvedValue({
      id: 1,
      title: "Vocab",
      items: [
        {
          text: "apple",
          definition: "蘋果",
          distractors: [
            { text: "banana", image_url: "https://example.com/b.png" },
            { text: "cherry", image_url: null },
          ],
        },
      ],
    });

    render(<VocabularySetPanel content={{ id: 1 }} isAssignmentCopy={true} />, {
      wrapper,
    });

    await waitFor(() => {
      expect(mockGetContentDetail).toHaveBeenCalled();
    });

    // The distractor inputs should show real text, not "[object Object]"
    const bananaInput = await screen.findByDisplayValue("banana");
    const cherryInput = await screen.findByDisplayValue("cherry");
    expect(bananaInput).toBeTruthy();
    expect(cherryInput).toBeTruthy();
    expect(screen.queryByDisplayValue("[object Object]")).toBeNull();
  });

  it("renders legacy string-shaped distractors (backwards compatible)", async () => {
    mockGetContentDetail.mockResolvedValue({
      id: 2,
      title: "Legacy",
      items: [
        {
          text: "dog",
          definition: "狗",
          distractors: ["cat", "bird"],
        },
      ],
    });

    render(<VocabularySetPanel content={{ id: 2 }} isAssignmentCopy={true} />, {
      wrapper,
    });

    await waitFor(() => expect(mockGetContentDetail).toHaveBeenCalled());

    expect(await screen.findByDisplayValue("cat")).toBeTruthy();
    expect(await screen.findByDisplayValue("bird")).toBeTruthy();
  });

  it("preserves image_url when editing distractor text (showOptionImages=false)", async () => {
    mockGetContentDetail.mockResolvedValue({
      id: 3,
      title: "Vocab",
      items: [
        {
          text: "apple",
          definition: "蘋果",
          distractors: [
            { text: "banana", image_url: "https://example.com/b.png" },
          ],
        },
      ],
    });

    const onUpdateContent = vi.fn();

    render(
      <VocabularySetPanel
        content={{ id: 3 }}
        isAssignmentCopy={true}
        showOptionImages={false}
        onUpdateContent={onUpdateContent}
      />,
      { wrapper },
    );

    const bananaInput = (await screen.findByDisplayValue(
      "banana",
    )) as HTMLInputElement;

    fireEvent.change(bananaInput, { target: { value: "blueberry" } });

    await waitFor(() => {
      const lastCall =
        onUpdateContent.mock.calls[onUpdateContent.mock.calls.length - 1];
      const items = (lastCall?.[0] as { items?: unknown[] })?.items as
        | Array<{ distractors?: unknown[] }>
        | undefined;
      expect(items?.[0]?.distractors?.[0]).toEqual({
        text: "blueberry",
        image_url: "https://example.com/b.png",
      });
    });
  });

  it("when showOptionImages=true, distractors render read-only with image (no input)", async () => {
    mockGetContentDetail.mockResolvedValue({
      id: 4,
      title: "Vocab",
      items: [
        {
          text: "apple",
          definition: "蘋果",
          distractors: [
            { text: "banana", image_url: "https://example.com/b.png" },
          ],
        },
      ],
    });

    render(
      <VocabularySetPanel
        content={{ id: 4 }}
        isAssignmentCopy={true}
        showOptionImages={true}
      />,
      { wrapper },
    );

    await waitFor(() => expect(mockGetContentDetail).toHaveBeenCalled());

    // Read-only: text is shown as plain content, not as an editable input.
    const bananaText = await screen.findByText("banana");
    expect(bananaText).toBeTruthy();
    expect(screen.queryByDisplayValue("banana")).toBeNull();

    // Image thumbnail should be rendered.
    const img = bananaText.parentElement?.querySelector(
      'img[src="https://example.com/b.png"]',
    );
    expect(img).toBeTruthy();
  });
});

// Issue #957: 例句「產生翻譯」偶發把「單字英文翻譯」翻進例句翻譯欄。
// Root cause 是前端非同步 state 競態：handler 先對 rows 做淺拷貝快照、await 網路、
// 再用捕捉到的 index 對整包 stale 快照 setRows 覆寫回去。若 await 期間列被重排/刪除，
// index 會對到別列，且 stale 快照會把期間的變動整包覆寫掉（甚至救活已刪的列）。
// 修法：送出前鎖定 row.id 與來源例句，回來後用 functional updater 依 id 定位、
// deep copy 目標列寫回；找不到（列已被刪）就放棄寫入。
describe("VocabularySetPanel example translation race (issue #957)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the translation back to the row identified by id, even after an earlier row is deleted mid-flight", async () => {
    mockGetContentDetail.mockResolvedValue({
      title: "Race",
      items: [
        { text: "apple", example_sentence: "I ate an apple." },
        { text: "banana", example_sentence: "I like banana." },
        { text: "cherry", example_sentence: "A red cherry." },
      ],
    });

    // 可控 resolve 時機的翻譯：呼叫時先卡住，等我們改動 rows 後才 resolve。
    let resolveTranslate: (v: { translation: string }) => void = () => {};
    mockTranslateSentence.mockImplementation(
      () =>
        new Promise<{ translation: string }>((res) => {
          resolveTranslate = res;
        }),
    );

    render(<VocabularySetPanel content={{ id: 123 }} />, { wrapper });

    await waitFor(() => expect(mockGetContentDetail).toHaveBeenCalledWith(123));

    // 三列的例句翻譯輸入框（依 render 順序 = 目前列順序）
    const exampleInputsBefore = await screen.findAllByPlaceholderText(
      "vocabularySet.placeholders.exampleTranslation",
    );
    expect(exampleInputsBefore).toHaveLength(3);

    // 點第三列（cherry）的「產生例句翻譯」按鈕
    const translateButtons = screen.getAllByTitle(
      "vocabularySet.tooltips.generateExampleTranslation",
    );
    expect(translateButtons).toHaveLength(3);
    fireEvent.click(translateButtons[2]);

    // #957: 例句翻譯必須走整句翻譯（translateSentence），不可走單字翻譯（translateText），
    // 且來源文字必須鎖定為該列的 example_sentence。
    await waitFor(() =>
      expect(mockTranslateSentence).toHaveBeenCalledWith(
        "A red cherry.",
        expect.anything(),
      ),
    );
    expect(mockTranslateText).not.toHaveBeenCalled();

    // await 期間刪掉第一列（apple）→ cherry 由 index 2 移到 index 1
    const deleteButtons = screen.getAllByTitle("contentEditor.tooltips.delete");
    fireEvent.click(deleteButtons[0]);

    await waitFor(() =>
      expect(
        screen.getAllByPlaceholderText(
          "vocabularySet.placeholders.exampleTranslation",
        ),
      ).toHaveLength(2),
    );

    // 現在才讓翻譯回來
    await act(async () => {
      resolveTranslate({ translation: "一顆紅櫻桃。" });
    });

    // 剩兩列，順序 [banana, cherry]
    const exampleInputsAfter = (await screen.findAllByPlaceholderText(
      "vocabularySet.placeholders.exampleTranslation",
    )) as HTMLInputElement[];
    expect(exampleInputsAfter).toHaveLength(2);

    // 翻譯結果必須落在 cherry（index 1），banana（index 0）維持空白
    expect(exampleInputsAfter[0].value).toBe("");
    expect(exampleInputsAfter[1].value).toBe("一顆紅櫻桃。");

    // 被刪掉的 apple 不能因為 stale 快照被救活
    expect(screen.queryByDisplayValue("apple")).toBeNull();
    expect(screen.queryByText("apple")).toBeNull();
  });

  it("drops the translation when its target row is deleted before the response arrives", async () => {
    mockGetContentDetail.mockResolvedValue({
      title: "Race2",
      items: [
        { text: "apple", example_sentence: "I ate an apple." },
        { text: "banana", example_sentence: "I like banana." },
      ],
    });

    let resolveTranslate: (v: { translation: string }) => void = () => {};
    mockTranslateSentence.mockImplementation(
      () =>
        new Promise<{ translation: string }>((res) => {
          resolveTranslate = res;
        }),
    );

    render(<VocabularySetPanel content={{ id: 55 }} />, { wrapper });
    await waitFor(() => expect(mockGetContentDetail).toHaveBeenCalledWith(55));

    // 對第一列（apple）觸發例句翻譯（走整句翻譯路徑）
    const translateButtons = screen.getAllByTitle(
      "vocabularySet.tooltips.generateExampleTranslation",
    );
    fireEvent.click(translateButtons[0]);
    await waitFor(() =>
      expect(mockTranslateSentence).toHaveBeenCalledWith(
        "I ate an apple.",
        expect.anything(),
      ),
    );

    // 回來前刪掉 apple 本身
    const deleteButtons = screen.getAllByTitle("contentEditor.tooltips.delete");
    fireEvent.click(deleteButtons[0]);
    await waitFor(() =>
      expect(
        screen.getAllByPlaceholderText(
          "vocabularySet.placeholders.exampleTranslation",
        ),
      ).toHaveLength(1),
    );

    await act(async () => {
      resolveTranslate({ translation: "我吃了一顆蘋果。" });
    });

    // 只剩 banana，且不得出現 apple 的翻譯內容，也不得救活 apple
    const inputs = (await screen.findAllByPlaceholderText(
      "vocabularySet.placeholders.exampleTranslation",
    )) as HTMLInputElement[];
    expect(inputs).toHaveLength(1);
    expect(inputs[0].value).toBe("");
    expect(screen.queryByDisplayValue("apple")).toBeNull();
    expect(screen.queryByText("apple")).toBeNull();
  });
});
