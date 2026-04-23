import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, waitFor } from "@testing-library/react";
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
