/**
 * #1158 修正 E4b（學生端低項）：
 * (2) 上次有正式作答（priorAttempts > 0）但伺服器沒有錄音：題目下方說明「上次有作答，但沒有留下錄音」，
 *     不放回答氣泡；下方操作列照常（還有次數＝再試一次，用完＝已達 N 次）。
 * (3) 學生沒答、老師就通過的題目：算答過（方格綠、提交前不列未答），題目下方標「老師已通過」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { useScenarioChat, TYPING_MS } from "../useScenarioChat";
import { ScenarioChatActivity } from "../ScenarioChatActivity";
import type { ScenarioChatItem } from "../types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

const AUDIO = "https://example.com/rec.webm";

const item = (
  id: number,
  extra: Partial<ScenarioChatItem> = {},
): ScenarioChatItem => ({
  id,
  text: `Q${id}?`,
  keywords: [],
  images: [],
  ...extra,
});

const SETTINGS = {
  replyMode: "voice" as const,
  textDefaultHidden: true,
  showTranslation: false,
  isPreviewMode: false,
  maxAttempts: 3,
};

function renderActivity(
  items: ScenarioChatItem[],
  onProgressChange?: (answered: boolean[]) => void,
) {
  render(
    <ScenarioChatActivity
      context={{ title: "t", images: [] }}
      items={items}
      settings={SETTINGS}
      adapters={{ getFeedback: vi.fn(), speak: vi.fn() }}
      onSubmit={() => {}}
      onProgressChange={onProgressChange}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /scenarioDialogue.chat.start/ }),
  );
  act(() => {
    vi.advanceTimersByTime(TYPING_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  URL.revokeObjectURL = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo =
    vi.fn() as unknown as typeof Element.prototype.scrollTo;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("(2) 上次答過但沒有錄音", () => {
  it("說明沒有留下錄音、不放回答氣泡；還有次數 → 再試一次", () => {
    renderActivity([item(1, { priorAttempts: 1 }), item(2)]);
    const record = screen.getByTestId("scenario-previous-answer");
    expect(
      screen.getByTestId("scenario-previous-answer-no-audio").textContent,
    ).toBe("scenarioDialogue.chat.previousAnswerNoAudio");
    // 沒有「上次的回答」氣泡（小字標籤）
    expect(
      screen.queryByText("scenarioDialogue.chat.previousAnswer"),
    ).toBeNull();
    expect(record.textContent).toContain("scenarioDialogue.chat.retry");
  });

  it("次數已用完 → 已達 N 次，沒有再試一次", () => {
    renderActivity([item(1, { priorAttempts: 3 }), item(2)]);
    const record = screen.getByTestId("scenario-previous-answer");
    expect(record.textContent).toContain(
      "scenarioDialogue.chat.attemptsReached",
    );
    expect(record.textContent).not.toContain("scenarioDialogue.chat.retry");
  });

  it("有錄音的照舊放「上次的回答」氣泡，不出現沒有錄音的說明（迴歸）", () => {
    renderActivity([item(1, { submittedAudioUrl: AUDIO, priorAttempts: 1 })]);
    expect(
      screen.getByTestId("scenario-previous-answer").textContent,
    ).toContain("scenarioDialogue.chat.previousAnswer");
    expect(
      screen.queryByTestId("scenario-previous-answer-no-audio"),
    ).toBeNull();
  });
});

describe("(3) 學生沒答、老師就通過", () => {
  it("answered 算答過；只求助過（priorAttempts 0）的照舊不算", () => {
    const items = [
      item(1, { teacherPassed: true }),
      item(2, { submittedAudioUrl: AUDIO, priorHelp: 1 }),
      item(3),
    ];
    const { result } = renderHook(() =>
      useScenarioChat({
        items,
        adapters: { getFeedback: vi.fn(), speak: vi.fn() },
        maxAttempts: 3,
        textDefaultHidden: true,
        translatable: items.map(() => false),
      }),
    );
    expect(result.current.answered).toEqual([true, false, false]);
  });

  it("畫面：題目下方標「老師已通過」、沒有回答氣泡也沒有再試一次；回報給外層算答過", () => {
    const onProgressChange = vi.fn();
    renderActivity(
      [item(1, { teacherPassed: true }), item(2)],
      onProgressChange,
    );
    const record = screen.getByTestId("scenario-previous-answer");
    expect(record.textContent).toContain("scenarioDialogue.chat.teacherPassed");
    expect(record.textContent).not.toContain("scenarioDialogue.chat.retry");
    expect(record.textContent).not.toContain(
      "scenarioDialogue.chat.previousAnswer",
    );
    expect(onProgressChange).toHaveBeenLastCalledWith([true, false]);
  });
});
