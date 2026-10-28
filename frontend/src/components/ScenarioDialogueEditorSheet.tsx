/**
 * ScenarioDialogueEditorSheet — 情境對話面板的外框（Issue #1014）。
 *
 * 搭配 `useScenarioDialogueEditor()`：hook 管 state 與存檔，這裡管「長什麼樣、
 * 怎麼關」。四個接線點只要各寫一行 `<ScenarioDialogueEditorSheet editor={editor} />`，
 * 不必再各自複製一份側滑容器 + RefSaveButton + 關閉確認。
 *
 * 兩種呈現方式是照現況分的，不是新發明：教材頁（我的／機構／學校／班級）用的是
 * 從右側滑出、避開側邊欄的面板；`ProgramTreeView` 用的是置中 modal。硬要統一會動到
 * 其他題型在那些頁面的既有版面，不在這張單的範圍。
 *
 * 面板外框只負責撐出 header 以下的高度（`flex-1 min-h-0 flex flex-col`），**不捲動、不加內距**：
 * 面板裡面自己分「捲動區＋固定在底端的操作列」（#1146 修正第 4 輪，見
 * `scenario-dialogue-editor/ScenarioSheetLayout`）。外框若再 overflow-auto，操作列就會
 * 跟著內容一起捲走。
 */
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { RefSaveButton } from "@/components/shared/RefSaveButton";
import ScenarioDialoguePanel, {
  type ScenarioDialoguePanelHandle,
} from "@/components/ScenarioDialoguePanel";
import { useSidebar } from "@/contexts/SidebarContext";
import type { ScenarioDialogueEditorState } from "@/hooks/useScenarioDialogueEditor";

export interface ScenarioDialogueEditorSheetProps {
  editor: ScenarioDialogueEditorState;
  /**
   * `sheet`（預設）= 從右側滑出、左邊讓開側邊欄；`modal` = 置中對話框。
   * 選 `sheet` 的呼叫端必須在 `SidebarProvider` 底下（教材頁都是）。
   */
  variant?: "sheet" | "modal";
}

export function ScenarioDialogueEditorSheet({
  editor,
  variant = "sheet",
}: ScenarioDialogueEditorSheetProps) {
  const { t } = useTranslation();
  const panelRef = useRef<ScenarioDialoguePanelHandle>(null);
  // RefSaveButton 讀的是 context 的 editorBusy（#651：直接讀 ref 會拿到 stale 值），
  // 這裡的關閉鍵也一樣，兩個要一起擋才不會「存到一半還能把面板關掉」
  const { sidebarWidth, editorBusy } = useSidebar();

  if (!editor.isOpen) return null;

  const handleClose = () => {
    if (editorBusy) return;
    if (!window.confirm(t("contentEditor.labels.unsavedChangesConfirm")))
      return;
    editor.close();
  };

  const header = (
    <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">
          {/* #1013: 編輯既有內容時標題要說「編輯」，寫「新增」會讓老師以為自己
              開錯地方、又建了一份新的 */}
          {t(
            editor.contentId
              ? "scenarioDialogue.editTitle"
              : "scenarioDialogue.dialogTitle",
          )}
        </h2>
        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
          {t("scenarioDialogue.badge")}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <RefSaveButton panelRef={panelRef} />
        <Button
          variant="ghost"
          size="icon"
          disabled={editorBusy}
          onClick={handleClose}
          aria-label={t("common.close", "Close")}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );

  const panel = (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScenarioDialoguePanel
        /**
         * #1013: key 綁內容 id —— 面板把 initialData 當初值（lazy initializer），
         * 換一份內容必須重新掛載才會重新取初值；沿用同一個實例的話，老師會在新內容
         * 裡看到上一份的題目。
         */
        key={editor.contentId ?? "new"}
        ref={panelRef}
        programLevel={editor.programLevel}
        initialData={editor.initialData}
        isSaving={editor.isSaving}
        onSave={editor.save}
        onCancel={editor.close}
      />
    </div>
  );

  if (variant === "modal") {
    return (
      <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
        <div className="relative w-full max-w-7xl h-[90vh] bg-white rounded-lg flex flex-col">
          {header}
          {panel}
        </div>
      </div>
    );
  }

  return (
    <div
      className="editor-panel fixed top-0 right-0 h-screen bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col animate-in slide-in-from-right duration-300"
      style={{ left: `${sidebarWidth}px` }}
    >
      {header}
      {panel}
    </div>
  );
}

export default ScenarioDialogueEditorSheet;
