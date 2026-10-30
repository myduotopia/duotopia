/**
 * TypingIndicator / AiRow — 情境對話聊天流的 AI 端共用小元件（#1133）。
 *
 * - `AiRow`：左側 AI 頭像（線描熊熊 BearAvatar，#1158 E-2）＋內容（題目、建議、結尾語氣泡都用它排版）。
 * - `TypingIndicator`：「輸入中…」三點跳動動畫，出現在下一則 AI 訊息之前。
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BearAvatar } from "./BearAvatar";

export function AiRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <BearAvatar className="mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function TypingIndicator() {
  const { t } = useTranslation();
  return (
    <AiRow>
      <div
        className="inline-flex items-center gap-1 rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-4 py-3"
        role="status"
        aria-label={t("scenarioDialogue.chat.typing")}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 rounded-full bg-gray-400 animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </AiRow>
  );
}
