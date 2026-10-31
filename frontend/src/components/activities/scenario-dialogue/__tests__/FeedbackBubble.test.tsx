/**
 * FeedbackBubble A 方案（#1158 E-2）：單層氣泡、評語一行、建議說法加粗＋🔊 圖示鈕、
 * 小膠囊按鈕整列靠右（目前題：下一題在左、再試一次主色在最右；前面題只有再試一次）。
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FeedbackBubble } from "../FeedbackBubble";
import { speakEnglish } from "@/utils/speakEnglish";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/utils/speakEnglish", () => ({ speakEnglish: vi.fn() }));

const FEEDBACK = {
  verdict: "improve" as const,
  comment: "要用過去式 ate。",
  suggestion: "She ate a lot of food.",
};

function renderBubble(
  over: Partial<React.ComponentProps<typeof FeedbackBubble>> = {},
) {
  const props = {
    feedback: FEEDBACK,
    onSpeak: vi.fn(),
    actions: "current" as const,
    maxAttempts: 3,
    onRetry: vi.fn(),
    onNext: vi.fn(),
    ...over,
  };
  render(<FeedbackBubble {...props} />);
  return props;
}

describe("FeedbackBubble — A 方案", () => {
  it("單層：沒有外框線，只有淺底色；評語一行（verdict 接評語）", () => {
    renderBubble();
    const bubble = screen.getByTestId("scenario-feedback");
    expect(bubble.className).toContain("bg-amber-50");
    expect(bubble.className).not.toMatch(/(^|\s)border(\s|-)/);
    expect(bubble.querySelector("p")!.textContent).toBe(
      "scenarioDialogue.chat.verdictImprovescenarioDialogue.chat.verdictSeparator要用過去式 ate。",
    );
  });

  it("建議說法加粗單獨一行，旁邊 🔊 圖示鈕（aria-label 聽建議說法）", () => {
    const props = renderBubble();
    const suggestion = screen.getByTestId("scenario-suggestion");
    expect(suggestion.className).toContain("font-bold");
    expect(suggestion.textContent).toContain("She ate a lot of food.");
    const speak = screen.getByRole("button", {
      name: "scenarioDialogue.chat.listenSuggestion",
    });
    expect(speak.textContent).toBe("");
    fireEvent.click(speak);
    expect(props.onSpeak).toHaveBeenCalledWith("She ate a lot of food.");
  });

  it("建議說法每個字可點，只唸那個字（標點不唸）；🔊 才播整句（#1158 E2）", () => {
    const props = renderBubble();
    fireEvent.click(
      screen.getByRole("button", {
        name: "groupedQuestionsTemplate.labels.clickToPronounciate: food",
      }),
    );
    expect(vi.mocked(speakEnglish)).toHaveBeenLastCalledWith(
      "food",
      expect.anything(),
    );
    expect(props.onSpeak).not.toHaveBeenCalled();
  });

  it("目前題：整列靠右，下一題（次要）在左、再試一次（主色）在最右", () => {
    const props = renderBubble();
    const row = screen
      .getByRole("button", { name: /scenarioDialogue\.chat\.retry/ })
      .closest("div")!;
    expect(row.className).toContain("justify-end");
    const actions = Array.from(row.querySelectorAll("button"));
    expect(actions.map((b) => b.textContent)).toEqual([
      "scenarioDialogue.chat.next",
      "scenarioDialogue.chat.retry",
    ]);
    expect(actions[1].className).toContain("rounded-full");
    expect(actions[1].className).not.toContain("border-input");
    expect(actions[0].className).toContain("border");
    fireEvent.click(actions[1]);
    expect(props.onRetry).toHaveBeenCalled();
    fireEvent.click(actions[0]);
    expect(props.onNext).toHaveBeenCalled();
  });

  it("前面題：只有「再試一次」（次要），靠右", () => {
    renderBubble({
      actions: "retry",
      feedback: { ...FEEDBACK, verdict: "great" },
    });
    expect(screen.getByTestId("scenario-feedback").className).toContain(
      "bg-green-50",
    );
    const retry = screen.getByRole("button", {
      name: /scenarioDialogue\.chat\.retry/,
    });
    expect(retry.parentElement!.className).toContain("justify-end");
    expect(
      screen.queryByRole("button", { name: /scenarioDialogue\.chat\.next/ }),
    ).toBeNull();
  });

  it("phrase（問某個字怎麼說）：不顯示很棒／可以更好，片語加粗可點＋🔊＋引導，中性底色", () => {
    const props = renderBubble({
      actions: "none",
      feedback: {
        kind: "phrase",
        verdict: "improve",
        comment: "試著用它回答看看",
        suggestion: "a lot of",
      },
    });
    const bubble = screen.getByTestId("scenario-feedback");
    expect(bubble.className).toContain("bg-blue-50");
    expect(bubble.className).not.toContain("bg-amber-50");
    expect(bubble.textContent).not.toContain(
      "scenarioDialogue.chat.verdictImprove",
    );
    expect(bubble.textContent).not.toContain(
      "scenarioDialogue.chat.verdictGreat",
    );
    expect(screen.getByText("試著用它回答看看")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-suggestion").className).toContain(
      "font-bold",
    );
    // 單字可點
    expect(
      screen.getByRole("button", {
        name: "groupedQuestionsTemplate.labels.clickToPronounciate: lot",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "scenarioDialogue.chat.listenPhrase",
      }),
    );
    expect(props.onSpeak).toHaveBeenCalledWith("a lot of");
  });

  it("model_answer（不會答）：標題「可以這樣說」＋整句加粗＋照著念一次，不顯示 verdict", () => {
    renderBubble({
      actions: "none",
      feedback: {
        kind: "model_answer",
        verdict: "great",
        comment: "照著念一次看看",
        suggestion: "I went to the park.",
      },
    });
    const bubble = screen.getByTestId("scenario-feedback");
    expect(bubble.className).toContain("bg-blue-50");
    expect(bubble.className).not.toContain("bg-green-50");
    expect(
      screen.getByText("scenarioDialogue.chat.modelAnswerTitle"),
    ).toBeInTheDocument();
    expect(bubble.textContent).not.toContain("scenarioDialogue.chat.verdict");
    expect(screen.getByTestId("scenario-suggestion").textContent).toContain(
      "I went to the park.",
    );
    expect(screen.getByText("照著念一次看看")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "scenarioDialogue.chat.listenSuggestion",
      }),
    ).toBeInTheDocument();
  });

  it("重答中這一題的舊建議變淡", () => {
    renderBubble({ faded: true, actions: "none" });
    expect(screen.getByTestId("scenario-feedback").className).toContain(
      "opacity-60",
    );
  });
});
