/**
 * useScenarioChat — 情境對話「訊息對話式」作答的狀態機（#1133）。
 *
 * 從 ScenarioChatActivity 拆出來，主元件只管版面。流程：
 *   intro →（開始）→ aiTyping → awaitingAnswer →（送出）→ awaitingFeedback
 *   → feedbackShown →（再試一次）awaitingAnswer ／（下一題）aiTyping → … → finished
 *
 * - 題目一題一題冒出：揭露前先顯示「輸入中…」TYPING_MS。
 * - 每題最多 maxAttempts 次；用完停 AUTO_NEXT_MS 自動進下一題。
 * - 結束後（finished）未答滿的題目可補答（reviewing），答滿的只能重聽。
 * - 老師預覽可跳題（jumpTo）：往後跳時中間未出現的題目標「略過」；往回跳保留紀錄。
 * - AI 建議以 adapters.getFeedback 注入；過期的回應（重置／跳題後才回來）以 sessionRef 丟棄。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ScenarioAnswer,
  ScenarioAttempt,
  ScenarioChatAdapters,
  ScenarioChatItem,
  TextRevealState,
} from "./types";

export const TYPING_MS = 900;
export const AUTO_NEXT_MS = 1500;

export type ScenarioChatPhase =
  | "intro"
  | "aiTyping"
  | "awaitingAnswer"
  | "awaitingFeedback"
  | "feedbackShown"
  | "finished";

interface Options {
  items: ScenarioChatItem[];
  adapters: ScenarioChatAdapters;
  maxAttempts: number;
  textDefaultHidden: boolean;
  showTranslation: boolean;
  onRevealChange?: (reveal: TextRevealState[]) => void;
}

export function useScenarioChat({
  items,
  adapters,
  maxAttempts,
  textDefaultHidden,
  showTranslation,
  onRevealChange,
}: Options) {
  const n = items.length;
  const [phase, setPhase] = useState<ScenarioChatPhase>("intro");
  const [revealedCount, setRevealedCount] = useState(0);
  const [current, setCurrent] = useState(0);
  const [attempts, setAttempts] = useState<ScenarioAttempt[][]>(() =>
    items.map(() => []),
  );
  const [skipped, setSkipped] = useState<boolean[]>(() =>
    items.map(() => false),
  );
  const [reveal, setReveal] = useState<TextRevealState[]>(() =>
    items.map(() => ({
      en: !textDefaultHidden,
      zh: false,
    })),
  );
  const [closingShown, setClosingShown] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const sessionRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const adaptersRef = useRef(adapters);
  adaptersRef.current = adapters;

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const later = useCallback((fn: () => void, ms: number) => {
    const session = sessionRef.current;
    const id = setTimeout(() => {
      if (session === sessionRef.current) fn();
    }, ms);
    timersRef.current.push(id);
  }, []);

  useEffect(() => {
    onRevealChange?.(reveal);
  }, [reveal, onRevealChange]);

  /** 「輸入中…」後揭露第 i 題並自動播一次 */
  const typeThenReveal = useCallback(
    (i: number) => {
      setPhase("aiTyping");
      later(() => {
        setRevealedCount((c) => Math.max(c, i + 1));
        setCurrent(i);
        setPhase("awaitingAnswer");
        adaptersRef.current.speak(items[i].text);
      }, TYPING_MS);
    },
    [items, later],
  );

  const start = useCallback(() => {
    if (n === 0) return;
    typeThenReveal(0);
  }, [n, typeThenReveal]);

  const finishAll = useCallback(() => {
    setPhase("aiTyping");
    later(() => {
      setClosingShown(true);
      setPhase("finished");
    }, TYPING_MS);
  }, [later]);

  const goNext = useCallback(() => {
    if (reviewing) {
      setReviewing(false);
      setPhase("finished");
      return;
    }
    const nextIdx = current + 1;
    if (nextIdx >= n) {
      finishAll();
    } else if (nextIdx < revealedCount) {
      // 老師往回跳過：下一題已在畫面上，直接接著答
      setCurrent(nextIdx);
      setPhase("awaitingAnswer");
      adaptersRef.current.speak(items[nextIdx].text);
    } else {
      typeThenReveal(nextIdx);
    }
  }, [reviewing, current, n, revealedCount, items, finishAll, typeThenReveal]);

  const submitAnswer = useCallback(
    (answer: ScenarioAnswer) => {
      const q = current;
      const attemptIndex = attempts[q].length;
      setAttempts((prev) =>
        prev.map((list, i) => (i === q ? [...list, { answer }] : list)),
      );
      setPhase("awaitingFeedback");
      const session = sessionRef.current;
      adaptersRef.current
        .getFeedback(items[q], answer, attemptIndex)
        .then((feedback) => {
          if (session !== sessionRef.current) return;
          setAttempts((prev) =>
            prev.map((list, i) =>
              i === q
                ? list.map((a, j) =>
                    j === attemptIndex ? { ...a, feedback } : a,
                  )
                : list,
            ),
          );
          setPhase("feedbackShown");
        });
    },
    [current, attempts, items],
  );

  // 用完次數 → 停一下自動進下一題
  const currentAttempts = attempts[current]?.length ?? 0;
  const exhausted = currentAttempts >= maxAttempts;
  useEffect(() => {
    if (phase === "feedbackShown" && exhausted) {
      later(goNext, AUTO_NEXT_MS);
    }
    // goNext 依賴會隨 state 變；只在進入 feedbackShown 時排一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, exhausted]);

  const retry = useCallback(() => setPhase("awaitingAnswer"), []);

  /** 結束後補答（未答滿的題目） */
  const reanswer = useCallback(
    (i: number) => {
      if (attempts[i].length >= maxAttempts) return;
      setReviewing(true);
      setCurrent(i);
      setPhase("awaitingAnswer");
    },
    [attempts, maxAttempts],
  );

  const cancelReview = useCallback(() => {
    setReviewing(false);
    setPhase("finished");
  }, []);

  /** 老師預覽：跳到第 i 題 */
  const jumpTo = useCallback(
    (i: number) => {
      sessionRef.current += 1;
      clearTimers();
      setReviewing(false);
      setClosingShown(false);
      if (i < revealedCount) {
        setCurrent(i);
        setPhase("awaitingAnswer");
        adaptersRef.current.speak(items[i].text);
        return;
      }
      setSkipped((prev) =>
        prev.map((s, j) => s || (j >= revealedCount && j < i)),
      );
      setRevealedCount(i);
      typeThenReveal(i);
    },
    [revealedCount, items, clearTimers, typeThenReveal],
  );

  const revealText = useCallback(
    (i: number, which: "en" | "zh") => {
      if (which === "zh" && !showTranslation) return;
      setReveal((prev) =>
        prev.map((r, j) => (j === i ? { ...r, [which]: true } : r)),
      );
    },
    [showTranslation],
  );

  const averageFor = useCallback(
    (i: number): number | null => {
      const scores = attempts[i]
        .map((a) => a.feedback?.score)
        .filter((s): s is number => typeof s === "number");
      if (scores.length === 0) return null;
      return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    },
    [attempts],
  );

  /** 給自動捲動用：流程有任何新內容就會變 */
  const flowKey = useMemo(() => {
    const total = attempts.reduce((s, l) => s + l.length, 0);
    const fb = attempts.reduce(
      (s, l) => s + l.filter((a) => a.feedback).length,
      0,
    );
    return `${revealedCount}-${total}-${fb}-${phase}-${closingShown}`;
  }, [attempts, revealedCount, phase, closingShown]);

  return {
    phase,
    current,
    revealedCount,
    attempts,
    skipped,
    reveal,
    closingShown,
    reviewing,
    exhausted,
    flowKey,
    start,
    submitAnswer,
    retry,
    goNext,
    reanswer,
    cancelReview,
    jumpTo,
    revealText,
    averageFor,
  };
}

export type ScenarioChatState = ReturnType<typeof useScenarioChat>;
