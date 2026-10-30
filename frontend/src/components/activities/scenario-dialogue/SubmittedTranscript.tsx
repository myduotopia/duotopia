/**
 * SubmittedTranscript — 情境對話「已提交」後重新打開的作答紀錄（#1158 E6）。
 *
 * 已提交（SUBMITTED／GRADED／RESUBMITTED）的作業不能再作答：不顯示「開始對話」、錄音鍵，
 * 只把每一題列出來 ——
 * - 題目：沿用作答時同一個 QuestionBubble（英文預設打開；🔊 可重聽題目；圖片在氣泡頂部）。
 * - 學生自己的錄音：沿用 AnswerBubble（標準 AudioPlayer，只能播放）。錄音來源是學生端作業
 *   payload 每題的 `recording_url`（StudentItemProgress，伺服器存的最後一次錄音；fromApi 轉成
 *   `submittedAudioUrl`）。沒有錄音的題目標「沒有作答」。
 * - AI 建議當下沒有存回 payload（只存在作答當時的畫面），所以紀錄裡不會有建議氣泡。
 * 「作業已提交，目前為檢視模式」由作答頁外框的唯讀橫幅說明，這裡只放一行小標，不重複橫幅。
 * 每題外層 div 交給外層登記（registerBlock），題號方格點了可以捲到那一題。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AnswerBubble } from "./AnswerBubble";
import { QuestionBubble } from "./QuestionBubble";
import type {
  ScenarioChatAdapters,
  ScenarioChatItem,
  TextRevealState,
} from "./types";

interface Props {
  items: ScenarioChatItem[];
  adapters: ScenarioChatAdapters;
  /** 每題能不能看翻譯（同作答時的規則，由外層算好） */
  translatable: boolean[];
  registerBlock: (index: number, el: HTMLDivElement | null) => void;
}

export function SubmittedTranscript({
  items,
  adapters,
  translatable,
  registerBlock,
}: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState<TextRevealState[]>(() =>
    items.map(() => ({ en: true, zh: false })),
  );
  const toggle = (i: number, which: "en" | "zh") =>
    setVisible((prev) =>
      prev.map((v, idx) => {
        if (idx !== i) return v;
        if (which === "en") return { en: !v.en, zh: v.en ? false : v.zh };
        return { ...v, zh: !v.zh };
      }),
    );

  return (
    <div className="space-y-4" data-testid="scenario-submitted-transcript">
      <p className="text-sm font-medium text-gray-600">
        {t("scenarioDialogue.chat.submittedRecord")}
      </p>
      {items.map((item, i) => (
        <div
          key={item.id}
          ref={(el) => registerBlock(i, el)}
          className="space-y-2"
        >
          <QuestionBubble
            index={i}
            total={items.length}
            item={item}
            visible={visible[i] ?? { en: true, zh: false }}
            showTranslation={Boolean(translatable[i])}
            isPreviewMode={false}
            skipped={false}
            averageScore={null}
            onPlay={() => void adapters.speak(item.text)}
            onToggle={(which) => toggle(i, which)}
          />
          {item.submittedAudioUrl ? (
            <AnswerBubble
              answer={{ kind: "voice", audioUrl: item.submittedAudioUrl }}
              attemptNo={1}
              showAttemptNo={false}
              faded={false}
            />
          ) : (
            <p className="text-right text-sm text-gray-500">
              {t("scenarioDialogue.chat.noAnswer")}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
