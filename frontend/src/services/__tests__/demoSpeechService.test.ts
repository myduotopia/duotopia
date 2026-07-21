import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { DemoLimitExceededError } from "../demoSpeechService";

// Mock Azure Speech SDK
vi.mock("microsoft-cognitiveservices-speech-sdk", () => ({
  SpeechConfig: {
    fromAuthorizationToken: vi.fn(() => ({
      speechRecognitionLanguage: "",
    })),
  },
  AudioConfig: {
    fromStreamInput: vi.fn(),
  },
  AudioInputStream: {
    createPushStream: vi.fn(() => ({
      write: vi.fn(),
      close: vi.fn(),
    })),
  },
  SpeechRecognizer: vi.fn(),
  PronunciationAssessmentConfig: vi.fn(() => ({
    applyTo: vi.fn(),
  })),
  PronunciationAssessmentResult: {
    fromResult: vi.fn(() => ({
      pronunciationScore: 85,
      accuracyScore: 90,
      fluencyScore: 80,
      completenessScore: 85,
    })),
  },
  ResultReason: {
    RecognizedSpeech: 3,
    NoMatch: 0,
  },
  PronunciationAssessmentGradingSystem: {
    HundredMark: 1,
  },
  PronunciationAssessmentGranularity: {
    Phoneme: 1,
    Word: 2,
  },
}));

// Mock config
vi.mock("@/config/api", () => ({
  API_URL: "http://localhost:8000",
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("DemoSpeechService", () => {
  // Need to dynamically import because of mocks
  let DemoSpeechServiceClass: new () => {
    getToken: (forceRefresh?: boolean) => Promise<{
      token: string;
      region: string;
      expires_in: number;
      demo_mode: boolean;
      remaining_today: number;
    }>;
    clearCache: () => void;
    getRemainingToday: () => number;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-import to get fresh instance
    vi.resetModules();
    const mod = await import("../demoSpeechService");
    DemoSpeechServiceClass = mod.demoSpeechService
      .constructor as typeof DemoSpeechServiceClass;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getToken", () => {
    it("should fetch a new token when cache is empty", async () => {
      const service = new DemoSpeechServiceClass();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "test-token",
          region: "japaneast",
          expires_in: 300,
          demo_mode: true,
          remaining_today: 59,
        }),
      });

      const result = await service.getToken();
      expect(result.token).toBe("test-token");
      expect(result.region).toBe("japaneast");
      expect(result.remaining_today).toBe(59);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should return cached token on subsequent calls", async () => {
      const service = new DemoSpeechServiceClass();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "cached-token",
          region: "japaneast",
          expires_in: 300,
          demo_mode: true,
          remaining_today: 58,
        }),
      });

      await service.getToken();
      const result = await service.getToken();

      expect(result.token).toBe("cached-token");
      // Only one fetch call - second used cache
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should bypass cache when forceRefresh is true", async () => {
      const service = new DemoSpeechServiceClass();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: "first-token",
            region: "japaneast",
            expires_in: 300,
            demo_mode: true,
            remaining_today: 59,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: "fresh-token",
            region: "japaneast",
            expires_in: 300,
            demo_mode: true,
            remaining_today: 58,
          }),
        });

      await service.getToken();
      const result = await service.getToken(true);

      expect(result.token).toBe("fresh-token");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should throw DemoLimitExceededError on 429 with daily_limit_exceeded", async () => {
      const service = new DemoSpeechServiceClass();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          detail: {
            error: "daily_limit_exceeded",
            message: "今日免費試用次數已達上限",
            suggestion: "註冊帳號即可無限使用",
            limit: 60,
            reset_at: "2025-01-02T16:00:00Z",
          },
        }),
      });

      try {
        await service.getToken();
        expect.fail("Should have thrown");
      } catch (err) {
        expect((err as Error).name).toBe("DemoLimitExceededError");
        expect((err as Error).message).toBe("今日免費試用次數已達上限");
      }
    });

    it("should throw generic error on 429 rate limit", async () => {
      const service = new DemoSpeechServiceClass();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          detail: "Rate limit exceeded",
        }),
      });

      await expect(service.getToken()).rejects.toThrow("請求過於頻繁");
    });

    it("should throw error on 403", async () => {
      const service = new DemoSpeechServiceClass();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      await expect(service.getToken()).rejects.toThrow("無法驗證請求來源");
    });

    it("should throw generic error on 500", async () => {
      const service = new DemoSpeechServiceClass();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(service.getToken()).rejects.toThrow("無法取得語音分析授權");
    });
  });

  describe("clearCache", () => {
    it("should clear the token cache", async () => {
      const service = new DemoSpeechServiceClass();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: "token-1",
            region: "japaneast",
            expires_in: 300,
            demo_mode: true,
            remaining_today: 59,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: "token-2",
            region: "japaneast",
            expires_in: 300,
            demo_mode: true,
            remaining_today: 58,
          }),
        });

      await service.getToken();
      service.clearCache();
      const result = await service.getToken();

      // Should have fetched again after cache clear
      expect(result.token).toBe("token-2");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("getRemainingToday", () => {
    it("should return -1 when no cache", () => {
      const service = new DemoSpeechServiceClass();
      expect(service.getRemainingToday()).toBe(-1);
    });

    it("should return cached remaining count", async () => {
      const service = new DemoSpeechServiceClass();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "test",
          region: "japaneast",
          expires_in: 300,
          demo_mode: true,
          remaining_today: 42,
        }),
      });

      await service.getToken();
      expect(service.getRemainingToday()).toBe(42);
    });
  });
});

describe("DemoLimitExceededError", () => {
  it("should carry limit and reset info", () => {
    const error = new DemoLimitExceededError({
      error: "daily_limit_exceeded",
      message: "Limit reached",
      suggestion: "Register",
      limit: 60,
      reset_at: "2025-01-02T16:00:00Z",
    });

    expect(error.name).toBe("DemoLimitExceededError");
    expect(error.message).toBe("Limit reached");
    expect(error.limit).toBe(60);
    expect(error.resetAt).toBe("2025-01-02T16:00:00Z");
    expect(error.suggestion).toBe("Register");
    expect(error instanceof Error).toBe(true);
  });
});
