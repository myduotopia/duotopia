/**
 * ScenarioChatActivity — 情境對話「訊息對話式」作答畫面主體（#1133）。
 *
 * 只管版面、捲動，並把狀態機（useScenarioChat）接到訊息流（ChatTranscript）與輸入區：
 * - 開始前：作答要求卡（藍）→ 情境卡（紫，情境 C 沒有）→ 底部「開始對話」；
 *   按下後直接問第 1 題（沒有 AI 開場複述）。
 *   手機／平板直式顯示在對話區；平板橫式／電腦（≥ lg）放左欄、常駐展開（獨立捲動）。
 * - 開始後（< lg，含作答要求倒數中）：兩張卡收合成上方一條 `[📋 作答要求] [📖 情境]` 小膠囊，點哪個展開哪個。
 * - layout="compact"（派發預覽欄，#1158 E2）：不管螢幕多寬都用單欄（上面那兩條的 < lg 版面），
 *   因為預覽欄本身很窄，用螢幕寬度判斷會在寬螢幕排出兩欄、擠成一團。
 * - 題號：#1158 E 段拿掉對話內的小點點（QuestionDots）和標題列的「N / M」，改由外層作答頁
 *   的題號方格切題。本元件用 `onNavChange` 往外回報「開始了沒／已出現幾題／目前第幾題」，
 *   外層點方格時呼叫 `navigateRef.current(i)`：學生只捲到那一題；老師預覽開始對話後跳題
 *   （沿用「略過」邏輯）。題目泡泡裡的「第 N 題」保留，往回捲時用來定位。
 * - 再試一次：任何已出現、沒答滿的題目都能回頭重答；輸入區上方出現「正在重答第 N 題 ✕」。
 *   AI 建議回來後先停在該題讓學生看一下（RETURN_DELAY_MS），再自動捲回原本進行中的題目；
 *   按 ✕ 取消則立刻捲回。
 * - 新訊息自動捲到底；使用者往上捲時不強制捲動，改顯示「↓ 新訊息」提示。
 *   內容高度變化（例如題目圖片晚載入）也會在貼底狀態下再捲一次（ResizeObserver）；
 *   重答中與重答後捲回計時中不做，免得打斷捲到該題／停留讓學生看建議。
 * - 翻譯鈕：老師開翻譯（settings.showTranslation）＋題目翻譯語言＝學生介面語言
 *   （uiLanguage，`zh` 開頭＝中文；英文介面沒有翻譯鈕）＋本題有翻譯文字，才算可翻譯；
 *   英文打開後才出現（RevealCapsules）。uiLanguage 不傳時用 i18n 目前語言。
 * - 高度＝外層給的高度（h-full），不自己用 100dvh：嵌在作答頁外框裡時只佔外框剩下的
 *   高度，不會和頁面各有一層捲動，也不會被頁面頂部列蓋住（#1158 E1）。呼叫端要給有高度的容器。
 *   底部輸入區留 safe-area。
 * - 語音錄音區（#1158 E3）固定在最下方、按鈕上半浮在對話區上（見 ReplyComposer）；作答中／等待中
 *   （isFloatingDock）捲動區底部多留空間、「↓ 新訊息」跟著上移，最新訊息不被擋住。等選「再試一次／
 *   下一題」時錄音區小字用短句（waitChooseShort）。
 *
 * - 沒有自己的標題列（#1158 E-3 拿掉「對話」那一列，手機上省高度）：作業標題在外框
 *   （作答頁頂部列／派發預覽欄標題）。
 * - 作答要求倒數（#1158 E-3）：有作答要求時，按「開始對話」先在對話最上方顯示熊熊「先看一下
 *   作答要求 👇」＋作答要求卡＋進度條「N 秒後開始」（RubricCountdown：5 秒，字多拉長，最多 12 秒），
 *   不能跳過；倒數中錄音區麥克風停用、小字「看完作答要求就開始」；倒數完才問第 1 題（自動朗讀）。
 *   朗讀解鎖（primeSpeech）仍在按下「開始對話」當下做；倒數後朗讀若仍被擋，走既有的逾時保底
 *   （自動打開英文）。沒有作答要求就直接問第 1 題。老師預覽一樣倒數。
 * - 手機橫放（#1158 E-3，usePhoneLandscape，以螢幕方向＋螢幕短邊判斷）：作答中整頁蓋提示
 *   （PhoneLandscapeOverlay；「錄音會作廢」小字只在語音作答且正在作答時顯示），停止朗讀、
 *   丟掉正在錄的錄音（ReplyComposer interrupted）、倒數暫停、暫停出題（useScenarioChat paused：
 *   「輸入中…」到了也先不出題，轉回直立才出題並朗讀）；轉回直立提示消失、狀態保留。老師預覽一樣擋。
 *   倒數的進度只在 RubricIntro 裡（這裡只記倒數中／倒數完），不讓整個畫面每 100ms 重繪。
 *
 * - 接著上次進度（#1158 E-4）：答到一半離開再進來，按「開始對話」（作答要求倒數照常）後，上次答過的
 *   題目（伺服器有錄音）以紀錄排在上方（題目＋上次的錄音），從第一題沒答的開始問；已答過的方格
 *   因為已出現而可點、捲到該題；還有次數的可「再試一次」（次數以伺服器 ai_analysis_count 為準）。
 *   全部都答過就直接到「提交作業」。規則在 useScenarioChat，紀錄外觀在 ChatTranscript。
 *
 * - 提交（#1158 E-4）：最後一題拿到建議就直接收尾，熊熊「全部答完了！確認後就可以提交囉 👇」，
 *   語音作答時底部錄音區位置換成綠色圓鈕＋上傳圖示（「提交作業」，同樣浮在半高底色條上）。
 *   老師預覽停用（灰色）並在底色條寫「預覽不會送出」。提交前的未答題檢查在呼叫端（onSubmit）。
 *
 * - 已提交唯讀（readOnly，#1158 E6）：不顯示「開始對話」與錄音區，改列出每題題目＋學生
 *   自己的錄音（SubmittedTranscript）；作答要求／情境卡照樣顯示。題號方格每題都能點、捲到該題。
 *
 * AI 建議與朗讀由 `adapters` 注入（sample 傳 mock；正式版之後接後端）。
 * 按「開始對話」時先呼叫 `adapters.primeSpeech`（點擊當下解鎖朗讀），第 1 題「輸入中…」後的
 * 自動朗讀才不會被瀏覽器擋掉（先聽後看，#1158 E-2）。
 * 學生畫面不顯示分數；老師預覽（settings.isPreviewMode）多「預覽模式」標示、跳題、
 * 參考答案開關與 mock 分數；「提交作業」停用並寫明「預覽不會送出」（#1158 E2）。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { ArrowDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ChatTranscript } from "./ChatTranscript";
import { SubmittedTranscript } from "./SubmittedTranscript";
import { ReplyComposer, type ComposerState } from "./ReplyComposer";
import {
  InfoStrip,
  RubricCard,
  ScenarioContextCard,
  hasContextCard,
  type InfoPanel,
} from "./ScenarioContextCard";
import { translationMatchesUi } from "./translationLanguage";
import {
  PhoneLandscapeOverlay,
  usePhoneLandscape,
} from "./PhoneLandscapeOverlay";
import { RubricIntro } from "./RubricCountdown";
import { useScenarioChat } from "./useScenarioChat";
import type {
  ScenarioChatAdapters,
  ScenarioChatContext,
  ScenarioChatItem,
  ScenarioChatSettings,
  TextRevealState,
} from "./types";

interface Props {
  context: ScenarioChatContext;
  items: ScenarioChatItem[];
  settings: ScenarioChatSettings;
  adapters: ScenarioChatAdapters;
  onSubmit: () => void;
  /** 回報每題「是否點開過文字」 */
  onRevealChange?: (seen: TextRevealState[]) => void;
  /**
   * 回報每題「有沒有答過」（至少送出過一次答案）。
   *
   * 給呼叫端擋「略過每一題就送出」用 —— 學生端的送出檢查讀的是作業頁自己的
   * `activities` state，而情境對話的錄音是在 adapters 裡上傳的、不會回寫那份 state，
   * 所以答題進度只有這個元件知道（#1140 A 項）。
   */
  onProgressChange?: (answered: boolean[]) => void;
  /**
   * 學生介面語言（例如 "zh-TW"、"en"），決定翻譯鈕是否出現；不傳＝i18n 目前語言。
   * sample 用控制面板的值，正式版傳學生實際介面語言。
   */
  uiLanguage?: string;
  /**
   * 版面：`auto`（預設）＝依螢幕寬度，≥ lg 左欄放作答要求／情境；
   * `compact`＝一律單欄（派發預覽欄用，#1158 E2）。
   */
  layout?: "auto" | "compact";
  /** 對話進度改變時回報給外層題號方格（#1158 E 段） */
  onNavChange?: (nav: ScenarioChatNav) => void;
  /**
   * 外層題號方格點了某題時呼叫 `navigateRef.current(i)`（0 起算）。
   * 學生：只捲到那一題；老師預覽且已開始：跳題。還沒出現的題目由外層擋掉。
   */
  navigateRef?: MutableRefObject<((index: number) => void) | null>;
  /**
   * 已提交（學生重開已交的作業）：只看作答紀錄，不能再作答（#1158 E6）。
   * 錄音來源是 items[i].submittedAudioUrl。
   */
  readOnly?: boolean;
}

/** 給外層題號方格的對話進度（#1158 E 段） */
export interface ScenarioChatNav {
  /** 按過「開始對話」了沒 */
  started: boolean;
  /** 已出現在對話裡的題數 */
  revealedCount: number;
  /** 目前進行中的題目（0 起算）；開始前為 null */
  current: number | null;
  /** 老師預覽且已開始：還沒出現的題目也能點（跳題） */
  canJump: boolean;
}

const NEAR_BOTTOM_PX = 80;
const RETURN_DELAY_MS = 2500;

export function ScenarioChatActivity({
  context,
  items,
  settings,
  adapters,
  onSubmit,
  onRevealChange,
  onProgressChange,
  uiLanguage,
  layout = "auto",
  onNavChange,
  navigateRef,
  readOnly = false,
}: Props) {
  const { t, i18n } = useTranslation();
  const lang = uiLanguage ?? i18n.language ?? "";
  const translatable = useMemo(
    () =>
      items.map(
        (it) =>
          settings.showTranslation &&
          Boolean(it.translation) &&
          translationMatchesUi(it.translationLanguage, lang),
      ),
    [items, settings.showTranslation, lang],
  );
  // ── 手機橫放：蓋提示、停朗讀、丟錄音、倒數暫停、暫停出題（#1158 E-3） ──
  const phoneLandscape = usePhoneLandscape();
  const blocked = phoneLandscape && !readOnly;
  const chat = useScenarioChat({
    items,
    adapters,
    maxAttempts: settings.maxAttempts,
    textDefaultHidden: settings.textDefaultHidden,
    translatable,
    onRevealChange,
    paused: blocked,
  });
  const { phase, current, retry } = chat;

  // 答過＝這一題至少送出過一次正式回答（略過的題目 attempts 會是空的；求助不算，#1158），
  // 或上次已答過（伺服器有錄音，接著上次進度，#1158 E-4）
  const answered = chat.answered;
  const answeredKey = answered.join(",");
  useEffect(() => {
    onProgressChange?.(answered);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- answeredKey 代表內容變化
  }, [answeredKey, onProgressChange]);
  const isPreview = settings.isPreviewMode;
  const chatStarted = phase !== "intro";

  const adaptersRef = useRef(adapters);
  adaptersRef.current = adapters;
  useEffect(() => {
    if (blocked) adaptersRef.current.stopSpeech?.();
  }, [blocked]);

  // ── 作答要求倒數（#1158 E-3） ──
  const rubric = context.rubric?.trim() ? context.rubric : "";
  // off＝沒顯示；counting＝倒數中；done＝倒數完（卡片留在對話裡）
  const [rubricPhase, setRubricPhase] = useState<"off" | "counting" | "done">(
    "off",
  );
  const counting = rubricPhase === "counting";
  const chatStart = chat.start;
  const handleRubricDone = useCallback(() => {
    setRubricPhase("done");
    chatStart();
  }, [chatStart]);
  // 版面上的「開始了」：倒數中也算（收合成膠囊列、不顯示開始前的大卡片）
  const started = chatStarted || counting;

  const showScenario = hasContextCard(context);
  const hasLeft = showScenario || Boolean(context.rubric);
  const [infoOpen, setInfoOpen] = useState<InfoPanel>(null);

  // ── 捲動 ──
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
  /**
   * 貼底：新內容自動捲到底；使用者往上捲就取消，捲回底部再恢復。
   * 開始前不貼底，讓手機從最上方的作答要求卡開始看。
   */
  const stickRef = useRef(false);
  const lastTopRef = useRef(0);
  const lastRetryIdxRef = useRef<number | null>(null);
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasNew, setHasNew] = useState(false);
  const retryActiveRef = useRef(retry);
  retryActiveRef.current = retry;

  const registerBlock = useCallback((i: number, el: HTMLDivElement | null) => {
    blockRefs.current[i] = el;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setHasNew(false);
  }, []);

  const scrollToBlock = useCallback(
    (i: number, block: ScrollLogicalPosition) => {
      blockRefs.current[i]?.scrollIntoView({ behavior: "smooth", block });
    },
    [],
  );

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (near) {
      stickRef.current = true;
      setHasNew(false);
    } else if (el.scrollTop < lastTopRef.current - 2) {
      stickRef.current = false;
    }
    lastTopRef.current = el.scrollTop;
  };

  // 內容長高（圖片晚載入等）時，貼底狀態下再捲一次；重答中／捲回計時中不搶捲動
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const el = scrollRef.current;
      if (!el || !stickRef.current) return;
      if (retryActiveRef.current || returnTimerRef.current) return;
      el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (retry) lastRetryIdxRef.current = retry.index;
  }, [retry]);

  // 流程有新內容：重答中捲到該題底部；否則貼底就捲到底，不然提示「新訊息」
  useEffect(() => {
    if (phase === "intro") return;
    if (retry) {
      requestAnimationFrame(() => scrollToBlock(retry.index, "end"));
      return;
    }
    if (stickRef.current) {
      requestAnimationFrame(scrollToBottom);
    } else {
      setHasNew(true);
    }
    // 只在流程有新內容時觸發
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.flowKey]);

  const clearReturnTimer = () => {
    if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    returnTimerRef.current = null;
  };
  useEffect(() => clearReturnTimer, []);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const currentRef = useRef(current);
  currentRef.current = current;
  const revealedRef = useRef(chat.revealedCount);
  revealedRef.current = chat.revealedCount;

  /** 捲回原本進行中的題目（它通常就在最底下） */
  const returnToCurrent = useCallback(() => {
    const cur = currentRef.current;
    if (phaseRef.current === "finished" || cur >= revealedRef.current - 1) {
      scrollToBottom();
    } else {
      scrollToBlock(cur, "start");
      setHasNew(false);
    }
  }, [scrollToBottom, scrollToBlock]);

  // 重答結束：有新建議就先停在該題一下再捲回；取消則立刻捲回
  useEffect(() => {
    if (chat.retryReturn.tick === 0) return;
    setHasNew(false);
    clearReturnTimer();
    if (!chat.retryReturn.delayed) {
      returnToCurrent();
      return;
    }
    const idx = lastRetryIdxRef.current;
    if (idx !== null) {
      requestAnimationFrame(() => scrollToBlock(idx, "end"));
    }
    returnTimerRef.current = setTimeout(() => {
      returnTimerRef.current = null;
      returnToCurrent();
    }, RETURN_DELAY_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.retryReturn]);

  const handleRetry = (i: number) => {
    clearReturnTimer();
    chat.retryItem(i);
  };

  const canJump = isPreview && chatStarted;
  const handleNavigate = (i: number) => {
    if (i < 0 || i >= items.length) return;
    // 已提交：每題都列出來了，直接捲過去
    if (readOnly) {
      scrollToBlock(i, "start");
      return;
    }
    // 還沒出現的題目：學生與開始前的老師預覽都不能去（外層方格也會擋）
    if (i >= chat.revealedCount && !canJump) return;
    clearReturnTimer();
    if (!isPreview) {
      scrollToBlock(i, "start");
      return;
    }
    // 老師預覽：跳題（答滿的題目不可再作答，只捲過去）
    setInfoOpen(null);
    const jumped = chat.jumpTo(i);
    if (!jumped || i < chat.revealedCount) {
      requestAnimationFrame(() => scrollToBlock(i, "start"));
    } else {
      stickRef.current = true;
    }
  };
  // 每次 render 後換成最新的 handler（它讀的是當下的 chat 狀態）
  useEffect(() => {
    if (navigateRef) navigateRef.current = handleNavigate;
  });
  useEffect(
    () => () => {
      if (navigateRef) navigateRef.current = null;
    },
    [navigateRef],
  );

  // 回頭重答時，題號方格的「目前」標在重答的那一題（#1158 E-2 重答流程）
  const navCurrent =
    chatStarted && !readOnly
      ? (retry?.index ?? Math.min(current, items.length - 1))
      : null;
  // 已提交：每題都「已出現」，沒有目前題
  const navStarted = chatStarted || readOnly;
  const navRevealed = readOnly ? items.length : chat.revealedCount;
  useEffect(() => {
    onNavChange?.({
      started: navStarted,
      revealedCount: navRevealed,
      current: navCurrent,
      canJump,
    });
  }, [onNavChange, navStarted, navRevealed, navCurrent, canJump]);

  const handleStart = () => {
    // 點擊當下解鎖朗讀：第 1 題在「輸入中…」之後才自動唸（先聽後看，#1158 E-2）
    adapters.primeSpeech?.();
    setInfoOpen(null);
    stickRef.current = true;
    // 有作答要求：先倒數讓學生看完（不能跳過），倒數完才問第 1 題
    if (rubric) {
      setRubricPhase("counting");
      return;
    }
    chat.start();
  };

  // ── 底部輸入區狀態 ──
  let composerState: ComposerState;
  let waitingHint = "";
  if (retry) {
    composerState = retry.status === "answering" ? "answer" : "waiting";
    waitingHint = t("scenarioDialogue.chat.waitFeedback");
  } else if (counting) {
    composerState = "waiting";
    waitingHint = t("scenarioDialogue.chat.waitRubric");
  } else if (phase === "intro") composerState = "intro";
  else if (phase === "finished") composerState = "finished";
  else if (phase === "awaitingAnswer") composerState = "answer";
  else {
    composerState = "waiting";
    waitingHint =
      phase === "aiTyping"
        ? t("scenarioDialogue.chat.waitTyping")
        : phase === "awaitingFeedback"
          ? t("scenarioDialogue.chat.waitFeedback")
          : chat.exhausted
            ? chat.atLastStep
              ? t("scenarioDialogue.chat.waitAutoFinish")
              : t("scenarioDialogue.chat.waitAutoNext")
            : // 錄音區底色條右側的短句（#1158 E3）；完整說法在建議氣泡的按鈕上
              t("scenarioDialogue.chat.waitChooseShort");
  }
  // 語音錄音區浮在對話區底部（ReplyComposer -mt-9）：捲動區底部多留按鈕上半的高度，
  // 重答橫條也浮在上面時再多留一些（#1158 E3）
  const isFloatingDock =
    !readOnly &&
    settings.replyMode === "voice" &&
    (composerState === "answer" ||
      composerState === "waiting" ||
      composerState === "finished");

  // 寬螢幕兩欄只在 layout="auto" 時啟用；compact（派發預覽欄）一律單欄
  const wide = layout !== "compact";

  const fullCards = (
    <>
      {context.rubric && <RubricCard rubric={context.rubric} />}
      {showScenario && <ScenarioContextCard context={context} />}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50">
      <div
        className={cn(
          "mx-auto flex min-h-0 w-full flex-1 flex-col",
          !wide
            ? "max-w-2xl"
            : hasLeft
              ? "max-w-2xl lg:max-w-6xl lg:flex-row lg:gap-4 lg:px-4"
              : "max-w-2xl lg:max-w-3xl",
        )}
        data-layout={layout}
      >
        {hasLeft && wide && (
          <aside className="hidden min-h-0 space-y-3 overflow-y-auto py-4 lg:block lg:w-2/5">
            {fullCards}
          </aside>
        )}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {started && !readOnly && hasLeft && (
            <div
              className={cn(
                "shrink-0 border-b border-gray-200 px-3 py-3",
                wide && "lg:hidden",
              )}
            >
              <InfoStrip
                context={context}
                showScenario={showScenario}
                open={infoOpen}
                onOpenChange={setInfoOpen}
              />
            </div>
          )}

          <div className="flex min-h-0 flex-1">
            <div className="relative min-h-0 min-w-0 flex-1">
              <div
                ref={scrollRef}
                onScroll={onScroll}
                className={cn(
                  "h-full overflow-y-auto overflow-x-hidden px-3 py-4",
                  isFloatingDock && (retry ? "pb-28" : "pb-14"),
                )}
                aria-live="polite"
              >
                <div ref={contentRef} className="space-y-3">
                  {(!started || readOnly) && hasLeft && (
                    <div className={cn("space-y-3", wide && "lg:hidden")}>
                      {fullCards}
                    </div>
                  )}
                  {readOnly ? (
                    <SubmittedTranscript
                      items={items}
                      adapters={adapters}
                      translatable={translatable}
                      registerBlock={registerBlock}
                    />
                  ) : (
                    <ChatTranscript
                      chat={chat}
                      items={items}
                      settings={settings}
                      adapters={adapters}
                      translatable={translatable}
                      registerBlock={registerBlock}
                      onRetry={handleRetry}
                      rubricIntro={
                        rubricPhase !== "off" && rubric ? (
                          <RubricIntro
                            rubric={rubric}
                            counting={counting}
                            paused={blocked}
                            onDone={handleRubricDone}
                          />
                        ) : undefined
                      }
                    />
                  )}
                </div>
              </div>

              {hasNew && (
                <button
                  type="button"
                  onClick={scrollToBottom}
                  className={cn(
                    "absolute left-1/2 flex min-h-11 -translate-x-1/2 items-center gap-1 rounded-full bg-gray-900/80 px-4 text-sm text-white shadow-md",
                    isFloatingDock
                      ? retry
                        ? "bottom-28"
                        : "bottom-14"
                      : "bottom-3",
                  )}
                >
                  <ArrowDown className="h-4 w-4" />
                  {t("scenarioDialogue.chat.newMessages")}
                </button>
              )}
            </div>
          </div>

          {!readOnly && (
            <ReplyComposer
              key={retry ? `retry-${retry.index}` : "main"}
              state={composerState}
              replyMode={settings.replyMode}
              waitingHint={waitingHint}
              retryNo={retry ? retry.index + 1 : null}
              canCancelRetry={retry?.status === "answering"}
              onStart={handleStart}
              onSubmitAnswer={chat.submitAnswer}
              onCancelRetry={chat.cancelRetry}
              onSubmitAssignment={onSubmit}
              interrupted={blocked}
              submitDisabledReason={
                isPreview
                  ? t("scenarioDialogue.chat.previewNoSubmit")
                  : undefined
              }
            />
          )}
        </main>
      </div>

      {blocked && (
        <PhoneLandscapeOverlay
          showRecordingHint={
            settings.replyMode === "voice" && composerState === "answer"
          }
        />
      )}
    </div>
  );
}
