import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeacherFeedbackBar } from "../TeacherFeedbackBar";

describe("TeacherFeedbackBar", () => {
  it("renders nothing when no feedback", () => {
    const { container } = render(
      <TeacherFeedbackBar passed={false} feedback="" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the feedback text", () => {
    render(<TeacherFeedbackBar passed={false} feedback="尾音吃掉了，再念一次試試" />);
    expect(screen.getByText("尾音吃掉了，再念一次試試")).toBeInTheDocument();
  });

  it("shows pass variant (✓) when passed", () => {
    render(<TeacherFeedbackBar passed={true} feedback="很棒！" />);
    expect(
      screen.getByTestId("teacher-feedback-bar").getAttribute("data-variant"),
    ).toBe("pass");
  });

  it("shows fail variant (✗) when not passed", () => {
    render(<TeacherFeedbackBar passed={false} feedback="再試一次" />);
    expect(
      screen.getByTestId("teacher-feedback-bar").getAttribute("data-variant"),
    ).toBe("fail");
  });

  it("shows neutral variant when passed is null", () => {
    render(<TeacherFeedbackBar passed={null} feedback="請注意重音" />);
    expect(
      screen.getByTestId("teacher-feedback-bar").getAttribute("data-variant"),
    ).toBe("neutral");
  });
});
