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

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Brain,
  Clock,
  RotateCcw,
  SkipForward,
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
import {
  useAzurePronunciation,
  type PronunciationResult,
} from "@/hooks/useAzurePronunciation";
import type { PhonemeDetail } from "@/hooks/useAzurePronunciation";
import { useDemoAzurePronunciation } from "@/hooks/useDemoAzurePronunciation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AssessmentResult {
  overallScore: number;
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  pronunciationScore: number;
  feedback: string;
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
  onTimeout?: () => void;
  onRetry?: () => void;
  onSkip?: () => void;
  onAssessmentComplete?: (result: AssessmentResult) => void;

  // AI analysis availability
  canUseAiAnalysis?: boolean; // 教師/機構是否有 AI 分析額度
}

/**
 * 🎯 Issue #450: 音素分析視覺化元件
 * 顯示每個音素的準確度，以顏色標示（綠 ≥80 / 黃 ≥60 / 紅 <60）
 */
function PhonemeVisualization({ phonemes }: { phonemes: PhonemeDetail[] }) {
  const getPhonemeColor = (score: number) => {
    if (score >= 80) return "bg-green-100 text-green-700 border-green-300";
    if (score >= 60) return "bg-yellow-100 text-yellow-700 border-yellow-300";
    return "bg-red-100 text-red-700 border-red-300";
  };

  const getScoreBarColor = (score: number) => {
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className="bg-white rounded-lg p-3">
      <div className="text-xs text-gray-500 mb-2 font-medium">音素分析</div>
      <div className="flex flex-wrap gap-1.5 justify-center">
        {phonemes.map((ph, idx) => (
          <div
            key={idx}
            className={cn(
              "flex flex-col items-center rounded-lg border px-2.5 py-1.5 min-w-[40px] transition-all",
              getPhonemeColor(ph.accuracy_score),
            )}
          >
            <span className="text-base font-mono font-semibold leading-tight">
              {ph.phoneme}
            </span>
            <div className="w-full h-1 rounded-full bg-gray-200 mt-1">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  getScoreBarColor(ph.accuracy_score),
                )}
                style={{ width: `${ph.accuracy_score}%` }}
              />
            </div>
            <span className="text-[10px] font-medium mt-0.5 leading-tight">
              {Math.round(ph.accuracy_score)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
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
  onTimeout,
  onRetry,
  onSkip,
  onAssessmentComplete,
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

  // Azure Speech Service hook for direct API calls
  // Use demo hook when in demo mode (no authentication required)
  const regularHook = useAzurePronunciation();
  const demoHook = useDemoAzurePronunciation();
  const { analyzePronunciation } = isDemoMode ? demoHook : regularHook;

  // Timer state
  const [timeRemaining, setTimeRemaining] = useState(timeLimit);
  const [showTimeoutDialog, setShowTimeoutDialog] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Image error handling
  const [imageError, setImageError] = useState(false);

  // Format time helper
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  // Start timer
  const startTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
          }
          setShowTimeoutDialog(true);
          onTimeout?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [onTimeout]);

  // Reset timer
  const resetTimer = useCallback(() => {
    setTimeRemaining(timeLimit);
    setShowTimeoutDialog(false);
    if (timeLimit > 0) {
      startTimer();
    }
  }, [timeLimit, startTimer]);

  // Initialize timer when component mounts or item changes
  useEffect(() => {
    if (!readOnly && !audioUrl && timeLimit > 0) {
      startTimer();
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [readOnly, timeLimit, startTimer, currentItem.id]);

  // Stop timer when recording is complete
  useEffect(() => {
    if (audioUrl && timerRef.current) {
      clearInterval(timerRef.current);
    }
  }, [audioUrl]);

  // Reset state when item changes (only triggered by currentItem.id change)
  useEffect(() => {
    setAudioUrl(existingAudioUrl || undefined);
    setAssessmentResult(null);
    setPhonemeResult(null);
    setTimeRemaining(timeLimit);
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
    }
  }, [currentItem.id]); // Only run when item changes, not when existingAudioUrl/timeLimit changes

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

  // Handle retry
  const handleRetry = () => {
    setShowTimeoutDialog(false);
    setAudioUrl(undefined);
    setAssessmentResult(null);
    resetTimer();
    onRetry?.();
  };

  // Handle skip
  const handleSkip = () => {
    setShowTimeoutDialog(false);
    onSkip?.();
  };

  const isLowTime = timeRemaining <= 5 && timeRemaining > 0;

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
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        onRecordingComplete?.(audioBlob, url);

        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

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
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAudioUrl(undefined);
    setAssessmentResult(null);
    setPhonemeResult(null);
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
        }),
      );

      if (_progressId) {
        formData.append("progress_id", _progressId.toString());
      }

      // 🎯 Issue #208: Generate unique analysis_id for deduction
      const analysisId = crypto.randomUUID();
      formData.append("analysis_id", analysisId);

      fetch(`${apiUrl}/api/speech/upload-analysis`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_STUDENT_TOKEN || ""}`,
        },
        body: formData,
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Upload failed: ${response.status}`);
          }
          console.log("Background upload completed for word reading");
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
      const audioContext = new AudioContext();
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const audioDuration = audioBuffer.duration;
      audioContext.close();

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
      };

      setAssessmentResult(result);
      // 🎯 Issue #450: 儲存音素分析結果
      setPhonemeResult(azureResult);
      toast.success(t("wordReading.toast.aiComplete") || "AI 評估完成");

      // Background upload
      if (!readOnly && audioUrl.startsWith("blob:")) {
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

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBadgeVariant = (score: number) => {
    if (score >= 80) return "default";
    if (score >= 60) return "secondary";
    return "destructive";
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

                {/* Timer Display */}
                {!readOnly && timeLimit > 0 && !audioUrl && (
                  <div
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium",
                      isLowTime
                        ? "bg-red-100 text-red-700 animate-pulse"
                        : "bg-gray-100 text-gray-700",
                    )}
                  >
                    <Clock className="h-3 w-3" />
                    <span>{formatTime(timeRemaining)}</span>
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

                        {/* 清除錄音按鈕 - 只在非 readOnly 模式顯示 */}
                        {!readOnly && (
                          <button
                            onClick={clearRecording}
                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                            title="清除錄音"
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
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          className="w-12 h-12 sm:w-16 sm:h-16 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transition-all"
                          disabled={readOnly}
                          onClick={() => {
                            setAssessmentResult(null);
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
                      {formatTime(recordingTime)}
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

            {/* 老師評語 */}
            <div
              className={cn(
                "rounded-lg border-2 p-3",
                currentItem.teacher_feedback
                  ? currentItem.teacher_passed === true
                    ? "border-green-400 bg-green-50"
                    : currentItem.teacher_passed === false
                      ? "border-red-400 bg-red-50"
                      : "border-blue-400 bg-blue-50"
                  : "border-gray-200 bg-gray-50 opacity-50",
              )}
            >
              <div
                className={cn(
                  "text-sm sm:text-base font-medium mb-1 flex items-center gap-1",
                  currentItem.teacher_feedback
                    ? currentItem.teacher_passed === true
                      ? "text-green-600"
                      : currentItem.teacher_passed === false
                        ? "text-red-600"
                        : "text-blue-600"
                    : "text-gray-400",
                )}
              >
                <MessageSquare className="w-4 h-4" />
                {t("wordReading.teacherFeedback") || "老師評語"}
                {currentItem.teacher_feedback &&
                  currentItem.teacher_passed !== null &&
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
                {currentItem.teacher_feedback || (
                  <span className="text-gray-400">
                    {t("wordReading.noTeacherFeedback") || "尚無老師評語"}
                  </span>
                )}
              </div>
              {currentItem.teacher_reviewed_at && (
                <div className="text-sm text-gray-500 mt-1">
                  {new Date(currentItem.teacher_reviewed_at).toLocaleString(
                    "zh-TW",
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 右欄 - AI 評估結果 */}
          <div className="w-full sm:col-span-6 space-y-4">
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
                  <style
                    dangerouslySetInnerHTML={{
                      __html: `
                      @keyframes pulse-scale {
                        0%, 100% {
                          transform: scale(1);
                        }
                        50% {
                          transform: scale(1.08);
                        }
                      }
                    `,
                    }}
                  />
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
                    {!readOnly && (
                      <button
                        onClick={clearRecording}
                        className="absolute top-0 right-0 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors z-10"
                        title="清除錄音和評估結果"
                        disabled={isAssessing}
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
                    )}

                    <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-lg p-6 space-y-6">
                      <div className="text-center">
                        <h4 className="text-xl font-bold text-blue-900 mb-4 flex items-center justify-center gap-2">
                          <Brain className="h-6 w-6" />
                          {t("wordReading.aiResult") || "AI 評估結果"}
                        </h4>

                        {/* Overall Score */}
                        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
                          <div className="text-4xl font-bold text-blue-600 mb-2">
                            {assessmentResult.overallScore}
                            {t("wordReading.points") || " 分"}
                          </div>
                          <Badge
                            variant={getScoreBadgeVariant(
                              assessmentResult.overallScore,
                            )}
                            className="text-sm px-3 py-1"
                          >
                            {t("wordReading.overallScore") || "綜合評分"}
                          </Badge>
                        </div>
                      </div>

                      {/* Detailed Scores */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white rounded-lg p-3 text-center">
                          <div className="text-xs text-gray-500 mb-1">
                            {t("wordReading.accuracy") || "準確度"}
                          </div>
                          <div
                            className={`text-lg font-bold ${getScoreColor(assessmentResult.accuracyScore)}`}
                          >
                            {assessmentResult.accuracyScore}
                          </div>
                        </div>
                        <div className="bg-white rounded-lg p-3 text-center">
                          <div className="text-xs text-gray-500 mb-1">
                            {t("wordReading.fluency") || "流暢度"}
                          </div>
                          <div
                            className={`text-lg font-bold ${getScoreColor(assessmentResult.fluencyScore)}`}
                          >
                            {assessmentResult.fluencyScore}
                          </div>
                        </div>
                        <div className="bg-white rounded-lg p-3 text-center">
                          <div className="text-xs text-gray-500 mb-1">
                            {t("wordReading.completeness") || "完整度"}
                          </div>
                          <div
                            className={`text-lg font-bold ${getScoreColor(assessmentResult.completenessScore)}`}
                          >
                            {assessmentResult.completenessScore}
                          </div>
                        </div>
                        <div className="bg-white rounded-lg p-3 text-center">
                          <div className="text-xs text-gray-500 mb-1">
                            {t("wordReading.pronunciation") || "發音"}
                          </div>
                          <div
                            className={`text-lg font-bold ${getScoreColor(assessmentResult.pronunciationScore)}`}
                          >
                            {assessmentResult.pronunciationScore}
                          </div>
                        </div>
                      </div>

                      {/* 🎯 Issue #450: 音素分析視覺化 */}
                      {phonemeResult?.detailed_words?.[0]?.phonemes &&
                        phonemeResult.detailed_words[0].phonemes.length > 0 && (
                          <PhonemeVisualization
                            phonemes={phonemeResult.detailed_words[0].phonemes}
                          />
                        )}

                      {/* Re-assess Button */}
                      {!readOnly && (
                        <div className="text-center">
                          <Button
                            onClick={() => setAssessmentResult(null)}
                            variant="outline"
                            size="sm"
                            className="border-blue-200 text-blue-700 hover:bg-blue-50"
                          >
                            {t("wordReading.reassess") || "重新評估"}
                          </Button>
                        </div>
                      )}
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

      {/* Timeout Dialog */}
      <Dialog open={showTimeoutDialog} onOpenChange={setShowTimeoutDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <Clock className="h-5 w-5" />
              {t("wordReading.timeUp") || "時間到！"}
            </DialogTitle>
            <DialogDescription>
              {t("wordReading.timeUpDescription") ||
                "錄音時間已結束，您可以選擇重試或跳過此題。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={handleRetry}
              className="flex items-center gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              {t("wordReading.retry") || "重試"}
            </Button>
            {onSkip && (
              <Button onClick={handleSkip} className="flex items-center gap-2">
                <SkipForward className="h-4 w-4" />
                {t("wordReading.skip") || "跳過"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
