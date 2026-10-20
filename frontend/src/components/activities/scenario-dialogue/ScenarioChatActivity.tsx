/**
 * ScenarioChatActivity — 情境對話「訊息對話式」作答畫面主體（#1133）。
 *
 * 只管版面、捲動，並把狀態機（useScenarioChat）接到訊息流（ChatTranscript）與輸入區：
 * - 開始前：作答要求卡（藍）→ 情境卡（紫，情境 C 沒有）→ 底部「開始對話」。
 *   手機／平板直式顯示在對話區；平板橫式／電腦（≥ lg）放左欄、常駐展開（獨立捲動）。
 * - 開始後（< lg）：兩張卡收合成上方一條 `[📋 作答要求] [📖 情境]` 小膠囊，點哪個展開哪個。
 * - 題號小點點（QuestionDots）：< lg 在標題列下方橫排，≥ lg 在對話欄左側直排。
 *   學生點了只捲到那一題；老師預覽點了跳題（取代舊的跳題列）。
 * - 再試一次：任何已出現、沒答滿的題目都能回頭重答；輸入區上方出現「正在重答第 N 題 ✕」。
 *   AI 建議回來後先停在該題讓學生看一下（RETURN_DELAY_MS），再自動捲回原本進行中的題目；
 *   按 ✕ 取消則立刻捲回。
 * - 新訊息自動捲到底；使用者往上捲時不強制捲動，改顯示「↓ 新訊息」提示。
 *   內容高度變化（例如題目圖片晚載入）也會在貼底狀態下再捲一次（ResizeObserver）。
 * - 高度用 100dvh；底部輸入區留 safe-area。
 *
 * AI 建議與朗讀由 `adapters` 注入（sample 傳 mock；正式版之後接後端）。
 * 學生畫面不顯示分數；老師預覽（settings.isPreviewMode）多「預覽模式」標示、點點跳題、
 * 參考答案開關與 mock 分數。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, Mic } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChatTranscript } from "./ChatTranscript";
import { QuestionDots } from "./QuestionDots";
import { ReplyComposer, type ComposerState } from "./ReplyComposer";
import {
  InfoStrip,
  RubricCard,
  ScenarioContextCard,
  hasContextCard,
  type InfoPanel,
} from "./ScenarioContextCard";
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
}: Props) {
  const { t } = useTranslation();
  const chat = useScenarioChat({
    items,
    adapters,
    maxAttempts: settings.maxAttempts,
    textDefaultHidden: settings.textDefaultHidden,
    showTranslation: settings.showTranslation,
    openingText: context.opening?.text,
    onRevealChange,
  });
  const { phase, current, retry } = chat;
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

  // 內容長高（圖片晚載入等）時，貼底狀態下再捲一次
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const el = scrollRef.current;
      if (el && stickRef.current) el.scrollTop = el.scrollHeight;
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
    returnTimerRef.current = setTimeout(returnToCurrent, RETURN_DELAY_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.retryReturn]);

  const handleRetry = (i: number) => {
    clearReturnTimer();
    chat.retryItem(i);
  };

  const handleDot = (i: number) => {
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

  const dotProps = {
    total: items.length,
    revealedCount: chat.revealedCount,
    current: started ? current : null,
    allowAll: isPreview,
    onSelect: handleDot,
  };

  const fullCards = (
    <>
      {context.rubric && <RubricCard rubric={context.rubric} />}
      {showScenario && <ScenarioContextCard context={context} />}
    </>
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-gray-50">
      {/* 標題列（紫色點綴）＋手機版題號點點 */}
      <header className="shrink-0 border-b border-purple-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-600">
            <Mic className="h-4 w-4" />
          </span>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900 sm:text-lg">
            {context.title}
          </h1>
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
          {started && (
            <span className="shrink-0 text-sm tabular-nums text-gray-500">
              {Math.min(current + 1, items.length)} / {items.length}
            </span>
          )}
        </div>
        <QuestionDots
          {...dotProps}
          orientation="horizontal"
          className="mx-auto max-w-2xl px-2 lg:hidden"
        />
      </header>

      <div
        className={cn(
          "mx-auto flex min-h-0 w-full flex-1 flex-col",
          hasLeft
            ? "max-w-2xl lg:max-w-6xl lg:flex-row lg:gap-4 lg:px-4"
            : "max-w-2xl lg:max-w-3xl",
        )}
      >
        {hasLeft && (
          <aside className="hidden min-h-0 space-y-3 overflow-y-auto py-4 lg:block lg:w-2/5">
            {fullCards}
          </aside>
        )}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {started && hasLeft && (
            <div className="shrink-0 px-3 pt-3 lg:hidden">
              <InfoStrip
                context={context}
                showScenario={showScenario}
                open={infoOpen}
                onOpenChange={setInfoOpen}
              />
            </div>
          )}

          <div className="flex min-h-0 flex-1">
            <QuestionDots
              {...dotProps}
              orientation="vertical"
              className="hidden shrink-0 py-4 lg:flex"
            />
            <div className="relative min-h-0 min-w-0 flex-1">
              <div
                ref={scrollRef}
                onScroll={onScroll}
                className="h-full overflow-y-auto overflow-x-hidden px-3 py-4"
                aria-live="polite"
              >
                <div ref={contentRef} className="space-y-3">
                  {!started && hasLeft && (
                    <div className="space-y-3 lg:hidden">{fullCards}</div>
                  )}
                  <ChatTranscript
                    chat={chat}
                    context={context}
                    items={items}
                    settings={settings}
                    adapters={adapters}
                    registerBlock={registerBlock}
                    onRetry={handleRetry}
                  />
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
          />
        </main>
      </div>
    </div>
  );
}
