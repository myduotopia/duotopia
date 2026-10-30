/**
 * #1158 E-2：情境對話畫面修正
 * - E1：對話標題列不重複情境標題，改寫「對話」、灰色系
 * - E4：🔊／英／中、作答要求／情境切換鈕開啟時淺藍底藍字、關閉白底，都沒有外框，不用藍底主按鈕
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
  it("英／中開啟時淺藍底藍字、關閉白底，沒有外框", () => {
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
    for (const c of ["bg-blue-100", "text-blue-700"]) {
      expect(en.className).toContain(c);
    }
    // 不是藍底主按鈕
    expect(en.className).not.toMatch(/(^|\s)bg-primary(\s|$)/);
    const zh = screen.getByRole("button", {
      name: "scenarioDialogue.chat.showChineseFull",
    });
    expect(zh.className).not.toContain("bg-blue-100");
    expect(zh.className).toContain("bg-white");
    // 沒有外框（ghost，不是 outline）
    expect(en.className).not.toContain("border-input");
    expect(zh.className).not.toContain("border-input");
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
    expect(scenario.className).not.toContain("bg-blue-100");
    expect(scenario.className).not.toContain("border-input");
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

describe("題目氣泡單層（#1158 E-2 A 方案）", () => {
  it("沒有外框線，只有淡灰底", async () => {
    const { QuestionBubble } = await import("../QuestionBubble");
    render(
      <QuestionBubble
        index={0}
        total={2}
        item={ITEMS[0]}
        visible={{ en: true, zh: false }}
        showTranslation={false}
        isPreviewMode={false}
        skipped={false}
        averageScore={null}
        onPlay={() => {}}
        onToggle={() => {}}
      />,
    );
    const bubble = screen.getByTestId("scenario-question");
    expect(bubble.className).toContain("bg-gray-100");
    expect(bubble.className).not.toMatch(/(^|\s)border(\s|-)/);
  });
});

describe("AI 頭像（#1158 E-2）", () => {
  it("AI 一側是線描熊熊（40px、purple），不是灰底 Bot；口鼻線條比較細", async () => {
    const { AiRow } = await import("../TypingIndicator");
    render(
      <AiRow>
        <p>hi</p>
      </AiRow>,
    );
    const avatar = screen.getByTestId("bear-avatar");
    for (const c of ["h-10", "w-10", "rounded-full", "bg-purple-100"]) {
      expect(avatar.className).toContain(c);
    }
    expect(avatar).toHaveAttribute("aria-hidden");
    const snout = avatar.querySelector("ellipse")!;
    expect(snout.getAttribute("stroke-width")).toBe("1.1");
    expect(snout.getAttribute("rx")).toBe("3.3");
    expect(avatar.querySelector("svg")!.getAttribute("stroke-width")).toBe(
      "1.8",
    );
  });

  it("學生的回答氣泡沒有頭像", async () => {
    const { AnswerBubble } = await import("../AnswerBubble");
    render(
      <AnswerBubble
        answer={{ kind: "text", text: "hello" }}
        attemptNo={1}
        showAttemptNo={false}
        faded={false}
      />,
    );
    expect(screen.queryByTestId("bear-avatar")).toBeNull();
  });
});

describe("回頭重答（#1158 E-2）", () => {
  it("題目氣泡標「重答中」、淡藍底＋藍色光圈", async () => {
    const { QuestionBubble } = await import("../QuestionBubble");
    render(
      <QuestionBubble
        index={0}
        total={2}
        item={ITEMS[0]}
        visible={{ en: true, zh: false }}
        showTranslation={false}
        isPreviewMode={false}
        skipped={false}
        averageScore={null}
        retrying
        onPlay={() => {}}
        onToggle={() => {}}
      />,
    );
    const bubble = screen.getByTestId("scenario-question");
    expect(bubble.className).toContain("bg-blue-100");
    expect(bubble.className).toContain("ring-blue-300");
    expect(
      screen.getByText("scenarioDialogue.chat.questionNoRetrying"),
    ).toBeInTheDocument();
  });

  it("重答中、還沒送出新回答：該題舊的回答與建議全部變淡", async () => {
    const { ChatTranscript } = await import("../ChatTranscript");
    const attempt = {
      answer: { kind: "text" as const, text: "She eat food." },
      feedback: { verdict: "improve" as const, comment: "用過去式" },
    };
    const chat = {
      phase: "awaitingAnswer",
      current: 1,
      attempts: [[attempt], []],
      revealedCount: 2,
      visible: [
        { en: true, zh: false },
        { en: true, zh: false },
      ],
      skipped: [false, false],
      retry: { index: 0, status: "answering" },
      retryBusy: false,
      closingShown: false,
      canRetry: () => false,
      averageFor: () => null,
      toggleText: () => {},
      goNext: () => {},
    };
    render(
      <ChatTranscript
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chat={chat as any}
        items={ITEMS}
        settings={SETTINGS}
        adapters={ADAPTERS}
        translatable={[false, false]}
        registerBlock={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByTestId("scenario-feedback").className).toContain(
      "opacity-60",
    );
    expect(
      screen.getByText("She eat food.").closest(".transition-opacity")!
        .className,
    ).toContain("opacity-50");
    expect(document.querySelector('[data-retrying="true"]')).not.toBeNull();
  });
});
