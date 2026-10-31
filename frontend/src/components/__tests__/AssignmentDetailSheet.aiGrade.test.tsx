/**
 * #1158：作業設定 sheet 的紫色「AI 批改」—— 情境對話直接不顯示（不是停用），
 * 批改維持老師手動評分；其他作業類型（例句朗讀）照舊顯示（迴歸）。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssignmentDetailSheet } from "../AssignmentDetailSheet";
import type { Assignment } from "@/types";

const stableT = (key: string, fallback?: unknown) =>
  typeof fallback === "string" ? fallback : key;
const stableI18n = { language: "zh-TW", changeLanguage: vi.fn() };
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: stableI18n }),
  Trans: ({ children }: { children?: unknown }) => children,
}));

// 詳情與進度永遠在載入中 —— 批改按鈕列只看 prop，不必等資料
vi.mock("@/lib/api", () => {
  const pending = () => new Promise(() => {});
  return {
    apiClient: {
      get: vi.fn(pending),
      patch: vi.fn(pending),
      post: vi.fn(pending),
      getContentDetail: vi.fn(pending),
    },
  };
});

vi.mock("@/contexts/SidebarContext", () => ({
  useSidebar: () => ({ sidebarWidth: 0 }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const renderSheet = (practice_mode: string) =>
  render(
    <MemoryRouter>
      <AssignmentDetailSheet
        open
        onOpenChange={vi.fn()}
        classroomId="1"
        canUseAiGrading
        onGradeClick={vi.fn()}
        onBatchGradeClick={vi.fn()}
        assignment={
          {
            id: 7,
            title: "作業",
            practice_mode,
            content_type: "EXAMPLE_SENTENCES",
          } as unknown as Assignment
        }
      />
    </MemoryRouter>,
  );

describe("AssignmentDetailSheet — AI 批改入口（#1158）", () => {
  it("情境對話：有批改作業鈕，但不顯示 AI 批改", () => {
    renderSheet("scenario_dialogue");
    expect(screen.getByText("批改作業")).toBeInTheDocument();
    expect(screen.queryByText("AI 批改")).not.toBeInTheDocument();
  });

  it("例句朗讀：照舊顯示 AI 批改（迴歸）", () => {
    renderSheet("reading");
    expect(screen.getByText("批改作業")).toBeInTheDocument();
    expect(screen.getByText("AI 批改")).toBeInTheDocument();
  });
});
