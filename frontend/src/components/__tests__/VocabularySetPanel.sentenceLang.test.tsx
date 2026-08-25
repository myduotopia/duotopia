/**
 * Issue #1004: 編輯既有單字集時的例句翻譯 bug
 *
 * 1. 左側「翻譯成」沒有從既有資料還原 → 顯示「尚未選擇」
 * 2. 一選語言就把所有列已完成的例句翻譯清空
 * 3. 沒選語言時，批次補齊會靜默跳過例句翻譯（使用者看到的是「全部失敗」）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, waitFor, fireEvent, screen } from "@testing-library/react";
import { toast } from "sonner";
import VocabularySetPanel, {
  resolveExampleTranslationTarget,
  getInitialSentenceLang,
} from "../VocabularySetPanel";
import { SidebarProvider } from "@/contexts/SidebarContext";

const wrapper = ({ children }: { children: ReactNode }) => (
  <SidebarProvider>{children}</SidebarProvider>
);

const mockGetContentDetail = vi.fn();
const mockBatchTranslateSentences = vi.fn();
const mockTranslateSentence = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    getContentDetail: (...args: unknown[]) => mockGetContentDetail(...args),
    batchTranslateSentences: (...args: unknown[]) =>
      mockBatchTranslateSentences(...args),
    translateSentence: (...args: unknown[]) => mockTranslateSentence(...args),
    translateText: vi.fn(),
    translateWithPos: vi.fn(),
    batchTranslate: vi.fn(),
    batchTranslateWithPos: vi.fn(),
    generateSentences: vi.fn(),
    generateTTS: vi.fn(),
    batchGenerateTTS: vi.fn(),
    uploadAudio: vi.fn(),
    updateContent: vi.fn(),
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

const getSentenceLangSelect = async () =>
  (await screen.findByTestId(
    "example-sentence-lang-select",
  )) as HTMLSelectElement;

describe("resolveExampleTranslationTarget (#1004)", () => {
  it("uses the explicitly selected language", () => {
    expect(
      resolveExampleTranslationTarget("japanese", "", [
        { selectedSentenceLanguage: "chinese" },
      ]),
    ).toEqual({ value: "japanese", code: "ja" });
  });

  it("falls back to the row language when nothing is selected", () => {
    expect(
      resolveExampleTranslationTarget("", "", [
        { example_sentence: "I eat.", selectedSentenceLanguage: "korean" },
      ]),
    ).toEqual({ value: "korean", code: "ko" });
  });

  it("falls back to chinese when neither is available", () => {
    expect(resolveExampleTranslationTarget("", "", [{}])).toEqual({
      value: "chinese",
      code: "zh-TW",
    });
  });

  it("uses the custom language for 'other'", () => {
    expect(resolveExampleTranslationTarget("other", "Thai", [{}])).toEqual({
      value: "other",
      code: "Thai",
    });
  });

  it("returns an empty code for 'other' without a custom language", () => {
    expect(resolveExampleTranslationTarget("other", "  ", [{}])).toEqual({
      value: "other",
      code: "",
    });
  });
});

describe("getInitialSentenceLang (#1004)", () => {
  it("prefers the language of a row that actually has a translation", () => {
    expect(
      getInitialSentenceLang([
        { selectedSentenceLanguage: "chinese" },
        {
          selectedSentenceLanguage: "japanese",
          example_sentence_japanese: "私はりんごを食べます。",
        },
      ]),
    ).toBe("japanese");
  });

  it("falls back to the first row's language", () => {
    expect(
      getInitialSentenceLang([{ selectedSentenceLanguage: "korean" }]),
    ).toBe("korean");
  });

  it("returns empty string when there are no rows", () => {
    expect(getInitialSentenceLang([])).toBe("");
  });
});

describe("VocabularySetPanel 例句翻譯語言 (#1004)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores the saved example translation language into 翻譯成", async () => {
    mockGetContentDetail.mockResolvedValue({
      id: 1,
      title: "Vocab",
      items: [
        {
          text: "apple",
          vocabulary_translation: "りんご",
          vocabulary_translation_lang: "japanese",
          example_sentence: "I eat an apple.",
          example_sentence_translation: "私はりんごを食べます。",
          example_sentence_translation_lang: "japanese",
        },
      ],
    });

    render(<VocabularySetPanel content={{ id: 1 }} />, { wrapper });
    await waitFor(() => expect(mockGetContentDetail).toHaveBeenCalled());

    const select = await getSentenceLangSelect();
    expect(select.value).toBe("japanese");
  });

  it("keeps existing translations when the language is switched", async () => {
    mockGetContentDetail.mockResolvedValue({
      id: 2,
      title: "Vocab",
      items: [
        {
          text: "apple",
          example_sentence: "I eat an apple.",
          example_sentence_translation: "私はりんごを食べます。",
          example_sentence_translation_lang: "japanese",
        },
      ],
    });

    render(<VocabularySetPanel content={{ id: 2 }} />, { wrapper });
    await waitFor(() => expect(mockGetContentDetail).toHaveBeenCalled());

    expect(screen.getByDisplayValue("私はりんごを食べます。")).toBeTruthy();

    const select = await getSentenceLangSelect();

    // 切到韓文：日文欄位不該被清掉，只是暫時不顯示
    fireEvent.change(select, { target: { value: "korean" } });
    await waitFor(() => {
      expect(screen.queryByDisplayValue("私はりんごを食べます。")).toBeNull();
    });

    // 切回日文：原本翻譯完成的內容必須還在
    fireEvent.change(select, { target: { value: "japanese" } });
    await waitFor(() => {
      expect(screen.getByDisplayValue("私はりんごを食べます。")).toBeTruthy();
    });
  });

  it("backfills example translations for an existing set (no silent skip)", async () => {
    // 使用者情境：把例句翻譯清空後，用左側批次補齊來補回來
    mockGetContentDetail.mockResolvedValue({
      id: 3,
      title: "Vocab",
      items: [
        {
          text: "apple",
          definition: "蘋果",
          vocabulary_translation: "蘋果",
          vocabulary_translation_lang: "chinese",
          audio_url: "https://example.com/apple.mp3",
          example_sentence: "I eat an apple.",
          example_sentence_translation: "",
          example_sentence_audio_url: "https://example.com/apple-s.mp3",
        },
      ],
    });
    mockBatchTranslateSentences.mockResolvedValue({
      translations: ["我吃一顆蘋果。"],
    });

    render(<VocabularySetPanel content={{ id: 3 }} />, { wrapper });
    await waitFor(() => expect(mockGetContentDetail).toHaveBeenCalled());

    // 貼上框留空 → 補齊模式
    fireEvent.click(screen.getByText("contentEditor.buttons.confirmPaste"));

    await waitFor(() => {
      expect(mockBatchTranslateSentences).toHaveBeenCalledWith(
        ["I eat an apple."],
        "zh-TW",
      );
    });
    await waitFor(() => {
      expect(screen.getByDisplayValue("我吃一顆蘋果。")).toBeTruthy();
    });
  });
});

describe("單題例句翻譯按鈕 (#1004)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const singleRowContent = {
    id: 4,
    title: "Vocab",
    items: [
      {
        text: "apple",
        example_sentence: "I eat an apple.",
        example_sentence_translation: "",
        example_sentence_translation_lang: "japanese",
      },
    ],
  };

  it("writes the translation into the field of the selected language", async () => {
    mockGetContentDetail.mockResolvedValue(singleRowContent);
    mockTranslateSentence.mockResolvedValue({
      translation: "私はりんごを食べます。",
    });

    render(<VocabularySetPanel content={{ id: 4 }} />, { wrapper });
    await waitFor(() => expect(mockGetContentDetail).toHaveBeenCalled());

    fireEvent.click(
      screen.getByTitle("vocabularySet.tooltips.generateExampleTranslation"),
    );

    await waitFor(() => {
      expect(mockTranslateSentence).toHaveBeenCalledWith(
        "I eat an apple.",
        "ja",
      );
    });
    await waitFor(() => {
      expect(screen.getByDisplayValue("私はりんごを食べます。")).toBeTruthy();
    });
  });

  it("reports an error when the API echoes the source sentence back", async () => {
    // 後端 AI 失敗時會原樣回傳英文句子 → 不可以當成翻譯成功寫進欄位
    mockGetContentDetail.mockResolvedValue(singleRowContent);
    mockTranslateSentence.mockResolvedValue({ translation: "I eat an apple." });

    render(<VocabularySetPanel content={{ id: 4 }} />, { wrapper });
    await waitFor(() => expect(mockGetContentDetail).toHaveBeenCalled());

    fireEvent.click(
      screen.getByTitle("vocabularySet.tooltips.generateExampleTranslation"),
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "vocabularySet.messages.exampleTranslationFailed",
      );
    });
    expect(screen.queryByDisplayValue("I eat an apple.")).toBeTruthy(); // 例句本身還在
    const translationInputs = screen.queryAllByDisplayValue("I eat an apple.");
    expect(translationInputs.length).toBe(1); // 翻譯欄位沒有被填入英文原句
  });
});
