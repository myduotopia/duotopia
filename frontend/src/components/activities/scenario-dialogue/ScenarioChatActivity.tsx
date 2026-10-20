/**
 * ScenarioChatActivity — 情境對話「訊息對話式」作答畫面主體（#1133）。
 *
 * 只管版面與把狀態機（useScenarioChat）接到各氣泡元件：
 * - 手機／平板直式：單欄（內容 max-w-2xl 置中）；情境卡在對話上方、可收合，
 *   開始作答後自動收合；手機橫式（useShortLandscape）一開始就收合。
 * - 平板橫式／電腦（≥ lg）且有情境卡：左欄情境卡常駐展開（獨立捲動）、右欄對話。
 * - 情境 C（無文章無圖）：不顯示情境卡，標題列顯示情境那一句＋作答要求。
 * - 新訊息自動捲到底；使用者往上捲時不強制捲動，改顯示「↓ 新訊息」提示。
 * - 高度用 100dvh；底部輸入區留 safe-area。
 *
 * AI 建議與朗讀由 `adapters` 注入（sample 傳 mock；正式版之後接後端）。
 * 學生畫面不顯示分數；老師預覽（settings.isPreviewMode）多「預覽模式」標示、跳題、
 * 參考答案開關與 mock 分數。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, Mic } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useShortLandscape } from "@/components/activities/shared/useShortLandscape";
import { AnswerBubble } from "./AnswerBubble";
import { FeedbackBubble } from "./FeedbackBubble";
import { QuestionBubble } from "./QuestionBubble";
import { ReplyComposer, type ComposerState } from "./ReplyComposer";
import {
  RubricBar,
  ScenarioContextCard,
  hasContextCard,
} from "./ScenarioContextCard";
import { AiRow, TypingIndicator } from "./TypingIndicator";
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
  onRevealChange?: (reveal: TextRevealState[]) => void;
}

const NEAR_BOTTOM_PX = 80;

export function ScenarioChatActivity({
  context,
  items,
  settings,
  adapters,
  onSubmit,
  onRevealChange,
}: Props) {
  const { t } = useTranslation();
  const shortLandscape = useShortLandscape();
  const chat = useScenarioChat({
    items,
    adapters,
    maxAttempts: settings.maxAttempts,
    textDefaultHidden: settings.textDefaultHidden,
    showTranslation: settings.showTranslation,
    onRevealChange,
  });
  const { phase, current, attempts } = chat;
  const isPreview = settings.isPreviewMode;

  const showCard = hasContextCard(context);
  const [cardCollapsed, setCardCollapsed] = useState(shortLandscape);

  // ── 自動捲動 ──
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
  const nearBottomRef = useRef(true);
  const [hasNew, setHasNew] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setHasNew(false);
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    nearBottomRef.current = near;
    if (near) setHasNew(false);
  };

  useEffect(() => {
    if (chat.reviewing) {
      blockRefs.current[current]?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
      return;
    }
    if (nearBottomRef.current) {
      requestAnimationFrame(scrollToBottom);
    } else {
      setHasNew(true);
    }
    // 只在流程有新內容時觸發
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.flowKey]);

  const handleStart = () => {
    setCardCollapsed(true);
    chat.start();
  };

  // ── 底部輸入區狀態 ──
  let composerState: ComposerState;
  let waitingHint = "";
  if (phase === "intro") composerState = "intro";
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

  const card = (pinned: boolean) => (
    <ScenarioContextCard
      context={context}
      collapsed={cardCollapsed}
      onToggle={() => setCardCollapsed((c) => !c)}
      pinnedOpen={pinned}
    />
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-gray-50">
      {/* 標題列（紫色點綴） */}
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
          {phase !== "intro" && (
            <span className="shrink-0 text-sm tabular-nums text-gray-500">
              {Math.min(current + 1, items.length)} / {items.length}
            </span>
          )}
        </div>
        {isPreview && (
          <div className="mx-auto flex max-w-6xl items-center gap-1.5 overflow-x-auto px-4 pb-2">
            <span className="shrink-0 text-xs text-gray-500">
              {t("scenarioDialogue.chat.jumpTo")}
            </span>
            {items.map((_, i) => (
              <Button
                key={i}
                type="button"
                variant={
                  i === current && phase !== "intro" ? "default" : "outline"
                }
                className="h-11 w-11 shrink-0 p-0"
                onClick={() => {
                  setCardCollapsed(true);
                  chat.jumpTo(i);
                }}
                aria-label={t("scenarioDialogue.chat.jumpToNo", { no: i + 1 })}
              >
                {i + 1}
              </Button>
            ))}
          </div>
        )}
      </header>

      <div
        className={cn(
          "mx-auto flex min-h-0 w-full flex-1 flex-col",
          showCard
            ? "max-w-2xl lg:max-w-6xl lg:flex-row lg:gap-4 lg:px-4"
            : "max-w-2xl",
        )}
      >
        {showCard && (
          <aside className="hidden min-h-0 overflow-y-auto py-4 lg:block lg:w-2/5">
            {card(true)}
          </aside>
        )}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="shrink-0 space-y-2 px-3 pt-3">
            {showCard && (
              <div
                className={cn(
                  "lg:hidden",
                  !cardCollapsed && "max-h-[45dvh] overflow-y-auto rounded-xl",
                )}
              >
                {card(false)}
              </div>
            )}
            {context.rubric && <RubricBar rubric={context.rubric} />}
          </div>

          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="h-full space-y-3 overflow-y-auto overflow-x-hidden px-3 py-4"
              aria-live="polite"
            >
              <AiRow>
                <div className="inline-block rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                  {t("scenarioDialogue.chat.intro", { count: items.length })}
                </div>
              </AiRow>

              {items.slice(0, chat.revealedCount).map((item, i) => {
                const list = attempts[i];
                const last = list.length - 1;
                const isActive = i === current;
                return (
                  <div
                    key={item.id}
                    ref={(el) => (blockRefs.current[i] = el)}
                    className="space-y-3"
                  >
                    <QuestionBubble
                      index={i}
                      total={items.length}
                      item={item}
                      reveal={chat.reveal[i]}
                      showTranslation={settings.showTranslation}
                      isPreviewMode={isPreview}
                      skipped={chat.skipped[i] && list.length === 0}
                      averageScore={isPreview ? chat.averageFor(i) : null}
                      onPlay={() => adapters.speak(item.text)}
                      onReveal={(w) => chat.revealText(i, w)}
                      onReanswer={
                        phase === "finished" &&
                        list.length < settings.maxAttempts
                          ? () => chat.reanswer(i)
                          : undefined
                      }
                    />
                    {list.map((a, j) => (
                      <div key={j} className="space-y-3">
                        <AnswerBubble
                          answer={a.answer}
                          attemptNo={j + 1}
                          showAttemptNo={list.length > 1}
                          faded={j < last}
                          score={isPreview ? a.feedback?.score : undefined}
                        />
                        {a.feedback ? (
                          <FeedbackBubble
                            feedback={a.feedback}
                            onSpeak={adapters.speak}
                            showActions={
                              isActive &&
                              j === last &&
                              phase === "feedbackShown"
                            }
                            exhausted={chat.exhausted}
                            maxAttempts={settings.maxAttempts}
                            nextLabel={
                              chat.reviewing
                                ? t("scenarioDialogue.chat.doneReview")
                                : t("scenarioDialogue.chat.next")
                            }
                            onRetry={chat.retry}
                            onNext={chat.goNext}
                          />
                        ) : (
                          isActive &&
                          j === last &&
                          phase === "awaitingFeedback" && <TypingIndicator />
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}

              {phase === "aiTyping" && <TypingIndicator />}

              {chat.closingShown && (
                <AiRow>
                  <div className="inline-block rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-3 py-2 text-gray-800">
                    {t("scenarioDialogue.chat.closing")}
                  </div>
                </AiRow>
              )}
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

          <ReplyComposer
            state={composerState}
            replyMode={settings.replyMode}
            waitingHint={waitingHint}
            reviewingNo={chat.reviewing ? current + 1 : null}
            onStart={handleStart}
            onSubmitAnswer={chat.submitAnswer}
            onCancelReview={chat.cancelReview}
            onSubmitAssignment={onSubmit}
          />
        </main>
      </div>
    </div>
  );
}
