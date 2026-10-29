/**
 * 編輯面板開著的登記（#1112 C4c 定案 U1）：全站浮動的數位教學工具列（DigitalTeachingToolbar）在
 * **手機寬度**、而且有編輯面板（editor-panel，例如上傳題本）開著時自動收成右緣小把手，免得蓋住面板內容；
 * 面板關掉就恢復。
 *
 * 面板呼叫 `useEditorPanelPresence(open)` 登記；工具列用 `useAnyEditorPanelOpen()` 讀。用計數
 * （不是布林）：同時開兩個面板、其中一個先關也不會誤判。其他面板（情境對話等）要同樣行為，加一行
 * `useEditorPanelPresence(open)` 就好。
 */
import { useEffect, useSyncExternalStore } from "react";

let openCount = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const snapshot = () => openCount > 0;

/** 面板開著時登記（`open` 變 false 或卸載時取消） */
export function useEditorPanelPresence(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    openCount += 1;
    emit();
    return () => {
      openCount = Math.max(0, openCount - 1);
      emit();
    };
  }, [open]);
}

/** 目前有沒有任何編輯面板開著 */
export function useAnyEditorPanelOpen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
