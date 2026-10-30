/**
 * ReplyComposer「提交作業」（#1158 E2）：老師預覽時停用並寫明原因；學生端照常可按。
 * 語音錄音區（#1158 E3）：固定在最下方、底色條＝主按鈕一半高、等待時灰色麥克風＋原因小字。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReplyComposer } from "../ReplyComposer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      opts ? `${key}:${Object.values(opts).join(",")}` : key,
  }),
}));

const baseProps = {
  state: "finished" as const,
  replyMode: "voice" as const,
  waitingHint: "",
  retryNo: null,
  canCancelRetry: false,
  onStart: vi.fn(),
  onSubmitAnswer: vi.fn(),
  onCancelRetry: vi.fn(),
};

describe("ReplyComposer — 提交作業", () => {
  it("有停用原因（預覽）：按鈕停用，原因顯示在下方並放進 title", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <ReplyComposer
        {...baseProps}
        onSubmitAssignment={onSubmit}
        submitDisabledReason="預覽不會送出"
      />,
    );
    // 語音作答：綠色圓鈕沒有文字，名稱（aria-label）帶停用原因（#1158 E-4）
    const btn = screen.getByRole("button", {
      name: "scenarioDialogue.chat.submitAssignment（預覽不會送出）",
    });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "預覽不會送出");
    expect(screen.getByText("預覽不會送出")).toBeInTheDocument();
    await user.click(btn);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("沒有停用原因（學生，打字作答）：可以按，下方照舊是完成提示", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <ReplyComposer
        {...baseProps}
        replyMode="text"
        onSubmitAssignment={onSubmit}
      />,
    );
    const btn = screen.getByRole("button", {
      name: "scenarioDialogue.chat.submitAssignment",
    });
    expect(btn).not.toBeDisabled();
    expect(
      screen.getByText("scenarioDialogue.chat.finishedHint"),
    ).toBeInTheDocument();
    await user.click(btn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("ReplyComposer — 語音錄音區（#1158 E3）", () => {
  const voiceProps = { ...baseProps, onSubmitAssignment: vi.fn() };

  it("作答中：錄音區浮在底部（-mt-9），底色條高度＝主按鈕一半（h-9，blue-50＋blue-100 細線）", () => {
    render(<ReplyComposer {...voiceProps} state="answer" />);
    const dock = screen.getByTestId("scenario-reply-dock");
    expect(dock.className).toContain("-mt-9");
    expect(dock.className).toContain("shrink-0");
    const strip = screen.getByTestId("scenario-reply-strip");
    for (const c of ["h-9", "bg-blue-50", "border-blue-100", "bottom-0"]) {
      expect(strip.className).toContain(c);
    }
    expect(
      screen.getByRole("button", { name: "audioRecorder.ui.startRecording" }),
    ).not.toBeDisabled();
  });

  it("等待中：灰色停用麥克風，原因小字在底色條右側", () => {
    render(
      <ReplyComposer
        {...voiceProps}
        state="waiting"
        waitingHint="請在上方選擇"
      />,
    );
    const mic = screen.getByRole("button", {
      name: "audioRecorder.ui.startRecordingDisabled:請在上方選擇",
    });
    expect(mic).toBeDisabled();
    const hint = screen.getByRole("status");
    expect(hint).toHaveTextContent("請在上方選擇");
    expect(hint.className).toContain("right-3");
  });

  it("重答中：「正在重答第 N 題 ✕」浮在按鈕列上方", () => {
    render(
      <ReplyComposer
        {...voiceProps}
        state="answer"
        retryNo={2}
        canCancelRetry
      />,
    );
    expect(
      screen.getByText("scenarioDialogue.chat.retrying:2"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "scenarioDialogue.chat.cancelRetry" }),
    ).toBeInTheDocument();
  });

  it("intro／finished 維持文字主按鈕，不是浮動錄音區", () => {
    render(<ReplyComposer {...voiceProps} state="intro" />);
    expect(screen.queryByTestId("scenario-reply-dock")).toBeNull();
    expect(
      screen.getByRole("button", { name: "scenarioDialogue.chat.start" }),
    ).toBeInTheDocument();
  });
});
