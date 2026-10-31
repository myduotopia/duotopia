/**
 * 引導式對話的泡泡（Issue #1158 C 段 commit 3，從 `ScenarioSetupChat.tsx` 抽出）。
 *
 * - `BotBubble`：左邊機器人圖示＋灰底泡泡（問句、重問句、「產生中…」）。
 * - `TeacherBubble`：貼右的藍底白字泡泡（老師的回答）。給 `onChange` 時左側多一個
 *   「改選」文字鈕（文字預設 `guidedChat.change`，可用 `changeLabel` 換掉）。
 *
 * 泡泡最寬 85%，文字保留換行（`whitespace-pre-wrap`），長字自動斷行。
 *
 * 用法：
 * ```tsx
 * <BotBubble>{t("…q.mode")}</BotBubble>
 * <TeacherBubble onChange={() => reopen("mode")}>{answer}</TeacherBubble>
 * ```
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";

export function BotBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
        <Bot className="h-4 w-4" />
      </span>
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-gray-100 px-3 py-2 text-sm text-gray-800 whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  );
}

export interface TeacherBubbleProps {
  children: ReactNode;
  /** 有給才顯示「改選」鈕 */
  onChange?: () => void;
  /** 「改選」鈕文字（預設 `guidedChat.change`） */
  changeLabel?: string;
}

export function TeacherBubble({
  children,
  onChange,
  changeLabel,
}: TeacherBubbleProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-end gap-2">
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          className="text-xs text-blue-600 hover:underline"
        >
          {changeLabel ?? t("guidedChat.change")}
        </button>
      )}
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-blue-600 px-3 py-2 text-sm text-white whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  );
}
