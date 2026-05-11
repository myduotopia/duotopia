import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, waitFor, fireEvent, screen } from "@testing-library/react";
import VocabularySetPanel from "../VocabularySetPanel";
import { SidebarProvider } from "@/contexts/SidebarContext";

const wrapper = ({ children }: { children: ReactNode }) => (
  <SidebarProvider>{children}</SidebarProvider>
);

// Mock apiClient.getContentDetail
const mockGetContentDetail = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    getContentDetail: (...args: unknown[]) => mockGetContentDetail(...args),
    generateTTS: vi.fn(),
    uploadAudio: vi.fn(),
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

    render(
      <VocabularySetPanel content={{ id: 1 }} isAssignmentCopy={true} />,
      { wrapper },
    );

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

    render(
      <VocabularySetPanel content={{ id: 2 }} isAssignmentCopy={true} />,
      { wrapper },
    );

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
