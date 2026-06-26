import { describe, it, expect, beforeEach, vi } from "vitest";
import { AzureSpeechService } from "../azureSpeechService";
import axios from "axios";

// Mock axios
vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
  },
}));

// Mock student auth store
vi.mock("@/stores/studentAuthStore", () => ({
  useStudentAuthStore: {
    getState: vi.fn(() => ({
      token: "mock-student-token",
    })),
  },
}));

// Mock teacher auth store
vi.mock("@/stores/teacherAuthStore", () => ({
  useTeacherAuthStore: {
    getState: vi.fn(() => ({
      token: null, // Default: no teacher token (student mode)
    })),
  },
}));

// Mock Azure Speech SDK
vi.mock("microsoft-cognitiveservices-speech-sdk", () => ({
  SpeechConfig: {
    fromAuthorizationToken: vi.fn(() => ({
      speechRecognitionLanguage: "",
    })),
  },
  AudioConfig: {
    fromWavFileInput: vi.fn(),
  },
  SpeechRecognizer: vi.fn(),
  PronunciationAssessmentConfig: vi.fn(),
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
  },
}));

describe("AzureSpeechService", () => {
  let service: AzureSpeechService;

  beforeEach(() => {
    service = new AzureSpeechService();
    vi.clearAllMocks();
  });

  describe("Token Management", () => {
    it("should fetch token from API on first call", async () => {
      const mockTokenResponse = {
        data: {
          token: "test-token-abc123",
          region: "eastasia",
          expires_in: 600,
        },
      };

      vi.mocked(axios.post).mockResolvedValueOnce(mockTokenResponse);

      const result = await service["getToken"]();

      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/api/azure-speech/token"),
        null,
        expect.objectContaining({
          headers: { Authorization: "Bearer mock-student-token" },
        }),
      );
      expect(result.token).toBe("test-token-abc123");
      expect(result.region).toBe("eastasia");
    });

    it("should cache token and reuse within expiration time", async () => {
      const mockTokenResponse = {
        data: {
          token: "cached-token",
          region: "eastasia",
          expires_in: 600,
        },
      };

      vi.mocked(axios.post).mockResolvedValueOnce(mockTokenResponse);

      // First call - should fetch from API
      await service["getToken"]();
      expect(axios.post).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await service["getToken"]();
      expect(axios.post).toHaveBeenCalledTimes(1); // Still 1

      // Third call - should still use cache
      await service["getToken"]();
      expect(axios.post).toHaveBeenCalledTimes(1); // Still 1
    });

    it("should refresh token after expiration", async () => {
      const mockToken1 = {
        data: { token: "token-1", region: "eastasia", expires_in: 1 }, // 1 second
      };
      const mockToken2 = {
        data: { token: "token-2", region: "eastasia", expires_in: 600 },
      };

      vi.mocked(axios.post)
        .mockResolvedValueOnce(mockToken1)
        .mockResolvedValueOnce(mockToken2);

      // First call
      const result1 = await service["getToken"]();
      expect(result1.token).toBe("token-1");

      // Wait for token to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Second call - should fetch new token
      const result2 = await service["getToken"]();
      expect(result2.token).toBe("token-2");
      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it("should handle token fetch error gracefully", async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error("Network error"));

      await expect(service["getToken"]()).rejects.toThrow(
        "无法获取语音分析授权，请刷新页面重试",
      );
    });
  });

  describe("Background Upload", () => {
    it("should upload audio and analysis in background", async () => {
      const mockBlob = new Blob(["fake audio"], { type: "audio/wav" });
      const mockAnalysis = { pronunciationScore: 85 };
      const latencyMs = 1500;

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { status: "success", attempt_id: 123 },
      });

      await service.uploadAnalysisInBackground(
        mockBlob,
        mockAnalysis,
        latencyMs,
      );

      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/api/speech/upload-analysis"),
        expect.any(FormData),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "multipart/form-data",
            Authorization: "Bearer mock-student-token",
          }),
        }),
      );
    });

    it("should not throw error if upload fails", async () => {
      const mockBlob = new Blob(["fake audio"], { type: "audio/wav" });

      vi.mocked(axios.post).mockRejectedValueOnce(new Error("Upload failed"));

      // Should not throw
      await expect(
        service.uploadAnalysisInBackground(mockBlob, {}, 1000),
      ).resolves.not.toThrow();
    });

    it("should log error if upload fails", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const mockBlob = new Blob(["fake audio"], { type: "audio/wav" });

      vi.mocked(axios.post).mockRejectedValueOnce(new Error("Upload failed"));

      await service.uploadAnalysisInBackground(mockBlob, {}, 1000);

      expect(consoleSpy).toHaveBeenCalledWith(
        "First upload attempt failed:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  // 🎯 Issue #138: Race condition in localStorage queue
  describe("localStorage Queue Concurrency (Issue #138)", () => {
    const STORAGE_KEY = "duotopia_pending_uploads";
    const VERSION_KEY = "duotopia_pending_uploads_version";

    const mkUpload = (id: string, overrides = {}) => ({
      id,
      audioBase64: "data:audio/wav;base64,AAAA",
      analysisResult: {},
      latencyMs: 100,
      timestamp: 1000,
      retryCount: 0,
      ...overrides,
    });

    const readQueue = () =>
      JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

    beforeEach(() => {
      localStorage.clear();
    });

    it("increments the version counter on each successful save", async () => {
      await service["savePendingUpload"](mkUpload("A"));
      expect(localStorage.getItem(VERSION_KEY)).toBe("1");

      await service["savePendingUpload"](mkUpload("B"));
      expect(localStorage.getItem(VERSION_KEY)).toBe("2");

      expect(readQueue().map((u: { id: string }) => u.id)).toEqual(["A", "B"]);
    });

    it("retries on a concurrent version bump and keeps both entries (no data loss)", async () => {
      const orig = localStorage.getItem.bind(localStorage);
      let versionReads = 0;
      let injected = false;

      // Simulate another tab committing entry B + bumping the version
      // right after this context first reads the version (the classic
      // read-modify-write race window).
      vi.spyOn(localStorage, "getItem").mockImplementation((key: string) => {
        if (key === VERSION_KEY) {
          versionReads++;
          if (versionReads === 2 && !injected) {
            injected = true;
            localStorage.setItem(STORAGE_KEY, JSON.stringify([mkUpload("B")]));
            localStorage.setItem(VERSION_KEY, "1");
          }
        }
        return orig(key);
      });

      const result = await service["savePendingUpload"](mkUpload("A"));

      expect(result).toBe(true);
      const ids = readQueue()
        .map((u: { id: string }) => u.id)
        .sort();
      expect(ids).toEqual(["A", "B"]); // B from the "other tab" survives
    });

    it("removePendingUpload only removes its target and preserves a concurrent add", async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([mkUpload("A")]));
      localStorage.setItem(VERSION_KEY, "1");

      const orig = localStorage.getItem.bind(localStorage);
      let versionReads = 0;
      let injected = false;

      vi.spyOn(localStorage, "getItem").mockImplementation((key: string) => {
        if (key === VERSION_KEY) {
          versionReads++;
          if (versionReads === 2 && !injected) {
            injected = true;
            // Another tab adds C while we are removing A
            localStorage.setItem(
              STORAGE_KEY,
              JSON.stringify([mkUpload("A"), mkUpload("C")]),
            );
            localStorage.setItem(VERSION_KEY, "2");
          }
        }
        return orig(key);
      });

      service["removePendingUpload"]("A");

      const ids = readQueue()
        .map((u: { id: string }) => u.id)
        .sort();
      expect(ids).toEqual(["C"]); // A removed, concurrently-added C kept
    });

    it("still prunes oldest entries when over the size limit", async () => {
      // Each item ~3MB of base64; MAX_QUEUE_SIZE is 10MB → only newest fit
      const big = "x".repeat(3 * 1024 * 1024);
      await service["savePendingUpload"](mkUpload("A", { audioBase64: big }));
      await service["savePendingUpload"](mkUpload("B", { audioBase64: big }));
      await service["savePendingUpload"](mkUpload("C", { audioBase64: big }));
      await service["savePendingUpload"](mkUpload("D", { audioBase64: big }));

      const ids = readQueue().map((u: { id: string }) => u.id);
      expect(ids).not.toContain("A"); // oldest pruned
      expect(ids).toContain("D"); // newest kept
    });

    it("rejects a single item larger than the queue limit", async () => {
      const tooBig = "x".repeat(11 * 1024 * 1024); // > 10MB
      const result = await service["savePendingUpload"](
        mkUpload("HUGE", { audioBase64: tooBig }),
      );
      expect(result).toBe(false);
      expect(readQueue()).toEqual([]);
    });
  });
});
