/**
 * WordReadingTemplate - 單字朗讀練習元件（#892 卡片改版）
 *
 * 功能（全數保留，僅改顯示方式）:
 * - 顯示單字卡片（圖片、單字、詞性、翻譯）
 * - 播放老師示範音（倍速 0.75 / 1 / 1.5）
 * - 錄音（useCardRecorder：限時 / auto-stop / 超時拒絕）或上傳音檔
 * - Azure Speech AI 評分（10 秒上限）+ 逐字染色 + 分數徽章（雷達 + 音素）
 * - 星級鼓勵動畫（ScoreOverlay）
 * - 老師批改評語（訂正模式）
 *
 * 版面骨架見 RecordingCard；題號列 / 上一題 / 下一題 / 提交由父層
 * WordReadingActivity 提供（位置與功能不變）。
 */
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import {
  useAzurePronunciation,
  type PronunciationResult,
} from "@/hooks/useAzurePronunciation";
import { useDemoAzurePronunciation } from "@/hooks/useDemoAzurePronunciation";
import ScoreOverlay from "./shared/ScoreOverlay";
import PronunciationScoreChart from "./shared/PronunciationScoreChart";
import { appendAudioToFormData } from "@/utils/audioFormatDetection";
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
    phonemes?: Array<{ phoneme: string; accuracy_score: number }>;
  }>;
}

interface WordItem {
  id: number;
  text: string;
  translation?: string;
  audio_url?: string;
  image_url?: string;
  part_of_speech?: string;
  progress_id?: number;
  recording_url?: string;
  ai_assessment?: {
    accuracy_score?: number;
    fluency_score?: number;
    completeness_score?: number;
    pronunciation_score?: number;
    detailed_words?: Array<{
      index: number;
      word: string;
      accuracy_score: number;
      error_type?: string;
      phonemes?: Array<{ phoneme: string; accuracy_score: number }>;
    }>;
  };
  teacher_feedback?: string;
  teacher_passed?: boolean;
  teacher_review_score?: number;
  teacher_reviewed_at?: string;
}

interface WordReadingTemplateProps {
  currentItem: WordItem;
  currentIndex: number;
  totalItems: number;
  showTranslation?: boolean;
  showImage?: boolean;
  existingAudioUrl?: string | null;
  onRecordingComplete?: (blob: Blob, url: string) => void;
  progressId?: number;
  readOnly?: boolean;
  timeLimit?: number;
  isDemoMode?: boolean;
  onAssessmentComplete?: (result: AssessmentResult) => void;
  onClearRecording?: () => void;
  canUseAiAnalysis?: boolean;
  // Issue #689 — Phase 1 frontend attempt gate
  recordingDisabled?: boolean;
  attemptsHint?: React.ReactNode;
  onAnalysisSuccess?: () => void;
}

export default function WordReadingTemplate({
  currentItem,
  currentIndex: _currentIndex,
  totalItems: _totalItems,
  showTranslation = true,
  showImage = true,
  existingAudioUrl,
  onRecordingComplete,
  progressId: _progressId,
  readOnly = false,
  isDemoMode = false,
  timeLimit = 0,
  onAssessmentComplete,
  onClearRecording,
  canUseAiAnalysis = true,
  recordingDisabled = false,
  attemptsHint,
  onAnalysisSuccess,
}: WordReadingTemplateProps) {
  const { t } = useTranslation();
  const [audioUrl, setAudioUrl] = useState<string | undefined>(
    existingAudioUrl || undefined,
  );
  const [isPlayingExample, setIsPlayingExample] = useState(false);
  const [isAssessing, setIsAssessing] = useState(false);
  const [assessmentResult, setAssessmentResult] =
    useState<AssessmentResult | null>(null);
  const [phonemeResult, setPhonemeResult] =
    useState<PronunciationResult | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [scoreOverlayOpen, setScoreOverlayOpen] = useState(false);
  const [scoreOverlayScore, setScoreOverlayScore] = useState(0);

  const exampleAudioRef = useRef<HTMLAudioElement | null>(null);
  const recordedAudioRef = useRef<HTMLAudioElement | null>(null);

  // Azure（demo 模式用免驗證 hook）
  const regularHook = useAzurePronunciation();
  const demoHook = useDemoAzurePronunciation();
  const { analyzePronunciation } = isDemoMode ? demoHook : regularHook;

  // 共用錄音 hook（取代原內嵌 MediaRecorder）
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

  // 換題重置 + 還原既有評測
  useEffect(() => {
    if (audioUrl && audioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(existingAudioUrl || undefined);
    setAssessmentResult(null);
    setPhonemeResult(null);
    setScoreOverlayOpen(false);

    if (currentItem.ai_assessment && existingAudioUrl) {
      const ai = currentItem.ai_assessment;
      setAssessmentResult({
        overallScore: ai.pronunciation_score || 0,
        accuracyScore: ai.accuracy_score || 0,
        fluencyScore: ai.fluency_score || 0,
        completenessScore: ai.completeness_score || 0,
        pronunciationScore: ai.pronunciation_score || 0,
        feedback: "",
        detailed_words: ai.detailed_words,
      });
      if (ai.detailed_words && ai.detailed_words.length > 0) {
        setPhonemeResult({
          pronunciationScore: ai.pronunciation_score || 0,
          accuracyScore: ai.accuracy_score || 0,
          fluencyScore: ai.fluency_score || 0,
          completenessScore: ai.completeness_score || 0,
          detailed_words: ai.detailed_words,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem.id]);

  // 背景分析完成後回填（切題後才回來）
  useEffect(() => {
    const ai = currentItem.ai_assessment;
    if (ai && !assessmentResult && audioUrl) {
      setAssessmentResult({
        overallScore: ai.pronunciation_score || 0,
        accuracyScore: ai.accuracy_score || 0,
        fluencyScore: ai.fluency_score || 0,
        completenessScore: ai.completeness_score || 0,
        pronunciationScore: ai.pronunciation_score || 0,
        feedback: "",
        detailed_words: ai.detailed_words,
      });
      if (ai.detailed_words && ai.detailed_words.length > 0) {
        setPhonemeResult({
          pronunciationScore: ai.pronunciation_score || 0,
          accuracyScore: ai.accuracy_score || 0,
          fluencyScore: ai.fluency_score || 0,
          completenessScore: ai.completeness_score || 0,
          detailed_words: ai.detailed_words,
        });
      }
    }
  }, [currentItem.ai_assessment, assessmentResult, audioUrl]);

  // 進新題自動播放示範音
  useEffect(() => {
    if (exampleAudioRef.current) {
      exampleAudioRef.current.pause();
      exampleAudioRef.current = null;
    }
    if (currentItem.audio_url) {
      const audio = new Audio(currentItem.audio_url);
      audio.playbackRate = playbackRate;
      exampleAudioRef.current = audio;
      audio.addEventListener("ended", () => setIsPlayingExample(false));
      setIsPlayingExample(true);
      audio.play().catch(() => setIsPlayingExample(false));
    }
    return () => {
      if (exampleAudioRef.current) {
        exampleAudioRef.current.pause();
        exampleAudioRef.current = null;
      }
    };
  }, [currentItem.id, currentItem.audio_url, playbackRate]);

  const handlePlayExample = useCallback(() => {
    if (!currentItem.audio_url) return;
    if (isPlayingExample && exampleAudioRef.current) {
      exampleAudioRef.current.pause();
      setIsPlayingExample(false);
    } else {
      if (!exampleAudioRef.current) {
        const audio = new Audio(currentItem.audio_url);
        audio.addEventListener("ended", () => setIsPlayingExample(false));
        exampleAudioRef.current = audio;
      }
      exampleAudioRef.current.playbackRate = playbackRate;
      exampleAudioRef.current.currentTime = 0;
      exampleAudioRef.current.play();
      setIsPlayingExample(true);
    }
  }, [currentItem.audio_url, isPlayingExample, playbackRate]);

  const updatePlaybackRate = useCallback(
    (rate: number) => {
      setPlaybackRate(rate);
      if (exampleAudioRef.current && isPlayingExample) {
        exampleAudioRef.current.playbackRate = rate;
      }
    },
    [isPlayingExample],
  );

  // 播放自己的錄音（固定 1x）
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
    setPhonemeResult(null);
    setScoreOverlayOpen(false);
    onClearRecording?.();
  }, [audioUrl, onClearRecording]);

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
            detailed_words: analysisResult.detailed_words || [],
            reference_text: currentItem.text,
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
    [currentItem.text, _progressId],
  );

  const handleAssessment = useCallback(async () => {
    if (!audioUrl) {
      toast.error(t("wordReading.toast.missingData") || "請先錄音");
      return;
    }
    setIsAssessing(true);
    try {
      const response = await fetch(audioUrl);
      const audioBlob = await response.blob();

      // 錄音長度上限 10 秒（AudioContext decode 檢查）
      const audioContext = new AudioContext();
      let audioDuration: number;
      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        audioDuration = audioBuffer.duration;
      } finally {
        audioContext.close();
      }
      if (audioDuration > 10) {
        toast.error(
          t("wordReading.toast.recordingTooLong") ||
            "錄音時間過長，限制最長 10 秒",
        );
        setIsAssessing(false);
        return;
      }

      // 單字用 Phoneme 層級分析
      const azureResult = await analyzePronunciation(
        audioBlob,
        currentItem.text,
        "Phoneme",
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
      setPhonemeResult(azureResult);
      setScoreOverlayScore(result.overallScore);
      setScoreOverlayOpen(true);
      toast.success(t("wordReading.toast.aiComplete") || "AI 評估完成");

      if (!readOnly && !isDemoMode && audioUrl.startsWith("blob:")) {
        uploadAnalysisInBackground(audioBlob, result);
      }
      onAssessmentComplete?.(result);
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
    currentItem.text,
    onAnalysisSuccess,
    readOnly,
    isDemoMode,
    uploadAnalysisInBackground,
    onAssessmentComplete,
    t,
  ]);

  // 圖表資料（雷達 + 音素長條圖）
  const chartData = useMemo(() => {
    if (!assessmentResult) return null;
    const dimensions = [
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
    ];
    const phonemes = phonemeResult?.detailed_words?.[0]?.phonemes || [];
    const details = phonemes.map((ph, i) => ({
      label:
        phonemes.filter((p) => p.phoneme === ph.phoneme).length > 1
          ? `${ph.phoneme}(${i + 1})`
          : ph.phoneme,
      score: ph.accuracy_score,
    }));
    return { overallScore: assessmentResult.overallScore, dimensions, details };
  }, [assessmentResult, phonemeResult, t]);

  // 逐字染色（單字：一個字，用 detailed_words 或整體分數）
  const scoredWords = useMemo<ScoredWord[]>(() => {
    if (!assessmentResult) return [];
    const dw = assessmentResult.detailed_words?.[0];
    return [
      {
        index: 0,
        word: dw?.word || currentItem.text,
        score: dw?.accuracy_score ?? assessmentResult.pronunciationScore,
        phonemes: dw?.phonemes,
      },
    ];
  }, [assessmentResult, currentItem.text]);

  const derived = deriveRecordingState({
    isRecording: recorder.isRecording,
    hasRecordingUrl: !!audioUrl,
    hasAssessment: !!assessmentResult,
  });

  const coloredText = assessmentResult ? (
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
            detailsTitle={t("pronunciationChart.phonemeDetails")}
          />
        )}
      </ScoreBadge>
    ) : undefined;

  return (
    <>
      <RecordingCard
        variant="word"
        text={currentItem.text}
        translation={currentItem.translation}
        showTranslation={showTranslation}
        imageUrl={currentItem.image_url}
        showImage={showImage}
        partOfSpeech={currentItem.part_of_speech}
        state={derived.state}
        isCorrection={!!currentItem.teacher_feedback}
        attempts={attemptsHint}
        hasExampleAudio={!!currentItem.audio_url}
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
        teacherPassed={currentItem.teacher_passed ?? null}
        teacherFeedback={currentItem.teacher_feedback}
      />

      {/* 分析完成星星鼓勵動畫 */}
      <ScoreOverlay
        open={scoreOverlayOpen}
        score={scoreOverlayScore}
        isError={false}
        onComplete={() => setScoreOverlayOpen(false)}
      />
    </>
  );
}
