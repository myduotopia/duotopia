/**
 * 上傳題本面板（#1112 C3／C4）：同一個面板先是上傳畫面（ExamImportUploadForm），按「開始擷取」或
 * 從提示列「繼續」後換成綜合確認畫面（ExamImportReview，C4 定案 A1：取代原「處理進度」畫面）。
 * 另外顯示「放棄這次匯入」的 ConfirmDialog（提示列與核對畫面共用）。
 *
 * 面板寬度與其他「新增題目／新增教材」面板一致（第五輪）：editor-panel 寫法，左緣貼齊側邊欄
 * （`sidebarWidth` 由宿主傳入），手機版由 `index.css` 的 `.editor-panel` 規則滿版；背後半透明遮罩。
 * 關閉鈕、Esc 會關閉（關閉不停止處理）；**點遮罩不關閉**（遮罩 pointer-events-none，與
 * QuestionSheet 一致，C4 cold-read B13）。Esc 只看 `e.defaultPrevented`：上面疊著的 Dialog
 * （放大縮圖、看原題、確認視窗）由 Radix 先處理並標記，按 Esc 只關它自己；焦點在面板外（例如從
 * 「新增題目 ▽」選單開啟後焦點回到觸發鈕）也照樣能關（C4 第五輪遺留）。
 * 關閉鈕與 Esc 走 `controller.requestClose`：核對畫面有題目正在編輯時先存回草稿（還沒送的年段也先送），
 * 存不進去就不關、原因顯示在那一題與提示訊息（C4b 審查 3）。
 *
 * 不新增路由、不塞進 QuestionSheet.tsx。狀態都在 `useExamImport`（關掉面板不停止處理）。
 * 由「我的教材」頁（TeacherTemplatePrograms）與「機構教材」頁（OrgMaterialsPage）在分頁外渲染，
 * 切到「教材」分頁也不卸載（C3 review 3）。
 */
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/organization/ConfirmDialog";
import type { Program } from "@/types";
import ExamImportReview from "./ExamImportReview";
import ExamImportUploadForm from "./ExamImportUploadForm";
import type { ExamImportController } from "./useExamImport";

interface ExamImportSheetProps {
  controller: ExamImportController;
  programs: Program[];
  /** 側邊欄寬度（px）：面板左緣貼齊側邊欄，同頁其他編輯面板 */
  sidebarWidth: number;
}

export default function ExamImportSheet({
  controller,
  programs,
  sidebarWidth,
}: ExamImportSheetProps) {
  const { t } = useTranslation();
  const { open, view, abandonTarget } = controller;
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(controller.requestClose);
  closeRef.current = controller.requestClose;

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      void closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const isUpload = view === "upload";

  return (
    <>
      {open && (
        <>
          <div
            className="fixed inset-0 bg-black bg-opacity-20 z-40 transition-opacity pointer-events-none"
            data-testid="exam-import-backdrop"
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            tabIndex={-1}
            className="editor-panel fixed top-0 right-0 h-screen bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col animate-in slide-in-from-right duration-300 outline-none"
            style={{ left: `${sidebarWidth}px` }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            data-testid="exam-import-sheet"
            data-view={view}
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4 pr-8 sm:pr-16">
              <div className="min-w-0 space-y-1">
                <h2
                  id={titleId}
                  className="text-lg font-semibold text-gray-900"
                >
                  {isUpload
                    ? t("questionBank.examImport.upload.title")
                    : t("questionBank.examImport.review.title")}
                </h2>
                <p id={descId} className="text-sm text-gray-500">
                  {isUpload
                    ? t("questionBank.examImport.upload.description")
                    : t("questionBank.examImport.review.description")}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => void controller.requestClose()}
                aria-label={t("common.close", "關閉")}
                data-testid="exam-import-close"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            {isUpload ? (
              <div className="flex flex-1 flex-col min-h-0 p-6 pr-8 sm:pr-16">
                <ExamImportUploadForm
                  programs={programs}
                  onStart={controller.start}
                  onCancel={controller.close}
                  onOpenExisting={controller.openExisting}
                  organizationId={controller.organizationId}
                />
              </div>
            ) : (
              <ExamImportReview
                controller={controller}
                programs={programs}
                onRequestAbandon={controller.requestAbandon}
              />
            )}
          </div>
        </>
      )}
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
