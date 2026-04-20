/**
 * RefSaveButton — Save 按鈕，透過 ref 呼叫面板的 save()
 *
 * 功能：
 * 1. 面板 busy 時（批次操作中）自動 disabled
 * 2. 防止重複連續點擊（saving 中 disabled）
 */
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface PanelHandle {
  save: () => Promise<void>;
  isBusy: boolean;
}

interface RefSaveButtonProps {
  panelRef: React.RefObject<PanelHandle | null>;
}

export function RefSaveButton({ panelRef }: RefSaveButtonProps) {
  const { t } = useTranslation();
  const [isSaving, setIsSaving] = useState(false);

  const handleClick = useCallback(async () => {
    const panel = panelRef.current;
    if (!panel || panel.isBusy || isSaving) return;
    setIsSaving(true);
    try {
      await panel.save();
    } finally {
      setIsSaving(false);
    }
  }, [panelRef, isSaving]);

  return (
    <Button
      size="sm"
      className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
      disabled={isSaving || (panelRef.current?.isBusy ?? false)}
      onClick={handleClick}
    >
      {isSaving ? (
        <>
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          {t("contentEditor.buttons.processing")}
        </>
      ) : (
        t("contentEditor.buttons.save")
      )}
    </Button>
  );
}
