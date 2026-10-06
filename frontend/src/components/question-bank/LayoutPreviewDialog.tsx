/**
 * 題組預覽 Dialog（Issue #1082 第 2 段修訂；完整題組版）。
 *
 * 編輯器旁不再常駐預覽：按面板標題列的「預覽」（`SheetPreviewButton`，選擇題與題組共用）
 * 開近全螢幕 Dialog，上方切「電腦／手機」；
 * 手機模式以 390px 置中並強制欄位上下堆疊、選項直排。內容是 `GroupPreview`
 * （主圖文＋小題＋選項，不含答案／解析／考點），老師看到的就是學生看到的。
 * 傳入整個題組草稿（`draft`），不再只吃 layout／glossary；`stimulusView` 轉給 `GroupPreview`
 * 決定主圖文畫排版或文字版（跟著題組卡目前分頁）。
 *
 * 選擇題面板的「預覽」也用這個 Dialog（同一套電腦／手機切換）：改傳 `questions`，
 * 內容換成 `QuestionsPreview`（所有單題依序 1..n，不含答案／解析／考點）。
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
import GroupPreview, { type GroupPreviewData } from "./GroupPreview";
import QuestionsPreview from "./QuestionsPreview";
import type { QuestionDraft } from "./questionDraft";

export type LayoutPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testId?: string;
  /** 題組模式：主圖文畫排版或文字版（`GroupPreview` 的 `stimulusView`） */
  stimulusView?: "layout" | "text";
} & (
  | {
      /** 題組草稿（`GroupDraft` 可直接傳） */
      draft: GroupPreviewData;
      questions?: never;
    }
  | {
      /** 選擇題面板：右側所有單題（依序編號） */
      questions: QuestionDraft[];
      draft?: never;
    }
);

export default function LayoutPreviewDialog({
  open,
  onOpenChange,
  draft,
  questions,
  testId = "layout-preview",
  stimulusView = "layout",
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
            {draft ? (
              <GroupPreview
                draft={draft}
                forceStack={mobile}
                stimulusView={stimulusView}
                testId={`${testId}-group`}
              />
            ) : (
              <QuestionsPreview
                questions={questions ?? []}
                forceStack={mobile}
                className="text-[15px] text-gray-900"
                testId={`${testId}-questions`}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
