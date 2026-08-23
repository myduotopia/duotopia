import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import AdminReleaseAnnouncementsPage from "../AdminReleaseAnnouncementsPage";
import { releaseAnnouncementApi } from "@/services/releaseAnnouncementService";
import type { ReleaseAnnouncement } from "@/services/releaseAnnouncementService";

vi.mock("@/services/releaseAnnouncementService", () => ({
  releaseAnnouncementApi: {
    list: vi.fn(),
    update: vi.fn(),
    merge: vi.fn(),
    publish: vi.fn(),
    discard: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/stores/teacherAuthStore", () => ({
  useTeacherAuthStore: (selector: (s: { token: string }) => unknown) =>
    selector({ token: "test-token" }),
}));

const draft = (
  overrides: Partial<ReleaseAnnouncement> = {},
): ReleaseAnnouncement => ({
  id: 1,
  environment: "production",
  source_ref: "abc1234",
  source_branch: "main",
  pr_number: 991,
  issue_numbers: "860",
  release_title: "Release: [Feature]: 單字選擇 (Fixes #860)",
  change_type: "feature",
  line_message_zh: "單字選擇題型上線囉！",
  line_message_en: "Word choice questions are live!",
  article_title_zh: "新功能：單字選擇題型",
  article_body_zh: "老師現在可以指派單字選擇題型。",
  article_title_en: "New: word choice questions",
  article_body_en: "Teachers can now assign word choice questions.",
  image_url: "https://cdn/banner.png",
  status: "draft",
  line_status: "pending",
  line_error: null,
  line_published_at: null,
  website_status: "pending",
  website_error: null,
  website_published_at: null,
  published_blog_url: null,
  published_blog_url_en: null,
  generation_error: null,
  merged_into_id: null,
  created_at: "2026-08-24T02:00:00+00:00",
  ...overrides,
});

const mockApi = releaseAnnouncementApi as unknown as {
  list: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  merge: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  discard: ReturnType<typeof vi.fn>;
};

const renderPage = () =>
  render(
    <BrowserRouter>
      <AdminReleaseAnnouncementsPage />
    </BrowserRouter>,
  );

describe("AdminReleaseAnnouncementsPage (issue #804)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.list.mockResolvedValue({ data: [draft()] });
  });

  it("列出草稿並顯示來源與環境", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: /Release: \[Feature\]/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/production/i).length).toBeGreaterThan(0);
  });

  it("LINE 文案與官網文章分開兩個編輯區塊", async () => {
    renderPage();
    await screen.findByTestId("line-flex-preview");

    expect(screen.getByText("LINE 推播文案")).toBeInTheDocument();
    expect(screen.getByText("官網雙語文章")).toBeInTheDocument();
    expect(screen.getByLabelText("LINE 文案（中文）")).toHaveValue(
      "單字選擇題型上線囉！",
    );
    expect(screen.getByLabelText("文章內文（中文）")).toHaveValue(
      "老師現在可以指派單字選擇題型。",
    );
  });

  it("顯示 LINE 卡片預覽（與文章草稿分開）", async () => {
    renderPage();
    await screen.findByText("LINE 卡片預覽");
    const preview = screen.getByTestId("line-flex-preview");
    expect(preview).toHaveTextContent("單字選擇題型上線囉！");
    expect(preview).toHaveTextContent("Word choice questions are live!");
  });

  it("儲存時只送出編輯過的草稿內容", async () => {
    mockApi.update.mockResolvedValue({
      data: draft({ line_message_zh: "改過的文案" }),
    });
    renderPage();
    await screen.findByTestId("line-flex-preview");

    fireEvent.change(screen.getByLabelText("LINE 文案（中文）"), {
      target: { value: "改過的文案" },
    });
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));

    await waitFor(() => expect(mockApi.update).toHaveBeenCalledTimes(1));
    expect(mockApi.update.mock.calls[0][1]).toMatchObject({
      line_message_zh: "改過的文案",
    });
  });

  it("未勾選通道時不能發布", async () => {
    renderPage();
    await screen.findByTestId("line-flex-preview");

    fireEvent.click(screen.getByLabelText("LINE 官方帳號"));
    fireEvent.click(screen.getByLabelText("官網文章"));

    expect(screen.getByRole("button", { name: /發布/ })).toBeDisabled();
  });

  it("發布時送出勾選的通道", async () => {
    mockApi.publish.mockResolvedValue({
      data: draft({
        website_status: "published",
        status: "partially_published",
      }),
    });
    renderPage();
    await screen.findByTestId("line-flex-preview");

    // 預設兩個通道都勾選 → 取消 LINE，只發官網
    fireEvent.click(screen.getByLabelText("LINE 官方帳號"));
    fireEvent.click(screen.getByRole("button", { name: /發布/ }));

    await waitFor(() => expect(mockApi.publish).toHaveBeenCalledTimes(1));
    expect(mockApi.publish.mock.calls[0][1]).toEqual(["website"]);
  });

  it("已發布的通道顯示狀態並不再重複勾選", async () => {
    mockApi.list.mockResolvedValue({
      data: [
        draft({
          website_status: "published",
          status: "partially_published",
          published_blog_url: "https://duotopia.co/blog/new-feature",
        }),
      ],
    });
    renderPage();
    await screen.findByTestId("line-flex-preview");

    expect(screen.getByLabelText("官網文章")).toBeDisabled();
    expect(
      screen.getByRole("link", {
        name: /https:\/\/duotopia.co\/blog\/new-feature/,
      }),
    ).toBeInTheDocument();
  });

  it("可把未發布的舊草稿併入這一則", async () => {
    const older = draft({
      id: 2,
      source_ref: "old999",
      release_title: "Release: [Bug]: 修正錄音 (Fixes #816)",
      line_message_zh: "上次沒發的修正",
    });
    mockApi.list.mockResolvedValue({ data: [draft(), older] });
    mockApi.merge.mockResolvedValue({
      data: draft({
        line_message_zh: "上次沒發的修正\n\n單字選擇題型上線囉！",
      }),
    });

    renderPage();
    await screen.findByTestId("line-flex-preview");

    fireEvent.click(screen.getByRole("button", { name: "載入舊草稿" }));
    fireEvent.click(await screen.findByLabelText(/修正錄音/));
    fireEvent.click(screen.getByRole("button", { name: "併入這一則" }));

    await waitFor(() => expect(mockApi.merge).toHaveBeenCalledTimes(1));
    expect(mockApi.merge.mock.calls[0][0]).toBe(1);
    expect(mockApi.merge.mock.calls[0][1]).toEqual([2]);
  });

  it("AI 產草稿失敗時顯示提醒", async () => {
    mockApi.list.mockResolvedValue({
      data: [draft({ generation_error: "vertex timeout" })],
    });
    renderPage();
    expect(await screen.findByText(/AI 產生草稿失敗/)).toBeInTheDocument();
  });

  it("沒有草稿時顯示空狀態", async () => {
    mockApi.list.mockResolvedValue({ data: [] });
    renderPage();
    expect(
      await screen.findByText(/目前沒有待處理的更新公告/),
    ).toBeInTheDocument();
  });
});
