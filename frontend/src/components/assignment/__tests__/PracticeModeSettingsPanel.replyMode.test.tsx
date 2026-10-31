/**
 * 派發「作答方式」兩個大按鈕（#1158，只有情境對話）：
 * 語音預設選取；打字停用並寫明「即將上線」（REVIEW.md 按鈕層級第 3 條）；
 * 純顯示，點了不會改設定。其他模式不出現。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PracticeModeSettingsPanel } from "../PracticeModeSettingsPanel";
import type { PracticeModeSettings } from "../practiceModeSettings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const PM = "dialogs.assignmentDialog.practiceMode";

const value: PracticeModeSettings = {
  time_limit_per_question: 30,
  quiz_time_limit_seconds: 0,
  is_live_quiz: false,
  shuffle_questions: false,
  show_answer: false,
  play_audio: false,
  target_proficiency: 80,
  show_translation: true,
  show_word: true,
  show_image: true,
  show_option_images: false,
  show_example_sentence: false,
};

describe("PracticeModeSettingsPanel — 作答方式（#1158）", () => {
  it("情境對話：語音預設選取；打字停用並標「即將上線」", () => {
    render(
      <PracticeModeSettingsPanel
        mode="scenario_dialogue"
        value={value}
        onChange={vi.fn()}
      />,
    );
    const group = screen.getByTestId("reply-mode-setting");
    expect(within(group).getByText(`${PM}.replyMode`)).toBeInTheDocument();

    const voice = within(group).getByRole("button", {
      name: new RegExp(`${PM}.replyModeOption.voice`),
    });
    const text = within(group).getByRole("button", {
      name: new RegExp(`${PM}.replyModeOption.text`),
    });
    expect(voice).toHaveAttribute("aria-pressed", "true");
    expect(voice).not.toBeDisabled();
    expect(text).toHaveAttribute("aria-pressed", "false");
    expect(text).toBeDisabled();
    // 停用原因看得到（按鈕上的小字）也在 title
    expect(text).toHaveTextContent(`${PM}.replyModeComingSoon`);
    expect(text).toHaveAttribute("title", `${PM}.replyModeComingSoon`);
  });

  it("純顯示：點語音不會改設定", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PracticeModeSettingsPanel
        mode="scenario_dialogue"
        value={value}
        onChange={onChange}
      />,
    );
    await user.click(
      screen.getByRole("button", {
        name: new RegExp(`${PM}.replyModeOption.voice`),
      }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("其他模式不顯示作答方式", () => {
    render(
      <PracticeModeSettingsPanel
        mode="reading"
        value={value}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("reply-mode-setting")).toBeNull();
  });
});
