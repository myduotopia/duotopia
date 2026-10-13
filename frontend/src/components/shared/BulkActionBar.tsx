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
 *   按鈕層級依 docs/design/ui-style-guide.md 第 3 節深色欄：批次操作列沒有明確的下一步，
 *   所有按鈕一律同一樣式（半透明白底 bg-white/15、白字、無外框，hover bg-white/25），不分主次。
 *   variant "danger"（例：刪除）樣式與一般按鈕相同，只有圖示是紅色（text-red-200 包住呼叫端的 icon），
 *   且元件自動在它前面加一條細分隔線（前面沒有其他動作時不加）。danger 必須給圖示；
 *   沒給圖示時文字改用同一紅色。元件不自動排序：呼叫端要把 danger 放在 actions 最後。
 *   loading 轉圈一律白色。
 *   開關動作（kind: "switch"）：以 LabeledSwitch tone="onDark" 呈現，文字在軌道內，
 *   小螢幕也保留文字（開關本身很短）；撥動呼叫 onToggle(新狀態)。
 * - 按鈕動作的選用提示：
 *   disabledReason：disabled 時當 title（滑鼠移上去顯示原因）；
 *   disabledBadge：disabled 時接在文字後的小標（例：「即將推出」）；
 *   loading：圖示換成轉圈、按鈕暫時不能按；testId：按鈕的 data-testid。
 * - 所有按鈕都帶 aria-label＝label；title：停用時用停用原因，否則用 label。
 * - ≤480px 縮小間距並隱藏「取消選取」文字（保留 ✕ 與 aria-label）；所有按鈕只顯示圖示，
 *   沒有圖示時改顯示 shortLabel（未提供則截斷原文字）；分隔線保留；
 *   停用小標也隱藏（原因仍在 title）。動作太多仍放不下時，膠囊可橫向捲動。
 * selectedCount 為 0 時不渲染。busy 時所有按鈕與開關（含取消選取）停用。
 * test id：膠囊 `bulk-action-bar`、取消選取 `bulk-action-bar-clear`、各動作用 testId 指定
 * （開關動作的 testId 掛在外包的 display:contents span 上）。
 * 頁面需在列表底部預留空間（約 pb-24），最後一列才不會被擋住。
 *
 * sidebarWidth 來自 SidebarContext：TeacherLayout 與 OrganizationLayout 都有提供 SidebarProvider。
 */
import { Fragment, type ReactNode } from "react";
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
  /** 不寫＝一般按鈕；"danger"＝紅色圖示＋前方分隔線（必須給 icon） */
  variant?: "danger";
  icon?: ReactNode;
  /** ≤480px 且沒有圖示時改顯示的短文字 */
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

/** 深藍膠囊上所有按鈕（含 danger）同一樣式：半透明白底、白字、無外框 */
const BUTTON_CLASS =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-60 max-[480px]:px-2";

/** danger 的紅色（深藍底上約 ≥3:1；深色模式同） */
const DANGER_TEXT = "text-red-200";

function renderLabel(action: BulkButtonAction): ReactNode {
  // danger 沒給圖示時，文字改用紅色，避免和一般按鈕完全一樣
  const tone =
    action.variant === "danger" && !action.icon ? ` ${DANGER_TEXT}` : "";
  // 小螢幕：有圖示 → 只留圖示；沒有圖示 → 短文字（或截斷）
  if (action.icon || action.loading) {
    return <span className={`max-[480px]:hidden${tone}`}>{action.label}</span>;
  }
  if (action.shortLabel) {
    return (
      <>
        <span className={`max-[480px]:hidden${tone}`}>{action.label}</span>
        <span className={`hidden max-[480px]:inline${tone}`} aria-hidden="true">
          {action.shortLabel}
        </span>
      </>
    );
  }
  return (
    <span className={`max-[480px]:max-w-[4em] max-[480px]:truncate${tone}`}>
      {action.label}
    </span>
  );
}

function renderIcon(action: BulkButtonAction): ReactNode {
  // loading 轉圈一律白色（danger 也是）
  if (action.loading) {
    return <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />;
  }
  if (!action.icon) return null;
  if (action.variant === "danger") {
    return (
      <span className={`inline-flex ${DANGER_TEXT}`} aria-hidden="true">
        {action.icon}
      </span>
    );
  }
  return action.icon;
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
        {actions.map((action, index) => {
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
          const reason = action.disabled ? action.disabledReason : undefined;
          const badge = action.disabled ? action.disabledBadge : undefined;
          const button = (
            <button
              key={action.key}
              type="button"
              onClick={action.onClick}
              disabled={busy || action.disabled || action.loading}
              aria-label={action.label}
              aria-busy={action.loading || undefined}
              title={reason ?? action.label}
              data-testid={action.testId}
              className={`${BUTTON_CLASS} ${FOCUS_RING}`}
            >
              {renderIcon(action)}
              {renderLabel(action)}
              {badge && (
                <span className="rounded-full bg-white/25 px-1.5 text-xs font-medium max-[480px]:hidden">
                  {badge}
                </span>
              )}
            </button>
          );
          // danger 前面加細分隔線（前面沒有其他動作時不加）
          if (action.variant !== "danger" || index === 0) return button;
          return (
            <Fragment key={action.key}>
              <span
                role="separator"
                aria-orientation="vertical"
                className="h-5 w-px shrink-0 bg-white/30"
              />
              {button}
            </Fragment>
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
