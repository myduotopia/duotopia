/**
 * BulkActionBar — 列表勾選後的底部浮動批次操作列（標準元件，#1097 建立，#1116 共用化）
 *
 * 用在「我的班級」、機構後台班級管理、題庫列表。畫面底部置中的深藍膠囊（不是滿版橫條）：
 * - 外層 fixed 滿版 flex 容器從 sidebar 右緣（left: sidebarWidth）開始、justify-center，
 *   只有膠囊本身接收滑鼠事件，不擋住下方內容。
 * - 計數文字由呼叫端傳入完整句子（countLabel，例：「已選 3 個班級」「已選 5 題」），
 *   元件在句子裡找到 selectedCount 的數字並放大顯示；countNote 為計數旁的琥珀色附註小字
 *   （例：「2 題有未儲存的修改」）。
 * - 呼叫端傳入的動作（actions）＋「✕ 取消選取」（共用 i18n key common.selection.clear）。
 *   按鈕層級依 docs/design/ui-style-guide.md 第 3 節深色欄：
 *   variant "primary"（預設）＝白底深藍字主按鈕；"ghost"＝透明底白框次要按鈕；
 *   "danger"＝透明底、淡紅框加淡紅字危險按鈕。一個操作列最多一個 primary。
 *   開關動作（kind: "switch"）：以 LabeledSwitch tone="onDark" 呈現，文字在軌道內，
 *   小螢幕也保留文字（開關本身很短）；撥動呼叫 onToggle(新狀態)。
 * - 按鈕動作的選用提示：
 *   disabledReason：disabled 時當 title（滑鼠移上去顯示原因）；
 *   disabledBadge：disabled 時接在文字後的小標（例：「即將推出」）；
 *   loading：圖示換成轉圈、按鈕暫時不能按；testId：按鈕的 data-testid。
 * - ≤480px 縮小間距並隱藏「取消選取」文字（保留 ✕ 與 aria-label）；ghost／danger 按鈕只顯示
 *   圖示（aria-label／title 保留完整文字），沒有圖示時改顯示 shortLabel（未提供則截斷原文字）；
 *   停用小標也隱藏（原因仍在 title）。動作太多仍放不下時，膠囊可橫向捲動。
 * selectedCount 為 0 時不渲染。busy 時所有按鈕與開關（含取消選取）停用。
 * test id：膠囊 `bulk-action-bar`、取消選取 `bulk-action-bar-clear`、各動作用 testId 指定
 * （開關動作的 testId 掛在外包的 display:contents span 上）。
 * 頁面需在列表底部預留空間（約 pb-24），最後一列才不會被擋住。
 *
 * sidebarWidth 來自 SidebarContext：TeacherLayout 與 OrganizationLayout 都有提供 SidebarProvider。
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";
import { useSidebar } from "@/contexts/SidebarContext";
import { LabeledSwitch } from "@/components/shared/LabeledSwitch";

export interface BulkButtonAction {
  key: string;
  kind?: "button";
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  icon?: ReactNode;
  /** ≤480px 且沒有圖示時改顯示的短文字（僅 ghost／danger） */
  shortLabel?: string;
  /** disabled 時滑鼠移上去顯示的原因（title） */
  disabledReason?: string;
  /** disabled 時接在文字後的小標（例：「即將推出」） */
  disabledBadge?: string;
  /** 處理中：圖示換成轉圈，按鈕暫時不能按 */
  loading?: boolean;
  testId?: string;
}

/** 文字在軌道內的開關（例：停用／啟用選取的班級） */
export interface BulkSwitchAction {
  key: string;
  kind: "switch";
  checked: boolean;
  /** 軌道內文字（撥下去會變成的狀態） */
  label: string;
  /** 給螢幕閱讀器的完整句子 */
  ariaLabel: string;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
  testId?: string;
}

export type BulkAction = BulkButtonAction | BulkSwitchAction;

export interface BulkActionBarProps {
  selectedCount: number;
  /** 完整的計數句子（例：「已選 3 個班級」）；其中的 selectedCount 數字會放大顯示 */
  countLabel: string;
  /** 計數旁的琥珀色附註小字（例：「2 題有未儲存的修改」） */
  countNote?: string;
  actions: readonly BulkAction[];
  onClear: () => void;
  busy?: boolean;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-blue-700 dark:focus-visible:ring-offset-blue-600";

const PRIMARY_BUTTON =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-4 py-1.5 text-sm font-bold text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60 max-[480px]:px-3";

const GHOST_BUTTON =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-white ring-1 ring-inset ring-white/40 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60 max-[480px]:px-2";

const DANGER_BUTTON =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-red-200 ring-1 ring-inset ring-red-300/60 transition-colors hover:bg-red-500/20 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-60 max-[480px]:px-2";

const BUTTON_CLASS = {
  primary: PRIMARY_BUTTON,
  ghost: GHOST_BUTTON,
  danger: DANGER_BUTTON,
} as const;

function renderLabel(action: BulkButtonAction): ReactNode {
  if ((action.variant ?? "primary") === "primary") return action.label;
  // 小螢幕：有圖示 → 只留圖示；沒有圖示 → 短文字（或截斷）
  if (action.icon || action.loading) {
    return <span className="max-[480px]:hidden">{action.label}</span>;
  }
  if (action.shortLabel) {
    return (
      <>
        <span className="max-[480px]:hidden">{action.label}</span>
        <span className="hidden max-[480px]:inline" aria-hidden="true">
          {action.shortLabel}
        </span>
      </>
    );
  }
  return (
    <span className="max-[480px]:max-w-[4em] max-[480px]:truncate">
      {action.label}
    </span>
  );
}

export function BulkActionBar({
  selectedCount,
  countLabel,
  countNote,
  actions,
  onClear,
  busy = false,
}: BulkActionBarProps) {
  const { t } = useTranslation();
  const { sidebarWidth } = useSidebar();

  if (selectedCount === 0) return null;

  // 把數字從呼叫端傳入的句子中切出來放大顯示
  const countText = String(selectedCount);
  const countAt = countLabel.indexOf(countText);
  const before = countAt >= 0 ? countLabel.slice(0, countAt) : countLabel;
  const after =
    countAt >= 0 ? countLabel.slice(countAt + countText.length) : "";
  const clearLabel = t("common.selection.clear");

  return (
    <div
      className="pointer-events-none fixed bottom-5 right-0 z-40 flex justify-center"
      style={{
        left: `${sidebarWidth}px`,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div
        role="toolbar"
        aria-label={countLabel}
        data-testid="bulk-action-bar"
        className="pointer-events-auto flex max-w-[calc(100%-32px)] overflow-x-auto items-center gap-2 rounded-full bg-blue-700 py-2 pl-5 pr-2 text-white shadow-[0_12px_32px_rgba(17,24,39,0.22)] animate-in slide-in-from-bottom duration-200 motion-reduce:animate-none dark:bg-blue-600 max-[480px]:gap-1.5 max-[480px]:pl-3 max-[480px]:pr-1.5"
      >
        <span className="mr-2 shrink-0 whitespace-nowrap text-sm max-[480px]:mr-0">
          {before}
          {countAt >= 0 && (
            <span className="text-base font-bold tabular-nums">
              {countText}
            </span>
          )}
          {after}
          {countNote && (
            <span className="ml-2 text-xs font-medium text-amber-200">
              {countNote}
            </span>
          )}
        </span>
        {actions.map((action) => {
          if (action.kind === "switch") {
            const toggle = (
              <LabeledSwitch
                key={action.key}
                tone="onDark"
                checked={action.checked}
                label={action.label}
                ariaLabel={action.ariaLabel}
                disabled={busy || action.disabled}
                onCheckedChange={action.onToggle}
              />
            );
            // LabeledSwitch 不收 data-testid：有 testId 才包一層不影響排版的 span
            return action.testId ? (
              <span
                key={action.key}
                className="contents"
                data-testid={action.testId}
              >
                {toggle}
              </span>
            ) : (
              toggle
            );
          }
          const variant = action.variant ?? "primary";
          const compact = variant !== "primary";
          const reason = action.disabled ? action.disabledReason : undefined;
          const badge = action.disabled ? action.disabledBadge : undefined;
          return (
            <button
              key={action.key}
              type="button"
              onClick={action.onClick}
              disabled={busy || action.disabled || action.loading}
              aria-label={compact ? action.label : undefined}
              aria-busy={action.loading || undefined}
              title={reason ?? (compact ? action.label : undefined)}
              data-testid={action.testId}
              className={`${BUTTON_CLASS[variant]} ${FOCUS_RING}`}
            >
              {action.loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                action.icon
              )}
              {renderLabel(action)}
              {badge && (
                <span className="rounded-full bg-white/15 px-1.5 text-xs font-medium max-[480px]:hidden">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          aria-label={clearLabel}
          data-testid="bulk-action-bar-clear"
          className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-sm text-white/90 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60 max-[480px]:px-2 ${FOCUS_RING}`}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="max-[480px]:hidden">{clearLabel}</span>
        </button>
      </div>
    </div>
  );
}

export default BulkActionBar;
