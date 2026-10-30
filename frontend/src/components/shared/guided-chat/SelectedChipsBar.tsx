/**
 * 引導式對話的「已選項目列」（Issue #1158 C 段 commit 3）。
 *
 * 放在左欄頂端（呼叫端放在對話捲動區**外面**，所以不隨對話捲動）。每個標籤顯示
 * 「標籤文字：目前值」，點了跳出 Popover（`components/ui/popover`）原地修改；Popover 的
 * 內容由各功能提供（`renderContent`，拿到 `close()` 改完自己關）。改完後對話紀錄只往下
 * 加一句「已把○○改成：…」——那是呼叫端用引擎的 `appendChange` 做的，這裡只管畫。
 *
 * **停用**（`disabled`，#1158 修正 C4）：AI 工作進行中（寫情境、擷取、產題、compose）時整列停用，
 * 每個標籤的 `title` 與列尾小字寫原因（`disabledReason`，例如「產生中，請稍候…」），已開的
 * Popover 也一併關掉 —— 和「產生中對話框停用」一致，避免產生中改了答案、結果落地時對不上。
 *
 * 標籤放不下就換行。窄版（`GuidedChatLayout` 的分頁版）多一個「收合／展開」鈕，收合時
 * 只留一行（超出的藏起來）；寬版一律展開。
 *
 * 搭配引擎：`chipsFor(flow, answers, ctx)` 回的 `ChipState` 用 `resolveText` 轉成
 * `label`／`value` 字串傳進來；Popover 內容可用這裡附的兩個小元件：
 * - `ChipOptionList`：引擎 `popover.type === "options"`，列出步驟選項（目前值標成已選）
 *   ＋額外動作鈕（例如「編輯情境內容」）。
 * - `ChipTextEditor`：引擎 `popover.type === "text"`，一個文字框＋「確定」。
 * `custom` 型由功能自己畫（例如情境對話的精簡設定）。
 *
 * 用法：
 * ```tsx
 * <SelectedChipsBar
 *   chips={chips.map((c) => ({ id: c.stepId, label: resolveText(c.label, t), value: … }))}
 *   renderContent={(id, close) => <ChipOptionList … onChoose={(v) => { change(id, v); close(); }} />}
 * />
 * ```
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useGuidedChatLayout } from "./GuidedChatLayout";

export interface SelectedChip {
  id: string;
  label: string;
  /** 目前值；空字串或 null ＝只顯示標籤文字（例如方向還沒填） */
  value?: string | null;
}

export interface SelectedChipsBarProps {
  chips: SelectedChip[];
  /** Popover 內容。`close()` 關掉 Popover */
  renderContent: (chipId: string, close: () => void) => ReactNode;
  /** 個別標籤的 Popover 寬度等（例如設定小框內容多，要寬一點、可捲動）；預設 `w-80` */
  popoverClassName?: (chipId: string) => string | undefined;
  /** 是否提供收合（預設：窄版才提供） */
  collapsible?: boolean;
  /** 整列停用（AI 工作進行中）；停用時已開的 Popover 也關掉 */
  disabled?: boolean;
  /** 停用原因：掛在每個標籤的 `title`，並在列尾以小字顯示 */
  disabledReason?: string;
  className?: string;
}

export function SelectedChipsBar({
  chips,
  renderContent,
  popoverClassName,
  collapsible,
  disabled = false,
  disabledReason,
  className,
}: SelectedChipsBarProps) {
  const { t } = useTranslation();
  const { wide } = useGuidedChatLayout();
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const canCollapse = collapsible ?? !wide;
  const isCollapsed = canCollapse && collapsed;

  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={t("guidedChat.chips.label")}
      data-testid="guided-chat-chips"
      className={cn(
        "flex shrink-0 items-start gap-2 border-b border-gray-200 bg-white px-4 py-2",
        className,
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-1 gap-1.5",
          isCollapsed ? "flex-nowrap overflow-hidden" : "flex-wrap",
        )}
      >
        {chips.map((chip) => (
          <Popover
            key={chip.id}
            open={!disabled && openId === chip.id}
            onOpenChange={(open) => setOpenId(open ? chip.id : null)}
          >
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                data-chip={chip.id}
                disabled={disabled}
                title={disabled ? disabledReason : undefined}
                className="h-7 max-w-full shrink-0 rounded-full px-3 text-xs font-normal"
              >
                <span className="font-semibold text-gray-700">
                  {chip.label}
                </span>
                {chip.value ? (
                  <span className="ml-1 truncate text-gray-600">
                    {chip.value}
                  </span>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className={cn("w-80", popoverClassName?.(chip.id))}
            >
              {renderContent(chip.id, () => setOpenId(null))}
            </PopoverContent>
          </Popover>
        ))}
        {disabled && disabledReason && (
          <span
            data-testid="guided-chat-chips-reason"
            className="self-center text-xs text-gray-500"
          >
            {disabledReason}
          </span>
        )}
      </div>
      {canCollapse && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs text-gray-500"
          aria-expanded={!isCollapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          {isCollapsed ? (
            <ChevronDown className="mr-0.5 h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="mr-0.5 h-3.5 w-3.5" />
          )}
          {isCollapsed
            ? t("guidedChat.chips.expand")
            : t("guidedChat.chips.collapse")}
        </Button>
      )}
    </div>
  );
}

// ============================================================ Popover 內容小元件

export interface ChipOptionItem {
  value: string;
  label: string;
  hint?: string;
}

/** 選項型 Popover：列出選項（目前值標成已選）＋額外動作鈕 */
export function ChipOptionList({
  options,
  current,
  onChoose,
  actions,
  onAction,
  disabledReason,
}: {
  options: readonly ChipOptionItem[];
  current?: string | null;
  onChoose: (value: string) => void;
  actions?: readonly { id: string; label: string }[];
  onAction?: (id: string) => void;
  /** 這個標籤現在不能改：選項全部停用，並顯示原因 */
  disabledReason?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {options.map((opt) => (
        <Button
          key={opt.value}
          variant="outline"
          aria-pressed={current === opt.value}
          disabled={!!disabledReason}
          onClick={() => onChoose(opt.value)}
          className={cn(
            "h-auto w-full flex-col items-start gap-0.5 whitespace-normal px-3 py-2 text-left",
            current === opt.value && "border-blue-600 bg-blue-50",
          )}
        >
          <span className="text-sm font-semibold text-gray-800">
            {opt.label}
          </span>
          {opt.hint && (
            <span className="text-xs font-normal text-gray-500">
              {opt.hint}
            </span>
          )}
        </Button>
      ))}
      {disabledReason && (
        <p className="text-xs text-gray-500">{disabledReason}</p>
      )}
      {actions && actions.length > 0 && (
        <div className="mt-1 border-t border-gray-200 pt-2">
          {actions.map((act) => (
            <Button
              key={act.id}
              variant="ghost"
              size="sm"
              className="w-full justify-start text-blue-600"
              onClick={() => onAction?.(act.id)}
            >
              {act.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 文字型 Popover：一個文字框＋「確定」。空白不能送出 */
export function ChipTextEditor({
  initialValue,
  placeholder,
  ariaLabel,
  onSubmit,
}: {
  initialValue: string;
  placeholder?: string;
  ariaLabel: string;
  onSubmit: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="min-h-0 resize-y"
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!value.trim()}
          onClick={() => onSubmit(value.trim())}
        >
          {t("guidedChat.chips.apply")}
        </Button>
      </div>
    </div>
  );
}
