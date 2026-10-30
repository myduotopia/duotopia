/**
 * useScenarioChat — 情境對話「訊息對話式」作答的狀態機（#1133）。
 *
 * 從 ScenarioChatActivity 拆出來，主元件只管版面。主流程：
 *   intro →（開始）→ aiTyping → awaitingAnswer（第 1 題）
 *   →（送出）→ awaitingFeedback → feedbackShown →（再試一次）awaitingAnswer
 *   ／（下一題）aiTyping → … → finished
 *
 * - 按「開始對話」直接問第 1 題；沒有 AI 開場複述（第 3 輪拿掉，作答要求已在開始前的卡片上）。
 * - 題目一題一題冒出：揭露前先顯示「輸入中…」TYPING_MS。
 * - 題目自動播放：新題出現、下一題、老師跳題時播一次；正在回頭重答時不播（免得錄進去），
 *   老師跳題先停掉正在唸的內容。
 * - 每題最多 maxAttempts 次；目前這題用完停 AUTO_NEXT_MS 自動進下一題。
 * - 重答（retry）：作答中或結束後，任何已出現、還沒答滿的題目都能按「再試一次」回頭答，
 *   不影響主流程（主流程的計時器照跑）。新回答與建議接在該題原有紀錄下方；
 *   建議回來（或按 ✕ 取消）後 `retryReturn` 會變，由畫面捲回原本進行中的題目。
 *   已答滿的題目任何方式（點點、再試一次、老師跳題）都不可再作答，只能重聽。
 * - 老師預覽可跳題（jumpTo）：往後跳時中間未出現的題目標「略過」；往回跳保留紀錄、
 *   從該題往下流。跳題會丟掉還在等 AI 建議的那筆回答（不佔次數）。
 * - 自動朗讀出錯（或沒有英文語音）時，該題英文自動打開（#1158 E2）；正常朗讀維持先聽後看。
 * - 英／翻譯文字顯示（visible）可切換；`seen` 記錄是否點開過（收回不取消），回報給外層。
 *   翻譯（zh 欄位）只有 `translatable[i]` 為真的題目能開（老師開翻譯＋翻譯語言＝學生介面語言）。
 * - AI 建議以 adapters.getFeedback 注入；過期的回應（卸載／跳題後才回來）以 sessionRef 丟棄。
 * - 卸載時：停止朗讀、清計時器、revoke 所有錄音 blob URL。
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

/** 回頭重答中的題目；answering＝等學生回答，waiting＝等 AI 建議 */
export interface RetryState {
  index: number;
  status: "answering" | "waiting";
}

interface Options {
  items: ScenarioChatItem[];
  adapters: ScenarioChatAdapters;
  maxAttempts: number;
  textDefaultHidden: boolean;
  /** 每題能不能看翻譯（老師開翻譯＋翻譯語言＝學生介面語言＋有翻譯文字） */
  translatable: boolean[];
  /** 回報「是否點開過文字」紀錄 */
  onRevealChange?: (seen: TextRevealState[]) => void;
}

const revokeAnswer = (a: ScenarioAttempt) => {
  if (a.answer.audioUrl) URL.revokeObjectURL(a.answer.audioUrl);
};

export function useScenarioChat({
  items,
  adapters,
  maxAttempts,
  textDefaultHidden,
  translatable,
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
  const initialText = () =>
    items.map(() => ({ en: !textDefaultHidden, zh: false }));
  const [visible, setVisible] = useState<TextRevealState[]>(initialText);
  const [seen, setSeen] = useState<TextRevealState[]>(initialText);
  const [closingShown, setClosingShown] = useState(false);
  const [retry, setRetry] = useState<RetryState | null>(null);
  /** 重答結束的訊號：tick 變就捲回；delayed＝有新建議，先讓學生看一下再捲 */
  const [retryReturn, setRetryReturn] = useState({ tick: 0, delayed: false });

  const sessionRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const adaptersRef = useRef(adapters);
  adaptersRef.current = adapters;
  const attemptsRef = useRef(attempts);
  attemptsRef.current = attempts;
  const retryRef = useRef(retry);
  retryRef.current = retry;

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  // 卸載（含 sample 重置）：丟棄所有進行中的回呼、停止朗讀、釋放錄音
  useEffect(
    () => () => {
      sessionRef.current += 1;
      clearTimers();
      adaptersRef.current.stopSpeech?.();
      attemptsRef.current.forEach((list) => list.forEach(revokeAnswer));
    },
    [clearTimers],
  );

  const later = useCallback((fn: () => void, ms: number) => {
    const session = sessionRef.current;
    const id = setTimeout(() => {
      if (session === sessionRef.current) fn();
    }, ms);
    timersRef.current.push(id);
  }, []);

  useEffect(() => {
    onRevealChange?.(seen);
  }, [seen, onRevealChange]);

  /**
   * 自動朗讀第 i 題。朗讀實際出錯（或沒有英文語音）時直接打開這題的英文，免得「先聽後看」
   * 變成看不到也聽不到；不算學生自己點開，`seen` 不記（#1158 E2）。過期（卸載／跳題）的錯誤丟棄。
   */
  const speakItem = useCallback(
    (i: number) => {
      const session = sessionRef.current;
      adaptersRef.current.speak(items[i].text, {
        onError: () => {
          if (session !== sessionRef.current) return;
          setVisible((prev) =>
            prev.map((v, j) => (j === i && !v.en ? { ...v, en: true } : v)),
          );
        },
      });
    },
    [items],
  );

  /** 「輸入中…」後揭露第 i 題並自動播一次（正在回頭重答時不播，免得錄進去） */
  const typeThenReveal = useCallback(
    (i: number) => {
      setPhase("aiTyping");
      later(() => {
        setRevealedCount((c) => Math.max(c, i + 1));
        setCurrent(i);
        setPhase("awaitingAnswer");
        if (!retryRef.current) speakItem(i);
      }, TYPING_MS);
    },
    [speakItem, later],
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

  const isExhausted = useCallback(
    (i: number) => (attemptsRef.current[i]?.length ?? 0) >= maxAttempts,
    [maxAttempts],
  );

  const goNext = useCallback(() => {
    // 老師往回跳過：後面已出現的題目直接接著答，答滿的跳過
    let nextIdx = current + 1;
    while (nextIdx < revealedCount && isExhausted(nextIdx)) nextIdx += 1;
    if (nextIdx >= n) {
      finishAll();
    } else if (nextIdx < revealedCount) {
      setCurrent(nextIdx);
      setPhase("awaitingAnswer");
      if (!retryRef.current) speakItem(nextIdx);
    } else {
      typeThenReveal(nextIdx);
    }
  }, [
    current,
    n,
    revealedCount,
    speakItem,
    isExhausted,
    finishAll,
    typeThenReveal,
  ]);

  const submitAnswer = useCallback(
    (answer: ScenarioAnswer) => {
      const r = retryRef.current;
      const isRetry = r !== null && r.status === "answering";
      const q = isRetry ? r.index : current;
      const attemptIndex = attemptsRef.current[q].length;
      if (attemptIndex >= maxAttempts) return;
      setAttempts((prev) =>
        prev.map((list, i) => (i === q ? [...list, { answer }] : list)),
      );
      if (isRetry) setRetry({ index: q, status: "waiting" });
      else setPhase("awaitingFeedback");
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
          if (isRetry) {
            setRetry(null);
            setRetryReturn((s) => ({ tick: s.tick + 1, delayed: true }));
          } else {
            setPhase("feedbackShown");
          }
        })
        .catch(() => {
          if (session !== sessionRef.current) return;
          // 建議取得失敗：這次作答不佔次數，還原狀態讓使用者重新作答
          setAttempts((prev) =>
            prev.map((list, i) =>
              i === q ? list.filter((_, j) => j !== attemptIndex) : list,
            ),
          );
          revokeAnswer({ answer });
          if (isRetry) setRetry({ index: q, status: "answering" });
          else setPhase("awaitingAnswer");
        });
    },
    [current, items, maxAttempts],
  );

  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;

  // 目前這題用完次數 → 停一下自動進下一題
  const exhausted = (attempts[current]?.length ?? 0) >= maxAttempts;
  useEffect(() => {
    if (phase === "feedbackShown" && exhausted) {
      later(() => goNextRef.current(), AUTO_NEXT_MS);
    }
    // 只在進入 feedbackShown 時排一次；goNext 透過 ref 取最新版本
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, exhausted]);

  /**
   * 第 i 題能不能按「再試一次」：已出現、有建議、沒答滿；
   * 目前這題正在作答／等建議時不算（底部輸入區本來就在答它）；
   * 另一題重答正在等建議時暫時不行（處理中）。
   */
  const canRetry = useCallback(
    (i: number) => {
      if (phase === "intro" || i >= revealedCount) return false;
      const list = attempts[i];
      if (list.length === 0 || list.length >= maxAttempts) return false;
      if (!list[list.length - 1].feedback) return false;
      if (
        i === current &&
        (phase === "awaitingAnswer" || phase === "awaitingFeedback")
      )
        return false;
      if (retry?.index === i) return false;
      return true;
    },
    [phase, revealedCount, attempts, maxAttempts, current, retry],
  );

  const retryBusy = retry?.status === "waiting";

  /** 再試一次：目前這題看完建議 → 主流程重答；其他題（或結束後）→ 回頭重答 */
  const retryItem = useCallback(
    (i: number) => {
      if (!canRetry(i) || retryBusy) return;
      if (i === current && phase === "feedbackShown") {
        setRetry(null);
        setPhase("awaitingAnswer");
        return;
      }
      setRetry({ index: i, status: "answering" });
    },
    [canRetry, retryBusy, current, phase],
  );

  const cancelRetry = useCallback(() => {
    if (retryRef.current?.status !== "answering") return;
    setRetry(null);
    setRetryReturn((s) => ({ tick: s.tick + 1, delayed: false }));
  }, []);

  /**
   * 老師預覽：跳到第 i 題。答滿的題目不可再作答 → 回傳 false（畫面只捲過去）。
   * 先停掉正在唸的內容；跳題會取消重答，並播放目標題（老師主動跳題，播放屬預期）。
   */
  const jumpTo = useCallback(
    (i: number): boolean => {
      adaptersRef.current.stopSpeech?.();
      if (i < revealedCount && isExhausted(i)) return false;
      sessionRef.current += 1;
      clearTimers();
      setRetry(null);
      setClosingShown(false);
      // 還在等 AI 建議的回答作廢（不佔次數）
      const pending = attemptsRef.current.flat().filter((a) => !a.feedback);
      if (pending.length > 0) {
        pending.forEach(revokeAnswer);
        setAttempts((prev) =>
          prev.map((list) => list.filter((a) => a.feedback)),
        );
      }
      if (i < revealedCount) {
        setCurrent(i);
        setPhase("awaitingAnswer");
        speakItem(i);
        return true;
      }
      setSkipped((prev) =>
        prev.map((s, j) => s || (j >= revealedCount && j < i)),
      );
      setRevealedCount(i);
      typeThenReveal(i);
      return true;
    },
    [revealedCount, speakItem, isExhausted, clearTimers, typeThenReveal],
  );

  /** 英／翻譯文字切換：收起英文時翻譯一起收；翻譯要英文開著、且本題可翻譯才能開 */
  const toggleText = useCallback(
    (i: number, which: "en" | "zh") => {
      const cur = visible[i];
      if (!cur) return;
      if (which === "zh" && (!translatable[i] || !cur.en)) return;
      const next: TextRevealState =
        which === "en"
          ? { en: !cur.en, zh: cur.en ? false : cur.zh }
          : { ...cur, zh: !cur.zh };
      setVisible((prev) => prev.map((v, j) => (j === i ? next : v)));
      if (next[which]) {
        setSeen((prev) =>
          prev.map((s, j) => (j === i ? { ...s, [which]: true } : s)),
        );
      }
    },
    [visible, translatable],
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
    visible,
    seen,
    closingShown,
    retry,
    retryBusy,
    retryReturn,
    exhausted,
    flowKey,
    start,
    submitAnswer,
    goNext,
    canRetry,
    retryItem,
    cancelRetry,
    jumpTo,
    toggleText,
    averageFor,
  };
}

export type ScenarioChatState = ReturnType<typeof useScenarioChat>;
