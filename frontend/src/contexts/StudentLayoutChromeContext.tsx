/**
 * StudentLayoutChromeContext — 讓學生版面（StudentLayout）裡的頁面調整版面外框（#1158 E-3）。
 *
 * 目前只有一件事：作答頁在窄螢幕（< lg，與 StudentLayout ☰ 斷點一致）不要顯示頂部
 * 「學生專區」標題列，把高度留給作答畫面。只有情境對話作答頁用（其他作業類型統一處理在 #1166）。
 *
 * 頁面呼叫 `useHideStudentHeaderOnMobile(active)`：active 為真時隱藏，卸載或 active 變假時恢復。
 * 不在 StudentLayout 底下（例如老師預覽頁）時 context 是 null，hook 什麼都不做。
 */

import { createContext, useContext, useEffect } from "react";

export interface StudentLayoutChrome {
  /** 窄螢幕（< lg）隱藏頂部標題列 */
  setHideHeaderOnMobile: (hide: boolean) => void;
}

export const StudentLayoutChromeContext =
  createContext<StudentLayoutChrome | null>(null);

/** active 為真時，窄螢幕隱藏 StudentLayout 標題列；卸載時恢復 */
export function useHideStudentHeaderOnMobile(active: boolean) {
  const chrome = useContext(StudentLayoutChromeContext);
  useEffect(() => {
    if (!chrome || !active) return;
    chrome.setHideHeaderOnMobile(true);
    return () => chrome.setHideHeaderOnMobile(false);
  }, [chrome, active]);
}
