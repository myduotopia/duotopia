/**
 * 題庫分頁（QuestionBankTab）裡「上傳題本」的接線（#1112；C4-0 自 QuestionBankTab 拆出，行為不變）。
 *
 * 狀態（useExamImport）與面板（ExamImportSheet）放在外層頁面（我的教材 TeacherTemplatePrograms、
 * 機構教材 OrgMaterialsPage），由 `examImport` prop 傳進題庫分頁——切到「教材」分頁時題庫分頁會
 * 卸載，處理要繼續。題庫分頁只需要兩樣：
 * - `ExamImportTabBanner`：最上方未完成匯入提示列（沒傳 controller 不顯示）
 * - `examImportToolbarProps`：工具列「新增題目 ▽ → 上傳題本」。有一份正在處理時停用並說明原因；
 *   沒傳 controller（學校題庫）停用、標「即將推出」
 */
import ExamImportBanner from "./ExamImportBanner";
import type { ExamImportController } from "./useExamImport";

export function ExamImportTabBanner({
  examImport,
}: {
  examImport?: ExamImportController;
}) {
  if (!examImport) return null;
  return <ExamImportBanner controller={examImport} />;
}

export function examImportToolbarProps(examImport?: ExamImportController) {
  return {
    onUploadExam: examImport?.openUpload,
    uploadExamBusy: !!examImport?.running,
  };
}
