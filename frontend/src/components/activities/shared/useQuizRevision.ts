/**
 * useQuizRevision — 小考訂正模式共用邏輯（Issue #830）
 *
 * 老師退回後，小考 start payload 會回傳 status="RETURNED"，學生重進即進入
 * 「訂正模式」：
 *   - 第一次已答對的題目鎖定唯讀（由各元件用 correctByItem 判斷）。
 *   - 答錯 → 立即揭示正解（revealByItem，呈現方式參考艾賓浩斯）。
 *   - 一答錯就禁止過題 / 提交，必須改到全部正確才能提交（allCorrect）。
 *
 * 後端 _complete_quiz 對 RETURNED 進入時會再把關一次（未全對回 400），
 * 前端 gating 只是即時體驗。
 */
import { useCallback, useState } from "react";

export function useQuizRevision(status: string | null | undefined) {
  const isRevision = status === "RETURNED";
  // key = content_item_id → 該題要揭示給學生看的正解
  const [revealByItem, setRevealByItem] = useState<Record<number, string>>({});

  const recordResult = useCallback(
    (itemId: number, isCorrect: boolean, correctAnswer?: string | null) => {
      if (!isRevision) return;
      setRevealByItem((m) => {
        const next = { ...m };
        if (!isCorrect && correctAnswer) next[itemId] = correctAnswer;
        else if (isCorrect) delete next[itemId];
        return next;
      });
    },
    [isRevision],
  );

  return { isRevision, revealByItem, recordResult };
}

/** 全部題目都答對才為 true — 訂正提交的前置條件。 */
export function allCorrect(
  words: { content_item_id: number }[],
  correctByItem: Record<number, boolean | null>,
): boolean {
  return (
    words.length > 0 &&
    words.every((w) => correctByItem[w.content_item_id] === true)
  );
}
