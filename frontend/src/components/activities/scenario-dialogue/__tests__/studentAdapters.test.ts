/**
 * 學生作答的 adapters（Issue #1140 Stage 3）。
 *
 * 最要緊的一條是 **429 不能 reject**：
 *
 * `useScenarioChat` 對 `getFeedback` 的 reject 會「還原狀態讓學生重新作答」。那對網路
 * 錯誤是對的，對「次數用完」是錯的 —— 再答幾次都一樣，學生會原地打轉。
 *
 * 而 429 是會**真的發生**的：伺服器的計數跨工作階段累積，UI 的 attempts 只在記憶體。
 * 學生昨天答過兩次、今天重新打開，畫面以為還有 3 次，伺服器只剩 1 次。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const scenarioDialogueFeedback = vi.fn();

// `vi.mock` 的 factory 會被提升到檔首，所以 class 不能寫在模組頂層 —— 會踩到
// "Cannot access 'MockApiError' before initialization"。用 vi.hoisted 一起提升。
const { MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    constructor(
      public status: number,
      public detail: unknown,
    ) {
      super(`ApiError ${status}`);
    }
  }
  return { MockApiError };
});

vi.mock("@/lib/api", () => ({
  ApiError: MockApiError,
  apiClient: {
    scenarioDialogueFeedback: (...args: unknown[]) =>
      scenarioDialogueFeedback(...args),
  },
}));

vi.mock("@/stores/studentAuthStore", () => ({
  useStudentAuthStore: { getState: () => ({ token: "t" }) },
}));
vi.mock("@/utils/audioFormatDetection", () => ({
  appendAudioToFormData: vi.fn(),
}));
vi.mock("@/utils/retryHelper", () => ({
  retryAudioUpload: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/utils/speakEnglish", () => ({ speakEnglish: vi.fn() }));
vi.mock("i18next", () => ({
  default: { language: "zh-TW", t: (k: string) => k },
}));

import {
  createPreviewScenarioAdapters,
  createStudentScenarioAdapters,
  isQuotaExhausted,
  toScenarioFeedback,
  uploadErrorMessageKey,
} from "../studentAdapters";

const ITEM = { id: 9001, text: "Q?", keywords: [], images: [] };
const ANSWER = {
  kind: "voice" as const,
  audioUrl: "blob:fake",
  durationSec: 4,
};

beforeEach(() => {
  scenarioDialogueFeedback.mockReset();
  // blob URL → Blob，以及錄音上傳
  global.fetch = vi.fn(async (url: unknown) => {
    if (String(url).startsWith("blob:")) {
      return { ok: true, blob: async () => new Blob(["x"]) } as never;
    }
    return {
      ok: true,
      json: async () => ({ progress_id: 555 }),
    } as never;
  }) as never;
});

describe("toScenarioFeedback", () => {
  it("帶過 verdict／評語／建議說法", () => {
    expect(
      toScenarioFeedback({
        verdict: "great",
        comment: "很棒！",
        suggestion: null,
      }),
    ).toEqual({ verdict: "great", comment: "很棒！", suggestion: undefined });
  });

  it("認不得的 verdict 當「可以更好」（與後端同一條規則）", () => {
    expect(
      toScenarioFeedback({ verdict: "perfect", comment: "x" }).verdict,
    ).toBe("improve");
  });

  it("不帶分數 —— 學生畫面不顯示分數", () => {
    const fb = toScenarioFeedback({
      verdict: "great",
      comment: "x",
      ...({ score: 92 } as object),
    });
    expect(Object.keys(fb)).not.toContain("score");
  });
});

describe("isQuotaExhausted", () => {
  it("429 + 我們的 code", () => {
    expect(
      isQuotaExhausted(
        new MockApiError(429, { code: "AI_ANALYSIS_QUOTA_EXCEEDED" }),
      ),
    ).toBe(true);
  });

  it("detail 被改寫成字串也認得", () => {
    expect(
      isQuotaExhausted(
        new MockApiError(429, "AI_ANALYSIS_QUOTA_EXCEEDED: no more"),
      ),
    ).toBe(true);
  });

  it("其他 429（例如上游限流）不算", () => {
    expect(isQuotaExhausted(new MockApiError(429, { code: "OTHER" }))).toBe(
      false,
    );
  });

  it("其他狀態碼與一般 Error 都不算", () => {
    expect(isQuotaExhausted(new MockApiError(503, {}))).toBe(false);
    expect(isQuotaExhausted(new Error("boom"))).toBe(false);
  });
});

describe("getFeedback", () => {
  it("上傳錄音後用回來的 progress_id 要建議", async () => {
    scenarioDialogueFeedback.mockResolvedValue({
      verdict: "improve",
      comment: "再完整一點",
      suggestion: "I went to the park.",
    });
    const adapters = createStudentScenarioAdapters({ assignmentId: 7 });

    const fb = await adapters.getFeedback(ITEM, ANSWER, 0);

    expect(scenarioDialogueFeedback).toHaveBeenCalledWith({
      item_progress_id: 555,
      ui_language: "zh-TW",
    });
    expect(fb).toEqual({
      verdict: "improve",
      comment: "再完整一點",
      suggestion: "I went to the park.",
    });
  });

  it("次數用完時 **resolve** 成一則說明，不是 reject", async () => {
    scenarioDialogueFeedback.mockRejectedValue(
      new MockApiError(429, { code: "AI_ANALYSIS_QUOTA_EXCEEDED" }),
    );
    const onError = vi.fn();
    const adapters = createStudentScenarioAdapters({
      assignmentId: 7,
      onError,
    });

    const fb = await adapters.getFeedback(ITEM, ANSWER, 0);

    expect(fb.comment).toBe("scenarioDialogue.chat.quotaExhausted");
    expect(fb.suggestion).toBeUndefined();
    // 這不是錯誤，不要跳錯誤提示
    expect(onError).not.toHaveBeenCalled();
  });

  it("其他錯誤 reject，並且讓學生知道原因", async () => {
    scenarioDialogueFeedback.mockRejectedValue(new MockApiError(503, {}));
    const onError = vi.fn();
    const adapters = createStudentScenarioAdapters({
      assignmentId: 7,
      onError,
    });

    await expect(adapters.getFeedback(ITEM, ANSWER, 0)).rejects.toBeTruthy();
    expect(onError).toHaveBeenCalledWith(
      "scenarioDialogue.chat.feedbackFailed",
    );
  });

  it("沒有錄音就不要打任何 API", async () => {
    const adapters = createStudentScenarioAdapters({ assignmentId: 7 });
    await expect(
      adapters.getFeedback(ITEM, { kind: "text", text: "hi" }, 0),
    ).rejects.toBeTruthy();
    expect(scenarioDialogueFeedback).not.toHaveBeenCalled();
  });
});

describe("createPreviewScenarioAdapters — 預覽完全不碰網路", () => {
  /**
   * 兩條老師預覽路徑都走這組：派發 sheet 的即時預覽，以及
   * `TeacherAssignmentPreviewPage`（用 isPreviewMode 預覽**真實作業**，practice_mode
   * 也是真的）。用學生版會拿老師的 token 去打學生專用端點，還會動到配額。
   */
  it("不上傳、不呼叫任何 API", async () => {
    const adapters = createPreviewScenarioAdapters("（預覽）…");
    await adapters.getFeedback(ITEM, ANSWER, 0);
    expect(scenarioDialogueFeedback).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("建議說法用老師自己寫的參考答案", async () => {
    const adapters = createPreviewScenarioAdapters("（預覽）…");
    const fb = await adapters.getFeedback(
      { ...ITEM, referenceAnswer: "I went to a movie." },
      ANSWER,
      0,
    );
    expect(fb.suggestion).toBe("I went to a movie.");
  });

  it("沒有參考答案就留空（學生端 payload 本來就沒有這個欄位）", async () => {
    const adapters = createPreviewScenarioAdapters("（預覽）…");
    const fb = await adapters.getFeedback(ITEM, ANSWER, 0);
    expect(fb.suggestion).toBeUndefined();
  });

  it("不給分數 —— 預覽的假分數會和批改頁的真分數互相干擾", async () => {
    const adapters = createPreviewScenarioAdapters("（預覽）…");
    const fb = await adapters.getFeedback(ITEM, ANSWER, 0);
    expect(Object.keys(fb)).not.toContain("score");
  });

  it("評語用傳進來的預覽文案，不假裝是 AI 說的", async () => {
    const adapters = createPreviewScenarioAdapters("（預覽）會出現 AI 建議");
    const fb = await adapters.getFeedback(ITEM, ANSWER, 0);
    expect(fb.comment).toBe("（預覽）會出現 AI 建議");
  });
});

describe("上傳失敗要講真話（#1140 1a）", () => {
  /**
   * 夥伴 staging 回報「AI 建議暫時拿不到」查了半天，最後發現是**上傳**被擋
   * （錄音超過 30 秒 → 400），而 adapter 把上傳與 AI 失敗收成同一句話。
   *
   * 兩者對學生的意義完全不同：「錄音太長」他自己修正得了，「AI 拿不到」只能重試。
   */
  const uploadFailing = (status: number, detail: string) => {
    global.fetch = vi.fn(async (url: unknown) => {
      if (String(url).startsWith("blob:")) {
        return { ok: true, blob: async () => new Blob(["x"]) } as never;
      }
      return {
        ok: false,
        status,
        json: async () => ({ detail }),
      } as never;
    }) as never;
  };

  it("錄音太長 → 專屬訊息，而且沒去打 AI", async () => {
    uploadFailing(400, "Recording too long. Maximum duration: 120 seconds");
    const onError = vi.fn();
    const adapters = createStudentScenarioAdapters({
      assignmentId: 7,
      onError,
    });

    await expect(adapters.getFeedback(ITEM, ANSWER, 0)).rejects.toBeTruthy();
    expect(onError).toHaveBeenCalledWith(
      "scenarioDialogue.chat.recordingTooLong",
    );
    expect(scenarioDialogueFeedback).not.toHaveBeenCalled();
  });

  it("錄音太短 → 專屬訊息", async () => {
    uploadFailing(400, "Recording file too small (0 bytes).");
    const onError = vi.fn();
    const adapters = createStudentScenarioAdapters({
      assignmentId: 7,
      onError,
    });
    await expect(adapters.getFeedback(ITEM, ANSWER, 0)).rejects.toBeTruthy();
    expect(onError).toHaveBeenCalledWith(
      "scenarioDialogue.chat.recordingTooShort",
    );
  });

  it("認不出來的上傳錯誤 → 上傳失敗（不是「AI 拿不到」）", async () => {
    uploadFailing(500, "boom");
    const onError = vi.fn();
    const adapters = createStudentScenarioAdapters({
      assignmentId: 7,
      onError,
    });
    await expect(adapters.getFeedback(ITEM, ANSWER, 0)).rejects.toBeTruthy();
    expect(onError).toHaveBeenCalledWith("scenarioDialogue.chat.uploadFailed");
  });

  it("uploadErrorMessageKey 對非上傳錯誤回 null（才會落到 AI 那句）", () => {
    expect(uploadErrorMessageKey(new Error("boom"))).toBeNull();
    expect(uploadErrorMessageKey(new MockApiError(503, {}))).toBeNull();
  });
});
