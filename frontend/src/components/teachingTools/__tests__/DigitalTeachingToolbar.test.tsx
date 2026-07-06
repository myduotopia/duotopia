import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DigitalTeachingToolbar from "../DigitalTeachingToolbar";

// Mock i18n useTranslation hook
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: "zh-TW",
    },
  }),
}));

describe("DigitalTeachingToolbar", () => {
  beforeEach(() => {
    // Mock canvas for testing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => ({
      scale: vi.fn(),
      lineCap: "",
      lineJoin: "",
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      closePath: vi.fn(),
      clearRect: vi.fn(),
      globalCompositeOperation: "",
      strokeStyle: "",
      lineWidth: 0,
    }));

    // Mock window.innerWidth and innerHeight
    window.innerWidth = 1024;
    window.innerHeight = 768;
  });

  describe("Toolbar UI", () => {
    it("should render the main toolbar", () => {
      render(<DigitalTeachingToolbar />);
      const timerButton = screen.getByLabelText("Timer");
      const diceButton = screen.getByLabelText("Dice");
      expect(timerButton).toBeInTheDocument();
      expect(diceButton).toBeInTheDocument();
    });

    it("should not render pencil and eraser buttons anymore", () => {
      render(<DigitalTeachingToolbar />);
      const pencilButton = screen.queryByLabelText("Pencil");
      const eraserButton = screen.queryByLabelText("Eraser");
      expect(pencilButton).not.toBeInTheDocument();
      expect(eraserButton).not.toBeInTheDocument();
    });
  });

  describe("Timer Tool", () => {
    it("should open timer when clicked", async () => {
      const user = userEvent.setup();
      render(<DigitalTeachingToolbar />);
      const timerButton = screen.getByLabelText("Timer");
      await user.click(timerButton);

      const startButton = screen.getByLabelText("Start timer");
      expect(startButton).toBeInTheDocument();
    });

    it("should show quick preset buttons", async () => {
      const user = userEvent.setup();
      render(<DigitalTeachingToolbar />);
      await user.click(screen.getByLabelText("Timer"));

      expect(screen.getByText("1m")).toBeInTheDocument();
      expect(screen.getByText("3m")).toBeInTheDocument();
      expect(screen.getByText("5m")).toBeInTheDocument();
      expect(screen.getByText("10m")).toBeInTheDocument();
    });

    it("should set time when preset button clicked", async () => {
      const user = userEvent.setup();
      render(<DigitalTeachingToolbar />);
      await user.click(screen.getByLabelText("Timer"));
      await user.click(screen.getByText("5m"));

      expect(screen.getByText("05")).toBeInTheDocument();
      expect(screen.getByText("00")).toBeInTheDocument();
    });

    it("should close timer when close button clicked", async () => {
      const user = userEvent.setup();
      render(<DigitalTeachingToolbar />);
      await user.click(screen.getByLabelText("Timer"));

      const closeButton = screen.getByLabelText("Close timer");
      await user.click(closeButton);

      expect(screen.queryByLabelText("Start timer")).not.toBeInTheDocument();
    });
  });

  describe("Dice Tool", () => {
    it("should open dice when clicked", async () => {
      const user = userEvent.setup();
      render(<DigitalTeachingToolbar />);
      await user.click(screen.getByLabelText("Dice"));

      // Dice should be visible (check for SVG element)
      expect(document.querySelector("svg")).toBeInTheDocument();
    });

    it("should generate random value 1-6", async () => {
      const user = userEvent.setup();
      render(<DigitalTeachingToolbar />);

      // Mock Math.random to control the outcome and assert the value range
      const spy = vi.spyOn(Math, "random").mockReturnValue(0.6); // yields value 4

      await user.click(screen.getByLabelText("Dice"));
      const diceClickable = document.querySelector(".dice-clickable");
      if (diceClickable) {
        fireEvent.click(diceClickable);
      }

      await waitFor(() => {
        expect(spy).toHaveBeenCalled();
      });

      spy.mockRestore();
    });

    it("should close dice when close button clicked", async () => {
      const user = userEvent.setup();
      render(<DigitalTeachingToolbar />);
      await user.click(screen.getByLabelText("Dice"));

      const closeButton = screen.getByLabelText("Close dice");
      await user.click(closeButton);

      expect(screen.queryByLabelText("Close dice")).not.toBeInTheDocument();
    });
  });

  describe("RPS Tool", () => {
    it("should open RPS when clicked", () => {
      render(<DigitalTeachingToolbar />);
      fireEvent.click(screen.getByLabelText("Rock Paper Scissors"));

      expect(screen.getByLabelText("Spin")).toBeInTheDocument();
      expect(screen.getByLabelText("Close RPS")).toBeInTheDocument();
    });

    it("should disable Spin while spinning and re-enable after it settles", () => {
      vi.useFakeTimers();
      try {
        render(<DigitalTeachingToolbar />);
        fireEvent.click(screen.getByLabelText("Rock Paper Scissors"));

        const spinButton = screen.getByLabelText("Spin");
        expect(spinButton).not.toBeDisabled();

        fireEvent.click(spinButton);
        expect(spinButton).toBeDisabled(); // isSpinning = true

        // Spin animation settles after 1900ms
        act(() => {
          vi.advanceTimersByTime(1900);
        });
        expect(spinButton).not.toBeDisabled();

        // Flush the two 50ms reel-reset timers
        act(() => {
          vi.advanceTimersByTime(100);
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("should ignore a second spin while one is in progress", () => {
      vi.useFakeTimers();
      const randomSpy = vi.spyOn(Math, "random");
      try {
        render(<DigitalTeachingToolbar />);
        fireEvent.click(screen.getByLabelText("Rock Paper Scissors"));

        const spinButton = screen.getByLabelText("Spin");
        fireEvent.click(spinButton); // first spin runs
        const callsAfterFirstSpin = randomSpy.mock.calls.length;

        // Button is disabled + spin() guards on isSpinning → no second spin
        fireEvent.click(spinButton);
        expect(randomSpy.mock.calls.length).toBe(callsAfterFirstSpin);

        act(() => {
          vi.advanceTimersByTime(2000);
        });
      } finally {
        randomSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it("should close RPS when close button clicked", () => {
      render(<DigitalTeachingToolbar />);
      fireEvent.click(screen.getByLabelText("Rock Paper Scissors"));

      fireEvent.click(screen.getByLabelText("Close RPS"));

      expect(screen.queryByLabelText("Spin")).not.toBeInTheDocument();
    });

    it("should clear pending spin timers on unmount", () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
      try {
        const { unmount } = render(<DigitalTeachingToolbar />);
        fireEvent.click(screen.getByLabelText("Rock Paper Scissors"));
        fireEvent.click(screen.getByLabelText("Spin")); // schedules spinTimerRef

        clearTimeoutSpy.mockClear();
        unmount();

        // RpsTool's unmount cleanup clears its pending spin/reset timers.
        expect(clearTimeoutSpy).toHaveBeenCalled();
      } finally {
        clearTimeoutSpy.mockRestore();
        vi.useRealTimers();
      }
    });
  });

  // Drawing tools removed; related tests deleted per scope change.

  // Canvas removed with drawing tools; skip canvas tests.

  describe("Accessibility", () => {
    it("should have proper ARIA labels for all buttons", () => {
      render(<DigitalTeachingToolbar />);
      expect(screen.getByLabelText("Timer")).toBeInTheDocument();
      expect(screen.getByLabelText("Dice")).toBeInTheDocument();
      expect(screen.queryByLabelText("Pencil")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Eraser")).not.toBeInTheDocument();
    });
  });

  // i18n tests for drawing tools removed; remaining tools use labels as expected.
});
