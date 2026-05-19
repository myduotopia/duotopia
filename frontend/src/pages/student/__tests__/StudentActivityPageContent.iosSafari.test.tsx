// iOS Safari MediaRecorder 競態：start(1000) + stop 前 requestData + recording_too_small 必須鎖提交
import { describe, test, expect, beforeEach, vi, type Mock } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudentActivityPageContent from "../StudentActivityPageContent";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrParams?: string | Record<string, unknown>) => {
      // params object 當 React child 會炸，所以只把 string fallback 當回傳值
      if (typeof fallbackOrParams === "string") return fallbackOrParams;
      return key;
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/stores/studentAuthStore", () => ({
  useStudentAuthStore: Object.assign(
    vi.fn(() => ({ token: "mock-token" })),
    { getState: () => ({ token: "mock-token" }) },
  ),
}));

vi.mock("@/utils/audioRecordingStrategy", () => ({
  getRecordingStrategy: vi.fn(() => ({
    platformName: "iosSafari",
    minFileSize: 100,
    minDuration: 0.5,
  })),
  selectSupportedMimeType: vi.fn(() => "audio/webm"),
  validateDuration: vi.fn(async () => ({
    valid: true,
    duration: 5.0,
    method: "test",
  })),
}));

vi.mock("@/utils/retryHelper", () => ({
  retryAudioUpload: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
  retryAIAnalysis: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
}));

const startSpy = vi.fn();
const stopSpy = vi.fn();
const requestDataSpy = vi.fn();
// 用 setNextRecordingChunks([]) 模擬 iOS Safari 競態（ondataavailable 沒觸發）
let nextRecordingChunks: Blob[] = [];
const setNextRecordingChunks = (chunks: Blob[]) => {
  nextRecordingChunks = chunks;
};

class MockMediaRecorder {
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((ev: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start(timeslice?: number) {
    this.state = "recording";
    startSpy(timeslice);
  }

  requestData() {
    requestDataSpy();
    nextRecordingChunks.forEach((chunk) => {
      this.ondataavailable?.({ data: chunk });
    });
  }

  stop() {
    stopSpy();
    this.state = "inactive";
    setTimeout(() => this.onstop?.(), 0);
  }
}

const makeReadingActivity = () => ({
  id: 1,
  content_id: 1,
  order: 1,
  type: "reading_assessment",
  title: "Reading",
  content: "Sample text to read",
  target_text: "Sample text to read",
  duration: 60,
  points: 10,
  status: "IN_PROGRESS",
  score: null,
  completed_at: null,
  items: [
    {
      id: 101,
      text: "Sentence one.",
      recording_url: "",
      progress_id: 1001,
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  startSpy.mockClear();
  stopSpy.mockClear();
  requestDataSpy.mockClear();
  setNextRecordingChunks([
    new Blob([new Uint8Array(2048)], { type: "audio/webm" }),
  ]);

  Object.defineProperty(window, "MediaRecorder", {
    writable: true,
    value: MockMediaRecorder,
  });

  Object.defineProperty(navigator, "mediaDevices", {
    writable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }],
      }),
    },
  });

  Object.defineProperty(window, "Audio", {
    writable: true,
    value: class {
      load() {}
      play() {
        return Promise.resolve();
      }
      pause() {}
      src = "";
      currentTime = 0;
      duration = 0;
      addEventListener(event: string, callback: () => void) {
        if (event === "loadedmetadata") callback();
      }
      removeEventListener() {}
    },
  });

  window.scrollTo = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();

  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();

  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.toString().includes("upload-recording")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            audio_url: "https://storage.googleapis.com/test-audio.webm",
            progress_id: 1001,
          }),
      });
    }
    if (url.toString().includes("/api/logs/audio-error")) {
      return Promise.resolve({ ok: true, statusText: "OK" });
    }
    return Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob(["x"], { type: "audio/webm" })),
      json: () => Promise.resolve({}),
    });
  });
});

const clickMicButton = async () => {
  const user = userEvent.setup();
  const buttons = await screen.findAllByTitle(
    /startRecording|labels\.startRecording/i,
  );
  await user.click(buttons[0]);
};

const clickStopButton = async () => {
  const user = userEvent.setup();
  // exact match：避免配到含 "stop" 的其他字串
  const stopButton = await screen.findByText(
    "groupedQuestionsTemplate.labels.stopping",
    { exact: true },
  );
  await user.click(stopButton);
};

describe("StudentActivityPageContent - iOS Safari MediaRecorder race", () => {
  test("start(1000): recorder.start is called with a 1-second timeslice", async () => {
    render(
      <StudentActivityPageContent
        activities={[makeReadingActivity()]}
        assignmentTitle="t"
        assignmentId={1}
        onSubmit={vi.fn()}
      />,
    );

    await clickMicButton();

    await waitFor(() => {
      expect(startSpy).toHaveBeenCalled();
    });
    expect(startSpy).toHaveBeenCalledWith(1000);
  });

  test("requestData() is called BEFORE stop() when student stops recording", async () => {
    render(
      <StudentActivityPageContent
        activities={[makeReadingActivity()]}
        assignmentTitle="t"
        assignmentId={1}
        onSubmit={vi.fn()}
      />,
    );

    await clickMicButton();
    await waitFor(() => expect(startSpy).toHaveBeenCalled());

    await clickStopButton();

    await waitFor(
      () => {
        expect(stopSpy).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );

    expect(requestDataSpy).toHaveBeenCalled();
    const requestDataOrder = requestDataSpy.mock.invocationCallOrder[0];
    const stopOrder = stopSpy.mock.invocationCallOrder[0];
    expect(requestDataOrder).toBeLessThan(stopOrder);
  });

  test("recording_too_small: empty chunks blocks 'next' / submit gates", async () => {
    setNextRecordingChunks([]);

    const onSubmit = vi.fn();
    render(
      <StudentActivityPageContent
        activities={[makeReadingActivity()]}
        assignmentTitle="t"
        assignmentId={1}
        onSubmit={onSubmit}
      />,
    );

    await clickMicButton();
    await waitFor(() => expect(startSpy).toHaveBeenCalled());
    await clickStopButton();

    await waitFor(
      () => {
        const calls = (global.fetch as Mock).mock.calls;
        const errorLogCall = calls.find((c: unknown[]) =>
          (c[0] as string).includes("/api/logs/audio-error"),
        );
        expect(errorLogCall).toBeTruthy();
      },
      { timeout: 3000 },
    );

    const fetchCalls = (global.fetch as Mock).mock.calls;
    const errorLogCall = fetchCalls.find((c: unknown[]) =>
      (c[0] as string).includes("/api/logs/audio-error"),
    );
    const body = JSON.parse(errorLogCall![1].body);
    expect(body.error_type).toBe("recording_too_small");
    expect(body.chunk_count).toBe(0);
    expect(typeof body.request_data_called).toBe("boolean");
    expect(typeof body.recorder_state_at_stop).toBe("string");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const submitButtons = screen.queryAllByRole("button", {
      name: /submit/i,
    });
    // 沒按鈕的話 assertion 會空轉成綠燈
    expect(submitButtons.length).toBeGreaterThan(0);
    const anyDisabled = submitButtons.some(
      (btn) => (btn as HTMLButtonElement).disabled,
    );
    expect(anyDisabled).toBe(true);
  });

  test("45s auto-stop: requestData() before stop(), guard prevents double requestData on manual stop", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <StudentActivityPageContent
          activities={[makeReadingActivity()]}
          assignmentTitle="t"
          assignmentId={1}
          onSubmit={vi.fn()}
        />,
      );

      await clickMicButton();
      await waitFor(() => expect(startSpy).toHaveBeenCalled());

      // 推進 setInterval 到 45 秒觸發 auto-stop
      await act(async () => {
        await vi.advanceTimersByTimeAsync(46_000);
      });

      await waitFor(() => {
        expect(stopSpy).toHaveBeenCalled();
      });

      expect(requestDataSpy).toHaveBeenCalledTimes(1);
      const autoRequestDataOrder = requestDataSpy.mock.invocationCallOrder[0];
      const autoStopOrder = stopSpy.mock.invocationCallOrder[0];
      expect(autoRequestDataOrder).toBeLessThan(autoStopOrder);

      // auto-stop 後 requestDataCalledRef.current === true，
      // 即使 80ms 內又呼叫 stopRecording 也不能再打 requestData
      requestDataSpy.mockClear();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(requestDataSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
