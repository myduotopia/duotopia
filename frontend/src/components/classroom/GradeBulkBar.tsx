/**
 * GradeBulkBar — 班級勾選後的底部浮動操作列（#1097）
 *
 * 「我的班級」與機構後台班級管理共用。樣式參考 question-bank/QuestionBulkBar，
 * 但做成畫面底部置中的深藍膠囊（不是滿版橫條）：
 * - 外層 fixed 滿版 flex 容器從 sidebar 右緣（left: sidebarWidth）開始、justify-center，
 *   只有膠囊本身接收滑鼠事件，不擋住下方內容。
 * - 「已選 N 個班級」＋呼叫端傳入的動作按鈕（actions）＋「✕ 取消選取」。
 *   「我的班級」傳調整年級／調整等級／停用／啟用；機構後台只傳調整年級。
 *   variant "primary"（預設）＝白色膠囊主按鈕；"ghost"＝透明底白框次要按鈕。
 * - ≤480px 縮小間距並隱藏「取消選取」文字（保留 ✕ 與 aria-label）；ghost 按鈕只顯示圖示
 *   （aria-label／title 保留完整文字），沒有圖示時改顯示 shortLabel（未提供則截斷原文字）。
 *   動作太多仍放不下時，膠囊可橫向捲動。
 * selectedCount 為 0 時不渲染。busy 時所有按鈕（含取消選取）停用。
 * 頁面需在列表底部預留空間（約 pb-24），最後一列才不會被擋住。
 *
 * sidebarWidth 來自 SidebarContext：TeacherLayout 與 OrganizationLayout 都有提供 SidebarProvider。
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useSidebar } from "@/contexts/SidebarContext";

export interface GradeBulkAction {
  key: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  icon?: ReactNode;
  /** ≤480px 且沒有圖示時改顯示的短文字（僅 ghost） */
  shortLabel?: string;
}

export interface GradeBulkBarProps {
  selectedCount: number;
  actions: readonly GradeBulkAction[];
  onClear: () => void;
  busy?: boolean;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-blue-700 dark:focus-visible:ring-offset-blue-600";

const PRIMARY_BUTTON =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-4 py-1.5 text-sm font-bold text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60 max-[480px]:px-3";

const GHOST_BUTTON =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-white ring-1 ring-inset ring-white/40 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60 max-[480px]:px-2";

function renderLabel(action: GradeBulkAction): ReactNode {
  if (action.variant !== "ghost") return action.label;
  // 小螢幕：有圖示 → 只留圖示；沒有圖示 → 短文字（或截斷）
  if (action.icon) {
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

export function GradeBulkBar({
  selectedCount,
  actions,
  onClear,
  busy = false,
}: GradeBulkBarProps) {
  const { t } = useTranslation();
  const { sidebarWidth } = useSidebar();

  if (selectedCount === 0) return null;

  // 把數字從翻譯字串中切出來放大顯示（zh-TW「已選 N 個班級」、en「N classroom(s) selected」）
  const label = t("classroomGrade.selection.selectedCount", {
    count: selectedCount,
  });
  const countText = String(selectedCount);
  const countAt = label.indexOf(countText);
  const before = countAt >= 0 ? label.slice(0, countAt) : label;
  const after = countAt >= 0 ? label.slice(countAt + countText.length) : "";

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
        aria-label={label}
        data-testid="grade-bulk-bar"
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
        </span>
        {actions.map((action) => {
          const ghost = action.variant === "ghost";
          return (
            <button
              key={action.key}
              type="button"
              onClick={action.onClick}
              disabled={busy || action.disabled}
              aria-label={ghost ? action.label : undefined}
              title={ghost ? action.label : undefined}
              className={`${ghost ? GHOST_BUTTON : PRIMARY_BUTTON} ${FOCUS_RING}`}
            >
              {action.icon}
              {renderLabel(action)}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          aria-label={t("classroomGrade.selection.clear")}
          className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-sm text-white/90 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60 max-[480px]:px-2 ${FOCUS_RING}`}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="max-[480px]:hidden">
            {t("classroomGrade.selection.clear")}
          </span>
        </button>
      </div>
    </div>
  );
}

export default GradeBulkBar;
