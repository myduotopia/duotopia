import { describe, it, expect, beforeEach } from "vitest";
import {
  getRecordingStrategy,
  selectSupportedMimeType,
  validateDuration,
} from "../audioRecordingStrategy";

describe("audioRecordingStrategy", () => {
  describe("getRecordingStrategy", () => {
    it("應該為 iOS Safari 返回正確策略", () => {
      const userAgent =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1";
      const strategy = getRecordingStrategy(userAgent);

      expect(strategy.preferredMimeType).toBe("audio/webm;codecs=opus");
      expect(strategy.useTimeslice).toBe(false);
      expect(strategy.useRequestData).toBe(true);
      expect(strategy.durationValidation).toBe("lenient");
      expect(strategy.minFileSize).toBe(500);
      expect(strategy.platformName).toBe("iOS Safari");
    });

    it("應該為 macOS Safari 返回正確策略", () => {
      const userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15";
      const strategy = getRecordingStrategy(userAgent);

      expect(strategy.preferredMimeType).toBe("audio/webm;codecs=opus");
      expect(strategy.useRequestData).toBe(true);
      expect(strategy.durationValidation).toBe("lenient");
      expect(strategy.platformName).toBe("macOS Safari");
    });

    it("應該為 Chrome 返回正確策略", () => {
      const userAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36";
      const strategy = getRecordingStrategy(userAgent);

      expect(strategy.preferredMimeType).toBe("audio/webm;codecs=opus");
      expect(strategy.fallbackMimeTypes).toContain("audio/webm");
      expect(strategy.fallbackMimeTypes).toContain("audio/mp4");
      expect(strategy.useRequestData).toBe(true);
      expect(strategy.durationValidation).toBe("metadata-first");
      expect(strategy.minFileSize).toBe(500);
    });

    it("應該為 Firefox 返回正確策略", () => {
      const userAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:94.0) Gecko/20100101 Firefox/94.0";
      const strategy = getRecordingStrategy(userAgent);

      expect(strategy.preferredMimeType).toBe("audio/webm;codecs=opus");
      expect(strategy.fallbackMimeTypes).toContain("audio/ogg;codecs=opus");
      expect(strategy.durationValidation).toBe("metadata-first");
      expect(strategy.platformName).toBe("Firefox");
    });

    it("應該為未知瀏覽器返回保守策略", () => {
      const userAgent = "Unknown Browser/1.0";
      const strategy = getRecordingStrategy(userAgent);

      expect(strategy.preferredMimeType).toBe("audio/mp4");
      expect(strategy.durationValidation).toBe("lenient");
      expect(strategy.minFileSize).toBe(500);
      expect(strategy.platformName).toBe("Unknown Browser");
    });
  });

  describe("selectSupportedMimeType", () => {
    // Mock MediaRecorder.isTypeSupported
    beforeEach(() => {
      (global as typeof globalThis).MediaRecorder = {
        isTypeSupported: (mimeType: string) => {
          if (mimeType.includes("webm")) return true;
          if (mimeType.includes("mp4")) return true;
          return false;
        },
      } as unknown as typeof MediaRecorder;
    });

    it("應該優先使用 preferredMimeType", () => {
      const strategy = {
        preferredMimeType: "audio/webm;codecs=opus",
        fallbackMimeTypes: ["audio/webm", "audio/mp4"],
        useTimeslice: false,
        useRequestData: true,
        maxDuration: 45,
        minDuration: 1,
        durationValidation: "metadata-first" as const,
        minFileSize: 1000,
        platformName: "Chrome",
        notes: "Test",
      };

      const mimeType = selectSupportedMimeType(strategy);
      expect(mimeType).toBe("audio/webm;codecs=opus");
    });

    it("應該為 macOS Safari 使用 WebM", () => {
      const userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15";

      // 從 strategy 獲取配置（而不是手動構造）
      const strategy = getRecordingStrategy(userAgent);

      // macOS Safari 策略應該要求 WebM（與 iOS 相同問題）
      expect(strategy.preferredMimeType).toBe("audio/webm;codecs=opus");

      // selectSupportedMimeType 應該直接返回策略的首選項（不依賴 isTypeSupported）
      // 需要 mock navigator.userAgent
      Object.defineProperty(navigator, "userAgent", {
        value: userAgent,
        writable: true,
      });

      const mimeType = selectSupportedMimeType(strategy);
      expect(mimeType).toBe("audio/webm;codecs=opus");
    });
  });

  describe("validateDuration", () => {
    it("應該在 lenient 模式下接受大於最小檔案大小的檔案", async () => {
      const blob = new Blob(["x".repeat(10000)], { type: "audio/webm" });
      const url = "blob:test";
      const strategy = {
        durationValidation: "lenient" as const,
        minFileSize: 5000,
        preferredMimeType: "audio/webm",
        fallbackMimeTypes: [],
        useTimeslice: false,
        useRequestData: true,
        maxDuration: 45,
        minDuration: 1,
        platformName: "Test",
        notes: "Test",
      };

      const result = await validateDuration(blob, url, strategy);
      expect(result.valid).toBe(true);
      expect(result.method).toBe("lenient-filesize");
    });

    it("應該在檔案太小時拒絕", async () => {
      const blob = new Blob(["x".repeat(100)], { type: "audio/webm" });
      const url = "blob:test";
      const strategy = {
        durationValidation: "lenient" as const,
        minFileSize: 5000,
        preferredMimeType: "audio/webm",
        fallbackMimeTypes: [],
        useTimeslice: false,
        useRequestData: true,
        maxDuration: 45,
        minDuration: 1,
        platformName: "Test",
        notes: "Test",
      };

      const result = await validateDuration(blob, url, strategy);
      expect(result.valid).toBe(false);
      expect(result.method).toBe("lenient-rejected");
    });

    it("應該在 filesize-first 模式下使用檔案大小估算", async () => {
      const blob = new Blob(["x".repeat(20000)], { type: "audio/webm" });
      const url = "blob:test";
      const strategy = {
        durationValidation: "filesize-first" as const,
        minFileSize: 10000,
        preferredMimeType: "audio/webm",
        fallbackMimeTypes: [],
        useTimeslice: false,
        useRequestData: true,
        maxDuration: 45,
        minDuration: 1,
        platformName: "Test",
        notes: "Test",
      };

      const result = await validateDuration(blob, url, strategy);
      expect(result.valid).toBe(true);
      expect(result.method).toContain("filesize");
      expect(result.duration).toBeGreaterThan(0);
    });
  });
});
