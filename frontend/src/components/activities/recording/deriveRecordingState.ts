/**
 * deriveRecordingState — issue #892 錄音狀態單一真相源。
 *
 * word / sentence 兩個 Template 共用，確保 5 個入口的狀態切換完全一致。
 * 對照設計狀態：A(idle) → C1(recording) → C0(recorded) → C4(assessed)，
 * 以及 C5 訂正模式（isCorrection，與上述 4 態正交，決定是否顯示評語條/補滿⚡）。
 */
import type { RecordingState } from "./RecordingControls";

export interface DeriveStateParams {
  /** 正在錄音中 */
  isRecording: boolean;
  /** 已有錄音（audioUrl 存在，含麥克風或上傳） */
  hasRecordingUrl: boolean;
  /** 已有 AI 評測結果 */
  hasAssessment: boolean;
  /** 作業狀態；RETURNED = 待訂正 */
  assignmentStatus?: string | null;
}

export interface DerivedRecordingState {
  state: RecordingState;
  /** 訂正模式：顯示老師評語條、⚡ 補滿、可重錄 */
  isCorrection: boolean;
}

/**
 * 優先序：錄音中 > 已評測 > 已錄未評 > 尚未錄。
 * 已評測需以 hasAssessment 為準（不靠 hasRecordingUrl），因為評測後仍保有錄音。
 */
export const deriveRecordingState = ({
  isRecording,
  hasRecordingUrl,
  hasAssessment,
  assignmentStatus,
}: DeriveStateParams): DerivedRecordingState => {
  const state: RecordingState = isRecording
    ? "recording"
    : hasAssessment
      ? "assessed"
      : hasRecordingUrl
        ? "recorded"
        : "idle";

  return { state, isCorrection: assignmentStatus === "RETURNED" };
};
