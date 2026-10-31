/**
 * 引導式對話的外層側滑面板外框（Issue #1158 C 段 commit 3，從
 * `ScenarioDialogueEditorSheet.tsx` 抽出；情境對話先改用，例句集、單字集之後再換）。
 *
 * 只管「長什麼樣」：標題列（標題＋徽章＋右側動作，例如儲存鈕）、✕ 關閉鈕，以及
 * header 以下撐滿高度的內容區。存檔、關閉前確認、要不要打開，都由呼叫端決定。
 *
 * 兩種呈現：
 * - `sheet`（預設）：從右側滑出，左緣貼齊側邊欄（`sidebarWidth`，由呼叫端從
 *   `useSidebar()` 取；展開 256px、收合 64px）。高度 `100dvh`：手機瀏覽器的網址列／工具列
 *   會吃掉 `100vh` 的一截，用 `h-screen` 時固定在底端的東西會被蓋住。
 * - `modal`：置中對話框（`max-w-7xl`、`90vh`），`ProgramTreeView` 用。
 *
 * 內容區只撐出 header 以下的高度（`flex-1 min-h-0 flex flex-col`），**不捲動、不加內距**：
 * 裡面自己分捲動區與固定在底端的東西（對話框、操作列）。外框若再 overflow-auto，固定在
 * 底端的東西就會跟著內容一起捲走。
 *
 * 用法：
 * ```tsx
 * <GuidedChatSheet
 *   title={t("scenarioDialogue.dialogTitle")}
 *   badges={<span …>{t("scenarioDialogue.badge")}</span>}
 *   actions={<RefSaveButton panelRef={panelRef} />}
 *   onClose={handleClose}
 *   closeDisabled={editorBusy}
 *   sidebarWidth={sidebarWidth}
 * >
 *   <Panel />
 * </GuidedChatSheet>
 * ```
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface GuidedChatSheetProps {
  title: ReactNode;
  /** 標題旁的徽章、Beta 標籤等 */
  badges?: ReactNode;
  /** ✕ 左邊的動作（例如儲存鈕） */
  actions?: ReactNode;
  onClose: () => void;
  /** 存檔中等情況不能關 */
  closeDisabled?: boolean;
  variant?: "sheet" | "modal";
  /** `sheet` 版左緣要讓開的側邊欄寬度（px） */
  sidebarWidth?: number;
  children: ReactNode;
}

export function GuidedChatSheet({
  title,
  badges,
  actions,
  onClose,
  closeDisabled = false,
  variant = "sheet",
  sidebarWidth = 0,
  children,
}: GuidedChatSheetProps) {
  const { t } = useTranslation();

  const header = (
    <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {badges}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <Button
          variant="ghost"
          size="icon"
          disabled={closeDisabled}
          onClick={onClose}
          aria-label={t("common.close", "Close")}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );

  const body = <div className="flex-1 min-h-0 flex flex-col">{children}</div>;

  if (variant === "modal") {
    return (
      <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
        <div className="relative w-full max-w-7xl h-[90vh] bg-white rounded-lg flex flex-col">
          {header}
          {body}
        </div>
      </div>
    );
  }

  return (
    <div
      className="editor-panel fixed top-0 right-0 h-[100dvh] bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col animate-in slide-in-from-right duration-300"
      style={{ left: `${sidebarWidth}px` }}
    >
      {header}
      {body}
    </div>
  );
}
