import { useState, useRef, useEffect, memo } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import AIScoreDisplay from "@/components/shared/AIScoreDisplay";
import {
  Mic,
  Square,
  Play,
  Pause,
  Volume2,
  Brain,
  Loader2,
  MessageSquare,
  Languages,
  X,
  Upload,
} from "lucide-react";
import { retryAIAnalysis, retryAudioUpload } from "@/utils/retryHelper";

interface Question {
  text?: string;
  translation?: string;
  audio_url?: string;
  image_url?: string; // 新增圖片URL
  teacher_feedback?: string;
  teacher_passed?: boolean;
  teacher_review_score?: number;
  teacher_reviewed_at?: string;
  review_status?: string;
  // Example sentence fields
  example_sentence?: string;
  example_sentence_translation?: string;
  [key: string]: unknown;
}

interface AssessmentResult {
  pronunciation_score?: number;
  accuracy_score?: number;
  fluency_score?: number;
  completeness_score?: number;
  overall_score?: number;
  prosody_score?: number;
  words?: Array<{
    accuracy_score?: number;
    word: string;
    error_type?: string;
  }>;
  word_details?: Array<{
    accuracy_score: number;
    word: string;
    error_type?: string;
  }>;
  detailed_words?: Array<{
    index: number;
    word: string;
    accuracy_score: number;
    error_type?: string;
    syllables?: Array<{
      index: number;
      syllable: string;
      accuracy_score: number;
    }>;
    phonemes?: Array<{
      index: number;
      phoneme: string;
      accuracy_score: number;
    }>;
  }>;
  reference_text?: string;
  recognized_text?: string;
  analysis_summary?: {
    total_words: number;
    problematic_words: string[];
    low_score_phonemes: Array<{
      phoneme: string;
      score: number;
      in_word: string;
    }>;
    assessment_time?: string;
  };
  error_type?: string;
}

interface GroupedQuestionsTemplateProps {
  items: Question[];
  // answers?: string[]; // 目前未使用
  currentQuestionIndex?: number;
  isRecording?: boolean;
  recordingTime?: number;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  onUpdateItemRecording?: (index: number, recordingUrl: string) => void; // 更新單一 item 的錄音
  onFileUpload?: (file: File) => void; // 🎯 檔案上傳回調
  formatTime?: (seconds: number) => string;
  progressId?: number | string;
  progressIds?: number[]; // 每個子問題的 progress_id 數組
  initialAssessmentResults?: Record<string, unknown>; // AI 評估結果
  readOnly?: boolean; // 唯讀模式
  assignmentId?: string; // 作業 ID，用於上傳錄音
  isPreviewMode?: boolean; // 預覽模式（老師端預覽）
  isDemoMode?: boolean; // Demo mode - uses public demo API endpoints
  authToken?: string; // 認證 token（預覽模式用 teacher token）
  onUploadSuccess?: (index: number, gcsUrl: string, progressId: number) => void; // 上傳成功回調
  onAssessmentComplete?: (
    index: number,
    assessmentResult: AssessmentResult | null,
  ) => void; // AI 評估完成回調
  timeLimit?: number; // 錄音時間限制（秒）
}

const GroupedQuestionsTemplate = memo(function GroupedQuestionsTemplate({
  items,
  // answers = [], // 目前未使用
  currentQuestionIndex = 0,
  isRecording = false,
  recordingTime = 0,
  onStartRecording,
  onStopRecording,
  onUpdateItemRecording,
  onFileUpload,
  formatTime = (s) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`,
  progressId,
  progressIds = [], // 接收 progress_id 數組
  initialAssessmentResults,
  readOnly = false, // 唯讀模式
  assignmentId,
  isPreviewMode = false, // 預覽模式
  isDemoMode = false, // Demo mode
  authToken, // 認證 token
  onUploadSuccess,
  onAssessmentComplete,
  timeLimit = 30, // 錄音時間限制（秒）
}: GroupedQuestionsTemplateProps) {
  const currentQuestion = items[currentQuestionIndex];

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isAssessing, setIsAssessing] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0); // 播放倍速
  const questionAudioRef = useRef<HTMLAudioElement | null>(null); // 題目音檔播放器
  const [assessmentResults, setAssessmentResults] = useState<
    Record<number, AssessmentResult>
  >(() => {
    // 如果有初始 AI 評分，處理多題目的評分結構
    if (
      initialAssessmentResults &&
      Object.keys(initialAssessmentResults).length > 0
    ) {
      // 檢查是否有多題目的評分結構 (items)
      if (
        initialAssessmentResults.items &&
        typeof initialAssessmentResults.items === "object"
      ) {
        const itemsResults: Record<number, AssessmentResult> = {};
        const items = initialAssessmentResults.items as Record<string, unknown>;

        // 將 items 中的評分轉換為數字索引的結果
        Object.keys(items).forEach((key) => {
          const index = parseInt(key);
          if (!isNaN(index) && items[key]) {
            itemsResults[index] = items[key] as AssessmentResult;
          }
        });

        return itemsResults;
      }
      // 如果這是一個單獨的評分結果（不是分組的）
      else if (
        !Object.prototype.hasOwnProperty.call(initialAssessmentResults, "0")
      ) {
        return { 0: initialAssessmentResults as AssessmentResult };
      }
      return initialAssessmentResults as Record<number, AssessmentResult>;
    }
    return {};
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const uploadButtonRef = useRef<HTMLButtonElement | null>(null);

  // 使用傳入的 token（預覽模式）或從 student store 取得（正常模式）
  const { token: studentToken } = useStudentAuthStore();
  const token = authToken || studentToken;

  // 🎯 Auto-stop recording when time limit is reached (Issue #108)
  useEffect(() => {
    if (isRecording && recordingTime >= timeLimit) {
      onStopRecording?.();
    }
  }, [isRecording, recordingTime, timeLimit, onStopRecording]);

  // Update assessmentResults when initialAssessmentResults changes
  useEffect(() => {
    if (
      initialAssessmentResults &&
      Object.keys(initialAssessmentResults).length > 0
    ) {
      // Check if it has items structure
      if (
        initialAssessmentResults.items &&
        typeof initialAssessmentResults.items === "object"
      ) {
        const itemsResults: Record<number, AssessmentResult> = {};
        const items = initialAssessmentResults.items as Record<string, unknown>;

        Object.keys(items).forEach((key) => {
          const index = parseInt(key);
          if (!isNaN(index) && items[key]) {
            itemsResults[index] = items[key] as AssessmentResult;
          }
        });

        setAssessmentResults(itemsResults);
      } else if (
        !Object.prototype.hasOwnProperty.call(initialAssessmentResults, "0")
      ) {
        setAssessmentResults({
          0: initialAssessmentResults as AssessmentResult,
        });
      } else {
        setAssessmentResults(
          initialAssessmentResults as Record<number, AssessmentResult>,
        );
      }
    }
  }, [initialAssessmentResults]);

  // 手機版：錄音完成後自動滾動到上傳按鈕
  useEffect(() => {
    const hasRecording = items[currentQuestionIndex]?.recording_url;
    const hasNoAssessment = !assessmentResults[currentQuestionIndex];
    const isMobile = window.innerWidth < 640; // Tailwind sm breakpoint

    if (hasRecording && hasNoAssessment && !isAssessing && isMobile) {
      // 延遲一點時間確保按鈕已渲染
      setTimeout(() => {
        if (uploadButtonRef.current) {
          uploadButtonRef.current.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
      }, 300);
    }
  }, [items, currentQuestionIndex, assessmentResults, isAssessing]);

  // 檢查題目是否已完成 - 目前未使用
  // const isQuestionCompleted = (index: number) => {
  //   const recording = items[index]?.recording_url;
  //   return recording || answers[index];
  // };

  // 播放/暫停音檔
  const togglePlayback = () => {
    const currentRecording = items[currentQuestionIndex]?.recording_url;
    if (!currentRecording) return;

    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }

      const audio = new Audio(currentRecording as string);
      audioRef.current = audio;

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

      // 設定播放速度
      audio.playbackRate = playbackRate;
      audio.play();
      setIsPlaying(true);

      progressIntervalRef.current = setInterval(() => {
        if (audioRef.current) {
          setCurrentTime(audioRef.current.currentTime);
        }
      }, 100);
    }
  };

  // 更新播放速度
  const updatePlaybackRate = (newRate: number) => {
    setPlaybackRate(newRate);
    if (audioRef.current && isPlaying) {
      audioRef.current.playbackRate = newRate;
    }
  };

  // 清理音檔播放和重置狀態
  useEffect(() => {
    // Reset states when switching questions
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    // Clean up previous audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    // Preload duration for current recording if it exists
    const currentRecording = items[currentQuestionIndex]?.recording_url;
    if (currentRecording) {
      const tempAudio = new Audio(currentRecording as string);
      tempAudio.addEventListener("loadedmetadata", () => {
        const dur = tempAudio.duration;
        if (dur && isFinite(dur) && !isNaN(dur)) {
          setDuration(dur);
        } else {
          setDuration(0);
        }
      });
      // Trigger load
      tempAudio.load();
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, [currentQuestionIndex, items]);

  // 自動播放題目音檔
  useEffect(() => {
    // 清理之前的題目音檔
    if (questionAudioRef.current) {
      questionAudioRef.current.pause();
      questionAudioRef.current = null;
    }

    // 如果當前題目有音檔，自動播放
    const questionAudio = currentQuestion?.audio_url;
    if (questionAudio) {
      const audio = new Audio(questionAudio as string);
      audio.playbackRate = playbackRate;
      questionAudioRef.current = audio;

      // 播放音檔
      audio.play().catch(() => {
        // 瀏覽器自動播放政策阻擋，需要用戶互動
      });
    }

    // 清理函數
    return () => {
      if (questionAudioRef.current) {
        questionAudioRef.current.pause();
        questionAudioRef.current = null;
      }
    };
  }, [currentQuestionIndex, currentQuestion?.audio_url, playbackRate]);

  // 格式化時間
  const formatAudioTime = (seconds: number) => {
    if (!seconds || !isFinite(seconds) || isNaN(seconds)) {
      return "0:00";
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // AI 發音評估
  const handleAssessment = async () => {
    const audioUrl = items[currentQuestionIndex]?.recording_url;
    const referenceText = currentQuestion?.text;
    const contentItemId = items[currentQuestionIndex]?.id;

    if (!audioUrl || !referenceText) {
      toast.error("請先錄音並確保有參考文本");
      return;
    }

    if (!assignmentId || !contentItemId) {
      toast.error("缺少作業或題目資訊，無法上傳");
      return;
    }

    setIsAssessing(true);
    try {
      let gcsAudioUrl = audioUrl as string;
      let currentProgressId =
        progressIds && progressIds[currentQuestionIndex]
          ? progressIds[currentQuestionIndex]
          : null;

      // 🔍 檢查是否需要上傳（如果是 blob URL）
      // 預覽模式跳過上傳到資料庫
      if (
        typeof audioUrl === "string" &&
        audioUrl.startsWith("blob:") &&
        !isPreviewMode
      ) {
        toast.info("正在上傳錄音...");

        // Convert blob URL to blob
        const response = await fetch(audioUrl as string);
        const audioBlob = await response.blob();

        // 上傳到 GCS
        const formData = new FormData();
        formData.append("assignment_id", assignmentId);
        formData.append("content_item_id", contentItemId.toString());
        // 根據 blob 的 MIME type 決定檔案副檔名
        const uploadFileExtension = audioBlob.type.includes("mp4")
          ? "recording.mp4"
          : audioBlob.type.includes("webm")
            ? "recording.webm"
            : "recording.audio";
        formData.append("audio_file", audioBlob, uploadFileExtension);

        const apiUrl = import.meta.env.VITE_API_URL || "";
        const uploadResult = await retryAudioUpload(
          async () => {
            const uploadResponse = await fetch(
              `${apiUrl}/api/students/upload-recording`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                },
                body: formData,
              },
            );

            if (!uploadResponse.ok) {
              const error = new Error(
                `Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`,
              );
              if (uploadResponse.status >= 500) {
                throw error;
              }
              throw Object.assign(error, { noRetry: true });
            }

            return await uploadResponse.json();
          },
          (attempt) => {
            toast.warning(`上傳失敗，正在重試... (第 ${attempt}/3 次)`);
          },
        );

        gcsAudioUrl = uploadResult.audio_url;
        currentProgressId = uploadResult.progress_id;

        // 通知父元件上傳成功
        if (onUploadSuccess && currentProgressId) {
          onUploadSuccess(currentQuestionIndex, gcsAudioUrl, currentProgressId);
        }

        toast.success("錄音已上傳到雲端");
      }

      // 🤖 開始 AI 分析
      toast.info("AI 正在分析您的發音...");

      // Convert audio URL to blob for AI analysis
      const response = await fetch(
        isPreviewMode ? (audioUrl as string) : gcsAudioUrl,
      );
      const audioBlob = await response.blob();

      // Create form data
      const formData = new FormData();
      // 根據 blob 的 MIME type 決定檔案副檔名
      const fileExtension = audioBlob.type.includes("mp4")
        ? "recording.mp4"
        : audioBlob.type.includes("webm")
          ? "recording.webm"
          : "recording.audio";
      formData.append("audio_file", audioBlob, fileExtension);
      formData.append("reference_text", referenceText);

      // Get authentication token from store
      if (!token) {
        toast.error("請重新登入");
        return;
      }

      const apiUrl = import.meta.env.VITE_API_URL || "";
      let result;

      // Demo mode, Preview mode, or Normal student mode
      if (isDemoMode) {
        // Demo mode: use demo API without authentication
        result = await retryAIAnalysis(
          async () => {
            const assessResponse = await fetch(
              `${apiUrl}/api/demo/assignments/preview/assess-speech`,
              {
                method: "POST",
                // No Authorization header for demo mode
                body: formData,
              },
            );

            if (!assessResponse.ok) {
              const error = new Error(
                `AI Analysis failed: ${assessResponse.status} ${assessResponse.statusText}`,
              );
              if (
                assessResponse.status >= 500 ||
                assessResponse.status === 429
              ) {
                throw error;
              }
              throw Object.assign(error, { noRetry: true });
            }

            const data = await assessResponse.json();
            // Demo API 返回格式：{ success: true, assessment: {...} }
            return data.assessment;
          },
          (attempt) => {
            toast.warning(`AI 分析失敗，正在重試... (第 ${attempt}/3 次)`);
          },
        );
      } else if (isPreviewMode) {
        // 預覽模式：使用老師的預覽 API，不需要 progress_id
        result = await retryAIAnalysis(
          async () => {
            const assessResponse = await fetch(
              `${apiUrl}/api/teachers/assignments/preview/assess-speech`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                },
                body: formData,
              },
            );

            if (!assessResponse.ok) {
              const error = new Error(
                `AI Analysis failed: ${assessResponse.status} ${assessResponse.statusText}`,
              );
              if (
                assessResponse.status >= 500 ||
                assessResponse.status === 429
              ) {
                throw error;
              }
              throw Object.assign(error, { noRetry: true });
            }

            const data = await assessResponse.json();
            // 預覽 API 返回格式：{ success: true, preview_mode: true, assessment: {...} }
            return data.assessment;
          },
          (attempt) => {
            toast.warning(`AI 分析失敗，正在重試... (第 ${attempt}/3 次)`);
          },
        );
      } else {
        // 正常模式：使用學生 API，需要 progress_id
        // 🔥 如果還沒有 progress_id，使用 fallback
        if (!currentProgressId) {
          currentProgressId = (progressId as number) || 1;
        }

        formData.append("progress_id", String(currentProgressId));
        formData.append("item_index", String(currentQuestionIndex));

        result = await retryAIAnalysis(
          async () => {
            const assessResponse = await fetch(`${apiUrl}/api/speech/assess`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
              },
              body: formData,
            });

            if (!assessResponse.ok) {
              const error = new Error(
                `AI Analysis failed: ${assessResponse.status} ${assessResponse.statusText}`,
              );
              if (
                assessResponse.status >= 500 ||
                assessResponse.status === 429
              ) {
                throw error;
              }
              throw Object.assign(error, { noRetry: true });
            }

            return await assessResponse.json();
          },
          (attempt) => {
            toast.warning(`AI 分析失敗，正在重試... (第 ${attempt}/3 次)`);
          },
        );
      }

      // Store result
      setAssessmentResults((prev) => ({
        ...prev,
        [currentQuestionIndex]: result,
      }));

      // Notify parent component about assessment completion
      if (onAssessmentComplete) {
        onAssessmentComplete(currentQuestionIndex, result);
      }

      toast.success("AI 發音評估完成！");
    } catch (error) {
      console.error("Assessment error:", error);
      toast.error("AI 評估失敗，請稍後再試");
    } finally {
      setIsAssessing(false);
    }
  };

  return (
    <div className="w-full">
      {/* 響應式佈局 - 手機垂直堆疊，桌面三欄式 */}
      <div className="flex flex-col sm:grid sm:grid-cols-12 gap-3 sm:gap-4 w-full">
        {/* 圖片區域 - 手機全寬，桌面3欄 */}
        {currentQuestion?.image_url && (
          <div className="w-full sm:col-span-3">
            <div className="w-full aspect-square rounded-lg overflow-hidden bg-gray-100">
              <img
                src={currentQuestion.image_url}
                alt="題目圖片"
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.parentElement!.innerHTML = `
                    <div class="w-full h-full flex items-center justify-center bg-gray-100">
                      <div class="text-center text-gray-400">
                        <svg class="w-16 h-16 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                        </svg>
                        <p class="text-sm">圖片載入失敗</p>
                      </div>
                    </div>
                  `;
                }}
              />
            </div>
          </div>
        )}

        {/* 題目和學生作答區 - 手機全寬，桌面根據是否有圖片調整 */}
        <div
          className={`w-full ${currentQuestion?.image_url ? "sm:col-span-5" : "sm:col-span-6"} space-y-3`}
        >
          {/* 題目區域 - 更精簡版 */}
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            {/* 題目文字與音檔 - 手機優化間距 */}
            <div className="flex items-center gap-2 sm:gap-3 mb-2">
              <button
                onClick={() => {
                  if (questionAudioRef.current) {
                    // 如果已有音檔，直接播放或暫停
                    if (questionAudioRef.current.paused) {
                      questionAudioRef.current.play();
                    } else {
                      questionAudioRef.current.pause();
                    }
                  } else if (currentQuestion?.audio_url) {
                    // 如果沒有音檔引用，創建新的
                    const audio = new Audio(currentQuestion.audio_url);
                    audio.playbackRate = playbackRate;
                    questionAudioRef.current = audio;
                    audio.play();
                  }
                }}
                disabled={!currentQuestion?.audio_url}
                className={`p-1.5 rounded-full transition-colors flex-shrink-0 ${
                  currentQuestion?.audio_url
                    ? "bg-green-100 hover:bg-green-200 text-green-600 cursor-pointer"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                }`}
                title={
                  currentQuestion?.audio_url ? "播放參考音檔" : "無參考音檔"
                }
              >
                <Volume2 className="w-4 h-4" />
              </button>

              {/* 題目文字 - 響應式字體大小 */}
              <div className="text-base sm:text-lg font-medium text-gray-800 flex-1">
                {currentQuestion?.text ? (
                  <div className="flex flex-wrap gap-1">
                    {currentQuestion.text.split(" ").map((word, index) => (
                      <span
                        key={index}
                        className="cursor-pointer hover:text-blue-600 hover:underline transition-colors px-1"
                        onClick={() => {
                          // 使用 Web Speech API 發音
                          if ("speechSynthesis" in window) {
                            // 取消之前的發音
                            window.speechSynthesis.cancel();

                            const utterance = new SpeechSynthesisUtterance(
                              word,
                            );
                            utterance.lang = "en-US"; // 設定為英文發音
                            utterance.rate = 1.0; // 正常速度
                            utterance.pitch = 1.0; // 正常音調
                            utterance.volume = 1.0; // 最大音量

                            window.speechSynthesis.speak(utterance);
                          }
                        }}
                        title={`點擊發音: ${word}`}
                      >
                        {word}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-gray-400 italic">無題目文字</span>
                )}
              </div>

              {/* 倍速控制 */}
              <select
                value={playbackRate}
                onChange={(e) => updatePlaybackRate(parseFloat(e.target.value))}
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
            </div>

            {/* 翻譯 - 響應式字體和內距 */}
            {currentQuestion?.translation && (
              <div className="flex items-center gap-2 text-sm sm:text-base text-purple-600 bg-purple-50 rounded px-2 sm:px-3 py-1.5 sm:py-2">
                <Languages className="w-4 h-4" />
                <span>{currentQuestion.translation}</span>
              </div>
            )}

            {/* 例句顯示 */}
            {currentQuestion?.example_sentence && (
              <div className="space-y-2 border-t border-gray-200 pt-3 mt-3">
                <div className="text-xs font-medium text-gray-500">
                  參考例句
                </div>
                <div className="text-sm text-gray-800 bg-blue-50 rounded px-3 py-2">
                  💡 {currentQuestion.example_sentence}
                </div>
                {currentQuestion.example_sentence_translation && (
                  <div className="flex items-start gap-2 text-xs text-gray-600">
                    <span className="text-gray-400">🇹🇼 中文:</span>
                    <span>{currentQuestion.example_sentence_translation}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 學生錄音區 - 超精簡版 */}
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-sm sm:text-base font-medium text-gray-700 mb-2">
              學生作答
            </div>

            {/* 錄音控制 - 一行搞定 */}
            <div className="flex items-center gap-2">
              {!isRecording ? (
                <>
                  {/* 錄音按鈕或播放控制 */}
                  {items[currentQuestionIndex]?.recording_url ? (
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
                          {formatAudioTime(
                            duration >= timeLimit - 1 ? timeLimit : duration,
                          )}
                        </div>
                      </div>

                      {/* 清除錄音按鈕 */}
                      <button
                        onClick={async () => {
                          // 停止播放
                          if (audioRef.current) audioRef.current.pause();
                          setIsPlaying(false);
                          setCurrentTime(0);
                          setDuration(0);

                          // 呼叫後端 DELETE API 清空 DB
                          if (
                            assignmentId &&
                            currentQuestionIndex !== undefined
                          ) {
                            try {
                              const apiUrl = import.meta.env.VITE_API_URL || "";
                              const token =
                                useStudentAuthStore.getState().token;

                              const response = await fetch(
                                `${apiUrl}/api/speech/assessment/${assignmentId}/item/${currentQuestionIndex}`,
                                {
                                  method: "DELETE",
                                  headers: {
                                    Authorization: `Bearer ${token}`,
                                    "Content-Type": "application/json",
                                  },
                                },
                              );

                              if (!response.ok) {
                                throw new Error(`HTTP ${response.status}`);
                              }

                              toast.success("錄音和評估結果已刪除");
                            } catch (error) {
                              console.error("刪除 DB 記錄失敗:", error);
                              toast.error("刪除失敗，請稍後再試");
                              return; // 失敗時不繼續清除前端狀態
                            }
                          }

                          // 清除前端狀態 - 必須創建新物件才能觸發重新渲染
                          setAssessmentResults((prev) => {
                            // Remove the key using destructuring

                            const { [currentQuestionIndex]: _, ...newResults } =
                              prev;
                            return newResults;
                          });

                          // 清空 items 中的 recording_url，觸發學生作答區塊 reset
                          if (
                            onUpdateItemRecording &&
                            currentQuestionIndex !== undefined
                          ) {
                            onUpdateItemRecording(currentQuestionIndex, "");
                          }

                          // 也要清空 items 的 ai_assessment，確保重新整理後不會殘留
                          if (
                            onAssessmentComplete &&
                            currentQuestionIndex !== undefined
                          ) {
                            onAssessmentComplete(currentQuestionIndex, null);
                          }
                        }}
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
                    </>
                  ) : (
                    <>
                      <button
                        className="w-12 h-12 sm:w-16 sm:h-16 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transition-all"
                        disabled={readOnly}
                        onClick={() => {
                          setAssessmentResults((prev) => {
                            const newResults = { ...prev };
                            delete newResults[currentQuestionIndex];
                            return newResults;
                          });
                          onStartRecording?.();
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
                            if (file && onFileUpload) onFileUpload(file);
                          };
                          input.click();
                        }}
                        title={readOnly ? "檢視模式" : "上傳音檔"}
                      >
                        <Upload className="w-5 h-5 sm:w-6 sm:h-6" />
                      </button>
                      <span className="text-sm sm:text-base text-gray-600">
                        {readOnly ? "檢視模式" : "開始錄音或上傳"}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <>
                  {/* 錄音中狀態 */}
                  <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse" />
                  <span className="text-base font-medium text-red-600">
                    {formatTime(
                      recordingTime >= timeLimit - 1
                        ? timeLimit
                        : recordingTime,
                    )}{" "}
                    / {formatTime(timeLimit)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onStopRecording}
                    className="border-red-600 text-red-600 hover:bg-red-50 h-7 px-2 text-xs"
                  >
                    <Square className="w-3 h-3 mr-1" />
                    停止
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* 老師評語 - 始終顯示，無評語時禁用狀態 */}
          {
            <div
              className={`rounded-lg border-2 p-3 ${
                currentQuestion?.teacher_feedback
                  ? currentQuestion.teacher_passed === true
                    ? "border-green-400 bg-green-50"
                    : currentQuestion.teacher_passed === false
                      ? "border-red-400 bg-red-50"
                      : "border-blue-400 bg-blue-50"
                  : "border-gray-200 bg-gray-50 opacity-50"
              }`}
            >
              <div
                className={`text-sm sm:text-base font-medium mb-1 flex items-center gap-1 ${
                  currentQuestion?.teacher_feedback
                    ? currentQuestion.teacher_passed === true
                      ? "text-green-600"
                      : currentQuestion.teacher_passed === false
                        ? "text-red-600"
                        : "text-blue-600"
                    : "text-gray-400"
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                老師評語
                {currentQuestion?.teacher_feedback &&
                  currentQuestion.teacher_passed !== null &&
                  currentQuestion.teacher_passed !== undefined && (
                    <span
                      className={
                        currentQuestion.teacher_passed
                          ? "text-green-600"
                          : "text-red-600"
                      }
                    >
                      {currentQuestion.teacher_passed
                        ? "（通過）"
                        : "（未通過）"}
                    </span>
                  )}
              </div>
              <div className="text-sm sm:text-base text-gray-700">
                {currentQuestion?.teacher_feedback || (
                  <span className="text-gray-400">尚無老師評語</span>
                )}
              </div>
              {currentQuestion?.teacher_reviewed_at && (
                <div className="text-sm text-gray-500 mt-1">
                  {new Date(currentQuestion.teacher_reviewed_at).toLocaleString(
                    "zh-TW",
                  )}
                </div>
              )}
            </div>
          }
        </div>

        {/* AI分析 - 手機全寬，桌面根據是否有圖片調整 */}
        <div
          className={`w-full ${currentQuestion?.image_url ? "sm:col-span-4" : "sm:col-span-6"} space-y-4`}
        >
          {/* AI 評估結果 */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            {items[currentQuestionIndex]?.recording_url &&
            !assessmentResults[currentQuestionIndex] ? (
              <div className="flex justify-center mb-4 py-6">
                <Button
                  ref={uploadButtonRef}
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
                      上傳並分析中
                    </>
                  ) : (
                    <>
                      <Brain className="w-7 h-7 mr-3 animate-pulse" />
                      上傳並分析
                    </>
                  )}
                </Button>
              </div>
            ) : null}
            {assessmentResults[currentQuestionIndex] ? (
              <div className="relative">
                {/* 評估結果 - 在分析時會被模糊 */}
                <div
                  className={`transition-all duration-300 ${isAssessing ? "blur-sm opacity-30" : ""}`}
                >
                  <button
                    onClick={async () => {
                      // 呼叫後端 DELETE API 清空 DB
                      if (assignmentId && currentQuestionIndex !== undefined) {
                        try {
                          const apiUrl = import.meta.env.VITE_API_URL || "";
                          const token = useStudentAuthStore.getState().token;

                          const response = await fetch(
                            `${apiUrl}/api/speech/assessment/${assignmentId}/item/${currentQuestionIndex}`,
                            {
                              method: "DELETE",
                              headers: {
                                Authorization: `Bearer ${token}`,
                                "Content-Type": "application/json",
                              },
                            },
                          );

                          if (!response.ok) {
                            throw new Error(`HTTP ${response.status}`);
                          }

                          toast.success("錄音和評估結果已刪除");
                        } catch (error) {
                          console.error("刪除 DB 記錄失敗:", error);
                          toast.error("刪除失敗，請稍後再試");
                          return; // 失敗時不繼續清除前端狀態
                        }
                      }

                      // 清除前端狀態 - 必須創建新物件才能觸發重新渲染
                      setAssessmentResults((prev) => {
                        // Remove the key using destructuring

                        const { [currentQuestionIndex]: _, ...newResults } =
                          prev;
                        return newResults;
                      });

                      // 清空 items 中的 recording_url，觸發學生作答區塊 reset
                      if (
                        onUpdateItemRecording &&
                        currentQuestionIndex !== undefined
                      ) {
                        onUpdateItemRecording(currentQuestionIndex, "");
                      }

                      // 也要清空 items 的 ai_assessment，確保重新整理後不會殘留
                      if (
                        onAssessmentComplete &&
                        currentQuestionIndex !== undefined
                      ) {
                        onAssessmentComplete(currentQuestionIndex, null);
                      }
                    }}
                    className="absolute top-0 right-0 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors z-10"
                    title="清除錄音和評估結果"
                    disabled={isAssessing}
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <AIScoreDisplay
                    key={`assessment-${currentQuestionIndex}`}
                    scores={assessmentResults[currentQuestionIndex]}
                    hasRecording={true}
                    title=""
                  />
                </div>

                {/* 思考動畫覆蓋層 - 在分析時顯示在最上層 */}
                {isAssessing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm z-20 rounded-lg">
                    <div className="text-center text-purple-500">
                      <div className="relative w-16 h-16 mx-auto mb-4">
                        {/* 外圈脈動動畫 */}
                        <div className="absolute inset-0 rounded-full bg-purple-100 animate-ping opacity-75"></div>
                        {/* 中圈脈動動畫 */}
                        <div className="absolute inset-2 rounded-full bg-purple-200 animate-pulse"></div>
                        {/* 大腦圖示 - 旋轉動畫 */}
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
                  </div>
                )}
              </div>
            ) : isAssessing ? (
              <div className="text-center text-purple-500 py-8">
                <div className="relative w-16 h-16 mx-auto mb-4">
                  {/* 外圈脈動動畫 */}
                  <div className="absolute inset-0 rounded-full bg-purple-100 animate-ping opacity-75"></div>
                  {/* 中圈脈動動畫 */}
                  <div className="absolute inset-2 rounded-full bg-purple-200 animate-pulse"></div>
                  {/* 大腦圖示 - 旋轉動畫 */}
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
                  {items[currentQuestionIndex]?.recording_url
                    ? "點擊上方按鈕開始評估"
                    : "請先錄音"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default GroupedQuestionsTemplate;
