/**
 * 主圖文預覽（Issue #1082 第 2 段修訂）。
 *
 * 編輯器旁不再常駐預覽：按「預覽」開近全螢幕 Dialog，上方切「電腦／手機」；
 * 手機模式以 390px 置中並強制欄位上下堆疊。內容用共用 `LayoutRenderer`，
 * 老師看到的就是學生看到的。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Monitor, Smartphone } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GlossaryEntry, LayoutDoc } from "@/types/questionBank";
import LayoutRenderer from "./LayoutRenderer";

export interface LayoutPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layout: LayoutDoc | null;
  glossary?: GlossaryEntry[];
  testId?: string;
}

export default function LayoutPreviewDialog({
  open,
  onOpenChange,
  layout,
  glossary,
  testId = "layout-preview",
}: LayoutPreviewDialogProps) {
  const { t } = useTranslation();
  const [mobile, setMobile] = useState(false);

  const modeButton = (
    isMobile: boolean,
    Icon: typeof Monitor,
    label: string,
  ) => (
    <button
      type="button"
      onClick={() => setMobile(isMobile)}
      className={cn(
        "flex items-center gap-1 px-2.5 py-1 text-xs",
        mobile === isMobile
          ? "bg-gray-900 text-white"
          : "text-gray-600 hover:bg-gray-100",
      )}
      aria-pressed={mobile === isMobile}
      data-testid={`${testId}-${isMobile ? "mobile" : "desktop"}`}
    >
      <Icon size={13} />
      {label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[92vh] w-[1100px] max-w-[96vw] flex-col gap-3 p-4"
        data-testid={`${testId}-dialog`}
      >
        <DialogHeader className="flex-row items-center justify-between space-y-0 pr-6">
          <div>
            <DialogTitle className="text-base">
              {t("questionBank.group.layout.preview")}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t("questionBank.group.layout.previewHint")}
            </DialogDescription>
          </div>
          <div className="flex overflow-hidden rounded border border-gray-200">
            {modeButton(
              false,
              Monitor,
              t("questionBank.group.layout.previewDesktop"),
            )}
            {modeButton(
              true,
              Smartphone,
              t("questionBank.group.layout.previewMobile"),
            )}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md bg-gray-100 p-4">
          <div
            className={cn(
              "mx-auto rounded-md border border-gray-200 bg-white p-5 shadow-sm",
              mobile ? "w-[390px] max-w-full" : "max-w-3xl",
            )}
            data-testid={testId}
            data-mode={mobile ? "mobile" : "desktop"}
          >
            {layout ? (
              <LayoutRenderer
                layout={layout}
                glossary={glossary}
                forceStack={mobile}
              />
            ) : (
              <p className="py-8 text-center text-sm text-gray-400">
                {t("questionBank.group.layout.empty")}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
