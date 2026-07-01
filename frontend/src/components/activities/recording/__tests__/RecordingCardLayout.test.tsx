import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecordingCardLayout } from "../RecordingCardLayout";

describe("RecordingCardLayout", () => {
  it("renders the card children", () => {
    render(
      <RecordingCardLayout>
        <div>CARD</div>
      </RecordingCardLayout>,
    );
    expect(screen.getByText("CARD")).toBeInTheDocument();
  });

  it("renders header, attempts and controls slots", () => {
    render(
      <RecordingCardLayout
        header={<span>HEADER</span>}
        attempts={<span>ATTEMPTS</span>}
        controls={<span>CONTROLS</span>}
      >
        card
      </RecordingCardLayout>,
    );
    expect(screen.getByText("HEADER")).toBeInTheDocument();
    expect(screen.getByText("ATTEMPTS")).toBeInTheDocument();
    expect(screen.getByTestId("recording-controls-slot")).toBeInTheDocument();
  });

  it("omits the feedback slot when not provided", () => {
    render(<RecordingCardLayout>card</RecordingCardLayout>);
    expect(screen.queryByTestId("recording-feedback-slot")).toBeNull();
  });

  it("renders the feedback slot when provided", () => {
    render(
      <RecordingCardLayout feedbackBar={<span>FEEDBACK</span>}>
        card
      </RecordingCardLayout>,
    );
    expect(screen.getByTestId("recording-feedback-slot")).toBeInTheDocument();
    expect(screen.getByText("FEEDBACK")).toBeInTheDocument();
  });
});
