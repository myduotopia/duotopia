/**
 * Issue #741: 朗讀類型作業音檔丟失（iOS Safari MediaRecorder 競態）
 *
 * 本檔保證 student answering page 的 MediaRecorder 行為與 PR #705 的
 * 共用 AudioRecorder.tsx 一致：
 *   1) recorder.start() 以 1000ms timeslice 啟動
 *   2) stop() 之前先呼叫 requestData() 觸發最後一個 ondataavailable
 *   3) 當 chunks 仍為空（recording_too_small）→ 必須鎖住下一題 / 提交，
 *      強迫學生重錄
 */
import { describe, test, expect, beforeEach, vi, type Mock } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudentActivityPageContent from "../StudentActivityPageContent";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrParams?: string | Record<string, unknown>) => {
      // 對齊既有測試：若第二個參數是 string fallback 就回 fallback，
      // 否則只回 key（避免把 params object 當 React child 渲染）。
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

// 共用 spy：在每個測試前重設
const startSpy = vi.fn();
const stopSpy = vi.fn();
const requestDataSpy = vi.fn();
// 模擬 chunks 變化：tests 透過 setNextRecordingChunks 切換成「空 chunks」
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
    // 模擬「正常」狀況：requestData 同步把 chunks 推進去
    // ※ 但 recording_too_small 測試會用 setNextRecordingChunks([]) 模擬
    //   iOS Safari 競態（ondataavailable 完全沒觸發）
    nextRecordingChunks.forEach((chunk) => {
      this.ondataavailable?.({ data: chunk });
    });
  }

  stop() {
    stopSpy();
    this.state = "inactive";
    // 模擬瀏覽器在 stop() 後觸發 onstop（同步觸發避免測試需要等待過久）
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
  // 預設讓 chunks 有資料，避免測試誤觸 recording_too_small
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

/**
 * 共用：點擊紅色麥克風按鈕（依 title 屬性鎖定）
 */
const clickMicButton = async () => {
  const user = userEvent.setup();
  // GroupedQuestionsTemplate / ReadingAssessmentTemplate 的麥克風按鈕都使用
  // i18n key 作為 title——mock 後 fallback 是 key 本身
  const buttons = await screen.findAllByTitle(
    /startRecording|labels\.startRecording/i,
  );
  await user.click(buttons[0]);
};

const clickStopButton = async () => {
  const user = userEvent.setup();
  // GroupedQuestionsTemplate 的紅色停止按鈕使用 i18n key 作為 label，
  // mock 後 fallback 是 key 本身。用 exact match 避免不小心配到 "stopRecording"
  // 之類含 "stop" 的其他字串。
  const stopButton = await screen.findByText(
    "groupedQuestionsTemplate.labels.stopping",
    { exact: true },
  );
  await user.click(stopButton);
};

describe("StudentActivityPageContent - iOS Safari MediaRecorder race (Issue #741)", () => {
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

    // 觸發 stop（學生點停止按鈕）
    await clickStopButton();

    // 等 stopRecording 的 80ms await 完成
    await waitFor(
      () => {
        expect(stopSpy).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );

    // 確認順序：requestData 必須在 stop 之前
    expect(requestDataSpy).toHaveBeenCalled();
    const requestDataOrder = requestDataSpy.mock.invocationCallOrder[0];
    const stopOrder = stopSpy.mock.invocationCallOrder[0];
    expect(requestDataOrder).toBeLessThan(stopOrder);
  });

  test("recording_too_small: empty chunks blocks 'next' / submit gates", async () => {
    // 模擬 iOS Safari 競態：ondataavailable 完全沒觸發，chunks 為空
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

    // 等 onstop 跑完並打 /api/logs/audio-error
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

    // recording_too_small payload 應該帶有診斷欄位
    const fetchCalls = (global.fetch as Mock).mock.calls;
    const errorLogCall = fetchCalls.find((c: unknown[]) =>
      (c[0] as string).includes("/api/logs/audio-error"),
    );
    const body = JSON.parse(errorLogCall![1].body);
    expect(body.error_type).toBe("recording_too_small");
    expect(body.chunk_count).toBe(0);
    expect(typeof body.request_data_called).toBe("boolean");
    expect(typeof body.recorder_state_at_stop).toBe("string");

    // recording_too_small 後，提交按鈕應該被 isSubmitBlockedByRecording 鎖住
    // （recording_url 已被清空，hasIncompleteRecordings 回 true）
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const submitButtons = screen.queryAllByRole("button", {
      name: /submit/i,
    });
    // 必須真的有 submit 按鈕被渲染——否則 assertion 變空轉，看似綠燈卻沒
    // 驗證到任何東西。
    expect(submitButtons.length).toBeGreaterThan(0);
    // 至少其中一個 submit 按鈕應該被 isSubmitBlockedByRecording 鎖成 disabled
    const anyDisabled = submitButtons.some(
      (btn) => (btn as HTMLButtonElement).disabled,
    );
    expect(anyDisabled).toBe(true);
  });
});
