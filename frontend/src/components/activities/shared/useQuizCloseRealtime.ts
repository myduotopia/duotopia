/**
 * useQuizCloseRealtime — Issue #835 / PR #881 點 1
 *
 * 訂閱 Supabase Realtime Broadcast 頻道 `live-quiz:{assignmentId}`，老師收卷時後端
 * 推播 `quiz_closed` 事件，學生端即時觸發 onClosed（跳離考卷頁），取代高頻輪詢。
 *
 * - 僅在 enabled 且 Realtime 已設定（isRealtimeEnabled）且 assignmentId 有效時訂閱。
 * - onClosed 只觸發一次（closedFiredRef 去重）。
 * - 以 ref 保存 onClosed，避免 caller 每次 render 重建 callback 而重訂閱。
 * - 回傳 connected：是否成功建立 Realtime 訂閱 —— 供 caller 決定是否拉長 polling fallback。
 * - 此處 assignmentId 為「老師端 Assignment.id」（取自 /quiz/status 回應），非 StudentAssignment.id。
 */
import { useEffect, useRef, useState } from "react";
import { supabase, isRealtimeEnabled } from "@/lib/supabase";

interface UseQuizCloseRealtimeOptions {
  /** teacher 端 Assignment.id（來自 /quiz/status 的 assignment_id）；未知時傳 null */
  assignmentId: number | null;
  /** 是否啟用訂閱（live 且未收卷時為 true） */
  enabled: boolean;
  /** 收到收卷事件時觸發一次 */
  onClosed?: () => void;
}

export function useQuizCloseRealtime({
  assignmentId,
  enabled,
  onClosed,
}: UseQuizCloseRealtimeOptions): { connected: boolean } {
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled || !isRealtimeEnabled || !supabase || !assignmentId) {
      setConnected(false);
      return;
    }

    // 局部非空參照：narrowing 不會延續進下方 cleanup closure，故在此固定。
    const client = supabase;
    let closedFired = false;
    const topic = `live-quiz:${assignmentId}`;
    const channel = client.channel(topic);

    channel
      .on("broadcast", { event: "quiz_closed" }, () => {
        if (closedFired) return;
        closedFired = true;
        onClosedRef.current?.();
      })
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      setConnected(false);
      client.removeChannel(channel);
    };
  }, [assignmentId, enabled]);

  return { connected };
}
