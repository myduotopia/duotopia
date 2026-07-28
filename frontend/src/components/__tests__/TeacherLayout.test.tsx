import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import TeacherLayout from "../TeacherLayout";

// Mock API client
vi.mock("@/lib/api", () => ({
  apiClient: {
    get: vi.fn(),
    getConfig: vi.fn().mockResolvedValue({
      enablePayment: true,
      environment: "development",
    }),
    getSubscriptionStatus: vi.fn(),
    // TeacherLayout 從 getTeacherDashboard().teacher 取得 profile（非 localStorage）
    getTeacherDashboard: vi.fn().mockResolvedValue({
      teacher: {
        id: 1,
        email: "teacher@example.com",
        name: "Test Teacher",
        is_demo: false,
        is_active: true,
      },
    }),
    logout: vi.fn(),
  },
}));

// Mock DigitalTeachingToolbar component
vi.mock("@/components/teachingTools/DigitalTeachingToolbar", () => ({
  default: () => (
    <div data-testid="digital-teaching-toolbar">DigitalTeachingToolbar</div>
  ),
}));

// Mock LanguageSwitcher
vi.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <div>LanguageSwitcher</div>,
}));

// Mock react-i18next（元件在 sidebar 語言選單使用 i18n.language.startsWith）
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW", changeLanguage: vi.fn() },
  }),
}));

describe("TeacherLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Mock localStorage
    const mockProfile = {
      id: 1,
      email: "teacher@example.com",
      name: "Test Teacher",
      is_demo: false,
      is_active: true,
    };
    localStorage.setItem("teacherProfile", JSON.stringify(mockProfile));
  });

  it("should render DigitalTeachingToolbar", async () => {
    const { apiClient } = await import("@/lib/api");
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { enablePayment: true, environment: "development" },
    });

    render(
      <BrowserRouter>
        <TeacherLayout>
          <div>Content</div>
        </TeacherLayout>
      </BrowserRouter>,
    );

    await waitFor(() => {
      // Teachers SHOULD have access to teaching tools
      expect(
        screen.getByTestId("digital-teaching-toolbar"),
      ).toBeInTheDocument();
    });
  });

  it("should render teacher navigation", async () => {
    const { apiClient } = await import("@/lib/api");
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { enablePayment: true, environment: "development" },
    });

    render(
      <BrowserRouter>
        <TeacherLayout>
          <div>Content</div>
        </TeacherLayout>
      </BrowserRouter>,
    );

    await waitFor(() => {
      // Teachers should have their own navigation
      expect(screen.getByText("Test Teacher")).toBeInTheDocument();
    });
  });

  it("personal 模式：quota 有值時顯示剩餘點數看板", async () => {
    const { apiClient } = await import("@/lib/api");
    // 預設 mode = personal（localStorage 未設定 workspace:mode）
    vi.mocked(apiClient.getSubscriptionStatus).mockResolvedValue({
      quota_total: 1000,
      quota_used: 250,
    } as never);

    render(
      <BrowserRouter>
        <TeacherLayout>
          <div>Content</div>
        </TeacherLayout>
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("剩餘點數").length).toBeGreaterThan(0);
    });
    expect(apiClient.getSubscriptionStatus).toHaveBeenCalled();
  });

  it("機構視圖（organization 模式）不顯示剩餘點數看板，也不 fetch 點數", async () => {
    const { apiClient } = await import("@/lib/api");
    // 切到機構視圖
    localStorage.setItem("workspace:mode", "organization");
    localStorage.setItem(
      "workspace:organization",
      JSON.stringify({ id: "org-1", name: "測試機構" }),
    );
    // 即使 API 會回傳 quota，也不該顯示（org 模式根本不 fetch）
    vi.mocked(apiClient.getSubscriptionStatus).mockResolvedValue({
      quota_total: 1000,
      quota_used: 250,
    } as never);

    render(
      <BrowserRouter>
        <TeacherLayout>
          <div>Content</div>
        </TeacherLayout>
      </BrowserRouter>,
    );

    // 等版面渲染完成（老師名稱出現）
    await waitFor(() => {
      expect(screen.getByText("Test Teacher")).toBeInTheDocument();
    });

    // 機構視圖不顯示剩餘點數看板
    expect(screen.queryAllByText("剩餘點數")).toHaveLength(0);
    // 機構視圖不呼叫個人 quota API，避免殘留個人資料
    expect(apiClient.getSubscriptionStatus).not.toHaveBeenCalled();
  });
});
