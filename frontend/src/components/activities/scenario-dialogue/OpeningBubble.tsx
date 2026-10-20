/**
 * OpeningBubble — 情境對話 AI 開場複述氣泡（#1133）。
 *
 * 按「開始對話」後 AI 第一則訊息：先用英文一句複述作答重點，再問第 1 題。
 * 跟題目氣泡一樣有 `[🔊] [Aa 英] [中]` 小膠囊（RevealCapsules），中文是作答要求的摘要；
 * 英文預設顯示與否跟老師「題目文字預設」設定一致。
 * 開場的「是否點開文字」不列入紀錄（只記題目）。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RevealCapsules } from "./RevealCapsules";
import { AiRow } from "./TypingIndicator";

interface Props {
  text: string;
  translation?: string;
  textDefaultHidden: boolean;
  showTranslation: boolean;
  onPlay: () => void;
}

export function OpeningBubble({
  text,
  translation,
  textDefaultHidden,
  showTranslation,
  onPlay,
}: Props) {
  const { t } = useTranslation();
  const [en, setEn] = useState(!textDefaultHidden);
  const [zh, setZh] = useState(false);
  const canZh = showTranslation && Boolean(translation);

  return (
    <AiRow>
      <div className="max-w-[min(100%,36rem)] space-y-2 rounded-2xl rounded-tl-sm border border-gray-200 bg-white p-3">
        <RevealCapsules
          enOn={en}
          zhOn={zh}
          showZh={canZh}
          playLabel={t("scenarioDialogue.chat.playMessage")}
          onPlay={onPlay}
          onToggleEn={() => {
            if (en) setZh(false);
            setEn(!en);
          }}
          onToggleZh={() => setZh(!zh)}
        />
        {en && (
          <p className="quiz-input-font font-medium leading-snug text-gray-900">
            {text}
          </p>
        )}
        {en && zh && canZh && (
          <p className="quiz-translation-font text-gray-600">{translation}</p>
        )}
      </div>
    </AiRow>
  );
}
