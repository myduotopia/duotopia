/**
 * useQuizCloseRealtime 單元測試（Issue #835 / PR #881 點 1）
 *
 * 鎖定行為：
 *  - Realtime 未設定 / 未啟用 / 無 assignmentId → 不訂閱、connected=false。
 *  - 啟用且 SUBSCRIBED → connected=true。
 *  - 收到 quiz_closed broadcast → onClosed 只觸發一次。
 *  - unmount → removeChannel 清理。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---- mock @/lib/supabase ----
let realtimeEnabled = true;
let broadcastHandler: (() => void) | null = null;
const removeChannel = vi.fn();

const channel = {
  on: vi.fn((_type: string, _filter: unknown, cb: () => void) => {
    broadcastHandler = cb;
    return channel;
  }),
  subscribe: vi.fn((cb: (status: string) => void) => {
    cb("SUBSCRIBED");
    return channel;
  }),
};

vi.mock("@/lib/supabase", () => ({
  get isRealtimeEnabled() {
    return realtimeEnabled;
  },
  supabase: {
    channel: vi.fn(() => channel),
    removeChannel: (...args: unknown[]) => removeChannel(...args),
  },
}));

import { useQuizCloseRealtime } from "../useQuizCloseRealtime";

beforeEach(() => {
  realtimeEnabled = true;
  broadcastHandler = null;
  removeChannel.mockClear();
  channel.on.mockClear();
  channel.subscribe.mockClear();
});

describe("useQuizCloseRealtime", () => {
  it("啟用且 SUBSCRIBED → connected=true 並訂閱正確頻道", () => {
    const onClosed = vi.fn();
    const { result } = renderHook(() =>
      useQuizCloseRealtime({ assignmentId: 42, enabled: true, onClosed }),
    );
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
    expect(result.current.connected).toBe(true);
  });

  it("收到 quiz_closed broadcast → onClosed 只觸發一次", () => {
    const onClosed = vi.fn();
    renderHook(() =>
      useQuizCloseRealtime({ assignmentId: 42, enabled: true, onClosed }),
    );
    act(() => {
      broadcastHandler?.();
      broadcastHandler?.(); // 第二次應被去重
    });
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("enabled=false → 不訂閱、connected=false", () => {
    const onClosed = vi.fn();
    const { result } = renderHook(() =>
      useQuizCloseRealtime({ assignmentId: 42, enabled: false, onClosed }),
    );
    expect(channel.subscribe).not.toHaveBeenCalled();
    expect(result.current.connected).toBe(false);
  });

  it("assignmentId 為 null → 不訂閱", () => {
    renderHook(() =>
      useQuizCloseRealtime({
        assignmentId: null,
        enabled: true,
        onClosed: vi.fn(),
      }),
    );
    expect(channel.subscribe).not.toHaveBeenCalled();
  });

  it("Realtime 未設定（isRealtimeEnabled=false）→ 不訂閱", () => {
    realtimeEnabled = false;
    renderHook(() =>
      useQuizCloseRealtime({
        assignmentId: 42,
        enabled: true,
        onClosed: vi.fn(),
      }),
    );
    expect(channel.subscribe).not.toHaveBeenCalled();
  });

  it("unmount → removeChannel 清理", () => {
    const { unmount } = renderHook(() =>
      useQuizCloseRealtime({
        assignmentId: 42,
        enabled: true,
        onClosed: vi.fn(),
      }),
    );
    unmount();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
