/**
 * ChatTranscript — 情境對話的訊息流（#1133），從 ScenarioChatActivity 拆出來。
 *
 * 由上而下：開始前的開場招呼 → AI 開場複述（OpeningBubble）→ 每題（題目氣泡＋
 * 該題所有回答與建議，重答接在該題原有紀錄下方）→「輸入中…」→ 結尾語。
 * 每題外層 div 交給外層登記（registerBlock），供點點捲動與重答後捲回。
 *
 * 每題「最後一則」建議氣泡的操作（FeedbackBubble actions）：
 * 目前這題剛看完建議＝再試一次＋下一題；已答滿＝「已達 N 次」（目前這題附「即將進入下一題」）；
 * 其他可重答的題目＝再試一次（回頭重答）。學生畫面不顯示分數；老師預覽顯示 mock 分數與本題平均。
 */

import { useTranslation } from "react-i18next";
import { AnswerBubble } from "./AnswerBubble";
import { FeedbackBubble, type FeedbackActions } from "./FeedbackBubble";
import { OpeningBubble } from "./OpeningBubble";
import { QuestionBubble } from "./QuestionBubble";
import { AiRow, TypingIndicator } from "./TypingIndicator";
import type { ScenarioChatState } from "./useScenarioChat";
import type {
  ScenarioChatAdapters,
  ScenarioChatContext,
  ScenarioChatItem,
  ScenarioChatSettings,
} from "./types";

interface Props {
  chat: ScenarioChatState;
  context: ScenarioChatContext;
  items: ScenarioChatItem[];
  settings: ScenarioChatSettings;
  adapters: ScenarioChatAdapters;
  registerBlock: (index: number, el: HTMLDivElement | null) => void;
  onRetry: (index: number) => void;
}

const bubble =
  "inline-block rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-3 py-2";

export function ChatTranscript({
  chat,
  context,
  items,
  settings,
  adapters,
  registerBlock,
  onRetry,
}: Props) {
  const { t } = useTranslation();
  const { phase, current, attempts } = chat;
  const { maxAttempts } = settings;
  const isPreview = settings.isPreviewMode;

  const actionsFor = (i: number): FeedbackActions => {
    const used = attempts[i].length;
    const isCurrentDone = i === current && phase === "feedbackShown";
    if (used >= maxAttempts) return isCurrentDone ? "autoNext" : "reached";
    if (isCurrentDone && !chat.retry) return "current";
    if (chat.canRetry(i)) return "retry";
    return "none";
  };

  return (
    <>
      {phase === "intro" && (
        <AiRow>
          <div className={`${bubble} text-sm text-gray-700`}>
            {t("scenarioDialogue.chat.intro", { count: items.length })}
          </div>
        </AiRow>
      )}

      {chat.openingShown && context.opening && (
        <OpeningBubble
          text={context.opening.text}
          translation={context.opening.translation}
          textDefaultHidden={settings.textDefaultHidden}
          showTranslation={settings.showTranslation}
          onPlay={() => adapters.speak(context.opening!.text)}
        />
      )}

      {items.slice(0, chat.revealedCount).map((item, i) => {
        const list = attempts[i];
        const last = list.length - 1;
        return (
          <div
            key={item.id}
            ref={(el) => registerBlock(i, el)}
            className="scroll-mt-2 space-y-3"
          >
            <QuestionBubble
              index={i}
              total={items.length}
              item={item}
              visible={chat.visible[i]}
              showTranslation={settings.showTranslation}
              isPreviewMode={isPreview}
              skipped={chat.skipped[i] && list.length === 0}
              averageScore={isPreview ? chat.averageFor(i) : null}
              onPlay={() => adapters.speak(item.text)}
              onToggle={(w) => chat.toggleText(i, w)}
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
                    actions={j === last ? actionsFor(i) : "none"}
                    maxAttempts={maxAttempts}
                    retryDisabled={chat.retryBusy}
                    onRetry={() => onRetry(i)}
                    onNext={chat.goNext}
                  />
                ) : (
                  <TypingIndicator />
                )}
              </div>
            ))}
          </div>
        );
      })}

      {phase === "aiTyping" && <TypingIndicator />}

      {chat.closingShown && (
        <AiRow>
          <div className={`${bubble} text-gray-800`}>
            {t("scenarioDialogue.chat.closing")}
          </div>
        </AiRow>
      )}
    </>
  );
}
