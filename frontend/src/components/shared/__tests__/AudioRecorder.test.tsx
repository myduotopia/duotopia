/**
 * AudioRecorder unit tests — Issue #703 Phase B
 *
 * Verifies:
 * 1. MediaRecorder.start is called with timeslice = 1000 ms.
 * 2. requestData() is called before stop() (iOS Safari data-ordering fix).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/utils/audioRecordingStrategy", () => ({
  getRecordingStrategy: () => ({
    mimeType: "audio/webm",
    fallbackMimeTypes: [],
    minFileSize: 100,
    validateDuration: true,
    timeslice: 1000,
  }),
  selectSupportedMimeType: () => "audio/webm",
  validateDuration: vi.fn().mockResolvedValue({ valid: true, duration: 3 }),
}));

vi.mock("@/utils/deviceDetector", () => ({
  detectDevice: () => ({ platform: "other", browser: "Chrome" }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// ---------------------------------------------------------------------------
// MediaRecorder mock
// ---------------------------------------------------------------------------

type MockRecorder = {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  requestData: ReturnType<typeof vi.fn>;
  state: string;
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
};

let capturedInstance: MockRecorder | null = null;

const MockMediaRecorder = vi
  .fn()
  .mockImplementation((_stream: unknown, opts: { mimeType?: string }) => {
    capturedInstance = {
      start: vi.fn((_timeslice?: number) => {
        capturedInstance!.state = "recording";
      }),
      stop: vi.fn(() => {
        capturedInstance!.state = "inactive";
      }),
      requestData: vi.fn(),
      state: "inactive",
      mimeType: opts?.mimeType || "audio/webm",
      ondataavailable: null,
      onstop: null,
    };
    return capturedInstance;
  });

const mockStream = {
  getTracks: () => [{ stop: vi.fn() }],
} as unknown as MediaStream;

// ---------------------------------------------------------------------------
// Global setup — runs once before all tests in this file
// ---------------------------------------------------------------------------

Object.defineProperty(global, "MediaRecorder", {
  value: MockMediaRecorder,
  writable: true,
  configurable: true,
});

Object.defineProperty(global.navigator, "mediaDevices", {
  value: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
  writable: true,
  configurable: true,
});

afterEach(() => {
  capturedInstance = null;
  vi.clearAllMocks();
  // Restore getUserMedia mock so it stays functional across tests
  Object.defineProperty(global.navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
    writable: true,
    configurable: true,
  });
});

// ---------------------------------------------------------------------------
// Import component after mocks are in place
// ---------------------------------------------------------------------------

import AudioRecorder from "../AudioRecorder";

// ---------------------------------------------------------------------------
// Helper: start recording and wait for the mock recorder to be created
// ---------------------------------------------------------------------------

async function startRecordingInUI() {
  const buttons = screen.getAllByRole("button");
  const startBtn = buttons[0];
  await act(async () => {
    await userEvent.click(startBtn);
  });
  // Wait until the mock recorder instance is created
  await waitFor(() => expect(capturedInstance).not.toBeNull());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AudioRecorder — start timeslice", () => {
  it("calls MediaRecorder.start with timeslice 1000", async () => {
    render(<AudioRecorder />);
    await startRecordingInUI();

    expect(capturedInstance).not.toBeNull();
    expect(capturedInstance!.start).toHaveBeenCalledWith(1000);
  });
});

describe("AudioRecorder — requestData before stop", () => {
  it("calls requestData before stop", async () => {
    const callOrder: string[] = [];

    render(<AudioRecorder />);
    await startRecordingInUI();

    expect(capturedInstance).not.toBeNull();

    // Override with order-tracking mocks
    capturedInstance!.requestData = vi.fn(() => {
      callOrder.push("requestData");
    });
    capturedInstance!.stop = vi.fn(() => {
      callOrder.push("stop");
      capturedInstance!.state = "inactive";
    });

    // Click stop
    const buttons = screen.getAllByRole("button");
    // Find the stop button (it's the one visible during recording)
    const stopBtn = buttons[0];
    await act(async () => {
      await userEvent.click(stopBtn);
    });

    // Wait until requestData and stop have both been called
    await waitFor(() => {
      expect(callOrder).toContain("requestData");
      expect(callOrder).toContain("stop");
    });
    expect(callOrder.indexOf("requestData")).toBeLessThan(
      callOrder.indexOf("stop"),
    );
  });
});

describe("AudioRecorder — discardSignal（#1158 E-3 手機橫放）", () => {
  it("錄音中訊號一變：停止並丟掉，不呼叫任何 callback，回到待錄", async () => {
    const onRecordingComplete = vi.fn();
    const onRecordingStop = vi.fn();
    const onError = vi.fn();
    const props = {
      variant: "chat" as const,
      onRecordingComplete,
      onRecordingStop,
      onError,
    };
    const { rerender } = render(<AudioRecorder {...props} discardSignal={0} />);
    await act(async () => {
      await userEvent.click(
        screen.getByRole("button", { name: "audioRecorder.ui.startRecording" }),
      );
    });
    await waitFor(() => expect(capturedInstance).not.toBeNull());
    const rec = capturedInstance!;
    rec.ondataavailable?.({ data: new Blob(["x".repeat(500)]) });
    expect(
      screen.getByRole("button", { name: "audioRecorder.ui.stopRecording" }),
    ).toBeInTheDocument();

    rerender(<AudioRecorder {...props} discardSignal={1} />);
    expect(rec.stop).toHaveBeenCalled();
    // 瀏覽器停止後照樣會觸發 onstop：丟棄後不能產生音檔
    await act(async () => {
      rec.onstop?.();
      await new Promise((r) => setTimeout(r, 900));
    });
    expect(onRecordingComplete).not.toHaveBeenCalled();
    expect(onRecordingStop).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "audioRecorder.ui.startRecording" }),
    ).toBeInTheDocument();
  });

  it("沒在錄音時訊號改變不做事", async () => {
    const { rerender } = render(
      <AudioRecorder variant="chat" discardSignal={0} />,
    );
    rerender(<AudioRecorder variant="chat" discardSignal={1} />);
    expect(capturedInstance).toBeNull();
    expect(
      screen.getByRole("button", { name: "audioRecorder.ui.startRecording" }),
    ).toBeInTheDocument();
  });

  // 修正 E3：等麥克風授權時轉橫，授權後一開始錄（onRecordingStart 裡）就送丟棄訊號
  it("在 onRecordingStart 裡送訊號：剛開始的錄音也會被停止並丟掉", async () => {
    const onRecordingComplete = vi.fn();
    function Host() {
      const [signal, setSignal] = useState(0);
      return (
        <AudioRecorder
          variant="chat"
          discardSignal={signal}
          onRecordingStart={() => setSignal((n) => n + 1)}
          onRecordingComplete={onRecordingComplete}
        />
      );
    }
    render(<Host />);
    await act(async () => {
      await userEvent.click(
        screen.getByRole("button", { name: "audioRecorder.ui.startRecording" }),
      );
    });
    await waitFor(() => expect(capturedInstance).not.toBeNull());
    const rec = capturedInstance!;
    await waitFor(() => expect(rec.stop).toHaveBeenCalled());
    await act(async () => {
      rec.onstop?.();
      await new Promise((r) => setTimeout(r, 900));
    });
    expect(onRecordingComplete).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "audioRecorder.ui.startRecording" }),
    ).toBeInTheDocument();
  });
});
