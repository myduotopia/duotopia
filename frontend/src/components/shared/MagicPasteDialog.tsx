/**
 * MagicPasteDialog — 魔術貼上的 Dialog 外殼（手機版用；issue #891）
 *
 * 桌面版改用 BatchWorkPanel 的「圖片 / PDF」tab 直接內嵌 MagicPasteInput；
 * 本 Dialog 保留給手機版（批次工具列按鈕開啟）。核心邏輯都在 MagicPasteInput。
 */
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import MagicPasteInput, {
  type MagicPasteItem,
  type MagicPasteExtractMode,
} from "@/components/shared/MagicPasteInput";

export type { MagicPasteItem, MagicPasteExtractMode };

interface MagicPasteDialogProps {
  open: boolean;
  onClose: () => void;
  onInsert: (items: MagicPasteItem[]) => void;
  level?: string;
  extractMode?: MagicPasteExtractMode;
}

export default function MagicPasteDialog({
  open,
  onClose,
  onInsert,
  level = "A1",
  extractMode = "vocabulary",
}: MagicPasteDialogProps) {
  const isSentenceMode = extractMode === "sentence";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            魔術貼上：從圖片 / PDF 擷取教材
          </DialogTitle>
          <DialogDescription>
            {isSentenceMode
              ? "上傳一張圖片或 PDF，AI 會自動擷取句子與翻譯，預覽確認後再插入。"
              : "上傳一張圖片或 PDF，AI 會自動擷取單字、翻譯與例句，預覽確認後再插入。"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
          <MagicPasteInput
            onInsert={onInsert}
            level={level}
            extractMode={extractMode}
            onAfterInsert={onClose}
            onCancel={onClose}
            resetSignal={open}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
