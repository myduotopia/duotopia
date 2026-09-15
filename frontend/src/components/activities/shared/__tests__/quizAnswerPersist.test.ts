import { describe, expect, it, vi } from "vitest";

import { createAnswerPersistTracker } from "../quizAnswerPersist";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createAnswerPersistTracker (#1045)", () => {
  it("skips a value only after it is confirmed saved", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const tracker = createAnswerPersistTracker(() => send);
    await tracker.save(1, "apple");
    await tracker.save(1, "apple");
    expect(send).toHaveBeenCalledTimes(1);
    expect(tracker.isSavedOrPending(1, "apple")).toBe(true);
  });

  it("does not confirm a skipped send and resends later", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, skipped: true })
      .mockResolvedValueOnce({ ok: true });
    const tracker = createAnswerPersistTracker(() => send);
    expect((await tracker.save(1, "apple")).ok).toBe(true);
    expect(tracker.isSavedOrPending(1, "apple")).toBe(false);
    await tracker.save(1, "apple");
    expect(send).toHaveBeenCalledTimes(2);
    expect(tracker.isSavedOrPending(1, "apple")).toBe(true);
  });

  it("awaits same-value in-flight save instead of sending twice", async () => {
    const d = deferred<{ ok: boolean }>();
    const send = vi.fn().mockReturnValueOnce(d.promise);
    const tracker = createAnswerPersistTracker(() => send);
    const autosave = tracker.save(1, "apple");
    const submit = tracker.save(1, "apple");
    expect(send).toHaveBeenCalledTimes(1);
    d.resolve({ ok: true });
    expect((await submit).ok).toBe(true);
    expect((await autosave).ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("resends when the in-flight autosave ultimately fails", async () => {
    const d = deferred<{ ok: boolean }>();
    const send = vi
      .fn()
      .mockReturnValueOnce(d.promise)
      .mockResolvedValueOnce({ ok: true });
    const tracker = createAnswerPersistTracker(() => send);
    const autosave = tracker.save(1, "apple");
    const submit = tracker.save(1, "apple");
    d.resolve({ ok: false });
    expect((await autosave).ok).toBe(false);
    expect((await submit).ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(1, "apple");
  });

  it("treats a thrown sender as failure and does not confirm", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("net"))
      .mockResolvedValueOnce({ ok: true });
    const tracker = createAnswerPersistTracker(() => send);
    expect((await tracker.save(1, "a")).ok).toBe(false);
    expect(tracker.isSavedOrPending(1, "a")).toBe(false);
    expect((await tracker.save(1, "a")).ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("serialises a different value behind the in-flight request", async () => {
    const d = deferred<{ ok: boolean }>();
    const send = vi
      .fn()
      .mockReturnValueOnce(d.promise)
      .mockResolvedValueOnce({ ok: true });
    const tracker = createAnswerPersistTracker(() => send);
    void tracker.save(1, "appl");
    const next = tracker.save(1, "apple");
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    d.resolve({ ok: true });
    expect((await next).ok).toBe(true);
    expect(send).toHaveBeenNthCalledWith(2, 1, "apple");
  });

  it("flush waits for in-flight saves and retries failures before finalize", async () => {
    const d1 = deferred<{ ok: boolean }>();
    const d2 = deferred<{ ok: boolean }>();
    const send = vi
      .fn()
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise)
      .mockResolvedValueOnce({ ok: true });
    const tracker = createAnswerPersistTracker(() => send);
    void tracker.save(1, "a");
    void tracker.save(2, "b");
    let flushed = false;
    const flush = tracker.flush().then((ok) => {
      flushed = true;
      return ok;
    });
    d1.resolve({ ok: true });
    await Promise.resolve();
    expect(flushed).toBe(false);
    d2.resolve({ ok: false });
    expect(await flush).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenLastCalledWith(2, "b");
  });

  it("flush returns false when a retry also fails", async () => {
    const send = vi.fn().mockResolvedValue({ ok: false });
    const tracker = createAnswerPersistTracker(() => send);
    void tracker.save(1, "a");
    expect(await tracker.flush()).toBe(false);
  });
});
