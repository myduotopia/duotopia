/**
 * 情境對話面板的捲動區（#1146 修正第 4 輪起；#1158 C commit 4 改成同頁版面後只剩這一塊）。
 *
 * 面板改用共用的同頁外框（`components/shared/guided-chat/GuidedChatLayout`）：左欄是
 * 「已選項目列＋對話捲動區＋底部對話框」，右欄是「題目捲動區」。兩欄的捲動區都用這裡的
 * `ScenarioScrollArea`：`flex-1 min-h-0 overflow-y-auto`，吃掉固定在上下的東西以外的高度
 * （已選項目列、對話框是它的 flex 兄弟，不是疊在上面的 sticky／absolute，最後的內容不會被蓋住）。
 *
 * 原本的固定操作列（`ScenarioActionBar`：回上一步／下一步／查看題目清單）已經拿掉：同頁版面
 * 不再切換畫面，每一步的確認鈕放在對話裡的卡片上。
 *
 * 右側留白：老師後台右緣的數位教學工具列（DigitalTeachingToolbar，約 54px）疊在面板上，
 * 貼右緣那一欄的留白由外框加（`TOOLBAR_GUTTER_CLASS`），這裡只留一般內距 `p-6`，
 * 不再自己加 `pr-8 sm:pr-16`（否則右邊會留白兩次）。
 *
 * 手機虛擬鍵盤：觸控裝置上，捲動區裡的輸入欄位 focus 後（等鍵盤動畫）把欄位捲到捲動區
 * 中間，避免被鍵盤或底部對話框擋住。滑鼠裝置不捲，免得每點一個欄位畫面就跳。
 */
import {
  forwardRef,
  useCallback,
  type FocusEvent,
  type ReactNode,
} from "react";

/** 等虛擬鍵盤動畫跑完再捲（iOS / Android 約 250~300ms） */
const KEYBOARD_SETTLE_MS = 300;

const isTouchDevice = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(pointer: coarse)")?.matches;

export const ScenarioScrollArea = forwardRef<
  HTMLDivElement,
  { children: ReactNode; testId?: string }
>(({ children, testId = "scenario-scroll-area" }, ref) => {
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
      data-testid={testId}
      onFocus={revealFocusedField}
      className="min-h-0 flex-1 overflow-y-auto p-6"
    >
      {children}
    </div>
  );
});
ScenarioScrollArea.displayName = "ScenarioScrollArea";
