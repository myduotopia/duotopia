/**
 * QuizNavSlotContext — 小考題號 bar 的 Page → Activity portal slot
 *
 * Page (StudentActivityPageContent) 在 back 按鈕下方保留一個空 div 作為 slot，
 * 透過此 context 把 slot DOM 節點傳給內部任何 quiz Activity。Activity 用
 * createPortal(navBar, slotEl) 把題號 bar 投射到 Page header 區，但 quiz state
 * 仍由 Activity 自己持有。一次只 render 一個 Activity，所以 slot 不會搶。
 */

import { createContext, useContext } from "react";

export const QuizNavSlotContext = createContext<HTMLElement | null>(null);

export function useQuizNavSlot(): HTMLElement | null {
  return useContext(QuizNavSlotContext);
}
