/**
 * ScenarioDialogueEditorSheet — 情境對話面板的外框（Issue #1014）。
 *
 * 搭配 `useScenarioDialogueEditor()`：hook 管 state 與存檔，這裡管「標題、怎麼關」。
 * 四個接線點只要各寫一行 `<ScenarioDialogueEditorSheet editor={editor} />`，
 * 不必再各自複製一份側滑容器 + RefSaveButton + 關閉確認。
 *
 * 外框本身（側滑／置中 modal、標題列、✕、`100dvh`、內容區不捲動不加內距）從 #1158 C 段
 * commit 3 起改用共用的 `components/shared/guided-chat/GuidedChatSheet`，例句集、單字集
 * 之後也會換成同一份；這裡只填情境對話自己的標題、徽章、儲存鈕與關閉確認。
 *
 * 兩種呈現方式是照現況分的，不是新發明：教材頁（我的／機構／學校／班級）用的是
 * 從右側滑出、避開側邊欄的面板；`ProgramTreeView` 用的是置中 modal。硬要統一會動到
 * 其他題型在那些頁面的既有版面，不在這張單的範圍。
 *
 * 面板裡面自己分「捲動區＋固定在底端的操作列」（#1146 修正第 4 輪，見
 * `scenario-dialogue-editor/ScenarioSheetLayout`）。瀏海機 home bar 的 safe-area 內距由
 * 操作列自己留（`ScenarioActionBar`）。
 */
import { useTranslation } from "react-i18next";
import { useRef } from "react";
import { RefSaveButton } from "@/components/shared/RefSaveButton";
import { GuidedChatSheet } from "@/components/shared/guided-chat/GuidedChatSheet";
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

  return (
    <GuidedChatSheet
      variant={variant}
      sidebarWidth={sidebarWidth}
      // #1013: 編輯既有內容時標題要說「編輯」，寫「新增」會讓老師以為自己
      // 開錯地方、又建了一份新的
      title={t(
        editor.contentId
          ? "scenarioDialogue.editTitle"
          : "scenarioDialogue.dialogTitle",
      )}
      badges={
        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
          {t("scenarioDialogue.badge")}
        </span>
      }
      actions={<RefSaveButton panelRef={panelRef} />}
      onClose={handleClose}
      closeDisabled={editorBusy}
    >
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
    </GuidedChatSheet>
  );
}

export default ScenarioDialogueEditorSheet;
