/**
 * 上傳題本 Sheet（#1112 C3）：寬版標準 Sheet，同一個 Sheet 先是上傳畫面
 * （ExamImportUploadForm），按「開始擷取」或從提示列「繼續」後換成處理進度（ExamImportProgress）。
 * 另外顯示「放棄這次匯入」的 ConfirmDialog（提示列與進度畫面共用）。
 *
 * 不新增路由、不塞進 QuestionSheet.tsx。狀態都在 `useExamImport`（關掉 Sheet 不停止處理）。
 */
import { useTranslation } from "react-i18next";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/organization/ConfirmDialog";
import type { Program } from "@/types";
import ExamImportProgress from "./ExamImportProgress";
import ExamImportUploadForm from "./ExamImportUploadForm";
import type { ExamImportController } from "./useExamImport";

interface ExamImportSheetProps {
  controller: ExamImportController;
  programs: Program[];
}

export default function ExamImportSheet({
  controller,
  programs,
}: ExamImportSheetProps) {
  const { t } = useTranslation();
  const { open, view, abandonTarget } = controller;
  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          if (!o) controller.close();
        }}
      >
        <SheetContent
          className="flex w-full flex-col sm:max-w-4xl"
          data-testid="exam-import-sheet"
          data-view={view}
        >
          <SheetHeader className="pr-8">
            <SheetTitle>
              {view === "upload"
                ? t("questionBank.examImport.upload.title")
                : t("questionBank.examImport.progress.title")}
            </SheetTitle>
            <SheetDescription>
              {view === "upload"
                ? t("questionBank.examImport.upload.description")
                : t("questionBank.examImport.progress.description")}
            </SheetDescription>
          </SheetHeader>
          {view === "upload" ? (
            <ExamImportUploadForm
              programs={programs}
              onStart={controller.start}
              onCancel={controller.close}
              onOpenExisting={(id) => void controller.openImport(id)}
            />
          ) : (
            <ExamImportProgress
              controller={controller}
              onRequestAbandon={controller.requestAbandon}
              onClose={controller.close}
            />
          )}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={abandonTarget !== null}
        onOpenChange={(o) => {
          if (!o) controller.cancelAbandon();
        }}
        title={t("questionBank.examImport.abandon.title")}
        description={t("questionBank.examImport.abandon.description", {
          name: abandonTarget?.file_name ?? "",
        })}
        confirmText={t("questionBank.examImport.abandon.confirm")}
        cancelText={t("common.cancel", "取消")}
        variant="destructive"
        onConfirm={controller.confirmAbandon}
      />
    </>
  );
}
