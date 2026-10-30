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
 * - 求助（AI 回 kind=phrase／model_answer，#1158）不算次數（usedAttempts），回來後直接回到
 *   作答（主流程 awaitingAnswer、重答維持 answering），不出現「再試一次／下一題」。
 *   每題求助最多 MAX_HELP_PER_ITEM 次；之後再回求助就當正式作答（計次、顯示一般建議），
 *   與後端一致（後端第 4 次起不退額度、回 kind=feedback；這裡再擋一層，mock／舊回應也一樣）。
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
 * - 暫停（paused，#1158 修正 E3 手機橫放）：「輸入中…」時間到但正在暫停 → 題目先不出、不朗讀
 *   （維持「輸入中…」），轉回直立才出題並朗讀；暫停中要自動朗讀的（例如自動進下一題）也等轉回才唸。
 * - 接著上次進度（#1158 E-4）：`priorAttempts > 0`（至少一次正式作答，#1158 修正 E4）＝上次答過
 *   （restored）；只求助或取建議失敗的題目不算，重新進入後仍會被問。
 *   老師已通過（`teacherPassed`）的題目視同答滿：不再問、不能再試（畫面標「老師已通過」）；
 *   學生沒答、老師就通過的也算答過（answered，#1158 修正 E4b）。
 *   按「開始對話」後，從第一題「沒答過、也沒答滿」的題目開始問（會朗讀）；它前面的題目一起出現，
 *   以紀錄呈現（題目＋上次的錄音，沒有 AI 建議，見 ChatTranscript）。之後主流程往下走時，
 *   上次答過的題目同樣直接以紀錄出現、不再問。全部都答過 → 直接到「提交作業」（finished）。
 *   次數以伺服器為準：`priorAttempts`（ai_analysis_count）＋本次正式作答＝已用次數；
 *   求助上限同理加 `priorHelp`。上次答過、還有次數的題目可以「再試一次」（回頭重答）。
 * - 最後一步（#1158 E-4 提交按鈕）：目前這題之後已經沒有要問的題目（atLastStep）時，正式回答的
 *   建議回來就直接收尾（「輸入中…」→ 熊熊「全部答完了…」→ finished，底部出現綠色提交鈕），
 *   不再停在「看建議」等學生按「下一題」。這題若已答滿，照舊顯示「已達 N 次，即將結束對話」
 *   後自動收尾。收尾後仍可在建議氣泡按「再試一次」回頭重答，答完回到可提交。
 * - 卸載時：停止朗讀、清計時器、revoke 所有錄音 blob URL。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ScenarioAnswer,
  ScenarioAttempt,
  ScenarioChatAdapters,
  ScenarioChatItem,
  ScenarioFeedback,
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
  /** 暫停出題與自動朗讀（手機橫放，#1158 修正 E3）；轉回 false 時補出題／補唸 */
  paused?: boolean;
}

const revokeAnswer = (a: ScenarioAttempt) => {
  if (a.answer.audioUrl) URL.revokeObjectURL(a.answer.audioUrl);
};

/** 求助（問某個字怎麼說／不會答，#1158）：不評、不算作答次數 */
export const isHelpFeedback = (f?: ScenarioFeedback): boolean =>
  f?.kind === "phrase" || f?.kind === "model_answer";

/** 每題最多幾次求助（與後端 MAX_HELP_PER_ITEM 一致，#1158 E2b） */
export const MAX_HELP_PER_ITEM = 3;

/** 這題用掉幾次求助 */
export const helpCount = (list: ScenarioAttempt[] | undefined): number =>
  (list ?? []).filter((a) => isHelpFeedback(a.feedback)).length;

/**
 * 求助次數用完後還回求助 → 當正式作答（verdict 沒有就補 improve）。後端已經這樣做，
 * 這裡保證前端計次與顯示一定一致。
 */
export const capHelpFeedback = (
  feedback: ScenarioFeedback,
  helpUsedBefore: number,
): ScenarioFeedback =>
  isHelpFeedback(feedback) && helpUsedBefore >= MAX_HELP_PER_ITEM
    ? { ...feedback, kind: "feedback", verdict: feedback.verdict ?? "improve" }
    : feedback;

/**
 * 這題用掉的作答次數：求助不算；還在等建議的先算（回來是求助就不算了）。
 * maxAttempts 一律跟這個比（後端同樣把求助的額度退回，兩邊一致）。
 */
export const usedAttempts = (list: ScenarioAttempt[] | undefined): number =>
  (list ?? []).filter((a) => !isHelpFeedback(a.feedback)).length;

/**
 * 上次已答過：至少一次正式作答（伺服器 ai_analysis_count > 0，#1158 修正 E4）。
 * 只求助、或取建議失敗（不佔次數）的題目不算，重新進入後仍會被問。
 */
export const isRestored = (item: ScenarioChatItem | undefined): boolean =>
  (item?.priorAttempts ?? 0) > 0;

/** 老師已通過：不再問、不能再試（#1158 修正 E4） */
const isTeacherPassed = (item: ScenarioChatItem | undefined): boolean =>
  item?.teacherPassed === true;

export function useScenarioChat({
  items,
  adapters,
  maxAttempts,
  textDefaultHidden,
  translatable,
  onRevealChange,
  paused = false,
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
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  /** 暫停中延後的出題／朗讀（題號） */
  const pendingRevealRef = useRef<number | null>(null);
  const pendingSpeakRef = useRef<number | null>(null);

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
      if (pausedRef.current) {
        pendingSpeakRef.current = i;
        return;
      }
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

  /** 揭露第 i 題並自動播一次（正在回頭重答時不播，免得錄進去） */
  const revealItem = useCallback(
    (i: number) => {
      setRevealedCount((c) => Math.max(c, i + 1));
      setCurrent(i);
      setPhase("awaitingAnswer");
      if (!retryRef.current) speakItem(i);
    },
    [speakItem],
  );

  /** 「輸入中…」後揭露第 i 題；暫停中（手機橫放）先不出，等轉回直立 */
  const typeThenReveal = useCallback(
    (i: number) => {
      setPhase("aiTyping");
      later(() => {
        if (pausedRef.current) {
          pendingRevealRef.current = i;
          return;
        }
        revealItem(i);
      }, TYPING_MS);
    },
    [revealItem, later],
  );

  // 暫停結束：補出暫停中該出的題目（會一併朗讀），或補唸該唸的題目
  useEffect(() => {
    if (paused) return;
    const reveal = pendingRevealRef.current;
    const speak = pendingSpeakRef.current;
    pendingRevealRef.current = null;
    pendingSpeakRef.current = null;
    if (reveal !== null) revealItem(reveal);
    else if (speak !== null) speakItem(speak);
  }, [paused, revealItem, speakItem]);

  const finishAll = useCallback(() => {
    setPhase("aiTyping");
    later(() => {
      setClosingShown(true);
      setPhase("finished");
    }, TYPING_MS);
  }, [later]);

  /** 第 i 題已用掉的正式作答次數：上次（伺服器）＋本次（#1158 E-4） */
  const usedFor = useCallback(
    (i: number, list: ScenarioAttempt[][] = attemptsRef.current) =>
      (items[i]?.priorAttempts ?? 0) + usedAttempts(list[i]),
    [items],
  );

  /** 不能再作答：答滿了，或老師已通過（#1158 修正 E4） */
  const isExhausted = useCallback(
    (i: number) => usedFor(i) >= maxAttempts || isTeacherPassed(items[i]),
    [usedFor, maxAttempts, items],
  );

  /** 主流程不必再問的題目：不能再作答，或上次已答過（以紀錄呈現，#1158 E-4） */
  const isSettled = useCallback(
    (i: number) => isRestored(items[i]) || isExhausted(i),
    [items, isExhausted],
  );

  const start = useCallback(() => {
    if (n === 0) return;
    let first = 0;
    while (first < n && isSettled(first)) first += 1;
    if (first >= n) {
      // 全部都答過：題目全部以紀錄列出，直接到「提交作業」（#1158 E-4）
      setRevealedCount(n);
      setCurrent(n - 1);
      setClosingShown(true);
      setPhase("finished");
      return;
    }
    // 前面答過的題目以紀錄出現，從第一題沒答的開始問
    setRevealedCount(first);
    typeThenReveal(first);
  }, [n, isSettled, typeThenReveal]);

  /**
   * 第 from 題之後下一題要問的題號（沒有＝n）：已出現的題目（老師往回跳過）答滿的跳過；
   * 還沒出現的、上次已答過的也跳過，直接以紀錄出現（#1158 E-4）。
   */
  const nextAskable = useCallback(
    (from: number, revealed: number) => {
      let nextIdx = from + 1;
      while (
        nextIdx < n &&
        (nextIdx < revealed ? isExhausted(nextIdx) : isSettled(nextIdx))
      )
        nextIdx += 1;
      return nextIdx;
    },
    [n, isExhausted, isSettled],
  );
  const nextAskableRef = useRef(nextAskable);
  nextAskableRef.current = nextAskable;
  const revealedRef = useRef(revealedCount);
  revealedRef.current = revealedCount;

  /** 收尾：剩下的（上次答過的）題目以紀錄出現 →「輸入中…」→ 結尾語 → 可提交 */
  const finishFlow = useCallback(() => {
    setRevealedCount(n);
    finishAll();
  }, [n, finishAll]);

  const goNext = useCallback(() => {
    const nextIdx = nextAskable(current, revealedCount);
    if (nextIdx >= n) {
      finishFlow();
    } else if (nextIdx < revealedCount) {
      setCurrent(nextIdx);
      setPhase("awaitingAnswer");
      if (!retryRef.current) speakItem(nextIdx);
    } else {
      setRevealedCount(nextIdx);
      typeThenReveal(nextIdx);
    }
  }, [
    current,
    n,
    revealedCount,
    speakItem,
    nextAskable,
    finishFlow,
    typeThenReveal,
  ]);

  const submitAnswer = useCallback(
    (answer: ScenarioAnswer) => {
      const r = retryRef.current;
      const isRetry = r !== null && r.status === "answering";
      const q = isRetry ? r.index : current;
      // slot＝這筆在紀錄裡的位置（含求助）；attemptIndex＝第幾次正式作答（不含求助）
      const slot = attemptsRef.current[q].length;
      // 含上次（伺服器計數）用掉的次數（#1158 E-4）
      const attemptIndex = usedFor(q);
      if (attemptIndex >= maxAttempts || isTeacherPassed(items[q])) return;
      setAttempts((prev) =>
        prev.map((list, i) => (i === q ? [...list, { answer }] : list)),
      );
      if (isRetry) setRetry({ index: q, status: "waiting" });
      else setPhase("awaitingFeedback");
      const session = sessionRef.current;
      adaptersRef.current
        .getFeedback(items[q], answer, attemptIndex)
        .then((raw) => {
          if (session !== sessionRef.current) return;
          const feedback = capHelpFeedback(
            raw,
            (items[q].priorHelp ?? 0) +
              helpCount(attemptsRef.current[q].slice(0, slot)),
          );
          setAttempts((prev) =>
            prev.map((list, i) =>
              i === q
                ? list.map((a, j) => (j === slot ? { ...a, feedback } : a))
                : list,
            ),
          );
          if (isHelpFeedback(feedback)) {
            // 求助：學生直接用底部錄音回答（不需要「再試一次」），重答中就留在重答
            if (isRetry) setRetry({ index: q, status: "answering" });
            else setPhase("awaitingAnswer");
          } else if (isRetry) {
            setRetry(null);
            setRetryReturn((s) => ({ tick: s.tick + 1, delayed: true }));
          } else if (
            nextAskableRef.current(q, revealedRef.current) >= n &&
            attemptIndex + 1 < maxAttempts
          ) {
            // 最後一步：直接收尾到可提交（答滿的照舊先顯示「即將結束對話」再自動收尾）
            finishFlow();
          } else {
            setPhase("feedbackShown");
          }
        })
        .catch(() => {
          if (session !== sessionRef.current) return;
          // 建議取得失敗：這次作答不佔次數，還原狀態讓使用者重新作答
          setAttempts((prev) =>
            prev.map((list, i) =>
              i === q ? list.filter((_, j) => j !== slot) : list,
            ),
          );
          revokeAnswer({ answer });
          if (isRetry) setRetry({ index: q, status: "answering" });
          else setPhase("awaitingAnswer");
        });
    },
    [current, items, maxAttempts, usedFor, n, finishFlow],
  );

  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;

  // 目前這題用完次數 → 停一下自動進下一題
  const exhausted = usedFor(current, attempts) >= maxAttempts;
  useEffect(() => {
    if (phase === "feedbackShown" && exhausted) {
      later(() => goNextRef.current(), AUTO_NEXT_MS);
    }
    // 只在進入 feedbackShown 時排一次；goNext 透過 ref 取最新版本
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, exhausted]);

  /**
   * 第 i 題能不能按「再試一次」：已出現、有建議（或上次已答過、本次還沒答，#1158 E-4）、沒答滿；
   * 目前這題正在作答／等建議時不算（底部輸入區本來就在答它）；
   * 另一題重答正在等建議時暫時不行（處理中）。
   */
  const canRetry = useCallback(
    (i: number) => {
      if (phase === "intro" || i >= revealedCount) return false;
      const list = attempts[i];
      if (usedFor(i, attempts) >= maxAttempts) return false;
      if (isTeacherPassed(items[i])) return false;
      if (list.length === 0) {
        if (!isRestored(items[i])) return false;
      } else if (!list[list.length - 1].feedback) return false;
      if (
        i === current &&
        (phase === "awaitingAnswer" || phase === "awaitingFeedback")
      )
        return false;
      if (retry?.index === i) return false;
      return true;
    },
    [
      phase,
      revealedCount,
      attempts,
      maxAttempts,
      current,
      retry,
      usedFor,
      items,
    ],
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
      pendingRevealRef.current = null;
      pendingSpeakRef.current = null;
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
        prev.map(
          (s, j) => s || (j >= revealedCount && j < i && !isRestored(items[j])),
        ),
      );
      setRevealedCount(i);
      typeThenReveal(i);
      return true;
    },
    [revealedCount, speakItem, isExhausted, clearTimers, typeThenReveal, items],
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
        .filter((a) => !isHelpFeedback(a.feedback))
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

  /** 目前這題之後已經沒有要問的題目（最後一步）：答滿時的提示改「即將結束對話」 */
  const atLastStep = nextAskable(current, revealedCount) >= n;

  /** 每題上次答過沒（至少一次正式作答，#1158 修正 E4）；ChatTranscript 據此放「上次的回答」 */
  const restored = useMemo(() => items.map((it) => isRestored(it)), [items]);

  /**
   * 每題答過沒：本次至少一次正式作答，或上次已答過（#1158 E-4），或老師已通過
   * （學生沒答、老師就通過也算，方格綠、提交前不列未答，#1158 修正 E4b）
   */
  const answered = useMemo(
    () =>
      attempts.map(
        (list, i) =>
          usedAttempts(list) > 0 || restored[i] || isTeacherPassed(items[i]),
      ),
    [attempts, restored, items],
  );

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
    atLastStep,
    restored,
    answered,
    usedFor,
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
