/**
 * #1158 E-2：情境對話畫面修正
 * - E1：對話標題列不重複情境標題，改寫「對話」、灰色系
 * - E4：🔊／英／中、作答要求／情境切換鈕開啟時用次要樣式（淺藍底藍字＋藍框），不用藍底主按鈕
 * - E5：情境卡顯示情境圖（ImageCarousel）
 * - E6：已提交唯讀：列出題目＋自己的錄音，不顯示「開始對話」與錄音區
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RevealCapsules, TOGGLE_ON_CLASS } from "../RevealCapsules";
import { InfoStrip, ScenarioContextCard } from "../ScenarioContextCard";
import { ScenarioChatActivity } from "../ScenarioChatActivity";
import type { ScenarioChatNav } from "../ScenarioChatActivity";
import type { ScenarioChatContext, ScenarioChatItem } from "../types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo =
    vi.fn() as unknown as typeof Element.prototype.scrollTo;
});

const CONTEXT: ScenarioChatContext = {
  title: "週末去夜市",
  content: "Amy went to the night market.",
  images: [
    { src: "https://example.com/s1.jpg", alt: "Scenario image 1" },
    { src: "https://example.com/s2.jpg", alt: "Scenario image 2" },
  ],
  rubric: "請用完整句子回答。",
};

const ITEMS: ScenarioChatItem[] = [
  {
    id: 1,
    text: "What did Amy eat?",
    keywords: [],
    images: [],
    submittedAudioUrl: "https://example.com/a1.webm",
  },
  { id: 2, text: "Who did Amy go with?", keywords: [], images: [] },
];

const SETTINGS = {
  replyMode: "voice" as const,
  textDefaultHidden: false,
  showTranslation: false,
  isPreviewMode: false,
  maxAttempts: 3,
};

const ADAPTERS = {
  getFeedback: vi.fn(),
  speak: vi.fn(),
};

const onClasses = TOGGLE_ON_CLASS.split(" ");

describe("E4 切換鈕樣式", () => {
  it("英／中開啟時是次要樣式（淺藍底藍字＋藍框），關閉是白底灰框", () => {
    render(
      <RevealCapsules
        enOn
        zhOn={false}
        showTranslation
        onPlay={() => {}}
        onToggleEn={() => {}}
        onToggleZh={() => {}}
      />,
    );
    const en = screen.getByRole("button", {
      name: "scenarioDialogue.chat.hideEnglish",
    });
    for (const c of ["bg-blue-50", "text-blue-700", "border-blue-300"]) {
      expect(en.className).toContain(c);
    }
    // 不是藍底主按鈕
    expect(en.className).not.toMatch(/(^|\s)bg-primary(\s|$)/);
    const zh = screen.getByRole("button", {
      name: "scenarioDialogue.chat.showChineseFull",
    });
    expect(zh.className).not.toContain("bg-blue-50");
  });

  it("情境卡的「作答要求／情境」切換鈕開啟時套同一樣式", () => {
    const onOpenChange = vi.fn();
    render(
      <InfoStrip
        context={CONTEXT}
        showScenario
        open="rubric"
        onOpenChange={onOpenChange}
      />,
    );
    const buttons = screen.getAllByRole("button");
    const rubric = buttons.find(
      (b) => b.getAttribute("aria-expanded") === "true",
    )!;
    const scenario = buttons.find(
      (b) => b.getAttribute("aria-expanded") === "false",
    )!;
    for (const c of onClasses) expect(rubric.className).toContain(c);
    expect(scenario.className).not.toContain("bg-blue-50");
    expect(rubric.className).not.toMatch(/(^|\s)bg-primary(\s|$)/);
  });
});

describe("E5 情境卡顯示情境圖", () => {
  it("有情境圖時用輪播顯示在卡片上方", () => {
    render(<ScenarioContextCard context={CONTEXT} />);
    const img = document.querySelector('img[src="https://example.com/s1.jpg"]');
    expect(img).not.toBeNull();
    expect(
      screen.getByLabelText("scenarioDialogue.chat.scenarioImages"),
    ).toBeInTheDocument();
  });
});

describe("E1／E4 對話標題列", () => {
  it("不重複情境標題，寫「對話」、灰色系", () => {
    render(
      <ScenarioChatActivity
        context={{ ...CONTEXT, images: [] }}
        items={ITEMS}
        settings={SETTINGS}
        adapters={ADAPTERS}
        onSubmit={() => {}}
        layout="compact"
      />,
    );
    const header = document.querySelector("header")!;
    expect(header.textContent).toContain("scenarioDialogue.chat.conversation");
    expect(header.textContent).not.toContain("週末去夜市");
    expect(header.className).toContain("bg-gray-50");
    expect(header.className).not.toContain("purple");
  });
});

describe("E6 已提交唯讀", () => {
  it("列出題目與自己的錄音，不顯示「開始對話」與錄音區；題號全部可點", () => {
    const navs: ScenarioChatNav[] = [];
    render(
      <ScenarioChatActivity
        context={{ ...CONTEXT, images: [] }}
        items={ITEMS}
        settings={SETTINGS}
        adapters={ADAPTERS}
        onSubmit={() => {}}
        readOnly
        onNavChange={(n) => navs.push(n)}
      />,
    );
    expect(
      screen.getByTestId("scenario-submitted-transcript"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("What did Amy eat?").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Who did Amy go with?").length).toBeGreaterThan(
      0,
    );
    // 第 2 題沒有錄音
    expect(
      screen.getByText("scenarioDialogue.chat.noAnswer"),
    ).toBeInTheDocument();
    // 第 1 題有可播放的錄音
    expect(
      screen
        .getByTestId("scenario-submitted-transcript")
        .querySelectorAll("audio"),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /scenarioDialogue\.chat\.start/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /scenarioDialogue\.chat\.submitAssignment/,
      }),
    ).toBeNull();
    const last = navs[navs.length - 1];
    expect(last).toMatchObject({
      started: true,
      revealedCount: 2,
      current: null,
    });
  });

  it("作答中（非唯讀）照舊顯示「開始對話」", () => {
    render(
      <ScenarioChatActivity
        context={{ ...CONTEXT, images: [] }}
        items={ITEMS}
        settings={SETTINGS}
        adapters={ADAPTERS}
        onSubmit={() => {}}
      />,
    );
    expect(screen.queryByTestId("scenario-submitted-transcript")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /scenarioDialogue\.chat\.start/ }),
    );
  });
});
