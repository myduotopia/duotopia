/**
 * ChatTranscript — 情境對話的訊息流（#1133），從 ScenarioChatActivity 拆出來。
 *
 * 由上而下：開始前的開場招呼 → 每題（題目氣泡＋該題所有回答與建議，重答接在該題原有
 * 紀錄下方）→「輸入中…」→ 結尾語。按「開始對話」後直接問第 1 題（沒有 AI 開場複述）。
 * 每題翻譯鈕是否出現由外層算好的 translatable[i] 決定。
 * 回頭重答某題（chat.retry）時：該題題目氣泡標「重答中」；還沒送出新回答前，該題舊的回答與建議
 * 全部變淡（#1158 E-2 重答流程）。
 * 每題外層 div 交給外層登記（registerBlock），供點點捲動與重答後捲回。
 *
 * 每題「最後一則」建議氣泡的操作（FeedbackBubble actions）：
 * 目前這題剛看完建議＝再試一次＋下一題；已答滿＝「已達 N 次」（目前這題附「即將進入下一題」）；
 * 其他可重答的題目＝再試一次（回頭重答）。學生畫面不顯示分數；老師預覽顯示 mock 分數與本題平均。
 */

import { useTranslation } from "react-i18next";
import { AnswerBubble } from "./AnswerBubble";
import { FeedbackBubble, type FeedbackActions } from "./FeedbackBubble";
import { QuestionBubble } from "./QuestionBubble";
import { AiRow, TypingIndicator } from "./TypingIndicator";
import type { ScenarioChatState } from "./useScenarioChat";
import type {
  ScenarioChatAdapters,
  ScenarioChatItem,
  ScenarioChatSettings,
} from "./types";

interface Props {
  chat: ScenarioChatState;
  items: ScenarioChatItem[];
  settings: ScenarioChatSettings;
  adapters: ScenarioChatAdapters;
  /** 每題能不能看翻譯（老師開翻譯＋翻譯語言＝學生介面語言＋有翻譯文字） */
  translatable: boolean[];
  registerBlock: (index: number, el: HTMLDivElement | null) => void;
  onRetry: (index: number) => void;
}

const bubble =
  "inline-block rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-3 py-2";

export function ChatTranscript({
  chat,
  items,
  settings,
  adapters,
  translatable,
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

      {items.slice(0, chat.revealedCount).map((item, i) => {
        const list = attempts[i];
        const last = list.length - 1;
        const retrying = chat.retry?.index === i;
        // 重答中、還沒送出新回答：這題舊的回答與建議全部變淡
        const fadeAll = retrying && chat.retry?.status === "answering";
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
              showTranslation={translatable[i]}
              isPreviewMode={isPreview}
              skipped={chat.skipped[i] && list.length === 0}
              averageScore={isPreview ? chat.averageFor(i) : null}
              retrying={retrying}
              onPlay={() => adapters.speak(item.text)}
              onToggle={(w) => chat.toggleText(i, w)}
            />
            {list.map((a, j) => (
              <div key={j} className="space-y-3">
                <AnswerBubble
                  answer={a.answer}
                  attemptNo={j + 1}
                  showAttemptNo={list.length > 1}
                  faded={j < last || fadeAll}
                  score={isPreview ? a.feedback?.score : undefined}
                />
                {a.feedback ? (
                  <FeedbackBubble
                    feedback={a.feedback}
                    onSpeak={adapters.speak}
                    actions={j === last ? actionsFor(i) : "none"}
                    maxAttempts={maxAttempts}
                    retryDisabled={chat.retryBusy}
                    faded={fadeAll}
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
