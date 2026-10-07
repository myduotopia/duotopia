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
 *
 * #1092：老師改評分設定（如改成區分大小寫）後，本機鎖定的「已答對」題可能被後端
 * 重判成錯 → /complete 回 400 QUIZ_REVISION_INCOMPLETE（isRevisionIncompleteError）。
 * 打字小考元件此時重新呼叫 start，用 priorCorrectFromStart / priorTypedFromStart
 * 更新鎖定狀態（本機已輸入的答案優先保留），並提示學生修改後再交卷。
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

/**
 * 第一題「尚未答對（需訂正）」的索引；全部答對回 -1。
 * 「未解決」＝ correctByItem[id] !== true（含未作答 null）。
 * 用於打開訂正小考時直接把游標停在第一題錯題。
 */
export function firstUnresolvedIndex(
  words: { content_item_id: number }[],
  correctByItem: Record<number, boolean | null>,
): number {
  return words.findIndex((w) => correctByItem[w.content_item_id] !== true);
}

/**
 * 從 from 之後（不含 from）找下一題尚未答對的索引，找不到則回頭從 0 找；
 * 全部答對回 -1。用於改對一題後自動跳到下一題錯題。
 */
export function nextUnresolvedIndex(
  words: { content_item_id: number }[],
  correctByItem: Record<number, boolean | null>,
  from: number,
): number {
  for (let i = from + 1; i < words.length; i++) {
    if (correctByItem[words[i].content_item_id] !== true) return i;
  }
  for (let i = 0; i < from && i < words.length; i++) {
    if (correctByItem[words[i].content_item_id] !== true) return i;
  }
  return -1;
}

/** start 回傳的每題前次作答（訂正模式用來鎖定已答對題、帶回原答案）。 */
export interface QuizPriorWord {
  content_item_id: number;
  prior_answer?: string | null;
  prior_is_correct?: boolean | null;
}

/** 從 start 的 words 取出每題對錯（鎖定依據）。後端未判過的題不放（＝未解決）。 */
export function priorCorrectFromStart(
  words: QuizPriorWord[],
): Record<number, boolean | null> {
  const correct: Record<number, boolean | null> = {};
  words.forEach((w) => {
    if (w.prior_is_correct != null)
      correct[w.content_item_id] = w.prior_is_correct;
  });
  return correct;
}

/**
 * 從 start 的 words 取出每題前次答案，再以本機已輸入的值覆蓋（本機值優先，
 * 重新載入時不會把學生這次打的答案蓋掉）。初次載入時 local 為空。
 */
export function priorTypedFromStart(
  words: QuizPriorWord[],
  local: Record<number, string> = {},
): Record<number, string> {
  const typed: Record<number, string> = {};
  words.forEach((w) => {
    if (w.prior_answer != null) typed[w.content_item_id] = w.prior_answer;
  });
  return { ...typed, ...local };
}

/**
 * #1092：訂正交卷被後端擋下（400 QUIZ_REVISION_INCOMPLETE）。
 * 典型情境：學生開著訂正頁時老師改了評分設定（如改成區分大小寫），本機鎖定為
 * 「已答對」的題目被後端重判成錯；呼叫端應重新呼叫 start 取得最新 prior_is_correct。
 */
export function isRevisionIncompleteError(err: unknown): boolean {
  return (
    (err as { detail?: { code?: string } })?.detail?.code ===
    "QUIZ_REVISION_INCOMPLETE"
  );
}
