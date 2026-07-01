/**
 * RecordingCard — issue #892 朗讀作答卡片（presentational 組合件）。
 *
 * 依 `state` 把 Stage 1/2 的零件組起來：
 *   RecordingCardLayout（骨架）
 *     ├─ header  = 題號列（questionNav）      ├─ attempts = ⚡ 指示
 *     ├─ card    = CardContent（headerSlot=AudioPlaybackBar，textSlot=染色文字）
 *     ├─ feedback= TeacherFeedbackBar（訂正模式 + 有回饋時）
 *     └─ controls= RecordingControls（中央狀態機）
 *
 * 純受控：所有互動經 callback 往上傳，元件本身不含 MediaRecorder / API 抓取
 * （那些由 Stage 5 的 Template 注入）。評測時翻譯自動弱化（state==="assessed"）。
 */
import type { ReactNode } from "react";
import { RecordingCardLayout } from "./RecordingCardLayout";
import { CardContent, type CardVariant } from "./CardContent";
import { AudioPlaybackBar } from "./AudioPlaybackBar";
import { RecordingControls, type RecordingState } from "./RecordingControls";
import { TeacherFeedbackBar } from "./TeacherFeedbackBar";

export interface RecordingCardProps {
  // ---- 內容 ----
  variant: CardVariant;
  text: string;
  translation?: string | null;
  showTranslation?: boolean;
  imageUrl?: string | null;
  showImage?: boolean;
  ipa?: string | null;
  partOfSpeech?: string | null;

  // ---- 狀態 ----
  state: RecordingState;
  isCorrection?: boolean;

  // ---- 頂部 ----
  questionNav?: ReactNode;
  attempts?: ReactNode;

  // ---- 示範音檔列 ----
  hasExampleAudio?: boolean;
  isPlayingExample?: boolean;
  playbackRate: number;
  onPlayExample?: () => void;
  onRateChange: (rate: number) => void;

  // ---- 控制列 ----
  onRecordStart?: () => void;
  onRecordStop?: () => void;
  onAnalyze?: () => void;
  onReRecord?: () => void;
  onPlayback?: () => void;
  onNext?: () => void;
  canPlayback?: boolean;
  canNext?: boolean;
  recordingDisabled?: boolean;
  canUseAiAnalysis?: boolean;
  recordingSeconds?: number;
  /** 卡片內是否顯示下一題（容器自帶導覽時設 false） */
  showNext?: boolean;

  // ---- 評測（Stage 4 注入）----
  coloredText?: ReactNode;
  scoreBadge?: ReactNode;

  // ---- 訂正 ----
  teacherPassed?: boolean | null;
  teacherFeedback?: string | null;
}

export const RecordingCard = ({
  variant,
  text,
  translation,
  showTranslation = true,
  imageUrl,
  showImage = true,
  ipa,
  partOfSpeech,
  state,
  isCorrection = false,
  questionNav,
  attempts,
  hasExampleAudio = true,
  isPlayingExample = false,
  playbackRate,
  onPlayExample,
  onRateChange,
  onRecordStart,
  onRecordStop,
  onAnalyze,
  onReRecord,
  onPlayback,
  onNext,
  canPlayback = false,
  canNext = false,
  recordingDisabled = false,
  canUseAiAnalysis = true,
  recordingSeconds = 0,
  showNext = true,
  coloredText,
  scoreBadge,
  teacherPassed = null,
  teacherFeedback,
}: RecordingCardProps) => {
  const showFeedback = isCorrection && !!teacherFeedback;

  return (
    <RecordingCardLayout
      header={questionNav}
      attempts={attempts}
      feedbackBar={
        showFeedback ? (
          <TeacherFeedbackBar passed={teacherPassed} feedback={teacherFeedback} />
        ) : undefined
      }
      controls={
        <RecordingControls
          state={state}
          onRecordStart={onRecordStart}
          onRecordStop={onRecordStop}
          onAnalyze={onAnalyze}
          onReRecord={onReRecord}
          onPlayback={onPlayback}
          onNext={onNext}
          canPlayback={canPlayback}
          canNext={canNext}
          disabled={recordingDisabled}
          canUseAiAnalysis={canUseAiAnalysis}
          recordingSeconds={recordingSeconds}
          showNext={showNext}
        />
      }
    >
      <CardContent
        variant={variant}
        text={text}
        translation={translation}
        showTranslation={showTranslation}
        imageUrl={imageUrl}
        showImage={showImage}
        ipa={ipa}
        partOfSpeech={partOfSpeech}
        headerSlot={
          <AudioPlaybackBar
            hasExampleAudio={hasExampleAudio}
            isPlaying={isPlayingExample}
            playbackRate={playbackRate}
            onPlayExample={onPlayExample}
            onRateChange={onRateChange}
          />
        }
        textSlot={coloredText}
        scoreBadge={scoreBadge}
        translationDimmed={state === "assessed"}
      />
    </RecordingCardLayout>
  );
};

export default RecordingCard;
