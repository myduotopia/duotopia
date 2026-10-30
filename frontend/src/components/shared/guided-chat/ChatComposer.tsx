/**
 * 引導式對話的底部對話框（Issue #1158 C 段 commit 3）：固定在左欄最底端（呼叫端放在
 * 對話捲動區**外面**），從頭到尾都在。
 *
 * - 灰字（`placeholder`）依步驟換，由引擎的 `composerState(...).placeholder` 決定：
 *   選項步驟「請點選上面的選項」、打字步驟的範例句、題目產生後的提示……
 * - 停用（`disabled`）：卡片還沒完成、產生中。停用時灰字就是原因（例如「請先完成上面的
 *   卡片」「產生中，請稍候…」），同一句也掛在 `title` 上，滑鼠移上去看得到。
 *   產生中（`busy`）時送出鈕顯示轉圈。
 * - 送出鈕：沒有字或停用時不能按（屬於表單驗證／處理中的暫時停用，不另外說明）。
 * - 不做範例按鈕、不做快捷按鈕（規格第 3 點）。
 * - Enter 預設是換行（老師常一次打好幾題）；`submitOnEnter` 打開後改成 Enter 送出、
 *   Shift+Enter 換行，中文輸入法選字中按 Enter 不會送出。
 * - 底部內距至少留 `env(safe-area-inset-bottom)`（瀏海機 home bar）。
 *
 * 送出後要不要清空由呼叫端決定（`value` 受控）。
 *
 * 用法：
 * ```tsx
 * const s = composerState(flow, answers, ctx);
 * <ChatComposer
 *   value={draft}
 *   onChange={setDraft}
 *   onSubmit={() => send(draft)}
 *   placeholder={resolveText(s.placeholder, t)}
 *   disabled={s.disabled}
 *   busy={s.phase === "pending"}
 * />
 * ```
 */
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled?: boolean;
  /** 產生中：送出鈕轉圈 */
  busy?: boolean;
  /** Enter 送出、Shift+Enter 換行（預設關：Enter 換行） */
  submitOnEnter?: boolean;
  /** 文字框的無障礙名稱（預設 `guidedChat.composer.label`） */
  ariaLabel?: string;
  className?: string;
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  busy = false,
  submitOnEnter = false,
  ariaLabel,
  className,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const canSend = !disabled && !busy && value.trim().length > 0;

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      submitOnEnter &&
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      if (canSend) onSubmit();
    }
  };

  return (
    <div
      data-testid="guided-chat-composer"
      className={cn(
        "shrink-0 border-t border-gray-200 bg-white px-4 py-3",
        className,
      )}
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {/* 窄版佔滿寬度時，對話框不要被拉得太長 */}
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder={placeholder}
          disabled={disabled}
          title={disabled ? placeholder : undefined}
          aria-label={ariaLabel ?? t("guidedChat.composer.label")}
          className="min-h-0 max-h-40 flex-1 resize-none"
        />
        <Button
          size="icon"
          onClick={onSubmit}
          disabled={!canSend}
          aria-label={t("guidedChat.composer.send")}
          className="shrink-0"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <SendHorizontal className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
