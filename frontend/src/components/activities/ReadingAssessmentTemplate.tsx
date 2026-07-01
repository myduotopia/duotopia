/**
 * ReadingAssessmentTemplate — 例句朗讀單題顯示元件（#892 卡片改版）
 *
 * 功能（全數保留，僅改顯示方式）:
 * - 顯示例句 + 翻譯（含逐字染色）
 * - 播放老師示範音（倍速 0.75 / 1 / 1.5）
 * - 錄音（useCardRecorder：限時 / auto-stop / 超時拒絕）或上傳音檔
 * - Azure Speech AI 評分 + 分數徽章（雷達）+ 星級鼓勵動畫
 *
 * ⚠️ 此元件同時被學生作答頁與派發 sheet 預覽共用。
 *    改動前必讀：docs/design/preview-architecture.md
 * 版面骨架見 RecordingCard；題號 / 導覽由父層提供（位置與功能不變）。
 */
import { useState, useRef, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAzurePronunciation } from "@/hooks/useAzurePronunciation";
import { useDemoAzurePronunciation } from "@/hooks/useDemoAzurePronunciation";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { appendAudioToFormData } from "@/utils/audioFormatDetection";
import ScoreOverlay from "./shared/ScoreOverlay";
import PronunciationScoreChart from "./shared/PronunciationScoreChart";
import { RecordingCard } from "./recording/RecordingCard";
import {
  WordWithScoreColor,
  type ScoredWord,
} from "./recording/WordWithScoreColor";
import { ScoreBadge } from "./recording/ScoreBadge";
import { useCardRecorder } from "./recording/useCardRecorder";
import { deriveRecordingState } from "./recording/deriveRecordingState";

interface AssessmentResult {
  overallScore: number;
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  pronunciationScore: number;
  feedback: string;
  detailed_words?: Array<{
    index: number;
    word: string;
    accuracy_score: number;
    error_type?: string;
  }>;
}

interface ReadingAssessmentProps {
  content: string;
  targetText: string;
  existingAudioUrl?: string | null;
  onRecordingComplete?: (blob: Blob, url: string) => void;
  exampleAudioUrl?: string;
  progressId?: number;
  readOnly?: boolean;
  isDemoMode?: boolean;
  timeLimit?: number;
  canUseAiAnalysis?: boolean;
  // Issue #689 — Phase 1 frontend attempt gate
  recordingDisabled?: boolean;
  attemptsHint?: React.ReactNode;
  onAnalysisSuccess?: () => void;
  // Issue #752: dialog 內即時預覽 — 跳過 background upload（避免扣老師點數）
  isLivePreview?: boolean;
}

export default function ReadingAssessmentTemplate({
  content,
  targetText,
  existingAudioUrl,
  onRecordingComplete,
  exampleAudioUrl,
  progressId: _progressId,
  readOnly = false,
  isDemoMode = false,
  timeLimit = 0,
  canUseAiAnalysis = true,
  recordingDisabled = false,
  attemptsHint,
  onAnalysisSuccess,
  isLivePreview = false,
}: ReadingAssessmentProps) {
  const { t } = useTranslation();
  const [audioUrl, setAudioUrl] = useState<string | undefined>(
    existingAudioUrl || undefined,
  );
  const [isAssessing, setIsAssessing] = useState(false);
  const [assessmentResult, setAssessmentResult] =
    useState<AssessmentResult | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isPlayingExample, setIsPlayingExample] = useState(false);
  const [scoreOverlayOpen, setScoreOverlayOpen] = useState(false);
  const [scoreOverlayScore, setScoreOverlayScore] = useState(0);

  const exampleAudioRef = useRef<HTMLAudioElement | null>(null);
  const recordedAudioRef = useRef<HTMLAudioElement | null>(null);

  const regularHook = useAzurePronunciation();
  const demoHook = useDemoAzurePronunciation();
  const { analyzePronunciation } = isDemoMode ? demoHook : regularHook;

  const recorder = useCardRecorder({
    timeLimit,
    onComplete: (blob, url) => {
      if (audioUrl && audioUrl.startsWith("blob:")) {
        URL.revokeObjectURL(audioUrl);
      }
      setAudioUrl(url);
      onRecordingComplete?.(blob, url);
    },
    onError: (msg) => toast.error(t("audioRecorder.toast.cannotStart") || msg),
    onOverLimit: (recorded, limit) =>
      toast.error(
        t("wordReading.toast.recordingExceedsLimit", { recorded, limit }) ||
          `錄音時間 ${recorded} 秒超過限制 ${limit} 秒，請重新錄音`,
      ),
  });

  const handlePlayExample = useCallback(() => {
    if (!exampleAudioUrl) return;
    if (isPlayingExample && exampleAudioRef.current) {
      exampleAudioRef.current.pause();
      setIsPlayingExample(false);
      return;
    }
    if (!exampleAudioRef.current) {
      const audio = new Audio(exampleAudioUrl);
      audio.addEventListener("ended", () => setIsPlayingExample(false));
      exampleAudioRef.current = audio;
    }
    exampleAudioRef.current.playbackRate = playbackRate;
    exampleAudioRef.current.currentTime = 0;
    exampleAudioRef.current.play().catch(() => setIsPlayingExample(false));
    setIsPlayingExample(true);
  }, [exampleAudioUrl, isPlayingExample, playbackRate]);

  const updatePlaybackRate = useCallback(
    (rate: number) => {
      setPlaybackRate(rate);
      if (exampleAudioRef.current && isPlayingExample) {
        exampleAudioRef.current.playbackRate = rate;
      }
    },
    [isPlayingExample],
  );

  const togglePlaybackRecorded = useCallback(() => {
    if (!audioUrl) return;
    if (recordedAudioRef.current && !recordedAudioRef.current.paused) {
      recordedAudioRef.current.pause();
      return;
    }
    const audio = recordedAudioRef.current ?? new Audio(audioUrl);
    if (audio.src !== audioUrl) audio.src = audioUrl;
    audio.playbackRate = 1.0;
    recordedAudioRef.current = audio;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, [audioUrl]);

  const handleFileUpload = useCallback(
    (file: File) => {
      if (audioUrl && audioUrl.startsWith("blob:")) {
        URL.revokeObjectURL(audioUrl);
      }
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      file.arrayBuffer().then((buffer) => {
        const blob = new Blob([buffer], { type: file.type });
        onRecordingComplete?.(blob, url);
      });
      toast.success(t("wordReading.toast.uploaded") || "音檔已上傳");
    },
    [audioUrl, onRecordingComplete, t],
  );

  const clearRecording = useCallback(() => {
    if (recordedAudioRef.current) recordedAudioRef.current.pause();
    if (audioUrl && audioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(undefined);
    setAssessmentResult(null);
    setScoreOverlayOpen(false);
  }, [audioUrl]);

  const uploadAnalysisInBackground = useCallback(
    async (audioBlob: Blob, analysisResult: AssessmentResult) => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || "";
        const formData = new FormData();
        await appendAudioToFormData(formData, "audio_file", audioBlob);
        formData.append(
          "analysis_json",
          JSON.stringify({
            pronunciation_score: analysisResult.pronunciationScore,
            accuracy_score: analysisResult.accuracyScore,
            fluency_score: analysisResult.fluencyScore,
            completeness_score: analysisResult.completenessScore,
            overall_score: analysisResult.overallScore,
          }),
        );
        if (_progressId) formData.append("progress_id", _progressId.toString());
        formData.append("analysis_id", crypto.randomUUID());

        const authToken =
          useStudentAuthStore.getState().token ||
          useTeacherAuthStore.getState().token ||
          "";
        fetch(`${apiUrl}/api/speech/upload-analysis`, {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
          body: formData,
        }).catch((error) => console.error("Background upload failed:", error));
      } catch (error) {
        console.error("Failed to prepare background upload:", error);
      }
    },
    [_progressId],
  );

  const handleAssessment = useCallback(async () => {
    if (!audioUrl) {
      toast.error(t("readingAssessment.toast.missingData") || "請先錄音");
      return;
    }
    setIsAssessing(true);
    try {
      const response = await fetch(audioUrl);
      const audioBlob = await response.blob();

      const normalizedTargetText = targetText.replace(/\n+/g, " ").trim();
      const azureResult = await analyzePronunciation(
        audioBlob,
        normalizedTargetText,
      );
      if (!azureResult) throw new Error("Azure analysis failed");

      // Issue #689: 分析成功才計次
      onAnalysisSuccess?.();

      const result: AssessmentResult = {
        overallScore: azureResult.pronunciationScore,
        accuracyScore: azureResult.accuracyScore,
        fluencyScore: azureResult.fluencyScore,
        completenessScore: azureResult.completenessScore,
        pronunciationScore: azureResult.pronunciationScore,
        feedback: "",
        detailed_words: azureResult.detailed_words,
      };
      setAssessmentResult(result);
      setScoreOverlayScore(result.overallScore);
      setScoreOverlayOpen(true);
      toast.success(t("readingAssessment.toast.aiComplete") || "AI 評估完成");

      if (!readOnly && !isLivePreview && audioUrl.startsWith("blob:")) {
        uploadAnalysisInBackground(audioBlob, result);
      }
    } catch (error) {
      console.error("Assessment error:", error);
      toast.error(
        error instanceof Error ? error.message : "AI 評估失敗，請重試",
      );
    } finally {
      setIsAssessing(false);
    }
  }, [
    audioUrl,
    analyzePronunciation,
    targetText,
    onAnalysisSuccess,
    readOnly,
    isLivePreview,
    uploadAnalysisInBackground,
    t,
  ]);

  // 圖表資料（例句用 Word 層級，無音素，只顯示雷達）
  const chartData = useMemo(() => {
    if (!assessmentResult) return null;
    return {
      overallScore: assessmentResult.overallScore,
      dimensions: [
        {
          label: t("pronunciationChart.shortLabels.overall"),
          score: assessmentResult.overallScore,
        },
        {
          label: t("pronunciationChart.shortLabels.accuracy"),
          score: assessmentResult.accuracyScore,
        },
        {
          label: t("pronunciationChart.shortLabels.fluency"),
          score: assessmentResult.fluencyScore,
        },
        {
          label: t("pronunciationChart.shortLabels.completeness"),
          score: assessmentResult.completenessScore,
        },
      ],
      details: [],
    };
  }, [assessmentResult, t]);

  // 逐字染色（例句：用 word-level detailed_words）
  const scoredWords = useMemo<ScoredWord[]>(() => {
    if (!assessmentResult?.detailed_words) return [];
    return assessmentResult.detailed_words.map((w) => ({
      index: w.index,
      word: w.word,
      score: w.accuracy_score,
    }));
  }, [assessmentResult]);

  const derived = deriveRecordingState({
    isRecording: recorder.isRecording,
    hasRecordingUrl: !!audioUrl,
    hasAssessment: !!assessmentResult,
  });

  const coloredText =
    assessmentResult && scoredWords.length > 0 ? (
      <WordWithScoreColor words={scoredWords} onPlayWord={handlePlayExample} />
    ) : undefined;

  const scoreBadge =
    assessmentResult && !isAssessing ? (
      <ScoreBadge score={assessmentResult.pronunciationScore}>
        {chartData && (
          <PronunciationScoreChart
            overallScore={chartData.overallScore}
            dimensions={chartData.dimensions}
            details={chartData.details}
          />
        )}
      </ScoreBadge>
    ) : undefined;

  return (
    <>
      <RecordingCard
        variant="sentence"
        text={targetText}
        translation={content}
        showImage={false}
        state={derived.state}
        attempts={attemptsHint}
        hasExampleAudio={!!exampleAudioUrl}
        isPlayingExample={isPlayingExample}
        playbackRate={playbackRate}
        onPlayExample={handlePlayExample}
        onRateChange={updatePlaybackRate}
        onRecordStart={recorder.startRecording}
        onRecordStop={recorder.stopRecording}
        onAnalyze={handleAssessment}
        onReRecord={clearRecording}
        onPlayback={togglePlaybackRecorded}
        onUpload={handleFileUpload}
        canPlayback={!!audioUrl}
        recordingDisabled={recordingDisabled || readOnly}
        canUseAiAnalysis={canUseAiAnalysis}
        recordingSeconds={recorder.recordingTime}
        showNext={false}
        coloredText={coloredText}
        scoreBadge={scoreBadge}
      />

      <ScoreOverlay
        open={scoreOverlayOpen}
        score={scoreOverlayScore}
        isError={false}
        onComplete={() => setScoreOverlayOpen(false)}
      />
    </>
  );
}
