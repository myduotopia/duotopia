/**
 * 情境對話面板的版面骨架（#1146 修正第 4 輪）：上面一塊捲動區＋下面一條固定操作列。
 *
 * 引導式對話與題目清單都用這兩塊，整個 sheet 的操作位置一致：
 *
 * - `ScenarioScrollArea`：`flex-1 min-h-0 overflow-y-auto`，吃掉固定列以外的高度。
 *   固定列是它的 flex 兄弟（不是疊在上面的 sticky／absolute），捲動區的高度本來就已經
 *   扣掉固定列，最後的內容不會被蓋住；底部 `pb-6` 只是留白。
 * - `ScenarioActionBar`：`shrink-0`，白底＋上方細分隔線，固定在 sheet 最底端、不隨內容捲動。
 *   左＝回上一步，右＝當前步驟主要動作（由呼叫端決定按鈕與層級）。
 *
 * 右側留白 `pr-8 sm:pr-16`（＝ sheet 原本的 p-6 再加 pr-2 / sm:pr-10）：老師後台的數位教學
 * 工具列（DigitalTeachingToolbar）固定在視窗右緣、約 54px 寬、疊在 sheet 上面；不留白的話
 * 貼右的老師泡泡、題目卡右側按鈕與固定列的主按鈕會被蓋住（修正第 2 輪）。手機只多留 8px
 * （第 3 輪）：390px 寬再讓出 40px 會太擠，手機上工具列可收合、可上下拖開。
 *
 * 手機虛擬鍵盤：觸控裝置上，捲動區裡的輸入欄位 focus 後（等鍵盤動畫）把欄位捲到捲動區
 * 中間，避免被鍵盤或固定列擋住。滑鼠裝置不捲，免得每點一個欄位畫面就跳。
 */
import {
  forwardRef,
  useCallback,
  type FocusEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

/** 等虛擬鍵盤動畫跑完再捲（iOS / Android 約 250~300ms） */
const KEYBOARD_SETTLE_MS = 300;

const isTouchDevice = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(pointer: coarse)")?.matches;

export const ScenarioScrollArea = forwardRef<
  HTMLDivElement,
  { children: ReactNode }
>(({ children }, ref) => {
  const revealFocusedField = useCallback((e: FocusEvent<HTMLDivElement>) => {
    const el = e.target;
    if (
      !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) ||
      !isTouchDevice()
    ) {
      return;
    }
    window.setTimeout(() => {
      if (document.activeElement === el) {
        el.scrollIntoView?.({ block: "center" });
      }
    }, KEYBOARD_SETTLE_MS);
  }, []);

  return (
    <div
      ref={ref}
      data-testid="scenario-scroll-area"
      onFocus={revealFocusedField}
      className="min-h-0 flex-1 overflow-y-auto p-6 pr-8 sm:pr-16"
    >
      {children}
    </div>
  );
});
ScenarioScrollArea.displayName = "ScenarioScrollArea";

export function ScenarioActionBar({
  left,
  right,
}: {
  left?: ReactNode;
  right?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("scenarioDialogue.setup.actionBar")}
      className="flex shrink-0 items-center gap-2 border-t border-gray-200 bg-white px-6 py-3 pr-8 sm:pr-16"
    >
      {left}
      <span className="flex-1" />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {right}
      </div>
    </div>
  );
}
