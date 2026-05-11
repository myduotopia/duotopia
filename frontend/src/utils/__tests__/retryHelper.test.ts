import { describe, it, expect, vi } from "vitest";
import { retryWithBackoff, retryAudioUpload } from "../retryHelper";

describe("retryWithBackoff", () => {
  it("should succeed on first try if function succeeds", async () => {
    const mockFn = vi.fn().mockResolvedValue("success");

    const result = await retryWithBackoff(mockFn);

    expect(result).toBe("success");
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it("should retry up to maxRetries times on failure", async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValueOnce("success");

    const result = await retryWithBackoff(mockFn, { maxRetries: 3 });

    expect(result).toBe("success");
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it("should throw error after maxRetries attempts", async () => {
    const mockFn = vi.fn().mockRejectedValue(new Error("always fails"));

    await expect(retryWithBackoff(mockFn, { maxRetries: 3 })).rejects.toThrow(
      "always fails",
    );

    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it("should use exponential backoff between retries", async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValueOnce("success");

    const startTime = Date.now();
    await retryWithBackoff(mockFn, {
      maxRetries: 3,
      initialDelay: 100,
      maxDelay: 1000,
    });
    const endTime = Date.now();

    // Should take at least 100ms (first delay) + 200ms (second delay)
    expect(endTime - startTime).toBeGreaterThanOrEqual(300);
  });

  it("should call onRetry callback when retrying", async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockResolvedValueOnce("success");

    const onRetry = vi.fn();

    await retryWithBackoff(mockFn, {
      maxRetries: 3,
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it("should handle specific error types differently if specified", async () => {
    const networkError = new Error("Network error");
    const validationError = new Error("Validation error");

    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(validationError);

    const shouldRetry = (error: Error) => {
      return error.message.includes("Network");
    };

    await expect(
      retryWithBackoff(mockFn, {
        maxRetries: 3,
        shouldRetry,
      }),
    ).rejects.toThrow("Validation error");

    // Should stop retrying after validation error
    expect(mockFn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// retryAudioUpload — shouldRetry behaviour
// ---------------------------------------------------------------------------

describe("retryAudioUpload shouldRetry", () => {
  it("retries on 429 (Too Many Requests)", async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Upload failed: 429"))
      .mockResolvedValueOnce("ok");

    const result = await retryAudioUpload(mockFn, undefined);
    expect(result).toBe("ok");
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it("retries on 408 (Request Timeout)", async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Upload failed: 408"))
      .mockResolvedValueOnce("ok");

    const result = await retryAudioUpload(mockFn, undefined);
    expect(result).toBe("ok");
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it("retries on 425 (Too Early)", async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Upload failed: 425"))
      .mockResolvedValueOnce("ok");

    const result = await retryAudioUpload(mockFn, undefined);
    expect(result).toBe("ok");
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on 400 (Bad Request)", async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Upload failed: 400"));

    await expect(retryAudioUpload(mockFn, undefined)).rejects.toThrow("400");
    // Should fail immediately — no retry
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it("retries on NetworkError", async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("NetworkError while uploading"))
      .mockResolvedValueOnce("ok");

    const result = await retryAudioUpload(mockFn, undefined);
    expect(result).toBe("ok");
    expect(mockFn).toHaveBeenCalledTimes(2);
  });
});
