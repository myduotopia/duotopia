/**
 * ReplyComposer「提交作業」（#1158 E2）：老師預覽時停用並寫明原因；學生端照常可按。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReplyComposer } from "../ReplyComposer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
    const btn = screen.getByRole("button", {
      name: "scenarioDialogue.chat.submitAssignment",
    });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "預覽不會送出");
    expect(screen.getByText("預覽不會送出")).toBeInTheDocument();
    await user.click(btn);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("沒有停用原因（學生）：可以按，下方照舊是完成提示", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ReplyComposer {...baseProps} onSubmitAssignment={onSubmit} />);
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
