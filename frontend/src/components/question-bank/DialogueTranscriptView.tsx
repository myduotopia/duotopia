/**
 * 題組「文字版」分頁的唯讀對話樣式（Issue #1083，2026-10-06）。
 *
 * 圖片題組有對話文稿（`segments`）時，GroupCard 的文字版分頁改顯示這個元件：
 * |（鎖頭）對話文稿由 AI 從圖片整理，會用來產生音檔，無法修改|
 * |非對話文字（標題、旁白、標示；有才顯示，同樣唯讀）|
 * |**Mary:** Where are you going?   ← 逐句一行，交錯淡底色|
 * |**Hank:** To the park.|
 *
 * 為什麼唯讀見 GroupCard `PassageTextTab` 的註解；這裡只負責畫。
 */

import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";

import type { GroupSegmentInput } from "@/types/questionBank";

export function DialogueTranscriptView({
  narration,
  segments,
  testId,
}: {
  /** 對話之前的非對話文字（可為空字串） */
  narration: string;
  segments: GroupSegmentInput[];
  testId: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5" data-testid={`${testId}-dialogue`}>
      <p className="flex items-center gap-1 text-xs text-gray-400">
        <Lock size={12} className="shrink-0" />
        {t("questionBank.group.passage.dialogueReadonly")}
      </p>
      <div className="rounded-md border border-gray-200 text-sm leading-relaxed">
        {narration && (
          <p
            className="whitespace-pre-wrap break-words border-b border-gray-100 px-3 py-2 text-gray-600"
            data-testid={`${testId}-narration`}
          >
            {narration}
          </p>
        )}
        <ol>
          {segments.map((s, i) => (
            <li
              key={i}
              className="break-words px-3 py-1.5 odd:bg-white even:bg-gray-50"
              data-testid={`${testId}-line-${i}`}
            >
              <span className="font-semibold text-gray-900">
                {s.speaker_label}:
              </span>{" "}
              <span className="text-gray-700">{s.transcript}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
