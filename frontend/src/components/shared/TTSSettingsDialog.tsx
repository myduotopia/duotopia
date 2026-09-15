/**
 * TTSSettingsDialog — 單一題目產生語音前的設定視窗（口音／性別／語速）
 *
 * Issue #1051：單一 item 的麥克風按鈕要先讓老師設定再產生。
 * 設定介面直接沿用 `BatchTTSSettings`（section variant），不另寫一套選單。
 *
 * 記憶規則由呼叫端決定 `initialSettings`：老師上次選什麼（含 Random）就帶什麼，
 * 本元件只負責在每次打開時重設為 `initialSettings`，按「生成」時回傳選定值。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  BatchTTSSettings,
  type TTSSettingsState,
} from "@/components/shared/BatchTTSSettings";

export interface TTSSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 打開時預設帶入的設定（上次的設定） */
  initialSettings: TTSSettingsState;
  /** 按「生成」時回傳老師選定的設定 */
  onConfirm: (settings: TTSSettingsState) => void;
}

export function TTSSettingsDialog({
  open,
  onOpenChange,
  initialSettings,
  onConfirm,
}: TTSSettingsDialogProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<TTSSettingsState>(initialSettings);

  // 每次打開都以最新的「上次設定」為起點，避免殘留上一題未確認的選擇
  useEffect(() => {
    if (open) setSettings(initialSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("contentEditor.modals.audioSettings")}</DialogTitle>
        </DialogHeader>
        <BatchTTSSettings
          variant="section"
          settings={settings}
          onChange={setSettings}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onConfirm(settings)}>
            {t("contentEditor.ttsSettings.generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
