/**
 * 回頭重答提示（#1158 E-2 重答流程）：深藍小膠囊「正在重答第 N 題 ✕」，錄音中隱藏 ✕。
 * AudioRecorder 換成 stub，才能不靠 MediaRecorder 模擬「開始／停止錄音」。
 */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ReplyComposer } from "../ReplyComposer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      opts ? `${key}:${Object.values(opts).join(",")}` : key,
  }),
}));

vi.mock("@/components/shared/AudioRecorder", () => ({
  default: (props: {
    onRecordingStart?: () => void;
    onRecordingStop?: () => void;
  }) => (
    <div>
      <button type="button" onClick={props.onRecordingStart}>
        stub-start
      </button>
      <button type="button" onClick={props.onRecordingStop}>
        stub-stop
      </button>
    </div>
  ),
}));

const props = {
  state: "answer" as const,
  replyMode: "voice" as const,
  waitingHint: "",
  retryNo: 1,
  canCancelRetry: true,
  onStart: vi.fn(),
  onSubmitAnswer: vi.fn(),
  onCancelRetry: vi.fn(),
  onSubmitAssignment: vi.fn(),
};

const cancelButton = () =>
  screen.queryByRole("button", { name: "scenarioDialogue.chat.cancelRetry" });

describe("ReplyComposer — 重答提示", () => {
  it("深藍小膠囊浮在錄音鈕上方，✕ 放棄重答", () => {
    const onCancelRetry = vi.fn();
    render(<ReplyComposer {...props} onCancelRetry={onCancelRetry} />);
    const banner = screen.getByTestId("scenario-retry-banner");
    expect(banner.className).toContain("bg-blue-900");
    expect(banner.className).toContain("rounded-full");
    expect(banner).toHaveTextContent("scenarioDialogue.chat.retrying:1");
    fireEvent.click(cancelButton()!);
    expect(onCancelRetry).toHaveBeenCalled();
  });

  it("錄音中隱藏 ✕，停止後再出現", () => {
    render(<ReplyComposer {...props} />);
    expect(cancelButton()).not.toBeNull();
    act(() => {
      fireEvent.click(screen.getByText("stub-start"));
    });
    expect(cancelButton()).toBeNull();
    expect(screen.getByTestId("scenario-retry-banner")).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByText("stub-stop"));
    });
    expect(cancelButton()).not.toBeNull();
  });
});
