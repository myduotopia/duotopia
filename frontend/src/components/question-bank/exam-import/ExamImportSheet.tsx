/**
 * 上傳題本面板（#1112 C3）：同一個面板先是上傳畫面（ExamImportUploadForm），按「開始擷取」或
 * 從提示列「繼續」後換成處理進度（ExamImportProgress）。
 * 另外顯示「放棄這次匯入」的 ConfirmDialog（提示列與進度畫面共用）。
 *
 * 面板寬度與其他「新增題目／新增教材」面板一致（第五輪）：editor-panel 寫法，左緣貼齊側邊欄
 * （`sidebarWidth` 由宿主傳入），手機版由 `index.css` 的 `.editor-panel` 規則滿版；背後半透明遮罩。
 * 關閉鈕、Esc、點遮罩都會關閉（關閉不停止處理）；Esc 只在焦點在面板內或頁面本身時才關，
 * 上面疊著的 Dialog（放大縮圖、放棄確認）按 Esc 只關它自己。
 *
 * 不新增路由、不塞進 QuestionSheet.tsx。狀態都在 `useExamImport`（關掉面板不停止處理）。
 * 由「我的教材」頁（TeacherTemplatePrograms）在分頁外渲染，切到「教材」分頁也不卸載（C3 review 3）。
 */
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/organization/ConfirmDialog";
import type { Program } from "@/types";
import ExamImportProgress from "./ExamImportProgress";
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
  const closeRef = useRef(controller.close);
  closeRef.current = controller.close;

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const active = document.activeElement;
      const inPanel =
        !active ||
        active === document.body ||
        (panelRef.current?.contains(active) ?? false);
      if (inPanel) closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      {open && (
        <>
          <div
            className="fixed inset-0 bg-black bg-opacity-20 z-40 transition-opacity"
            onClick={controller.close}
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
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
              <div className="min-w-0 space-y-1">
                <h2
                  id={titleId}
                  className="text-lg font-semibold text-gray-900"
                >
                  {view === "upload"
                    ? t("questionBank.examImport.upload.title")
                    : t("questionBank.examImport.progress.title")}
                </h2>
                <p id={descId} className="text-sm text-gray-500">
                  {view === "upload"
                    ? t("questionBank.examImport.upload.description")
                    : t("questionBank.examImport.progress.description")}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={controller.close}
                aria-label={t("common.close", "關閉")}
                data-testid="exam-import-close"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex flex-1 flex-col min-h-0 p-6">
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
            </div>
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
