import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScoreBadge } from "../ScoreBadge";

describe("ScoreBadge", () => {
  it("shows the rounded score", () => {
    render(<ScoreBadge score={86.6} />);
    expect(screen.getByTestId("score-badge").textContent).toContain("87");
  });

  it("colors the badge by band", () => {
    const { rerender } = render(<ScoreBadge score={90} />);
    expect(screen.getByTestId("score-badge").getAttribute("data-band")).toBe(
      "pass",
    );
    rerender(<ScoreBadge score={70} />);
    expect(screen.getByTestId("score-badge").getAttribute("data-band")).toBe(
      "warn",
    );
    rerender(<ScoreBadge score={40} />);
    expect(screen.getByTestId("score-badge").getAttribute("data-band")).toBe(
      "fail",
    );
  });

  it("is disabled with no popover when no children", () => {
    render(<ScoreBadge score={90} />);
    expect(screen.getByTestId("score-badge")).toBeDisabled();
    fireEvent.click(screen.getByTestId("score-badge"));
    expect(screen.queryByTestId("score-badge-popover")).toBeNull();
  });

  it("toggles the detail popover with children", () => {
    render(
      <ScoreBadge score={87}>
        <div data-testid="chart">RADAR + PHONEME</div>
      </ScoreBadge>,
    );
    expect(screen.queryByTestId("score-badge-popover")).toBeNull();
    fireEvent.click(screen.getByTestId("score-badge"));
    expect(screen.getByTestId("score-badge-popover")).toBeInTheDocument();
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("score-badge"));
    expect(screen.queryByTestId("score-badge-popover")).toBeNull();
  });
});
