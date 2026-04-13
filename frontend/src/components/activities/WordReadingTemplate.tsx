/**
 * WordReadingTemplate - 單字朗讀練習元件
 *
 * Phase 2-2: 單字集練習的朗讀功能
 *
 * 功能:
 * - 顯示單字卡片（圖片、單字、翻譯）
 * - 播放單字音檔
 * - 錄音或上傳音檔
 * - Azure Speech AI 評分
 * - 老師批改後完成
 *
 * 流程:
 * 已指派 -> 未開始 -> 已開始 -> 已提交 -> 待訂正 -> 已訂正 -> 已完成
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Brain,
  Clock,
  Volume2,
  Mic,
  Square,
  Play,
  Pause,
  Upload,
  MessageSquare,
  Languages,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useStudentAuthStore } from "@/stores/studentAuthStore"; // used via .getState()
import { useTeacherAuthStore } from "@/stores/teacherAuthStore"; // used via .getState()
import {
  useAzurePronunciation,
  type PronunciationResult,
} from "@/hooks/useAzurePronunciation";
import { useDemoAzurePronunciation } from "@/hooks/useDemoAzurePronunciation";
import ScoreOverlay from "./shared/ScoreOverlay";
import PronunciationScoreChart from "./shared/PronunciationScoreChart";

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
  text: string; // The word
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
  // Current word item to practice
  currentItem: WordItem;
  currentIndex: number;
  totalItems: number;

  // Assignment settings
  showTranslation?: boolean;
  showImage?: boolean;

  // Existing recording state
  existingAudioUrl?: string | null;
  onRecordingComplete?: (blob: Blob, url: string) => void;

  // Progress tracking
  progressId?: number;
  readOnly?: boolean;

  // Time limit (0 = unlimited)
  timeLimit?: number;

  // Demo mode
  isDemoMode?: boolean; // Demo mode - uses public demo API endpoints

  // Callbacks
  onAssessmentComplete?: (result: AssessmentResult) => void;
  onClearRecording?: () => void;

  // AI analysis availability
  canUseAiAnalysis?: boolean; // 教師/機構是否有 AI 分析額度
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
  timeLimit = 0, // Default unlimited
  onAssessmentComplete,
  onClearRecording,
  canUseAiAnalysis = true,
}: WordReadingTemplateProps) {
  const { t } = useTranslation();
  const [audioUrl, setAudioUrl] = useState<string | undefined>(
    existingAudioUrl || undefined,
  );
  const [isPlayingExample, setIsPlayingExample] = useState(false);
  const [isAssessing, setIsAssessing] = useState(false);
  const [assessmentResult, setAssessmentResult] =
    useState<AssessmentResult | null>(null);
  const exampleAudioRef = useRef<HTMLAudioElement | null>(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Playback state for recorded audio
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const recordedAudioRef = useRef<HTMLAudioElement | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Playback rate
  const [playbackRate, setPlaybackRate] = useState(1.0);

  // 🎯 Issue #450: 儲存音素分析結果
  const [phonemeResult, setPhonemeResult] =
    useState<PronunciationResult | null>(null);

  // 🎯 Issue #461: 分數動畫 overlay + 手機版 modal
  const [scoreOverlayOpen, setScoreOverlayOpen] = useState(false);
  const [scoreOverlayScore, setScoreOverlayScore] = useState(0);
  const [scoreModalOpen, setScoreModalOpen] = useState(false);

  // Azure Speech Service hook for direct API calls
  // Use demo hook when in demo mode (no authentication required)
  const regularHook = useAzurePronunciation();
  const demoHook = useDemoAzurePronunciation();
  const { analyzePronunciation } = isDemoMode ? demoHook : regularHook;

  // Recording start timestamp (for duration check against timeLimit)
  const recordingStartTimeRef = useRef<number>(0);

  // Image error handling
  const [imageError, setImageError] = useState(false);

  // 🎯 Issue #461: 圖表資料（雷達圖維度 + 音素長條圖）
  const chartData = useMemo(() => {
    if (!assessmentResult) return null;

    const overallScore = assessmentResult.overallScore;

    const dimensions = [
      {
        label: t("pronunciationChart.shortLabels.overall"),
        score: overallScore,
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

    // 音素詳情 → 長條圖（加 index 避免同名音素被去重）
    const phonemes = phonemeResult?.detailed_words?.[0]?.phonemes || [];
    const details = phonemes.map((ph, i) => ({
      label:
        phonemes.filter((p) => p.phoneme === ph.phoneme).length > 1
          ? `${ph.phoneme}(${i + 1})`
          : ph.phoneme,
      score: ph.accuracy_score,
    }));

    return { overallScore, dimensions, details };
  }, [assessmentResult, phonemeResult, t]);

  // Reset state when item changes (only triggered by currentItem.id change)
  useEffect(() => {
    // Revoke previous blob URL to prevent memory leak
    if (audioUrl && audioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(existingAudioUrl || undefined);
    setAssessmentResult(null);
    setPhonemeResult(null);
    setScoreOverlayOpen(false);
    setScoreModalOpen(false);
    setImageError(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    // Load existing assessment if available AND there's a saved recording
    // (Only load if existingAudioUrl exists - meaning this is a saved recording, not a new one)
    if (currentItem.ai_assessment && existingAudioUrl) {
      const ai = currentItem.ai_assessment;
      setAssessmentResult({
        overallScore: ai.pronunciation_score || 0,
        accuracyScore: ai.accuracy_score || 0,
        fluencyScore: ai.fluency_score || 0,
        completenessScore: ai.completeness_score || 0,
        pronunciationScore: ai.pronunciation_score || 0,
        feedback: "",
      });

      // 🎯 還原音素詳細資料（重開時顯示圖表）
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
  }, [currentItem.id]); // Only run when item changes, not when existingAudioUrl/timeLimit changes

  // Sync assessment from background analysis completing after navigation
  // The reset effect (above) only runs on currentItem.id change, so if
  // background analysis finishes while viewing this item, we need this
  // effect to pick up the new ai_assessment data.
  useEffect(() => {
    const ai = currentItem.ai_assessment;
    // Guard: don't re-apply stale data when user has cleared recording (retry)
    if (ai && !assessmentResult && audioUrl) {
      setAssessmentResult({
        overallScore: ai.pronunciation_score || 0,
        accuracyScore: ai.accuracy_score || 0,
        fluencyScore: ai.fluency_score || 0,
        completenessScore: ai.completeness_score || 0,
        pronunciationScore: ai.pronunciation_score || 0,
        feedback: "",
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

  // Auto-play example audio when entering a new question
  useEffect(() => {
    // Clean up previous audio
    if (exampleAudioRef.current) {
      exampleAudioRef.current.pause();
      exampleAudioRef.current = null;
    }

    // Auto-play if audio exists
    if (currentItem.audio_url) {
      const audio = new Audio(currentItem.audio_url);
      audio.playbackRate = playbackRate;
      exampleAudioRef.current = audio;

      audio.addEventListener("ended", () => {
        setIsPlayingExample(false);
      });

      setIsPlayingExample(true);
      audio.play().catch(() => {
        // Browser autoplay policy blocked, user interaction required
        setIsPlayingExample(false);
      });
    }

    return () => {
      if (exampleAudioRef.current) {
        exampleAudioRef.current.pause();
        exampleAudioRef.current = null;
      }
    };
  }, [currentItem.id, currentItem.audio_url, playbackRate]);

  // Play example audio
  const handlePlayExample = () => {
    if (!currentItem.audio_url) return;

    if (isPlayingExample && exampleAudioRef.current) {
      exampleAudioRef.current.pause();
      setIsPlayingExample(false);
    } else {
      // Create new audio if not exists, or reuse existing
      if (!exampleAudioRef.current) {
        const audio = new Audio(currentItem.audio_url);
        audio.addEventListener("ended", () => {
          setIsPlayingExample(false);
        });
        exampleAudioRef.current = audio;
      }
      exampleAudioRef.current.playbackRate = playbackRate;
      exampleAudioRef.current.currentTime = 0;
      exampleAudioRef.current.play();
      setIsPlayingExample(true);
    }
  };

  // Update playback rate
  const updatePlaybackRate = (newRate: number) => {
    setPlaybackRate(newRate);
    if (exampleAudioRef.current && isPlayingExample) {
      exampleAudioRef.current.playbackRate = newRate;
    }
    if (recordedAudioRef.current && isPlaying) {
      recordedAudioRef.current.playbackRate = newRate;
    }
  };

  // Start recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });

        // Check recording duration against time limit
        const elapsedSeconds =
          (Date.now() - recordingStartTimeRef.current) / 1000;
        if (timeLimit > 0 && elapsedSeconds > timeLimit) {
          toast.error(
            t("wordReading.toast.recordingExceedsLimit", {
              recorded: Math.round(elapsedSeconds),
              limit: timeLimit,
            }) ||
              `錄音時間 ${Math.round(elapsedSeconds)} 秒超過限制 ${timeLimit} 秒，請重新錄音`,
          );
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        // Revoke previous blob URL to prevent memory leak
        if (audioUrl && audioUrl.startsWith("blob:")) {
          URL.revokeObjectURL(audioUrl);
        }
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        onRecordingComplete?.(audioBlob, url);

        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingStartTimeRef.current = Date.now();

      // Start recording timer
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error("Error starting recording:", error);
      toast.error("無法啟動錄音，請檢查麥克風權限");
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    }
  };

  // Handle file upload
  const handleFileUpload = (file: File) => {
    // Revoke previous blob URL to prevent memory leak
    if (audioUrl && audioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(audioUrl);
    }
    const url = URL.createObjectURL(file);
    setAudioUrl(url);

    // Convert file to blob for callback
    file.arrayBuffer().then((buffer) => {
      const blob = new Blob([buffer], { type: file.type });
      onRecordingComplete?.(blob, url);
    });

    toast.success("音檔已上傳");
  };

  // Toggle recorded audio playback
  const togglePlayback = () => {
    if (!audioUrl) return;

    if (isPlaying && recordedAudioRef.current) {
      recordedAudioRef.current.pause();
      setIsPlaying(false);
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    } else {
      if (recordedAudioRef.current) {
        recordedAudioRef.current.pause();
      }

      const audio = new Audio(audioUrl);
      recordedAudioRef.current = audio;

      audio.addEventListener("loadedmetadata", () => {
        const dur = audio.duration;
        if (dur && isFinite(dur) && !isNaN(dur)) {
          setDuration(dur);
        }
      });

      audio.addEventListener("ended", () => {
        setIsPlaying(false);
        setCurrentTime(0);
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
        }
      });

      audio.playbackRate = playbackRate;
      audio.play();
      setIsPlaying(true);

      progressIntervalRef.current = setInterval(() => {
        if (recordedAudioRef.current) {
          setCurrentTime(recordedAudioRef.current.currentTime);
        }
      }, 100);
    }
  };

  // Clear recording
  const clearRecording = () => {
    if (recordedAudioRef.current) {
      recordedAudioRef.current.pause();
    }
    // Revoke blob URL to prevent memory leak
    if (audioUrl && audioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(audioUrl);
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAudioUrl(undefined);
    setAssessmentResult(null);
    setPhonemeResult(null);
    setScoreOverlayOpen(false);
    setScoreModalOpen(false);
    // 通知 parent 同步刪除後端錄音和評估
    onClearRecording?.();
  };

  // Upload analysis in background
  const uploadAnalysisInBackground = async (
    audioBlob: Blob,
    analysisResult: AssessmentResult,
  ) => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || "";
      const formData = new FormData();

      const uploadFileExtension = audioBlob.type.includes("mp4")
        ? "recording.mp4"
        : audioBlob.type.includes("webm")
          ? "recording.webm"
          : "recording.audio";

      formData.append("audio_file", audioBlob, uploadFileExtension);
      formData.append(
        "analysis_json",
        JSON.stringify({
          pronunciation_score: analysisResult.pronunciationScore,
          accuracy_score: analysisResult.accuracyScore,
          fluency_score: analysisResult.fluencyScore,
          completeness_score: analysisResult.completenessScore,
          overall_score: analysisResult.overallScore,
          // 🎯 音素詳細資料（重開時可還原圖表）
          // 使用參數中的 detailed_words 避免 stale closure
          detailed_words: analysisResult.detailed_words || [],
          reference_text: currentItem.text,
        }),
      );

      if (_progressId) {
        formData.append("progress_id", _progressId.toString());
      }

      // 🎯 Issue #208: Generate unique analysis_id for deduction
      const analysisId = crypto.randomUUID();
      formData.append("analysis_id", analysisId);

      // 🔧 Review fix: 使用正確的 auth token（非 env var）
      const studentToken = useStudentAuthStore.getState().token;
      const teacherToken = useTeacherAuthStore.getState().token;
      const authToken = studentToken || teacherToken || "";

      fetch(`${apiUrl}/api/speech/upload-analysis`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Upload failed: ${response.status}`);
          }
          // Background upload completed successfully
        })
        .catch((error) => {
          console.error("Background upload failed:", error);
        });
    } catch (error) {
      console.error("Failed to prepare background upload:", error);
    }
  };

  // Handle assessment
  const handleAssessment = async () => {
    if (!audioUrl) {
      toast.error(t("wordReading.toast.missingData") || "請先錄音");
      return;
    }

    setIsAssessing(true);
    try {
      const response = await fetch(audioUrl);
      const audioBlob = await response.blob();

      // Check recording duration (max 10 seconds)
      // 🔧 Review fix: 確保 AudioContext 在 error path 也會 close
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

      // 🎯 Issue #450: 單字朗讀使用 Phoneme 層級分析
      const azureResult = await analyzePronunciation(
        audioBlob,
        currentItem.text,
        "Phoneme",
      );

      if (!azureResult) {
        throw new Error("Azure analysis failed");
      }

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
      // 🎯 Issue #450: 儲存音素分析結果
      setPhonemeResult(azureResult);

      // 🎯 Issue #461: 觸發星級動畫 overlay
      setScoreOverlayScore(result.overallScore);
      setScoreOverlayOpen(true);

      toast.success(t("wordReading.toast.aiComplete") || "AI 評估完成");

      // Background upload (skip in demo mode — no auth token available)
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
  };

  // Format audio time
  const formatAudioTime = (seconds: number) => {
    if (!seconds || !isFinite(seconds) || isNaN(seconds)) {
      return "0:00";
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <>
      <div className="w-full">
        {/* 響應式佈局 - 手機垂直堆疊，桌面兩欄式 */}
        <div className="flex flex-col sm:grid sm:grid-cols-12 gap-3 sm:gap-4 w-full">
          {/* 左欄 - 題目、圖片、學生作答、老師評語 */}
          <div className="w-full sm:col-span-6 space-y-3">
            {/* 題目區域 */}
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              {/* 題目文字與音檔 */}
              <div className="flex items-center gap-2 sm:gap-3 mb-2">
                <button
                  onClick={handlePlayExample}
                  disabled={!currentItem.audio_url}
                  className={cn(
                    "p-1.5 rounded-full transition-colors flex-shrink-0",
                    currentItem.audio_url
                      ? "bg-green-100 hover:bg-green-200 text-green-600 cursor-pointer"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed",
                  )}
                  title={currentItem.audio_url ? "播放參考音檔" : "無參考音檔"}
                >
                  <Volume2 className="w-4 h-4" />
                </button>

                {/* 單字文字 */}
                <div className="text-lg sm:text-xl font-bold text-gray-800 flex-1">
                  {currentItem.text}
                  {currentItem.part_of_speech && (
                    <Badge variant="outline" className="text-xs ml-2">
                      {currentItem.part_of_speech}
                    </Badge>
                  )}
                </div>

                {/* 倍速控制 */}
                <select
                  value={playbackRate}
                  onChange={(e) =>
                    updatePlaybackRate(parseFloat(e.target.value))
                  }
                  className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white"
                  title="播放速度"
                >
                  <option value={0.5}>0.5x</option>
                  <option value={0.75}>0.75x</option>
                  <option value={1.0}>1.0x</option>
                  <option value={1.25}>1.25x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2.0}>2.0x</option>
                </select>

                {/* Time Limit Display (static) */}
                {!readOnly && timeLimit > 0 && (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                    <Clock className="h-3 w-3" />
                    <span>
                      {t("wordReading.timeLimit", { seconds: timeLimit }) ||
                        `限時 ${timeLimit} 秒`}
                    </span>
                  </div>
                )}
              </div>

              {/* 翻譯 */}
              {showTranslation && currentItem.translation && (
                <div className="flex items-center gap-2 text-sm sm:text-base text-purple-600 bg-purple-50 rounded px-2 sm:px-3 py-1.5 sm:py-2">
                  <Languages className="w-4 h-4" />
                  <span>{currentItem.translation}</span>
                </div>
              )}
            </div>

            {/* 圖片區塊（可選） */}
            {showImage && currentItem.image_url && !imageError && (
              <div className="bg-white rounded-lg border border-gray-200 p-3">
                <div className="flex justify-center">
                  <img
                    src={currentItem.image_url}
                    alt={currentItem.text}
                    className="max-h-48 object-contain rounded-lg"
                    onError={() => setImageError(true)}
                  />
                </div>
              </div>
            )}

            {/* 學生錄音區 */}
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-sm sm:text-base font-medium text-gray-700 mb-2">
                {t("wordReading.studentAnswer") || "學生作答"}
              </div>

              {/* 錄音控制 */}
              <div className="flex items-center gap-2">
                {!isRecording ? (
                  <>
                    {/* 錄音按鈕或播放控制 */}
                    {audioUrl ? (
                      <>
                        {/* 播放控制 */}
                        <button
                          onClick={togglePlayback}
                          className="w-8 h-8 bg-green-600 hover:bg-green-700 rounded-full flex items-center justify-center text-white flex-shrink-0"
                        >
                          {isPlaying ? (
                            <Pause className="w-3 h-3" fill="currentColor" />
                          ) : (
                            <Play
                              className="w-3 h-3 ml-0.5"
                              fill="currentColor"
                            />
                          )}
                        </button>

                        {/* 時間軸 */}
                        <div className="flex-1">
                          <div className="h-1.5 bg-green-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500 rounded-full transition-all duration-100"
                              style={{
                                width:
                                  duration > 0
                                    ? `${(currentTime / duration) * 100}%`
                                    : "0%",
                              }}
                            />
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {formatAudioTime(duration)}
                          </div>
                        </div>

                        {/* 清除錄音按鈕 */}
                        <button
                          onClick={clearRecording}
                          disabled={readOnly}
                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-gray-500 disabled:hover:bg-transparent"
                          title={readOnly ? "檢視模式" : "清除錄音"}
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="w-12 h-12 sm:w-16 sm:h-16 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transition-all"
                          disabled={readOnly}
                          onClick={() => {
                            setAssessmentResult(null);
                            setScoreModalOpen(false);
                            startRecording();
                          }}
                          title={readOnly ? "檢視模式" : "開始錄音"}
                        >
                          <Mic className="w-5 h-5 sm:w-6 sm:h-6" />
                        </button>
                        <button
                          className="w-12 h-12 sm:w-16 sm:h-16 bg-green-600 hover:bg-green-700 text-white rounded-full flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transition-all"
                          disabled={readOnly}
                          onClick={() => {
                            const input = document.createElement("input");
                            input.type = "file";
                            input.accept =
                              "audio/*,.mp3,.m4a,.mp4,.wav,.webm,.ogg,.aac";
                            input.onchange = (e) => {
                              const file = (e.target as HTMLInputElement)
                                .files?.[0];
                              if (file) handleFileUpload(file);
                            };
                            input.click();
                          }}
                          title={readOnly ? "檢視模式" : "上傳音檔"}
                        >
                          <Upload className="w-5 h-5 sm:w-6 sm:h-6" />
                        </button>
                        <span className="text-sm sm:text-base text-gray-600">
                          {readOnly
                            ? "檢視模式"
                            : t("wordReading.startRecordOrUpload") ||
                              "開始錄音或上傳"}
                        </span>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {/* 錄音中狀態 */}
                    <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse" />
                    <span className="text-base font-medium text-red-600">
                      {`${Math.floor(recordingTime / 60)}:${(recordingTime % 60).toString().padStart(2, "0")}`}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={stopRecording}
                      className="border-red-600 text-red-600 hover:bg-red-50 h-7 px-2 text-xs"
                    >
                      <Square className="w-3 h-3 mr-1" />
                      停止
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* 老師評語（無資料時隱藏） */}
            {currentItem.teacher_feedback && (
              <div
                className={cn(
                  "rounded-lg border-2 p-3",
                  currentItem.teacher_passed === true
                    ? "border-green-400 bg-green-50"
                    : currentItem.teacher_passed === false
                      ? "border-red-400 bg-red-50"
                      : "border-blue-400 bg-blue-50",
                )}
              >
                <div
                  className={cn(
                    "text-sm sm:text-base font-medium mb-1 flex items-center gap-1",
                    currentItem.teacher_passed === true
                      ? "text-green-600"
                      : currentItem.teacher_passed === false
                        ? "text-red-600"
                        : "text-blue-600",
                  )}
                >
                  <MessageSquare className="w-4 h-4" />
                  {t("wordReading.teacherFeedback") || "老師評語"}
                  {currentItem.teacher_passed !== null &&
                    currentItem.teacher_passed !== undefined && (
                      <span
                        className={
                          currentItem.teacher_passed
                            ? "text-green-600"
                            : "text-red-600"
                        }
                      >
                        {currentItem.teacher_passed ? "（通過）" : "（未通過）"}
                      </span>
                    )}
                </div>
                <div className="text-sm sm:text-base text-gray-700">
                  {currentItem.teacher_feedback}
                </div>
                {currentItem.teacher_reviewed_at && (
                  <div className="text-sm text-gray-500 mt-1">
                    {new Date(currentItem.teacher_reviewed_at).toLocaleString(
                      "zh-TW",
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 手機版：分析按鈕 / 查看結果按鈕 */}
          {canUseAiAnalysis && audioUrl && (
            <div className="flex justify-center py-4 md:hidden">
              {assessmentResult ? (
                <Button
                  size="lg"
                  onClick={() => setScoreModalOpen(true)}
                  variant="outline"
                  className="h-14 px-8 text-lg font-bold rounded-2xl border-2 border-indigo-400 text-indigo-600 hover:bg-indigo-50"
                >
                  <Brain className="w-5 h-5 mr-2" />
                  {t("wordReading.viewAnalysis") || "查看分析結果"}
                </Button>
              ) : (
                <Button
                  size="lg"
                  onClick={handleAssessment}
                  disabled={isAssessing}
                  className="relative bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white h-14 px-8 text-lg font-bold rounded-2xl shadow-xl transition-all"
                  style={{
                    animation: isAssessing
                      ? "none"
                      : "pulse-scale 1.5s ease-in-out infinite",
                  }}
                >
                  {isAssessing ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      {t("wordReading.analyzing") || "分析中"}
                    </>
                  ) : (
                    <>
                      <Brain className="w-5 h-5 mr-2 animate-pulse" />
                      {t("wordReading.analyze") || "分析"}
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {/* 右欄 - AI 評估結果（手機版隱藏，用 modal 顯示） */}
          <div className="w-full hidden md:block sm:col-span-6 space-y-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              {/* 🎯 Issue #227: 只有教師/機構有 AI 分析額度時才顯示分析按鈕 */}
              {audioUrl && !assessmentResult && canUseAiAnalysis ? (
                <div className="flex justify-center mb-4 py-6">
                  <Button
                    size="lg"
                    onClick={handleAssessment}
                    disabled={isAssessing}
                    className="relative bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white h-16 px-10 text-xl font-bold rounded-2xl shadow-2xl hover:shadow-purple-500/50 transition-all"
                    style={{
                      animation: isAssessing
                        ? "none"
                        : "pulse-scale 1.5s ease-in-out infinite",
                    }}
                  >
                    {isAssessing ? (
                      <>
                        <Loader2 className="w-7 h-7 mr-3 animate-spin" />
                        {t("wordReading.analyzing") || "分析中"}
                      </>
                    ) : (
                      <>
                        <Brain className="w-7 h-7 mr-3 animate-pulse" />
                        {t("wordReading.analyze") || "分析"}
                      </>
                    )}
                  </Button>
                </div>
              ) : null}
              {assessmentResult ? (
                <div className="relative">
                  {/* 評估結果 */}
                  <div
                    className={cn(
                      "transition-all duration-300",
                      isAssessing && "blur-sm opacity-30",
                    )}
                  >
                    <button
                      onClick={clearRecording}
                      className="absolute top-0 right-0 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors z-10 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-transparent"
                      title={readOnly ? "檢視模式" : "清除錄音和評估結果"}
                      disabled={isAssessing || readOnly}
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>

                    <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-lg p-4 space-y-4">
                      <h4 className="text-lg font-bold text-blue-900 flex items-center justify-center gap-2">
                        <Brain className="h-5 w-5" />
                        {t("wordReading.aiResult") || "AI 評估結果"}
                      </h4>

                      {/* 🎯 Issue #461: 雷達圖 + 音素長條圖 */}
                      {chartData && (
                        <PronunciationScoreChart
                          overallScore={chartData.overallScore}
                          dimensions={chartData.dimensions}
                          details={chartData.details}
                          detailsTitle={t("pronunciationChart.phonemeDetails")}
                        />
                      )}

                      {/* Re-assess Button */}
                      <div className="text-center">
                        <Button
                          onClick={() => {
                            setAssessmentResult(null);
                            setScoreModalOpen(false);
                          }}
                          variant="outline"
                          size="sm"
                          disabled={readOnly}
                          className="border-blue-200 text-blue-700 hover:bg-blue-50"
                        >
                          {t("wordReading.reassess") || "重新評估"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* 思考動畫覆蓋層 */}
                  {isAssessing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm z-20 rounded-lg">
                      <div className="text-center text-purple-500">
                        <div className="relative w-16 h-16 mx-auto mb-4">
                          <div className="absolute inset-0 rounded-full bg-purple-100 animate-ping opacity-75"></div>
                          <div className="absolute inset-2 rounded-full bg-purple-200 animate-pulse"></div>
                          <Brain
                            className="w-16 h-16 absolute inset-0 animate-spin"
                            style={{ animationDuration: "3s" }}
                          />
                        </div>
                        <p className="text-base font-medium text-purple-600 animate-pulse">
                          AI 正在分析中...
                        </p>
                        <p className="text-xs text-purple-400 mt-1">
                          請稍候片刻
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : isAssessing ? (
                <div className="text-center text-purple-500 py-8">
                  <div className="relative w-16 h-16 mx-auto mb-4">
                    <div className="absolute inset-0 rounded-full bg-purple-100 animate-ping opacity-75"></div>
                    <div className="absolute inset-2 rounded-full bg-purple-200 animate-pulse"></div>
                    <Brain
                      className="w-16 h-16 absolute inset-0 animate-spin"
                      style={{ animationDuration: "3s" }}
                    />
                  </div>
                  <p className="text-base font-medium text-purple-600 animate-pulse">
                    AI 正在分析中...
                  </p>
                  <p className="text-xs text-purple-400 mt-1">請稍候片刻</p>
                </div>
              ) : (
                <div className="text-center text-gray-400 py-8">
                  <Brain className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">
                    {audioUrl
                      ? canUseAiAnalysis
                        ? t("wordReading.clickToAssess") ||
                          "點擊上方按鈕開始評估"
                        : t("wordReading.recordingComplete") || "已錄音完成"
                      : t("wordReading.pleaseRecord") || "請先錄音"}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 🎯 Issue #461: 分析完成星星鼓勵動畫 overlay */}
      <ScoreOverlay
        open={scoreOverlayOpen}
        score={scoreOverlayScore}
        isError={false}
        onComplete={() => {
          setScoreOverlayOpen(false);
          if (window.innerWidth < 768) {
            setScoreModalOpen(true);
          }
        }}
      />

      {/* 🎯 Issue #461: 手機版分數詳情 modal */}
      {scoreModalOpen && chartData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setScoreModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl mx-4 p-4 max-h-[85vh] overflow-y-auto w-full max-w-md"
            onClick={() => setScoreModalOpen(false)}
          >
            <PronunciationScoreChart
              overallScore={chartData.overallScore}
              dimensions={chartData.dimensions}
              details={chartData.details}
              detailsTitle={t("pronunciationChart.phonemeDetails")}
            />
            <p className="text-xs text-gray-400 mt-3 text-center">
              {t("scoreOverlay.tapToContinue")}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
