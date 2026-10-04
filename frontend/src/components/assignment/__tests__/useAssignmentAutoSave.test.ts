/**
 * #1092：useAssignmentAutoSave（作業設定 sheet 改完即存的佇列）
 * - 只送與已儲存值不同的欄位；沒差異不發請求
 * - 一次只送一個請求、先進先出；排隊中的同區變動會合併成一筆
 * - 失敗 → reject 原始錯誤，baseline() 退回已儲存值（呼叫端據此把欄位退回）；佇列繼續
 * - flush() 等全部送完；hasSaved() 回報是否存過
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  diffFields,
  useAssignmentAutoSave,
  type PatchBody,
} from "../useAssignmentAutoSave";

/** 手動控制每個請求何時完成的 patch mock */
function controlledPatch() {
  const calls: Array<{
    body: PatchBody;
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
  }> = [];
  const patch = vi.fn(
    (body: PatchBody) =>
      new Promise((resolve, reject) => {
        calls.push({ body, resolve, reject });
      }),
  );
  return { patch, calls };
}

const SAVED = {
  title: "Unit 1",
  shuffle_questions: false,
  show_image: true,
  show_option_images: false,
};

describe("diffFields", () => {
  it("只回傳值不同的 key", () => {
    expect(
      diffFields(
        { a: 1, b: true, c: null },
        { a: 1, b: false, c: null, d: "x" },
      ),
    ).toEqual({ b: false, d: "x" });
  });
});

describe("useAssignmentAutoSave", () => {
  it("只送有變的欄位；沒變不發請求", async () => {
    const patch = vi.fn().mockResolvedValue({ success: true });
    const { result } = renderHook(() => useAssignmentAutoSave({ patch }));
    act(() => result.current.reset(SAVED));

    let unchanged: unknown;
    await act(async () => {
      unchanged = await result.current.saveFields("basic", {
        title: "Unit 1",
      });
    });
    expect(unchanged).toBeNull();
    expect(patch).not.toHaveBeenCalled();

    let res: unknown;
    await act(async () => {
      res = await result.current.saveFields("advanced", {
        ...SAVED,
        show_image: false,
        show_option_images: true,
      });
    });
    // 互斥開關一次改兩個 key → 兩個一起送，其他沒變的不送
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({
      show_image: false,
      show_option_images: true,
    });
    expect(res).toEqual({
      body: { show_image: false, show_option_images: true },
      response: { success: true },
    });
    expect(result.current.saveStates.advanced).toBe("saved");
    expect(result.current.hasSaved()).toBe(true);
  });

  it("序列化先進先出；排隊中的同區變動合併成一筆，diff 對「送完後的值」算", async () => {
    const { patch, calls } = controlledPatch();
    const { result } = renderHook(() => useAssignmentAutoSave({ patch }));
    act(() => result.current.reset(SAVED));

    let p1!: Promise<unknown>;
    let p2!: Promise<unknown>;
    let p3!: Promise<unknown>;
    let p4!: Promise<unknown>;
    act(() => {
      p1 = result.current.saveFields("basic", { title: "A" });
      // 第一筆送出中 → 後面三筆排隊
      p2 = result.current.saveFields("advanced", { shuffle_questions: true });
      p3 = result.current.saveFields("advanced", {
        show_image: false,
        show_option_images: true,
      });
      // 對 baseline（含排隊中的 title A）算 diff：B ≠ A → 要送
      p4 = result.current.saveFields("basic", { title: "B" });
    });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(calls[0].body).toEqual({ title: "A" });
    expect(result.current.saveStates.basic).toBe("saving");
    expect(result.current.baseline()).toMatchObject({
      title: "B",
      shuffle_questions: true,
      show_image: false,
      show_option_images: true,
    });

    await act(async () => {
      calls[0].resolve({ ok: 1 });
      await p1;
    });
    // 兩筆 advanced 合併成一筆，在 title B 之前送（先進先出）
    expect(calls[1].body).toEqual({
      shuffle_questions: true,
      show_image: false,
      show_option_images: true,
    });

    await act(async () => {
      calls[1].resolve({ ok: 2 });
      await Promise.all([p2, p3]);
    });
    expect(calls[2].body).toEqual({ title: "B" });

    await act(async () => {
      calls[2].resolve({ ok: 3 });
      await p4;
    });
    expect(patch).toHaveBeenCalledTimes(3);
    expect(await p2).toEqual(await p3);
  });

  it("排隊中開了又關 → 合併後沒差異就不送", async () => {
    const { patch, calls } = controlledPatch();
    const { result } = renderHook(() => useAssignmentAutoSave({ patch }));
    act(() => result.current.reset(SAVED));

    let first!: Promise<unknown>;
    let on!: Promise<unknown>;
    let off!: Promise<unknown>;
    act(() => {
      first = result.current.saveFields("basic", { title: "A" });
      on = result.current.saveFields("advanced", { shuffle_questions: true });
      off = result.current.saveFields("advanced", {
        shuffle_questions: false,
      });
    });
    await act(async () => {
      calls[0].resolve({});
      await first;
    });
    expect(await on).toBeNull();
    expect(await off).toBeNull();
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it("失敗 → reject 原始錯誤、baseline 退回已儲存值、後面的請求照送", async () => {
    const { patch, calls } = controlledPatch();
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useAssignmentAutoSave({ patch, onSaved }),
    );
    act(() => result.current.reset(SAVED));

    const error = { status: 422, detail: { code: "EXAMPLE_AUDIO_REQUIRED" } };
    let failing!: Promise<unknown>;
    let next!: Promise<unknown>;
    act(() => {
      failing = result.current.saveFields("advanced", {
        shuffle_questions: true,
      });
      next = result.current.saveFields("basic", { title: "New" });
    });

    let caught: unknown;
    await act(async () => {
      calls[0].reject(error);
      try {
        await failing;
      } catch (e) {
        caught = e;
      }
    });
    expect(caught).toBe(error);
    expect(result.current.saveStates.advanced).toBe("failed");
    // 呼叫端用 baseline() 把開關退回：失敗那筆不在裡面，排隊中的 title 仍在
    expect(result.current.baseline()).toMatchObject({
      shuffle_questions: false,
      title: "New",
    });

    await act(async () => {
      calls[1].resolve({ success: true });
      await next;
    });
    expect(calls[1].body).toEqual({ title: "New" });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith({ title: "New" }, { success: true });
  });

  it("送出對象在排進佇列時決定：換作業後，舊作業排隊中的變動仍送給舊作業", async () => {
    const a = controlledPatch();
    const b = controlledPatch();
    const { result, rerender } = renderHook(
      ({ target, patch }) => useAssignmentAutoSave({ patch, target }),
      { initialProps: { target: 1 as number, patch: a.patch } },
    );
    act(() => result.current.reset(SAVED));

    let first!: Promise<unknown>;
    let queued!: Promise<unknown>;
    act(() => {
      first = result.current.saveFields("basic", { title: "A" });
      // 第一筆送出中 → 這筆排隊（作業 1）
      queued = result.current.saveFields("advanced", {
        shuffle_questions: true,
      });
    });

    // 切到作業 2（新的 patch 函式）並重設已儲存值
    rerender({ target: 2, patch: b.patch });
    act(() => result.current.reset({ ...SAVED, title: "Other" }));
    // 作業 1 排隊中的變動不算進作業 2 的 baseline
    expect(result.current.baseline()).toMatchObject({
      title: "Other",
      shuffle_questions: false,
    });

    await act(async () => {
      a.calls[0].resolve({});
      await first;
    });
    // 排隊那筆仍用作業 1 的 patch 送出
    expect(a.patch).toHaveBeenCalledTimes(2);
    expect(a.calls[1].body).toEqual({ shuffle_questions: true });
    expect(b.patch).not.toHaveBeenCalled();

    await act(async () => {
      a.calls[1].resolve({});
      await queued;
    });
    // 作業 1 的成功不會改到作業 2 的已儲存值與狀態
    expect(result.current.baseline()).toMatchObject({
      title: "Other",
      shuffle_questions: false,
    });
    expect(result.current.saveStates.advanced).toBe("idle");
  });

  it("flush() 等佇列全部送完；沒有排隊時立即完成", async () => {
    const { patch, calls } = controlledPatch();
    const { result } = renderHook(() => useAssignmentAutoSave({ patch }));
    act(() => result.current.reset(SAVED));

    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.hasSaved()).toBe(false);

    act(() => {
      void result.current.saveFields("basic", { title: "A" });
      void result.current.saveFields("advanced", { shuffle_questions: true });
    });

    let flushed = false;
    let flushPromise!: Promise<void>;
    act(() => {
      flushPromise = result.current.flush().then(() => {
        flushed = true;
      });
    });

    await act(async () => {
      calls[0].resolve({});
      await Promise.resolve();
    });
    expect(flushed).toBe(false);

    await act(async () => {
      calls[1].resolve({});
      await flushPromise;
    });
    expect(flushed).toBe(true);
    expect(result.current.hasSaved()).toBe(true);
  });
});
