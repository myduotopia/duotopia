/**
 * ScenarioChatActivity — 情境對話「訊息對話式」作答畫面主體（#1133）。
 *
 * 只管版面、捲動，並把狀態機（useScenarioChat）接到訊息流（ChatTranscript）與輸入區：
 * - 開始前：作答要求卡（藍）→ 情境卡（紫，情境 C 沒有）→ 底部「開始對話」；
 *   按下後直接問第 1 題（沒有 AI 開場複述）。
 *   手機／平板直式顯示在對話區；平板橫式／電腦（≥ lg）放左欄、常駐展開（獨立捲動）。
 * - 開始後（< lg）：兩張卡收合成上方一條 `[📋 作答要求] [📖 情境]` 小膠囊，點哪個展開哪個。
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
 *
 * - 標題列（#1158 E1／E4）：作業標題只留一處 —— 外框（作答頁頂部列／派發預覽欄標題）有標題，
 *   這裡不再重複情境標題，只寫「對話」＋難度／預覽模式徽章。灰色系（紫色只留在情境卡標頭，
 *   減少色塊疊加）；圖示用對話框，不用麥克風（像錄音鍵，會被誤按）。
 *
 * - 已提交唯讀（readOnly，#1158 E6）：不顯示「開始對話」與錄音區，改列出每題題目＋學生
 *   自己的錄音（SubmittedTranscript）；作答要求／情境卡照樣顯示。題號方格每題都能點、捲到該題。
 *
 * AI 建議與朗讀由 `adapters` 注入（sample 傳 mock；正式版之後接後端）。
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
import { ArrowDown, MessagesSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
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
  const chat = useScenarioChat({
    items,
    adapters,
    maxAttempts: settings.maxAttempts,
    textDefaultHidden: settings.textDefaultHidden,
    translatable,
    onRevealChange,
  });
  const { phase, current, retry } = chat;

  // 答過＝這一題至少送出過一次答案（略過的題目 attempts 會是空的）
  const answeredKey = chat.attempts.map((list) => list.length > 0).join(",");
  useEffect(() => {
    onProgressChange?.(chat.attempts.map((list) => list.length > 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- answeredKey 代表內容變化
  }, [answeredKey, onProgressChange]);
  const isPreview = settings.isPreviewMode;
  const started = phase !== "intro";

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

  const canJump = isPreview && started;
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

  const navCurrent =
    started && !readOnly ? Math.min(current, items.length - 1) : null;
  // 已提交：每題都「已出現」，沒有目前題
  const navStarted = started || readOnly;
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
    setInfoOpen(null);
    stickRef.current = true;
    chat.start();
  };

  // ── 底部輸入區狀態 ──
  let composerState: ComposerState;
  let waitingHint = "";
  if (retry) {
    composerState = retry.status === "answering" ? "answer" : "waiting";
    waitingHint = t("scenarioDialogue.chat.waitFeedback");
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
            ? t("scenarioDialogue.chat.waitAutoNext")
            : t("scenarioDialogue.chat.waitChoose");
  }

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
      {/* 標題列（灰色系、不重複作業標題）；題號改由外層作答頁的方格負責（#1158 E 段） */}
      <header className="shrink-0 border-b border-gray-200 bg-gray-50">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-600">
            <MessagesSquare className="h-4 w-4" aria-hidden />
          </span>
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-gray-700">
            {t("scenarioDialogue.chat.conversation")}
          </h2>
          {context.level && (
            <Badge variant="outline" className="shrink-0">
              {context.level}
            </Badge>
          )}
          {isPreview && (
            <Badge className="shrink-0 bg-amber-100 text-amber-800 hover:bg-amber-100">
              {t("scenarioDialogue.chat.previewMode")}
            </Badge>
          )}
        </div>
      </header>

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
            <div className={cn("shrink-0 px-3 pt-3", wide && "lg:hidden")}>
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
                className="h-full overflow-y-auto overflow-x-hidden px-3 py-4"
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
                    />
                  )}
                </div>
              </div>

              {hasNew && (
                <button
                  type="button"
                  onClick={scrollToBottom}
                  className="absolute bottom-3 left-1/2 flex min-h-11 -translate-x-1/2 items-center gap-1 rounded-full bg-gray-900/80 px-4 text-sm text-white shadow-md"
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
              submitDisabledReason={
                isPreview
                  ? t("scenarioDialogue.chat.previewNoSubmit")
                  : undefined
              }
            />
          )}
        </main>
      </div>
    </div>
  );
}
