/**
 * useQuizStatusPolling — Issue #835 Live quiz mode
 *
 * 學生在 live 考卷頁時，每 3–5 秒輪詢 `/quiz/status`，偵測老師「收卷」
 * （closed_at 從 null → 非 null）後觸發 onClosed 一次（讓考卷頁跳回作業列表 + toast）。
 *
 * - 只在 enabled（= 該作業是 live quiz 且尚未收卷）時輪詢。
 * - onClosed 只觸發一次（closedFiredRef 去重），觸發後停止輪詢。
 * - onClosed 以 ref 保存，避免 caller 每次 render 重建 callback 而重啟輪詢。
 * - 暫態錯誤（網路抖動）忽略，下一輪再試。
 */
import { useEffect, useRef } from "react";
import { apiClient, type StudentQuizStatus } from "@/lib/api";

interface UseQuizStatusPollingOptions {
  /** StudentAssignment.id（與其餘 quiz 端點一致） */
  studentAssignmentId: number;
  /** 是否啟用輪詢（live 且未收卷時為 true） */
  enabled: boolean;
  /** 輪詢間隔（毫秒），預設 4000 */
  intervalMs?: number;
  /** 偵測到老師已收卷時觸發一次 */
  onClosed?: (status: StudentQuizStatus) => void;
}

export function useQuizStatusPolling({
  studentAssignmentId,
  enabled,
  intervalMs = 4000,
  onClosed,
}: UseQuizStatusPollingOptions): void {
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => {
    if (!enabled || !studentAssignmentId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closedFired = false;

    const poll = async () => {
      try {
        const status =
          await apiClient.getStudentQuizStatus(studentAssignmentId);
        if (cancelled) return;
        if (status.closed_at && !closedFired) {
          closedFired = true;
          onClosedRef.current?.(status);
          return; // 收卷後停止輪詢
        }
      } catch {
        // 暫態錯誤忽略，下一輪再試
      }
      if (!cancelled) timer = setTimeout(poll, intervalMs);
    };

    // 立即跑首輪（poll() 內部會自排下一輪）：當 Realtime 連線、intervalMs=15s 時，
    // 若 broadcast 漏接，fallback 不必等滿一個間隔（最長 15s）才偵測到收卷。
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [studentAssignmentId, enabled, intervalMs]);
}
