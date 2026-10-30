/**
 * 題目圖格（ScenarioImageSlot）點圖放大（#1158 修正 C6）。
 *
 * - 有圖時點圖開放大檢視（標準元件 ZoomableImage）
 * - 點「替換」「移除」不觸發放大
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { ScenarioImageSlot } from "../ScenarioQuestionRow";

const renderSlot = () => {
  const props = {
    imageUrl: "https://cdn/q1.png",
    loading: false,
    onPick: vi.fn(),
    onRemove: vi.fn(),
    onGenerate: vi.fn(),
  };
  render(<ScenarioImageSlot {...props} />);
  return props;
};

describe("ScenarioImageSlot 點圖放大（修正 C6）", () => {
  it("點題目圖開放大檢視", () => {
    renderSlot();
    expect(screen.getByTestId("scenario-question-image")).toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText("questionBank.group.render.zoomImage"),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("點「移除」「替換」不觸發放大", () => {
    const props = renderSlot();
    fireEvent.click(screen.getByText("scenarioDialogue.buttons.removeImage"));
    expect(props.onRemove).toHaveBeenCalled();
    fireEvent.click(screen.getByText("scenarioDialogue.buttons.replaceImage"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
