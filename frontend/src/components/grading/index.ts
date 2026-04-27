/**
 * 批改頁共用元件 — 批改頁採「同路由 + Panel 分流」模式
 *
 * ⚠️ 新增作業類型前請先閱讀 docs/design/grading-page-architecture.md
 *
 * ─── 作業類型不可知元件（Shared — 勿依作業類型改行為） ───
 * - GradingHeader: 頂部工具列（學生切換、儲存狀態）
 * - StudentListPanel: 左欄學生列表
 * - OverallFeedbackPanel: 右欄總評（分數、總評語、完成/要求訂正）
 *
 * ─── 作業類型專屬 Panel（Per-practice-mode — 新類型加新檔案） ───
 * - ReadingAssessmentPanel: practice_mode = "reading" | "word_reading"
 * - SentenceRearrangementPanel: practice_mode = "rearrangement"
 * - （未來新增：XxxAssessmentPanel 依 practice_mode 新增）
 *
 * 分流點在 src/pages/teacher/GradingPage.tsx 中間欄的 conditional render。
 */

export { GradingHeader } from "./GradingHeader";
export { StudentListPanel } from "./StudentListPanel";
export { OverallFeedbackPanel } from "./OverallFeedbackPanel";
export { ReadingAssessmentPanel } from "./ReadingAssessmentPanel";
export { SentenceRearrangementPanel } from "./SentenceRearrangementPanel";
