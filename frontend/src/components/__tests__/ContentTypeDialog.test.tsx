import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import ContentTypeDialog from "../ContentTypeDialog";
import { SidebarProvider } from "@/contexts/SidebarContext";

// i18n: follow repo convention — t returns the key (or the provided default
// string). 斷言一律用 key，避免文案調整就讓測試紅掉。
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultOrOpts?: unknown) =>
      typeof defaultOrOpts === "string" ? defaultOrOpts : key,
    i18n: { language: "zh-TW" },
  }),
}));

// 元件關閉時有 300ms 的 slide-out 動畫，onClose 是動畫結束後才呼叫。
const CLOSE_ANIMATION_MS = 300;

// 目前支援的內容類型（順序即畫面顯示順序）。
// 只斷言「有哪些類型」，不斷言各自的 enabled/disabled——後者會隨功能開關變動，
// 由下面 aria-disabled 驅動的測試負責覆蓋。
const EXPECTED_TYPES = [
  "example_sentences",
  "vocabulary_set",
  "scenario_dialogue",
];

const lessonInfo = {
  programName: "Basic English",
  lessonName: "Unit 1: Greetings",
  lessonId: 1,
};

describe("ContentTypeDialog", () => {
  const mockOnClose = vi.fn();
  const mockOnSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderComponent = (
    open = true,
    info: React.ComponentProps<
      typeof ContentTypeDialog
    >["lessonInfo"] = lessonInfo,
    extra: Partial<React.ComponentProps<typeof ContentTypeDialog>> = {},
  ) =>
    render(
      <SidebarProvider>
        <ContentTypeDialog
          open={open}
          onClose={mockOnClose}
          onSelect={mockOnSelect}
          lessonInfo={info}
          {...extra}
        />
      </SidebarProvider>,
    );

  const getCards = () => screen.getAllByTestId(/^content-type-card-/);
  const typeOf = (card: HTMLElement) =>
    card.getAttribute("data-testid")!.replace("content-type-card-", "");
  const isDisabled = (card: HTMLElement) =>
    card.getAttribute("aria-disabled") === "true";
  const enabledCards = () => getCards().filter((c) => !isDisabled(c));
  const disabledCards = () => getCards().filter((c) => isDisabled(c));
  const runCloseAnimation = () =>
    act(() => {
      vi.advanceTimersByTime(CLOSE_ANIMATION_MS);
    });

  it("open=false 時不渲染任何內容", () => {
    const { container } = renderComponent(false);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByText("dialogs.contentTypeDialog.title"),
    ).not.toBeInTheDocument();
  });

  it("顯示標題與帶課程名稱的說明", () => {
    renderComponent();

    expect(
      screen.getByText("dialogs.contentTypeDialog.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("dialogs.contentTypeDialog.description"),
    ).toBeInTheDocument();
  });

  it("每個支援的內容類型各一張卡，testid 為小寫 type", () => {
    renderComponent();

    expect(getCards().map(typeOf)).toEqual(EXPECTED_TYPES);
  });

  it("每張卡顯示自己的名稱與描述（i18n key）", () => {
    renderComponent();

    getCards().forEach((card) => {
      const type = typeOf(card);
      expect(
        within(card).getByText(`dialogs.contentTypeDialog.types.${type}.name`),
      ).toBeInTheDocument();
      expect(
        within(card).getByText(
          `dialogs.contentTypeDialog.types.${type}.description`,
        ),
      ).toBeInTheDocument();
    });
  });

  it("每張卡都是 role=button 並帶 aria-label", () => {
    renderComponent();

    getCards().forEach((card) => {
      expect(card).toHaveAttribute("role", "button");
      expect(card.getAttribute("aria-label")).toContain(
        `dialogs.contentTypeDialog.types.${typeOf(card)}.name`,
      );
    });
  });

  it("啟用的卡可聚焦、停用的卡不可聚焦且標示 Soon", () => {
    renderComponent();

    enabledCards().forEach((card) => {
      expect(card).toHaveAttribute("tabindex", "0");
      expect(card).not.toHaveClass("cursor-not-allowed");
    });
    disabledCards().forEach((card) => {
      expect(card).toHaveAttribute("tabindex", "-1");
      expect(card).toHaveClass("cursor-not-allowed");
      expect(within(card).getByText("Soon")).toBeInTheDocument();
    });
  });

  it("點擊啟用的卡會帶著課程資訊呼叫 onSelect", () => {
    renderComponent();

    const card = enabledCards()[0];
    expect(card).toBeDefined();
    fireEvent.click(card);

    expect(mockOnSelect).toHaveBeenCalledTimes(1);
    expect(mockOnSelect).toHaveBeenCalledWith({
      type: typeOf(card),
      lessonId: 1,
      programId: undefined,
      programName: "Basic English",
      lessonName: "Unit 1: Greetings",
    });
  });

  it("programId 會原樣傳出（Issue #587 program-direct 內容）", () => {
    renderComponent(true, {
      programName: "Basic English",
      lessonName: "",
      lessonId: 0,
      programId: 42,
    });

    fireEvent.click(enabledCards()[0]);

    expect(mockOnSelect).toHaveBeenCalledWith(
      expect.objectContaining({ programId: 42, lessonId: 0 }),
    );
  });

  it("停用的卡不論點擊或鍵盤都不會觸發 onSelect", () => {
    renderComponent();

    const disabled = disabledCards();
    disabled.forEach((card) => {
      fireEvent.click(card);
      fireEvent.keyDown(card, { key: "Enter" });
      fireEvent.keyDown(card, { key: " " });
    });

    expect(mockOnSelect).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it.each([["Enter"], [" "]])("在啟用的卡上按 %s 等同點擊", (key) => {
    renderComponent();

    const card = enabledCards()[0];
    fireEvent.keyDown(card, { key });

    expect(mockOnSelect).toHaveBeenCalledTimes(1);
    expect(mockOnSelect).toHaveBeenCalledWith(
      expect.objectContaining({ type: typeOf(card) }),
    );
  });

  it("選擇後先顯示處理中，動畫結束才呼叫 onClose", () => {
    renderComponent();

    fireEvent.click(enabledCards()[0]);

    // 進入 loading：卡片被處理中訊息取代
    expect(
      screen.getByText("dialogs.contentTypeDialog.processing"),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^content-type-card-/)).toHaveLength(0);

    // 動畫跑完前不呼叫 onClose
    expect(mockOnClose).not.toHaveBeenCalled();
    runCloseAnimation();
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("按關閉鈕會關閉 dialog 且不觸發 onSelect", () => {
    renderComponent();

    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    runCloseAnimation();

    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(mockOnSelect).not.toHaveBeenCalled();
  });

  it("按 Escape 會關閉 dialog", () => {
    renderComponent();

    fireEvent.keyDown(window, { key: "Escape" });
    runCloseAnimation();

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("點背景遮罩會關閉 dialog", () => {
    const { container } = renderComponent();

    const backdrop = container.querySelector(".fixed.inset-0");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    runCloseAnimation();

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  /**
   * #944：ContentTypeDialog 被五個頁面共用，但只有「我的教材」接了
   * ScenarioDialoguePanel。這個開關讓還沒接面板的頁面維持停用，
   * 避免點下去靜靜地什麼都不發生。
   */
  describe("情境對話開關（#944 enableScenarioDialogue）", () => {
    const card = () =>
      screen.getByTestId("content-type-card-scenario_dialogue");

    it("預設停用：不可聚焦、點了不會觸發 onSelect", () => {
      renderComponent();

      expect(card()).toHaveAttribute("aria-disabled", "true");
      expect(card()).toHaveAttribute("tabindex", "-1");

      fireEvent.click(card());
      expect(mockOnSelect).not.toHaveBeenCalled();
    });

    it("打開後才可以選，並帶出正確的 type", () => {
      renderComponent(true, lessonInfo, { enableScenarioDialogue: true });

      expect(card()).toHaveAttribute("aria-disabled", "false");

      fireEvent.click(card());
      expect(mockOnSelect).toHaveBeenCalledWith(
        expect.objectContaining({ type: "scenario_dialogue" }),
      );
    });
  });
});
