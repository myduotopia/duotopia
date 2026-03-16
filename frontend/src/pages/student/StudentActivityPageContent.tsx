/**
 * 學生作業活動內容元件（可重用）
 *
 * 此元件包含完整的學生作業活動介面，可被以下場景使用：
 * 1. 學生作業頁面 (StudentActivityPage)
 * 2. 老師預覽示範頁面 (TeacherAssignmentPreviewPage)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import ReadingAssessmentTemplate from "@/components/activities/ReadingAssessmentTemplate";
import ListeningClozeTemplate from "@/components/activities/ListeningClozeTemplate";
import GroupedQuestionsTemplate from "@/components/activities/GroupedQuestionsTemplate";
import SentenceMakingActivity from "@/components/activities/SentenceMakingActivity";
import RearrangementActivity, {
  type RearrangementQuestion,
  type RearrangementQuestionState,
} from "@/components/activities/RearrangementActivity";
import WordReadingActivity from "@/components/activities/WordReadingActivity";
import WordSelectionActivity from "@/components/activities/WordSelectionActivity";
import {
  ChevronLeft,
  ChevronRight,
  Send,
  CheckCircle,
  Circle,
  Clock,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getRecordingStrategy,
  selectSupportedMimeType,
  validateDuration,
} from "@/utils/audioRecordingStrategy";
import { retryAudioUpload } from "@/utils/retryHelper";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { useTranslation } from "react-i18next";
import { useAzurePronunciation } from "@/hooks/useAzurePronunciation";
import { useDemoAzurePronunciation } from "@/hooks/useDemoAzurePronunciation";
import { azureSpeechService } from "@/services/azureSpeechService";
import { useAutoAnalysis } from "@/hooks/useAutoAnalysis"; // Issue #141: 例句朗讀自動分析
import { DemoLimitModal } from "@/components/demo/DemoLimitModal";

// Activity type from API
export interface Activity {
  id: number;
  content_id: number;
  order: number;
  type: string;
  title: string;
  content: string;
  target_text: string;
  duration: number;
  points: number;
  status: string;
  score: number | null;
  audio_url?: string | null;
  completed_at: string | null;
  items?: Array<{
    id?: number;
    text?: string;
    translation?: string;
    audio_url?: string;
    recording_url?: string;
    progress_id?: number;
    ai_assessment?: {
      accuracy_score?: number;
      fluency_score?: number;
      completeness_score?: number;
      pronunciation_score?: number;
      prosody_score?: number;
      word_details?: Array<{
        word: string;
        accuracy_score: number;
        error_type?: string;
      }>;
      detailed_words?: unknown[];
      reference_text?: string;
      recognized_text?: string;
      analysis_summary?: unknown;
    };
    [key: string]: unknown;
  }>;
  item_count?: number;
  answers?: string[];
  blanks?: string[];
  prompts?: string[];
  example_audio_url?: string;
  ai_scores?: {
    accuracy_score?: number;
    fluency_score?: number;
    completeness_score?: number;
    pronunciation_score?: number;
    word_details?: Array<{
      word: string;
      accuracy_score: number;
      error_type?: string;
    }>;
    items?: Record<
      number,
      {
        accuracy_score?: number;
        fluency_score?: number;
        completeness_score?: number;
        pronunciation_score?: number;
        prosody_score?: number;
        word_details?: Array<{
          word: string;
          accuracy_score: number;
          error_type?: string;
        }>;
        detailed_words?: unknown[];
        reference_text?: string;
        recognized_text?: string;
        analysis_summary?: unknown;
      }
    >;
  };
}

interface Answer {
  progressId: number;
  progressIds?: number[];
  audioBlob?: Blob;
  audioUrl?: string;
  textAnswer?: string;
  userAnswers?: string[];
  answers?: string[];
  startTime: Date;
  endTime?: Date;
  status: "not_started" | "in_progress" | "completed";
}

interface StudentActivityPageContentProps {
  activities: Activity[];
  assignmentTitle: string;
  assignmentId: number;
  isPreviewMode?: boolean;
  isDemoMode?: boolean; // Demo mode - uses public demo API endpoints
  authToken?: string; // 認證 token（預覽模式用）
  onBack?: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSubmit?: (data: { answers: any[] }) => Promise<void>;
  assignmentStatus?: string;
  practiceMode?: string | null; // 例句重組/朗讀模式
  showAnswer?: boolean; // 例句重組：答題結束後是否顯示正確答案
  canUseAiAnalysis?: boolean; // 教師/機構是否有 AI 分析額度
}

// =============================================================================
// Content Type Compatibility Helpers
// =============================================================================
// 處理新舊 ContentType 的相容性：
// - READING_ASSESSMENT (legacy) → EXAMPLE_SENTENCES (new) - 例句集
// - SENTENCE_MAKING (legacy) → VOCABULARY_SET (new) - 單字集

/**
 * 檢查是否為「例句集」類型（包含新舊類型）
 * 用於：朗讀練習、例句重組
 */
const isExampleSentencesType = (type: string): boolean => {
  const normalizedType = type?.toUpperCase();
  return ["READING_ASSESSMENT", "EXAMPLE_SENTENCES"].includes(normalizedType);
};

/**
 * 檢查是否為「單字集」類型（包含新舊類型）
 * 用於：造句練習
 */
const isVocabularySetType = (type: string): boolean => {
  const normalizedType = type?.toUpperCase();
  return ["SENTENCE_MAKING", "VOCABULARY_SET"].includes(normalizedType);
};

export default function StudentActivityPageContent({
  activities: initialActivities,
  assignmentTitle,
  assignmentId,
  isPreviewMode = false,
  isDemoMode = false,
  authToken,
  onBack,
  onSubmit,
  assignmentStatus = "",
  practiceMode = null,
  showAnswer = false,
  canUseAiAnalysis = true,
}: StudentActivityPageContentProps) {
  const { t } = useTranslation();

  // 🚀 Azure Speech Service hook for direct API calls (background analysis)
  // Use demo hook when in demo mode (no authentication required)
  const regularHook = useAzurePronunciation();
  const demoHook = useDemoAzurePronunciation();

  // Select the appropriate hook based on mode
  const { analyzePronunciation } = isDemoMode ? demoHook : regularHook;

  // Demo limit exceeded state (only used in demo mode)
  const {
    limitExceeded: demoLimitExceeded,
    limitError: demoLimitError,
    clearLimitError: clearDemoLimitError,
  } = demoHook;

  // 🎯 Issue #141: 例句朗讀自動分析 hook
  const {
    isAnalyzing: isAutoAnalyzing,
    analyzingMessage,
    analyzeAndUpload,
  } = useAutoAnalysis(assignmentId, isPreviewMode);

  // State management
  const [activities, setActivities] = useState<Activity[]>(initialActivities);
  const [currentActivityIndex, setCurrentActivityIndex] = useState(0);
  const [currentSubQuestionIndex, setCurrentSubQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<number, Answer>>(new Map());
  const [saving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [incompleteItems, setIncompleteItems] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false); // 🔒 GroupedQuestionsTemplate 錄音分析中狀態

  // 🎯 背景分析狀態管理
  type ItemAnalysisStatus =
    | "not_recorded"
    | "recorded"
    | "analyzing"
    | "analyzed"
    | "failed";

  interface ItemAnalysisState {
    status: ItemAnalysisStatus;
    error?: string;
    retryCount?: number;
  }

  const [itemAnalysisStates, setItemAnalysisStates] = useState<
    Map<string, ItemAnalysisState>
  >(new Map());
  const [pendingAnalysisCount, setPendingAnalysisCount] = useState(0); // 🔒 追蹤背景分析數量以觸發 UI 更新
  const pendingAnalysisRef = useRef<Map<string, Promise<void>>>(new Map());
  const failedItemsRef = useRef<Set<string>>(new Set());

  // 例句重組導航狀態
  const [rearrangementQuestions, setRearrangementQuestions] = useState<
    RearrangementQuestion[]
  >([]);
  const [rearrangementQuestionStates, setRearrangementQuestionStates] =
    useState<Map<number, RearrangementQuestionState>>(new Map());
  const [rearrangementQuestionIndex, setRearrangementQuestionIndex] =
    useState(0);

  // Read-only mode (for submitted/graded/resubmitted assignments)
  // Note: isPreviewMode is NOT read-only - it allows all operations but doesn't save to DB
  const isReadOnly =
    assignmentStatus === "SUBMITTED" ||
    assignmentStatus === "GRADED" ||
    assignmentStatus === "RESUBMITTED";

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(
    null,
  );
  const recordingInterval = useRef<NodeJS.Timeout | null>(null);
  const recordingTimeRef = useRef<number>(0);
  const hasRecordedData = useRef<boolean>(false);
  const isReRecording = useRef<boolean>(false);
  const streamRef = useRef<MediaStream | null>(null); // 🔧 追蹤 MediaStream 以便清理

  // Initialize answers
  useEffect(() => {
    const initialAnswers = new Map<number, Answer>();
    initialActivities.forEach((activity) => {
      let audioUrl: string | undefined = undefined;
      if (isExampleSentencesType(activity.type) && activity.items?.[0]) {
        audioUrl = activity.items[0].recording_url || "";
      }

      initialAnswers.set(activity.id, {
        progressId: activity.id,
        status:
          activity.status === "NOT_STARTED"
            ? "not_started"
            : activity.status === "IN_PROGRESS"
              ? "in_progress"
              : "completed",
        startTime: new Date(),
        audioUrl: audioUrl,
        answers: activity.answers || [],
        userAnswers: [],
      });
    });
    setAnswers(initialAnswers);
  }, [initialActivities]);

  // Scroll to top when switching questions
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentActivityIndex, currentSubQuestionIndex]);

  // 🎯 使用統一的錄音策略
  const strategyRef = useRef(getRecordingStrategy());

  // 🔧 清理錄音資源（避免重用舊的 MediaRecorder 和 Stream）
  const cleanupRecording = () => {
    // 停止舊的 MediaRecorder
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    setMediaRecorder(null);

    // 停止舊的 MediaStream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // 清理 timer
    if (recordingInterval.current) {
      clearInterval(recordingInterval.current);
      recordingInterval.current = null;
    }

    setIsRecording(false);
  };

  const startRecording = async (isReRecord: boolean = false) => {
    if (isReadOnly) {
      toast.warning(
        isPreviewMode
          ? t("studentActivityPage.warnings.previewNoRecord")
          : t("studentActivityPage.warnings.readonlyNoRecord"),
      );
      return;
    }

    isReRecording.current = isReRecord;

    try {
      // 🔧 先清理舊的錄音資源（關鍵！避免重用壞掉的 recorder）
      cleanupRecording();

      const currentActivity = activities[currentActivityIndex];

      // Clear previous recording and AI scores for grouped questions
      if (currentActivity.items && currentActivity.items.length > 0) {
        setActivities((prevActivities) => {
          const newActivities = [...prevActivities];
          const activityIndex = newActivities.findIndex(
            (a) => a.id === currentActivity.id,
          );
          if (activityIndex !== -1 && newActivities[activityIndex].items) {
            const newItems = [...newActivities[activityIndex].items!];
            if (newItems[currentSubQuestionIndex]) {
              newItems[currentSubQuestionIndex] = {
                ...newItems[currentSubQuestionIndex],
                recording_url: "",
              };
            }
            newActivities[activityIndex] = {
              ...newActivities[activityIndex],
              items: newItems,
              ai_scores: undefined,
            };
          }
          return newActivities;
        });
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream; // 🔧 儲存 stream reference

      // 🎯 使用統一錄音策略選擇 MIME type
      const strategy = strategyRef.current;
      const mimeType = selectSupportedMimeType(strategy);
      const options = mimeType ? { mimeType } : {};
      const recorder = new MediaRecorder(stream, options);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
          hasRecordedData.current = true;
        }
      };

      recorder.onstop = async () => {
        const actualRecordingDuration = recordingTimeRef.current;

        await new Promise((resolve) => setTimeout(resolve, 800)); // 500→800ms

        const audioBlob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });
        const currentActivity = activities[currentActivityIndex];

        // 🎯 使用統一驗證策略
        const strategy = strategyRef.current;
        const localAudioUrl = URL.createObjectURL(audioBlob);

        // 🔍 雙重檢查：chunks 和 blob 都太小才報錯
        const chunksSize = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
        const blobSize = audioBlob.size;

        if (
          chunksSize < strategy.minFileSize &&
          blobSize < strategy.minFileSize
        ) {
          console.error(
            `⚠️ Recording file too small (both checks failed): chunks=${chunksSize}B, blob=${blobSize}B, min=${strategy.minFileSize}B`,
          );

          const { logAudioError } = await import("@/utils/audioErrorLogger");
          await logAudioError({
            errorType: "recording_too_small",
            audioUrl: localAudioUrl,
            audioSize: blobSize,
            audioDuration: actualRecordingDuration,
            contentType: audioBlob.type,
            assignmentId: assignmentId,
            errorMessage: `Both chunks (${chunksSize}B) and blob (${blobSize}B) below minimum ${strategy.minFileSize}B`,
          });

          toast.error(t("studentActivityPage.recording.failed"), {
            description: t("studentActivityPage.recording.fileAbnormal"),
          });

          // 🔧 清理所有錄音狀態
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
          }
          setMediaRecorder(null);
          setIsRecording(false);
          setRecordingTime(0);
          return;
        }

        // 使用策略驗證 duration
        try {
          const validationResult = await validateDuration(
            audioBlob,
            localAudioUrl,
            strategy,
          );

          if (!validationResult.valid) {
            console.error("⚠️ Recording validation failed");

            const { logAudioError } = await import("@/utils/audioErrorLogger");
            await logAudioError({
              errorType: "recording_validation_failed",
              audioUrl: localAudioUrl,
              audioSize: audioBlob.size,
              audioDuration: validationResult.duration,
              contentType: audioBlob.type,
              assignmentId: assignmentId,
              errorMessage: `Validation failed (method: ${validationResult.method})`,
            });

            toast.error(t("studentActivityPage.recording.validationFailed"), {
              description: t("studentActivityPage.recording.fileAbnormal"),
            });

            // 🔧 清理 stream
            if (streamRef.current) {
              streamRef.current.getTracks().forEach((track) => track.stop());
              streamRef.current = null;
            }
            return;
          }

          if (isPreviewMode) {
            toast.success(t("studentActivityPage.recording.completePreview"), {
              description: t("studentActivityPage.recording.duration", {
                duration: Math.round(validationResult.duration),
              }),
            });
          }
          // 正常模式：不在此處顯示 toast，等上傳成功後再顯示（與單字朗讀行為一致）
        } catch (error) {
          console.error("⚠️ Recording validation error:", error);

          const { logAudioError } = await import("@/utils/audioErrorLogger");
          await logAudioError({
            errorType: "recording_validation_error",
            audioUrl: localAudioUrl,
            audioSize: audioBlob.size,
            audioDuration: actualRecordingDuration,
            contentType: audioBlob.type,
            assignmentId: assignmentId,
            errorMessage: String(error),
          });

          toast.error(t("studentActivityPage.recording.processingFailed"), {
            description: t("studentActivityPage.recording.cannotValidate"),
          });

          // 🔧 清理所有錄音狀態
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
          }
          setMediaRecorder(null);
          setIsRecording(false);
          setRecordingTime(0);
          return;
        }

        // Update local state immediately for playback
        setAnswers((prev) => {
          const newAnswers = new Map(prev);
          const answer = newAnswers.get(currentActivity.id) || {
            progressId: currentActivity.id,
            status: "not_started",
            startTime: new Date(),
            recordings: [],
            answers: [],
          };

          if (currentActivity.items && currentActivity.items.length > 0) {
            // Will update activities state instead
          } else {
            (answer as Answer).audioBlob = audioBlob;
            (answer as Answer).audioUrl = localAudioUrl;
          }

          answer.status = "in_progress";
          (answer as Answer).endTime = new Date();

          newAnswers.set(currentActivity.id, answer);
          return newAnswers;
        });

        // Update activity's item recording_url for display
        if (currentActivity.items && currentActivity.items.length > 0) {
          setActivities((prevActivities) => {
            const newActivities = [...prevActivities];
            const activityIndex = newActivities.findIndex(
              (a) => a.id === currentActivity.id,
            );
            if (activityIndex !== -1 && newActivities[activityIndex].items) {
              const newItems = [...newActivities[activityIndex].items!];
              if (newItems[currentSubQuestionIndex]) {
                newItems[currentSubQuestionIndex] = {
                  ...newItems[currentSubQuestionIndex],
                  recording_url: localAudioUrl,
                };
              }
              newActivities[activityIndex] = {
                ...newActivities[activityIndex],
                items: newItems,
              };
            }
            return newActivities;
          });
        }

        isReRecording.current = false;

        // 🎯 Issue #227: 錄音完成後立即上傳到 GCS（與單字朗讀行為一致）
        // 不論 canUseAiAnalysis 為何，錄音檔案都應保存到伺服器
        if (currentActivity.items && currentActivity.items.length > 0) {
          const contentItemId =
            currentActivity.items[currentSubQuestionIndex]?.id;
          if (!isPreviewMode && !isDemoMode && assignmentId && contentItemId) {
            const uploadFileExtension = audioBlob.type.includes("mp4")
              ? "recording.mp4"
              : audioBlob.type.includes("webm")
                ? "recording.webm"
                : "recording.audio";

            const formData = new FormData();
            formData.append("assignment_id", assignmentId.toString());
            formData.append("content_item_id", contentItemId.toString());
            formData.append("audio_file", audioBlob, uploadFileExtension);

            const apiUrl = import.meta.env.VITE_API_URL || "";
            const authToken = useStudentAuthStore.getState().token;
            const subIdx = currentSubQuestionIndex;
            const activityId = currentActivity.id;

            retryAudioUpload(
              async () => {
                const uploadResponse = await fetch(
                  `${apiUrl}/api/students/upload-recording`,
                  {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${authToken}`,
                    },
                    body: formData,
                  },
                );

                if (!uploadResponse.ok) {
                  throw new Error(`Upload failed: ${uploadResponse.status}`);
                }

                return await uploadResponse.json();
              },
              () => {},
            )
              .then((uploadResult) => {
                // 更新 recording_url 為 GCS URL
                setActivities((prevActivities) => {
                  const newActivities = [...prevActivities];
                  const activityIndex = newActivities.findIndex(
                    (a) => a.id === activityId,
                  );
                  if (
                    activityIndex !== -1 &&
                    newActivities[activityIndex].items
                  ) {
                    const newItems = [...newActivities[activityIndex].items!];
                    if (newItems[subIdx]) {
                      newItems[subIdx] = {
                        ...newItems[subIdx],
                        recording_url: uploadResult.audio_url,
                      };
                    }
                    newActivities[activityIndex] = {
                      ...newActivities[activityIndex],
                      items: newItems,
                    };
                  }
                  return newActivities;
                });

                // 更新 progressIds
                setAnswers((prev) => {
                  const newAnswers = new Map(prev);
                  const ans = newAnswers.get(activityId);
                  if (ans) {
                    if (!ans.progressIds) ans.progressIds = [];
                    while (ans.progressIds.length <= subIdx) {
                      ans.progressIds.push(0);
                    }
                    ans.progressIds[subIdx] = uploadResult.progress_id;
                  }
                  return newAnswers;
                });

                toast.success(
                  t("wordReading.toast.uploaded") || "Recording uploaded",
                );
              })
              .catch((error) => {
                console.error("❌ 錄音上傳失敗:", error);
              });
          }
        }

        // 🔧 錄音完成後清理所有錄音狀態
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
        setMediaRecorder(null);
        setIsRecording(false);
        setRecordingTime(0);
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimeRef.current = 0;
      hasRecordedData.current = false;

      // Start recording timer with 45 second limit
      let hasReachedLimit = false;
      recordingInterval.current = setInterval(() => {
        recordingTimeRef.current += 1;
        const newTime = recordingTimeRef.current;
        setRecordingTime(newTime);

        if (newTime >= 45 && !hasReachedLimit) {
          hasReachedLimit = true;
          if (recordingInterval.current) {
            clearInterval(recordingInterval.current);
            recordingInterval.current = null;
          }
          setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === "recording") {
              mediaRecorder.stop();
              setMediaRecorder(null);
              setIsRecording(false);
              toast.info(t("studentActivityPage.warnings.recordingLimit"));
            }
          }, 0);
        }
      }, 1000);
    } catch (error) {
      console.error("Failed to start recording:", error);
      toast.error(t("studentActivity.toast.cannotStartRecording"));
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      // cleanupRecording 會在 recorder.onstop 之後自動被呼叫
      // 這裡只清理 timer，避免干擾 onstop 事件
      if (recordingInterval.current) {
        clearInterval(recordingInterval.current);
        recordingInterval.current = null;
      }
    }
  };

  const handleRecordingComplete = useCallback(
    (blob: Blob, url: string) => {
      const currentActivity = activities[currentActivityIndex];
      const subIdx = currentSubQuestionIndex;

      setAnswers((prev) => {
        const newAnswers = new Map(prev);
        const answer = newAnswers.get(currentActivity.id) || {
          progressId: currentActivity.id,
          status: "not_started",
          startTime: new Date(),
          recordings: [],
          answers: [],
        };

        (answer as Answer).audioBlob = blob;
        (answer as Answer).audioUrl = url;
        answer.status = "in_progress";
        (answer as Answer).endTime = new Date();

        newAnswers.set(currentActivity.id, answer);
        return newAnswers;
      });

      if (currentActivity.items && currentActivity.items.length > 0) {
        setActivities((prevActivities) => {
          const newActivities = [...prevActivities];
          const activityIndex = newActivities.findIndex(
            (a) => a.id === currentActivity.id,
          );
          if (activityIndex !== -1 && newActivities[activityIndex].items) {
            const newItems = [...newActivities[activityIndex].items!];
            if (newItems[subIdx]) {
              newItems[subIdx] = {
                ...newItems[subIdx],
                recording_url: url,
              };
            }
            newActivities[activityIndex] = {
              ...newActivities[activityIndex],
              items: newItems,
            };
          }
          return newActivities;
        });

        // 🎯 Issue #227: 錄音完成後立即上傳到 GCS（與單字朗讀行為一致）
        // 不論 canUseAiAnalysis 為何，錄音檔案都應保存到伺服器
        const contentItemId = currentActivity.items[subIdx]?.id;
        if (!isPreviewMode && !isDemoMode && assignmentId && contentItemId) {
          const uploadFileExtension = blob.type.includes("mp4")
            ? "recording.mp4"
            : blob.type.includes("webm")
              ? "recording.webm"
              : "recording.audio";

          const formData = new FormData();
          formData.append("assignment_id", assignmentId.toString());
          formData.append("content_item_id", contentItemId.toString());
          formData.append("audio_file", blob, uploadFileExtension);

          const apiUrl = import.meta.env.VITE_API_URL || "";
          const authToken = useStudentAuthStore.getState().token;

          retryAudioUpload(
            async () => {
              const uploadResponse = await fetch(
                `${apiUrl}/api/students/upload-recording`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${authToken}`,
                  },
                  body: formData,
                },
              );

              if (!uploadResponse.ok) {
                throw new Error(`Upload failed: ${uploadResponse.status}`);
              }

              return await uploadResponse.json();
            },
            () => {},
          )
            .then((uploadResult) => {
              // 更新 recording_url 為 GCS URL
              setActivities((prevActivities) => {
                const newActivities = [...prevActivities];
                const activityIndex = newActivities.findIndex(
                  (a) => a.id === currentActivity.id,
                );
                if (
                  activityIndex !== -1 &&
                  newActivities[activityIndex].items
                ) {
                  const newItems = [...newActivities[activityIndex].items!];
                  if (newItems[subIdx]) {
                    newItems[subIdx] = {
                      ...newItems[subIdx],
                      recording_url: uploadResult.audio_url,
                    };
                  }
                  newActivities[activityIndex] = {
                    ...newActivities[activityIndex],
                    items: newItems,
                  };
                }
                return newActivities;
              });

              // 更新 progressIds
              setAnswers((prev) => {
                const newAnswers = new Map(prev);
                const answer = newAnswers.get(currentActivity.id);
                if (answer) {
                  if (!answer.progressIds) answer.progressIds = [];
                  while (answer.progressIds.length <= subIdx) {
                    answer.progressIds.push(0);
                  }
                  answer.progressIds[subIdx] = uploadResult.progress_id;
                }
                return newAnswers;
              });

              // 🎯 Issue #227: 上傳成功後，有額度時自動背景分析
              if (canUseAiAnalysis) {
                const targetText =
                  currentActivity.items![subIdx]?.text ||
                  currentActivity.target_text ||
                  "";
                if (targetText) {
                  analyzeAndUpload(
                    uploadResult.audio_url,
                    targetText,
                    uploadResult.progress_id,
                    contentItemId,
                  ).catch((err) =>
                    console.error(
                      "Background analysis after upload failed:",
                      err,
                    ),
                  );
                }
              }

              toast.success(
                t("wordReading.toast.uploaded") || "Recording uploaded",
              );
            })
            .catch((error) => {
              console.error("❌ 錄音上傳失敗:", error);
            });
        }
      }
    },
    [
      activities,
      currentActivityIndex,
      currentSubQuestionIndex,
      assignmentId,
      isPreviewMode,
      isDemoMode,
      canUseAiAnalysis,
      analyzeAndUpload,
    ],
  );

  const handleFileUpload = async (file: File) => {
    if (isReadOnly) {
      toast.warning(
        isPreviewMode
          ? t("studentActivityPage.warnings.previewNoUpload")
          : t("studentActivityPage.warnings.readonlyNoUpload"),
      );
      return;
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t("studentActivity.toast.fileTooLarge"), {
        description: t("studentActivity.toast.fileSizeLimit"),
      });
      return;
    }

    const ALLOWED_TYPES = [
      "audio/mpeg",
      "audio/mp3",
      "audio/mp4",
      "audio/x-m4a",
      "audio/m4a",
      "video/mp4",
      "audio/webm",
      "audio/wav",
      "audio/wave",
      "audio/x-wav",
      "audio/ogg",
      "audio/aac",
    ];
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error(t("studentActivity.toast.unsupportedFormat"), {
        description: t("studentActivity.toast.supportedFormats"),
      });
      return;
    }

    try {
      const audio = new Audio();
      const tempUrl = URL.createObjectURL(file);

      const duration = await new Promise<number>((resolve, reject) => {
        audio.addEventListener("loadedmetadata", () => {
          const dur = audio.duration;
          if (isNaN(dur) || dur === Infinity) {
            reject(new Error("無法讀取音檔長度"));
          } else {
            resolve(dur);
          }
        });
        audio.addEventListener("error", () =>
          reject(new Error("音檔格式錯誤")),
        );
        audio.src = tempUrl;
      });

      URL.revokeObjectURL(tempUrl);

      if (duration < 1) {
        toast.error(t("studentActivity.toast.recordingTooShort"), {
          description: t("studentActivity.toast.minDuration", { duration: 1 }),
        });
        return;
      }

      if (duration > 45) {
        toast.error(t("studentActivity.toast.recordingTooLong"), {
          description: t("studentActivity.toast.maxDuration", { duration: 45 }),
        });
        return;
      }

      const audioBlob = new Blob([file], { type: file.type });
      const audioUrl = URL.createObjectURL(audioBlob);
      const currentActivity = activities[currentActivityIndex];

      // 🎯 先設置本地 blob URL 讓用戶可以預覽
      setAnswers((prev) => {
        const newAnswers = new Map(prev);
        const answer = newAnswers.get(currentActivity.id) || {
          progressId: currentActivity.id,
          status: "not_started",
          startTime: new Date(),
          recordings: [],
          answers: [],
        };

        if (currentActivity.items && currentActivity.items.length > 0) {
          // Will update activities state
        } else {
          (answer as Answer).audioBlob = audioBlob;
          (answer as Answer).audioUrl = audioUrl;
        }

        answer.status = "in_progress";
        (answer as Answer).endTime = new Date();

        newAnswers.set(currentActivity.id, answer);
        return newAnswers;
      });

      if (currentActivity.items && currentActivity.items.length > 0) {
        setActivities((prevActivities) => {
          const newActivities = [...prevActivities];
          const activityIndex = newActivities.findIndex(
            (a) => a.id === currentActivity.id,
          );
          if (activityIndex !== -1 && newActivities[activityIndex].items) {
            const newItems = [...newActivities[activityIndex].items!];
            if (newItems[currentSubQuestionIndex]) {
              newItems[currentSubQuestionIndex] = {
                ...newItems[currentSubQuestionIndex],
                recording_url: audioUrl,
              };
            }
            newActivities[activityIndex] = {
              ...newActivities[activityIndex],
              items: newItems,
            };
          }
          return newActivities;
        });
      }

      toast.success(t("studentActivity.toast.uploadSuccess"), {
        description: `${file.name}（${Math.round(duration)} 秒）`,
      });

      // 🎯 立即上傳到 GCS (與錄音完成後的上傳邏輯相同)
      if (
        !isPreviewMode &&
        currentActivity.items &&
        currentActivity.items.length > 0
      ) {
        const contentItemId =
          currentActivity.items[currentSubQuestionIndex]?.id;

        if (contentItemId) {
          toast.info(t("studentActivityPage.recording.uploading"), {
            duration: 3000,
          });

          const formData = new FormData();
          formData.append("assignment_id", assignmentId!.toString());
          formData.append("content_item_id", contentItemId.toString());
          const uploadFileExtension = file.type.includes("mp4")
            ? "recording.mp4"
            : file.type.includes("webm")
              ? "recording.webm"
              : file.type.includes("wav")
                ? "recording.wav"
                : file.type.includes("m4a")
                  ? "recording.m4a"
                  : "recording.audio";
          formData.append("audio_file", audioBlob, uploadFileExtension);

          const apiUrl = import.meta.env.VITE_API_URL || "";
          const authToken = useStudentAuthStore.getState().token;

          retryAudioUpload(
            async () => {
              const uploadResponse = await fetch(
                `${apiUrl}/api/students/upload-recording`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${authToken}`,
                  },
                  body: formData,
                },
              );

              if (!uploadResponse.ok) {
                throw new Error(`Upload failed: ${uploadResponse.status}`);
              }

              return await uploadResponse.json();
            },
            () => {},
          )
            .then((uploadResult) => {
              toast.success(t("studentActivityPage.recording.uploadSuccess"));

              // 更新為 GCS URL
              setActivities((prevActivities) => {
                const newActivities = [...prevActivities];
                const activityIndex = newActivities.findIndex(
                  (a) => a.id === currentActivity.id,
                );
                if (
                  activityIndex !== -1 &&
                  newActivities[activityIndex].items
                ) {
                  const newItems = [...newActivities[activityIndex].items!];
                  if (newItems[currentSubQuestionIndex]) {
                    newItems[currentSubQuestionIndex] = {
                      ...newItems[currentSubQuestionIndex],
                      recording_url: uploadResult.audio_url,
                    };
                  }
                  newActivities[activityIndex] = {
                    ...newActivities[activityIndex],
                    items: newItems,
                  };
                }
                return newActivities;
              });

              // 更新 progressIds
              setAnswers((prev) => {
                const newAnswers = new Map(prev);
                const answer = newAnswers.get(currentActivity.id);
                if (answer) {
                  if (!answer.progressIds) answer.progressIds = [];
                  while (answer.progressIds.length <= currentSubQuestionIndex) {
                    answer.progressIds.push(0);
                  }
                  answer.progressIds[currentSubQuestionIndex] =
                    uploadResult.progress_id;
                  answer.status = "completed";
                }
                newAnswers.set(currentActivity.id, answer!);
                return newAnswers;
              });
            })
            .catch((error) => {
              console.error("❌ 上傳失敗:", error);
              toast.error("上傳錄音失敗", {
                description: "請檢查網路連接後重試",
              });

              // 🎯 上傳失敗時，清除 blob URL，回到初始狀態
              setActivities((prevActivities) => {
                const newActivities = [...prevActivities];
                const activityIndex = newActivities.findIndex(
                  (a) => a.id === currentActivity.id,
                );
                if (
                  activityIndex !== -1 &&
                  newActivities[activityIndex].items
                ) {
                  const newItems = [...newActivities[activityIndex].items!];
                  if (newItems[currentSubQuestionIndex]) {
                    newItems[currentSubQuestionIndex] = {
                      ...newItems[currentSubQuestionIndex],
                      recording_url: "",
                    };
                  }
                  newActivities[activityIndex] = {
                    ...newActivities[activityIndex],
                    items: newItems,
                  };
                }
                return newActivities;
              });
            });
        }
      }
    } catch (error) {
      console.error("❌ File upload failed:", error);
      toast.error(t("studentActivity.toast.validationFailed"), {
        description: error instanceof Error ? error.message : "未知錯誤",
      });
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // 🎯 生成項目唯一 key (activityId-itemIndex)
  const getItemKey = (activityId: number, itemIndex: number) =>
    `${activityId}-${itemIndex}`;

  // 🎯 Issue #75: 背景分析函數已停用 - 改用手動分析
  // @ts-expect-error - Function disabled for Issue #75 manual analysis workflow
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const analyzeInBackground = useCallback(
    async (activityId: number, itemIndex: number) => {
      const itemKey = getItemKey(activityId, itemIndex);
      const activity = activities.find((a) => a.id === activityId);
      if (!activity || !activity.items || !activity.items[itemIndex]) {
        console.error("Activity or item not found for background analysis");
        return;
      }

      const item = activity.items[itemIndex];
      const audioUrl = item.recording_url;
      const referenceText = item.text;
      const contentItemId = item.id;

      if (!audioUrl || !referenceText || !contentItemId) {
        console.warn("Missing data for background analysis:", {
          audioUrl,
          referenceText,
          contentItemId,
        });
        return;
      }

      // 檢查是否已經在分析中或已完成
      const currentState = itemAnalysisStates.get(itemKey);
      if (
        currentState?.status === "analyzing" ||
        currentState?.status === "analyzed"
      ) {
        return;
      }

      // 更新狀態為 analyzing
      setItemAnalysisStates((prev) => {
        const next = new Map(prev);
        next.set(itemKey, { status: "analyzing", retryCount: 0 });
        return next;
      });

      const token = useStudentAuthStore.getState().token;
      const apiUrl = import.meta.env.VITE_API_URL || "";

      const analysisPromise = (async () => {
        try {
          let gcsAudioUrl = audioUrl as string;
          const answer = answers.get(activityId);
          let currentProgressId =
            answer?.progressIds && answer.progressIds[itemIndex]
              ? answer.progressIds[itemIndex]
              : item.progress_id || null;

          // 🔍 上傳音檔（如果是 blob URL）
          if (typeof audioUrl === "string" && audioUrl.startsWith("blob:")) {
            const response = await fetch(audioUrl);
            const audioBlob = await response.blob();

            const formData = new FormData();
            formData.append("assignment_id", assignmentId!.toString());
            formData.append("content_item_id", contentItemId.toString());
            const uploadFileExtension = audioBlob.type.includes("mp4")
              ? "recording.mp4"
              : audioBlob.type.includes("webm")
                ? "recording.webm"
                : "recording.audio";
            formData.append("audio_file", audioBlob, uploadFileExtension);

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
                    `Upload failed: ${uploadResponse.status}`,
                  );
                  throw error;
                }

                return await uploadResponse.json();
              },
              () => {},
            );

            if (uploadResult) {
              gcsAudioUrl = uploadResult.audio_url;
              currentProgressId = uploadResult.progress_id;
            }
          }

          if (!currentProgressId) {
            throw new Error("No progress_id available for analysis");
          }

          // 🚀 使用 Azure Speech Service 直接分析（快速！）
          const audioResponse = await fetch(gcsAudioUrl);
          const audioBlob = await audioResponse.blob();

          const azureResult = await analyzePronunciation(
            audioBlob,
            referenceText!,
          );

          if (!azureResult) {
            throw new Error("Azure analysis failed");
          }

          // Convert Azure result format to our existing format
          const analysisResult = {
            pronunciation_score: azureResult.pronunciationScore,
            accuracy_score: azureResult.accuracyScore,
            fluency_score: azureResult.fluencyScore,
            completeness_score: azureResult.completenessScore,
            words: azureResult.words?.map((w) => ({
              word: w.word,
              accuracy_score: w.accuracyScore,
              error_type: w.errorType,
            })),
          };

          // 更新 activity 的 ai_scores
          setActivities((prevActivities) => {
            const newActivities = [...prevActivities];
            const activityIndex = newActivities.findIndex(
              (a) => a.id === activityId,
            );
            if (activityIndex !== -1) {
              const updatedActivity = { ...newActivities[activityIndex] };
              if (!updatedActivity.ai_scores) {
                updatedActivity.ai_scores = { items: {} };
              }
              if (!updatedActivity.ai_scores.items) {
                updatedActivity.ai_scores.items = {};
              }
              updatedActivity.ai_scores.items[itemIndex] = analysisResult;

              // Also update item's ai_assessment
              if (updatedActivity.items && updatedActivity.items[itemIndex]) {
                const newItems = [...updatedActivity.items];
                newItems[itemIndex] = {
                  ...newItems[itemIndex],
                  ai_assessment: analysisResult,
                };
                updatedActivity.items = newItems;
              }

              newActivities[activityIndex] = updatedActivity;
            }
            return newActivities;
          });

          // 更新狀態為 analyzed
          setItemAnalysisStates((prev) => {
            const next = new Map(prev);
            next.set(itemKey, { status: "analyzed" });
            return next;
          });

          pendingAnalysisRef.current.delete(itemKey);
          failedItemsRef.current.delete(itemKey);
          setPendingAnalysisCount(pendingAnalysisRef.current.size); // 🔒 更新計數
        } catch (error) {
          console.error(`❌ Background analysis failed for ${itemKey}:`, error);

          // 更新狀態為 failed
          setItemAnalysisStates((prev) => {
            const next = new Map(prev);
            const current = next.get(itemKey) || {
              status: "failed" as const,
              retryCount: 0,
            };
            next.set(itemKey, {
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
              retryCount: (current.retryCount || 0) + 1,
            });
            return next;
          });

          failedItemsRef.current.add(itemKey);
          pendingAnalysisRef.current.delete(itemKey);
          setPendingAnalysisCount(pendingAnalysisRef.current.size); // 🔒 更新計數
        }
      })();

      pendingAnalysisRef.current.set(itemKey, analysisPromise);
      setPendingAnalysisCount(pendingAnalysisRef.current.size); // 🔒 更新計數
    },
    [activities, answers, assignmentId, itemAnalysisStates],
  );

  // 🎯 Issue #75: checkAndTriggerBackgroundAnalysis 已移除 - 不再自動分析

  const handleNextActivity = async () => {
    const currentActivity = activities[currentActivityIndex];

    // 🎯 Issue #227: 有 AI 分析額度時，按下一題自動背景分析當前題目（blob + GCS URL）
    if (canUseAiAnalysis && !isPreviewMode && currentActivity.items) {
      const currentItem = currentActivity.items[currentSubQuestionIndex];
      const hasRecording =
        currentItem?.recording_url && currentItem.recording_url !== "";
      if (hasRecording && !currentItem?.ai_assessment) {
        // fire-and-forget：背景分析不阻塞導航
        analyzeAndUpload(
          currentItem.recording_url!,
          currentItem.text || currentActivity.target_text || "",
          currentItem.progress_id,
          currentItem.id,
        ).catch((err) =>
          console.error("Background analysis on next failed:", err),
        );
      }
    }

    if (currentActivity.items && currentActivity.items.length > 0) {
      // 切換到下一題
      if (currentSubQuestionIndex < currentActivity.items.length - 1) {
        setCurrentSubQuestionIndex(currentSubQuestionIndex + 1);
        setRecordingTime(0);
        recordingTimeRef.current = 0;
        return;
      }
    }

    if (currentActivityIndex < activities.length - 1) {
      setCurrentActivityIndex(currentActivityIndex + 1);
      setCurrentSubQuestionIndex(0);
      setRecordingTime(0);
      recordingTimeRef.current = 0;
    }
  };

  const handlePreviousActivity = async () => {
    const currentActivity = activities[currentActivityIndex];

    // 🎯 Issue #75: 不再觸發背景分析 - 只切換問題
    if (currentActivity.items && currentActivity.items.length > 0) {
      if (currentSubQuestionIndex > 0) {
        setCurrentSubQuestionIndex(currentSubQuestionIndex - 1);
        setRecordingTime(0);
        recordingTimeRef.current = 0;
        return;
      }
    }

    if (currentActivityIndex > 0) {
      const prevActivityIndex = currentActivityIndex - 1;
      const prevActivity = activities[prevActivityIndex];
      setCurrentActivityIndex(prevActivityIndex);

      if (prevActivity.items && prevActivity.items.length > 0) {
        setCurrentSubQuestionIndex(prevActivity.items.length - 1);
      } else {
        setCurrentSubQuestionIndex(0);
      }
      setRecordingTime(0);
      recordingTimeRef.current = 0;
    }
  };

  const handleActivitySelect = async (
    index: number,
    subQuestionIndex: number = 0,
  ) => {
    // 🎯 Issue #75: 不再觸發背景分析 - 只切換問題
    setCurrentActivityIndex(index);
    setCurrentSubQuestionIndex(subQuestionIndex);
    setRecordingTime(0);
    recordingTimeRef.current = 0;
  };

  /**
   * Issue #141: 處理題號按鈕跳題
   * 如果當前題目有錄音但未分析，自動觸發分析後再跳轉
   */
  const handleQuestionJump = async (
    targetActivityIndex: number,
    targetItemIndex: number,
  ) => {
    const currentActivity = activities[currentActivityIndex];

    // 檢查是否為例句朗讀模式（items 有值且非重組模式）
    const isReadingMode =
      isExampleSentencesType(currentActivity.type) &&
      practiceMode !== "rearrangement" &&
      currentActivity.items &&
      currentActivity.items.length > 0;

    // 只有例句朗讀模式才需要自動分析
    if (!isReadingMode) {
      // 其他模式直接跳轉
      if (targetActivityIndex !== currentActivityIndex) {
        handleActivitySelect(targetActivityIndex, targetItemIndex);
      } else {
        setCurrentSubQuestionIndex(targetItemIndex);
      }
      return;
    }

    // 🎯 Issue #227: 只有在有 AI 分析額度時才自動分析
    if (canUseAiAnalysis) {
      // 檢查當前題目是否有錄音但未分析
      const currentItem = currentActivity.items![currentSubQuestionIndex];
      const hasRecording =
        currentItem.recording_url && currentItem.recording_url !== "";
      const hasAssessment = !!currentItem?.ai_assessment;

      // 如果有錄音但沒有分析結果，自動背景分析（fire-and-forget）
      if (hasRecording && !hasAssessment) {
        const targetText = currentItem.text || "";
        const progressId = currentItem.progress_id;
        const contentItemId = currentItem.id;

        if (targetText) {
          analyzeAndUpload(
            currentItem.recording_url!,
            targetText,
            progressId,
            contentItemId,
          )
            .then((analysisResult) => {
              if (analysisResult) {
                setActivities((prevActivities) => {
                  const newActivities = [...prevActivities];
                  const activityIndex = newActivities.findIndex(
                    (a) => a.id === currentActivity.id,
                  );
                  if (
                    activityIndex !== -1 &&
                    newActivities[activityIndex].items
                  ) {
                    const newItems = [...newActivities[activityIndex].items!];
                    if (newItems[currentSubQuestionIndex]) {
                      newItems[currentSubQuestionIndex] = {
                        ...newItems[currentSubQuestionIndex],
                        ai_assessment: analysisResult,
                      };
                    }
                    newActivities[activityIndex] = {
                      ...newActivities[activityIndex],
                      items: newItems,
                    };
                  }
                  return newActivities;
                });
              }
            })
            .catch((err) =>
              console.error("Background analysis on jump failed:", err),
            );
        }
      }
    }

    // 執行跳轉
    if (targetActivityIndex !== currentActivityIndex) {
      handleActivitySelect(targetActivityIndex, targetItemIndex);
    } else {
      setCurrentSubQuestionIndex(targetItemIndex);
    }
  };

  /**
   * Issue #75: 提交邏輯說明
   *
   * 當學生點擊「提交」時：
   * 1. 只檢查所有題目是否有錄音檔案
   * 2. 直接上傳所有錄音檔案並標記作業為已提交
   * 3. 不等待 AI 分析完成，也不觸發分析
   * 4. 背景分析可以繼續執行（不影響提交）
   */
  const handleSubmit = async (e?: React.MouseEvent, force = false) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (isPreviewMode) {
      toast.info(t("studentActivityPage.preview.cannotSubmit"));
      return;
    }

    // 🎯 收集所有未錄音的題目（警告） - 只在未強制提交時檢查
    if (!force) {
      const notRecorded: {
        activity: Activity;
        itemIndex?: number;
        itemLabel: string;
      }[] = [];

      activities.forEach((activity) => {
        // 檢查是否是需要錄音的題型
        const needsRecording = [
          "reading_assessment",
          "grouped_questions",
          "speaking",
        ].includes(activity.type);

        if (needsRecording && activity.items && activity.items.length > 0) {
          // 逐題檢查
          activity.items.forEach((item, itemIndex) => {
            const hasRecording =
              item.recording_url && item.recording_url !== "";
            const isBlob =
              hasRecording && item.recording_url!.startsWith("blob:");
            const itemLabel = `${activity.title} - ${t("studentActivityPage.validation.itemNumber", { number: itemIndex + 1 })}`;

            if (!hasRecording || isBlob) {
              const warning = isBlob
                ? `${itemLabel}${t("studentActivityPage.validation.notUploaded")}`
                : `${itemLabel}${t("studentActivityPage.validation.notRecorded")}`;

              notRecorded.push({
                activity,
                itemIndex,
                itemLabel: warning,
              });
            }
          });
        } else if (needsRecording && !activity.items) {
          // 單一錄音題目（如 reading_assessment）
          const hasRecording = activity.audio_url && activity.audio_url !== "";
          const isBlob =
            hasRecording && activity.audio_url!.startsWith("blob:");

          if (!hasRecording || isBlob) {
            const warning = isBlob
              ? `${activity.title}${t("studentActivityPage.validation.notUploaded")}`
              : activity.title;

            notRecorded.push({
              activity,
              itemLabel: warning,
            });
          }
        }
      });

      // 🎯 如果有未錄音的題目，顯示警告 dialog
      if (notRecorded.length > 0) {
        // itemLabel already contains the complete warning message
        const incompleteList = notRecorded.map((item) => item.itemLabel);
        setIncompleteItems(incompleteList);
        setShowSubmitDialog(true);
        return;
      }
    }

    // 🎯 Issue #227: 提交前確保所有錄音都上傳到 GCS（安全網）
    if (!isPreviewMode) {
      const pendingBlobItems: {
        activity: Activity;
        itemIndex: number;
        item: Activity["items"] extends (infer T)[] | undefined ? T : never;
      }[] = [];

      activities.forEach((activity) => {
        if (activity.items) {
          activity.items.forEach((item, itemIndex) => {
            if (item.recording_url?.startsWith("blob:")) {
              pendingBlobItems.push({ activity, itemIndex, item });
            }
          });
        }
      });

      if (pendingBlobItems.length > 0) {
        setSubmitting(true);
        const apiUrl = import.meta.env.VITE_API_URL || "";
        const authToken = useStudentAuthStore.getState().token;

        for (const { activity, itemIndex, item } of pendingBlobItems) {
          try {
            const contentItemId = item.id;
            if (!contentItemId || !item.recording_url) continue;

            const resp = await fetch(item.recording_url);
            const audioBlob = await resp.blob();

            const ext = audioBlob.type.includes("mp4")
              ? "recording.mp4"
              : audioBlob.type.includes("webm")
                ? "recording.webm"
                : "recording.audio";

            const formData = new FormData();
            formData.append("assignment_id", assignmentId!.toString());
            formData.append("content_item_id", contentItemId.toString());
            formData.append("audio_file", audioBlob, ext);

            const uploadResult = await retryAudioUpload(
              async () => {
                const uploadResp = await fetch(
                  `${apiUrl}/api/students/upload-recording`,
                  {
                    method: "POST",
                    headers: { Authorization: `Bearer ${authToken}` },
                    body: formData,
                  },
                );
                if (!uploadResp.ok)
                  throw new Error(`Upload failed: ${uploadResp.status}`);
                return await uploadResp.json();
              },
              () => {},
            );

            // 更新 recording_url 為 GCS URL
            setActivities((prev) => {
              const newActivities = [...prev];
              const actIdx = newActivities.findIndex(
                (a) => a.id === activity.id,
              );
              if (actIdx !== -1 && newActivities[actIdx].items) {
                const newItems = [...newActivities[actIdx].items!];
                if (newItems[itemIndex]) {
                  newItems[itemIndex] = {
                    ...newItems[itemIndex],
                    recording_url: uploadResult.audio_url,
                    progress_id: uploadResult.progress_id,
                  };
                }
                newActivities[actIdx] = {
                  ...newActivities[actIdx],
                  items: newItems,
                };
              }
              return newActivities;
            });
          } catch (error) {
            console.error(
              `Failed to upload blob for item ${itemIndex + 1}:`,
              error,
            );
          }
        }
        setSubmitting(false);
      }
    }

    // 🎯 Issue #227: 提交前補分析所有有錄音但未分析的題目（blob + GCS URL）
    if (!isPreviewMode && canUseAiAnalysis) {
      const unanalyzedItems: {
        activity: Activity;
        itemIndex: number;
        item: Activity["items"] extends (infer T)[] | undefined ? T : never;
      }[] = [];

      // 收集所有有錄音但未分析的題目（不限 blob URL）
      activities.forEach((activity) => {
        if (
          isExampleSentencesType(activity.type) &&
          practiceMode !== "rearrangement" &&
          activity.items
        ) {
          activity.items.forEach((item, itemIndex) => {
            const hasRecording =
              item.recording_url && item.recording_url !== "";
            const hasAssessment = !!item?.ai_assessment;

            if (hasRecording && !hasAssessment) {
              unanalyzedItems.push({ activity, itemIndex, item });
            }
          });
        }
      });

      // 逐一分析未分析的錄音
      if (unanalyzedItems.length > 0) {
        setSubmitting(true);

        for (const { activity, itemIndex, item } of unanalyzedItems) {
          try {
            const targetText = item.text || "";
            const progressId = item.progress_id;
            const contentItemId = item.id;

            if (targetText && item.recording_url) {
              const result = await analyzeAndUpload(
                item.recording_url,
                targetText,
                progressId,
                contentItemId,
              );

              if (result) {
                // 更新 activities state
                setActivities((prevActivities) => {
                  const newActivities = [...prevActivities];
                  const activityIndex = newActivities.findIndex(
                    (a) => a.id === activity.id,
                  );
                  if (
                    activityIndex !== -1 &&
                    newActivities[activityIndex].items
                  ) {
                    const newItems = [...newActivities[activityIndex].items!];
                    if (newItems[itemIndex]) {
                      newItems[itemIndex] = {
                        ...newItems[itemIndex],
                        ai_assessment: result,
                      };
                    }
                    newActivities[activityIndex] = {
                      ...newActivities[activityIndex],
                      items: newItems,
                    };
                  }
                  return newActivities;
                });
              }
            }
          } catch (error) {
            console.error(
              `Failed to analyze item ${itemIndex + 1} of activity ${activity.id}:`,
              error,
            );
            // 繼續分析其他題目，不中斷提交流程
          }
        }

        setSubmitting(false);
      }
    }

    // 🎯 立即提交（只上傳音檔，不執行分析）
    if (onSubmit) {
      try {
        setSubmitting(true);

        // 🎯 Issue #118: Retry any pending uploads before submitting
        const pendingCount = azureSpeechService.getPendingUploadCount();
        if (pendingCount > 0) {
          await azureSpeechService.retryPendingUploads();
        }

        await onSubmit({
          answers: [], // Will be filled by parent component
        });
        setSubmitting(false);

        toast.success(
          t("studentActivityPage.messages.submitSuccess") || "提交成功！",
        );
      } catch (error) {
        setSubmitting(false);
        console.error("Submission error:", error);
        const errorMessage =
          error instanceof Error ? error.message : "提交失敗";
        toast.error(
          t("studentActivityPage.messages.submitError") || errorMessage,
        );
      }
    }
  };

  const handleConfirmSubmit = async () => {
    setShowSubmitDialog(false);
    // 用戶確認提交，強制提交跳過驗證（已經在 dialog 確認過了）
    await handleSubmit(undefined, true);
  };

  const getStatusIcon = (activity: Activity, answer?: Answer) => {
    const status = answer?.status || "not_started";

    if (status === "completed" || activity.status === "SUBMITTED") {
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    } else if (status === "in_progress" || activity.status === "IN_PROGRESS") {
      return <Clock className="h-4 w-4 text-yellow-500" />;
    } else {
      return <Circle className="h-4 w-4" />;
    }
  };

  const getActivityTypeBadge = (type: string) => {
    // 使用 helper functions 處理例句集和單字集類型
    if (isExampleSentencesType(type)) {
      return (
        <Badge variant="outline">
          {practiceMode === "rearrangement"
            ? t("studentActivityPage.activityTypes.rearrangement")
            : t("studentActivityPage.activityTypes.reading")}
        </Badge>
      );
    }

    if (isVocabularySetType(type)) {
      return (
        <Badge variant="outline">
          {t("studentActivityPage.activityTypes.vocabulary")}
        </Badge>
      );
    }

    switch (type) {
      case "listening_cloze":
        return (
          <Badge variant="outline">
            {t("studentActivityPage.activityTypes.listening")}
          </Badge>
        );
      case "speaking_practice":
        return (
          <Badge variant="outline">
            {t("studentActivityPage.activityTypes.speaking")}
          </Badge>
        );
      case "speaking_scenario":
        return (
          <Badge variant="outline">
            {t("studentActivityPage.activityTypes.speaking")}
          </Badge>
        );
      case "speaking_quiz":
        return (
          <Badge variant="outline">
            {t("studentActivityPage.activityTypes.speaking")}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            {t("studentActivityPage.activityTypes.reading")}
          </Badge>
        );
    }
  };

  const handleUpdateItemRecording = useCallback(
    (activityId: number, index: number, url: string) => {
      setActivities((prevActivities) => {
        const newActivities = [...prevActivities];
        const activityIndex = newActivities.findIndex(
          (a) => a.id === activityId,
        );
        if (activityIndex !== -1 && newActivities[activityIndex].items) {
          const newItems = [...newActivities[activityIndex].items!];
          if (newItems[index]) {
            newItems[index] = {
              ...newItems[index],
              recording_url: url,
            };
          }
          newActivities[activityIndex] = {
            ...newActivities[activityIndex],
            items: newItems,
          };
        }
        return newActivities;
      });
    },
    [],
  );

  const renderActivityContent = (activity: Activity) => {
    const answer = answers.get(activity.id);

    // 單字集類型使用新的 SentenceMakingActivity 組件，不要進入舊的 GroupedQuestionsTemplate
    // 例句集 + rearrangement 模式使用 RearrangementActivity，也不要進入 GroupedQuestionsTemplate
    const isRearrangementMode =
      isExampleSentencesType(activity.type) && practiceMode === "rearrangement";

    if (
      activity.items &&
      activity.items.length > 0 &&
      !isVocabularySetType(activity.type) &&
      !isRearrangementMode
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const aiAssessments: Record<number, any> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activity.items.forEach((item: any, index: number) => {
        if (item.ai_assessment) {
          aiAssessments[index] = {
            accuracy_score: item.ai_assessment.accuracy_score,
            fluency_score: item.ai_assessment.fluency_score,
            pronunciation_score: item.ai_assessment.pronunciation_score,
            completeness_score: item.ai_assessment.completeness_score || 0,
            prosody_score: item.ai_assessment.prosody_score,
            word_details: item.ai_assessment.word_details || [],
            detailed_words: item.ai_assessment.detailed_words || [],
            reference_text: item.ai_assessment.reference_text || "",
            recognized_text: item.ai_assessment.recognized_text || "",
            analysis_summary: item.ai_assessment.analysis_summary || {},
          };
        }
      });

      const assessmentResults =
        Object.keys(aiAssessments).length > 0
          ? { items: aiAssessments }
          : activity.ai_scores;

      return (
        <GroupedQuestionsTemplate
          items={activity.items}
          currentQuestionIndex={currentSubQuestionIndex}
          isRecording={isRecording}
          recordingTime={recordingTime}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
          onUpdateItemRecording={(index, url) =>
            handleUpdateItemRecording(activity.id, index, url)
          }
          onFileUpload={handleFileUpload}
          formatTime={formatTime}
          timeLimit={activity.duration || 30}
          progressIds={
            // 🔧 Issue #118 Fix: Always use activity.items as base, merge in updated progressIds
            // Previous bug: answer?.progressIds || ... would use incomplete array [101] after first upload
            // causing items 1-4 to have undefined progressId
            activity.items?.map(
              (item, index) =>
                answer?.progressIds?.[index] ?? item.progress_id ?? 0,
            ) || []
          }
          initialAssessmentResults={assessmentResults}
          readOnly={isReadOnly}
          assignmentId={assignmentId.toString()}
          isPreviewMode={isPreviewMode}
          isDemoMode={isDemoMode}
          authToken={authToken}
          itemAnalysisState={itemAnalysisStates.get(
            getItemKey(activity.id, currentSubQuestionIndex),
          )}
          onUploadSuccess={(index, gcsUrl, progressId) => {
            setActivities((prevActivities) => {
              const newActivities = [...prevActivities];
              const activityIndex = newActivities.findIndex(
                (a) => a.id === activity.id,
              );
              if (activityIndex !== -1 && newActivities[activityIndex].items) {
                const newItems = [...newActivities[activityIndex].items!];
                if (newItems[index]) {
                  newItems[index] = {
                    ...newItems[index],
                    recording_url: gcsUrl,
                  };
                }
                newActivities[activityIndex] = {
                  ...newActivities[activityIndex],
                  items: newItems,
                };
              }
              return newActivities;
            });

            setAnswers((prev) => {
              const newAnswers = new Map(prev);
              const answer = newAnswers.get(activity.id);
              if (answer) {
                if (!answer.progressIds) answer.progressIds = [];
                while (answer.progressIds.length <= index) {
                  answer.progressIds.push(0);
                }
                answer.progressIds[index] = progressId;
                answer.status = "completed";
              }
              newAnswers.set(activity.id, answer!);
              return newAnswers;
            });
          }}
          onAssessmentComplete={(index, assessmentResult) => {
            setActivities((prevActivities) => {
              const newActivities = [...prevActivities];
              const activityIndex = newActivities.findIndex(
                (a) => a.id === activity.id,
              );
              // 修正：無論 assessmentResult 是新結果或 null（清除），都要更新 ai_assessment
              // Issue #82: 刪除錄音時需要同步清除前端的分析結果
              if (activityIndex !== -1 && newActivities[activityIndex].items) {
                const newItems = [...newActivities[activityIndex].items!];
                if (newItems[index]) {
                  newItems[index] = {
                    ...newItems[index],
                    ai_assessment: assessmentResult ?? undefined, // 可以是新結果或 undefined（清除）
                  };
                }
                newActivities[activityIndex] = {
                  ...newActivities[activityIndex],
                  items: newItems,
                };
              }
              return newActivities;
            });
          }}
          onAnalyzingStateChange={setIsAnalyzing} // 🔒 接收分析狀態變化
          canUseAiAnalysis={canUseAiAnalysis}
        />
      );
    }

    // 使用 helper functions 來處理類型判斷，避免 switch 遺漏新類型
    // 例句集類型（包含 READING_ASSESSMENT 和 EXAMPLE_SENTENCES）
    if (isExampleSentencesType(activity.type)) {
      // 例句集：根據 practiceMode 決定使用哪種練習模式
      if (practiceMode === "rearrangement") {
        // 例句重組模式
        return (
          <RearrangementActivity
            studentAssignmentId={assignmentId}
            isPreviewMode={isPreviewMode}
            isDemoMode={isDemoMode}
            showAnswer={showAnswer}
            currentQuestionIndex={rearrangementQuestionIndex}
            onQuestionIndexChange={setRearrangementQuestionIndex}
            onQuestionsLoaded={(questions, states) => {
              setRearrangementQuestions(questions);
              setRearrangementQuestionStates(states);
            }}
            onQuestionStateChange={setRearrangementQuestionStates}
            onComplete={async (totalScore, totalQuestions) => {
              if (onSubmit) {
                try {
                  await onSubmit({ answers: [] });
                  toast.success(
                    t("rearrangement.messages.allComplete", {
                      score: totalScore,
                      total: totalQuestions * 100,
                    }),
                  );
                } catch (error) {
                  console.error("Submission failed:", error);
                }
              } else {
                toast.success(
                  t("rearrangement.messages.allComplete", {
                    score: totalScore,
                    total: totalQuestions * 100,
                  }),
                );
              }
            }}
          />
        );
      } else {
        // 預設朗讀模式
        return (
          <ReadingAssessmentTemplate
            content={activity.content}
            targetText={activity.target_text}
            existingAudioUrl={answer?.audioUrl}
            onRecordingComplete={handleRecordingComplete}
            exampleAudioUrl={activity.example_audio_url}
            progressId={activity.id}
            readOnly={isReadOnly}
            isDemoMode={isDemoMode}
            timeLimit={activity.duration || 60}
            canUseAiAnalysis={canUseAiAnalysis}
            onSkip={
              currentActivityIndex < activities.length - 1
                ? () => handleActivitySelect(currentActivityIndex + 1)
                : undefined
            }
          />
        );
      }
    }

    // 單字集類型（包含 SENTENCE_MAKING 和 VOCABULARY_SET）
    if (isVocabularySetType(activity.type)) {
      // Check practice mode for vocabulary set
      if (practiceMode === "word_reading") {
        // Phase 2-2: 單字朗讀練習
        return (
          <WordReadingActivity
            assignmentId={assignmentId}
            isPreviewMode={isPreviewMode}
            isDemoMode={isDemoMode}
            authToken={authToken}
            canUseAiAnalysis={canUseAiAnalysis}
            onComplete={async () => {
              if (onSubmit) {
                try {
                  await onSubmit({ answers: [] });
                  toast.success(
                    t("wordReading.toast.completed") || "作業已完成！",
                  );
                } catch (error) {
                  console.error("Submission failed:", error);
                }
              } else {
                toast.success(
                  t("wordReading.toast.completed") || "作業已完成！",
                );
              }
            }}
          />
        );
      }

      if (practiceMode === "word_selection") {
        // Phase 2-3: 單字選擇練習
        // 🔥 注意：不呼叫 onSubmit，因為後端在每次作答時已自動同步狀態到 GRADED
        // 呼叫 onSubmit 會觸發 /submit API，把狀態覆蓋成 SUBMITTED
        return (
          <WordSelectionActivity
            assignmentId={assignmentId}
            isPreviewMode={isPreviewMode}
            isDemoMode={isDemoMode}
            onComplete={() => {
              toast.success(
                t("wordSelection.toast.completed") || "作業已完成！",
              );
              // 導航回作業列表
              window.location.href = "/student/assignments";
            }}
          />
        );
      }

      // 造句練習：使用艾賓浩斯記憶曲線系統
      return (
        <SentenceMakingActivity
          assignmentId={assignmentId}
          onComplete={() => {
            toast.success("作業已完成！");
          }}
        />
      );
    }

    // 其他類型使用 switch 處理
    switch (activity.type) {
      case "listening_cloze":
        return (
          <ListeningClozeTemplate
            content={activity.content}
            audioUrl={activity.audio_url || ""}
            blanks={activity.blanks || []}
            userAnswers={answer?.userAnswers || []}
            onAnswerChange={(index, value) => {
              if (isReadOnly) return;

              setAnswers((prev) => {
                const newAnswers = new Map(prev);
                const ans = newAnswers.get(activity.id) || {
                  progressId: activity.id,
                  status: "not_started",
                  startTime: new Date(),
                  userAnswers: [],
                };
                if (!ans.userAnswers) ans.userAnswers = [];
                ans.userAnswers[index] = value;
                ans.status = "in_progress";
                newAnswers.set(activity.id, ans);
                return newAnswers;
              });
            }}
            showAnswers={activity.status === "SUBMITTED"}
          />
        );

      case "speaking_practice":
      case "speaking_scenario":
        return (
          <div className="text-center p-8 text-gray-500">
            <p>此活動類型目前不可用</p>
          </div>
        );

      default:
        console.warn(
          "⚠️ [StudentActivityPageContent] Unknown activity.type, falling back to ReadingAssessmentTemplate",
        );
        console.warn(
          "⚠️ [StudentActivityPageContent] activity.type =",
          activity.type,
        );
        return (
          <ReadingAssessmentTemplate
            content={activity.content}
            targetText={activity.target_text || activity.content}
            existingAudioUrl={answer?.audioUrl}
            onRecordingComplete={handleRecordingComplete}
            progressId={activity.id}
            readOnly={isReadOnly}
            isDemoMode={isDemoMode}
            timeLimit={activity.duration || 60}
            onSkip={
              currentActivityIndex < activities.length - 1
                ? () => handleActivitySelect(currentActivityIndex + 1)
                : undefined
            }
          />
        );
    }
  };

  if (activities.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-gray-600 mb-4">此作業尚無題目</p>
          {onBack && <Button onClick={onBack}>返回作業詳情</Button>}
        </div>
      </div>
    );
  }

  const currentActivity = activities[currentActivityIndex];
  const progress = ((currentActivityIndex + 1) / activities.length) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Read-only mode banner */}
      {isReadOnly && !isPreviewMode && (
        <div className="bg-blue-50 border-b border-blue-200 px-2 sm:px-4 py-2">
          <div className="max-w-6xl mx-auto flex items-center gap-2">
            <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 flex-shrink-0" />
            <span className="text-xs sm:text-sm text-blue-700 truncate">
              {assignmentStatus === "SUBMITTED"
                ? "作業已提交，目前為檢視模式"
                : assignmentStatus === "GRADED"
                  ? "作業已評分，目前為檢視模式"
                  : "檢視模式"}
            </span>
          </div>
        </div>
      )}

      {/* Header with progress */}
      <div className="sticky top-0 bg-white border-b z-10">
        {/* 🎯 單字選擇預覽模式：使用 max-w-7xl px-4 對齊預覽頁的藍色提示條 */}
        <div
          className={
            practiceMode === "word_selection" && isPreviewMode
              ? "max-w-7xl mx-auto px-4 py-2"
              : "max-w-6xl mx-auto px-2 sm:px-4 py-2"
          }
        >
          {/* Mobile header layout */}
          <div className="flex flex-row items-center justify-between gap-2 mb-2">
            {/* 🎯 單字選擇預覽模式：只顯示標題（外層已有返回按鈕）；學生端保留返回按鈕 */}
            {practiceMode === "word_selection" && isPreviewMode ? (
              <h1 className="text-sm sm:text-base font-semibold truncate min-w-0">
                {assignmentTitle}
              </h1>
            ) : (
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                {onBack && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onBack}
                    className="flex-shrink-0 px-2 sm:px-3"
                  >
                    <ChevronLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                    <span className="hidden sm:inline">
                      {t("studentActivityPage.buttons.back")}
                    </span>
                    <span className="sm:hidden">
                      {t("studentActivityPage.buttons.backShort")}
                    </span>
                  </Button>
                )}
                {onBack && (
                  <div className="h-4 sm:h-6 w-px bg-gray-300 flex-shrink-0" />
                )}
                <h1 className="text-sm sm:text-base font-semibold truncate min-w-0">
                  {assignmentTitle}
                </h1>
              </div>
            )}

            <div className="flex items-center gap-2 sm:gap-3 justify-end flex-shrink-0">
              {saving && (
                <div className="flex items-center gap-1 sm:gap-2 text-xs text-gray-600">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="hidden sm:inline">
                    {t("studentActivityPage.status.saving")}
                  </span>
                  <span className="sm:hidden">
                    {t("studentActivityPage.status.savingShort")}
                  </span>
                </div>
              )}
              {/* Issue #110: 例句重組模式不在 header 顯示提交按鈕（避免誤觸）
                  單字選擇模式也不需要（自動根據熟悉度完成） */}
              {!isReadOnly &&
                !isPreviewMode &&
                practiceMode !== "rearrangement" &&
                practiceMode !== "word_selection" && (
                  <Button
                    onClick={handleSubmit}
                    disabled={submitting}
                    size="sm"
                    variant="default"
                    className="px-2 sm:px-3"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        <span className="hidden sm:inline">
                          {t("studentActivityPage.buttons.submitting")}
                        </span>
                        <span className="sm:hidden">
                          {t("studentActivityPage.buttons.submittingShort")}
                        </span>
                      </>
                    ) : (
                      <>
                        <Send className="h-3 w-3 mr-1" />
                        <span className="hidden sm:inline">
                          {t("studentActivityPage.buttons.submit")}
                        </span>
                        <span className="sm:hidden">
                          {t("studentActivityPage.buttons.submitShort")}
                        </span>
                      </>
                    )}
                  </Button>
                )}
            </div>
          </div>

          {/* Activity navigation - 單字選擇模式不顯示此區塊 */}
          {!isVocabularySetType(currentActivity?.type || "") && (
            <div className="flex gap-2 sm:gap-4 overflow-x-auto pb-2 scrollbar-hide">
              {/* 例句重組模式：所有題目合併顯示，不分 activity */}
              {practiceMode === "rearrangement" &&
              rearrangementQuestions.length > 0 ? (
                <div className="flex gap-0.5 sm:gap-1 flex-wrap">
                  {rearrangementQuestions.map((q, qIndex) => {
                    const state = rearrangementQuestionStates.get(
                      q.content_item_id,
                    );
                    const isActiveItem = rearrangementQuestionIndex === qIndex;
                    const isCompleted = state?.completed;
                    const isFailed = state?.challengeFailed;

                    return (
                      <button
                        key={q.content_item_id}
                        onClick={() => setRearrangementQuestionIndex(qIndex)}
                        className={cn(
                          "relative w-8 h-8 sm:w-8 sm:h-8 rounded border transition-all",
                          "flex items-center justify-center text-sm sm:text-xs font-medium",
                          "min-w-[32px] sm:min-w-[32px]",
                          isCompleted
                            ? "bg-green-100 text-green-800 border-green-400"
                            : isFailed
                              ? "bg-red-100 text-red-800 border-red-400"
                              : "bg-white text-gray-600 border-gray-300 hover:border-blue-400",
                          isActiveItem && "border-2 border-blue-600",
                        )}
                        title={
                          isCompleted
                            ? "已完成"
                            : isFailed
                              ? "挑戰失敗"
                              : "未完成"
                        }
                      >
                        {qIndex + 1}
                      </button>
                    );
                  })}
                </div>
              ) : (
                /* 其他模式：保持原來的 activities.map 邏輯 */
                activities.map((activity, activityIndex) => {
                  const answer = answers.get(activity.id);
                  const isActiveActivity =
                    activityIndex === currentActivityIndex;

                  // 🎯 Issue #147: 單字選擇模式不顯示題號指示器（練習是輪次制，與 items 不對應）
                  if (
                    activity.items &&
                    activity.items.length > 0 &&
                    !isVocabularySetType(activity.type)
                  ) {
                    return (
                      <div
                        key={activity.id}
                        className="flex items-center gap-1 sm:gap-2 flex-shrink-0"
                      >
                        <div className="flex items-center gap-1">
                          <span className="text-sm sm:text-xs font-medium text-gray-600 whitespace-nowrap max-w-[120px] sm:max-w-none truncate sm:truncate-none">
                            {activity.title}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-sm sm:text-xs px-1.5 sm:px-1 py-0 h-5 sm:h-5 min-w-[35px] sm:min-w-[30px] text-center"
                          >
                            {t("studentActivityPage.labels.itemCount", {
                              count: activity.items.length,
                            })}
                          </Badge>
                        </div>

                        <div className="flex gap-0.5 sm:gap-1">
                          {activity.items.map((item, itemIndex) => {
                            const isActiveItem =
                              isActiveActivity &&
                              currentSubQuestionIndex === itemIndex;

                            const isCompleted =
                              ("recording_url" in item && item.recording_url) ||
                              activity.answers?.[itemIndex];
                            const teacherFeedback =
                              "teacher_feedback" in item
                                ? item.teacher_feedback
                                : undefined;
                            const teacherPassed =
                              "teacher_passed" in item
                                ? item.teacher_passed
                                : undefined;

                            const hasTeacherGraded =
                              teacherFeedback !== undefined &&
                              teacherFeedback !== null;
                            const isTeacherPassed =
                              hasTeacherGraded && teacherPassed === true;
                            const needsCorrection =
                              hasTeacherGraded && teacherPassed === false;

                            // 🎯 Issue #118: 判斷是否為例句朗讀模式（禁止跳題）
                            const isReadingMode =
                              isExampleSentencesType(activity.type) &&
                              practiceMode !== "rearrangement";

                            // 🎯 Issue #147: 判斷是否為單字選擇模式（禁止跳題）
                            const isWordSelectionMode = isVocabularySetType(
                              activity.type,
                            );

                            // 🎯 Issue #118: 檢查當前題目是否已分析（用於顯示狀態）
                            const hasAssessment = !!item?.ai_assessment;

                            return (
                              <button
                                key={itemIndex}
                                onClick={async () => {
                                  // 🔒 單字選擇模式禁止跳題
                                  if (isWordSelectionMode) return;
                                  // 🔒 分析中或錄音中禁止切換
                                  if (
                                    isAnalyzing ||
                                    isAutoAnalyzing ||
                                    isRecording
                                  )
                                    return;
                                  // 🎯 Issue #141: 使用新的跳題邏輯（會自動分析未分析的錄音）
                                  await handleQuestionJump(
                                    activityIndex,
                                    itemIndex,
                                  );
                                }}
                                disabled={
                                  isWordSelectionMode ||
                                  isAnalyzing ||
                                  isAutoAnalyzing ||
                                  isRecording
                                } // 🔒 單字選擇模式、分析中或錄音中禁用
                                className={cn(
                                  "relative w-8 h-8 sm:w-8 sm:h-8 rounded border transition-all",
                                  "flex items-center justify-center text-sm sm:text-xs font-medium",
                                  "min-w-[32px] sm:min-w-[32px]",
                                  // 保持學生原本的完成狀態樣式
                                  // 🎯 Issue #147: 單字選擇模式只顯示狀態，不能點擊
                                  isWordSelectionMode
                                    ? isCompleted
                                      ? "bg-green-100 text-green-800 border-green-400 cursor-default"
                                      : "bg-white text-gray-600 border-gray-300 cursor-default"
                                    : // 🎯 Issue #118: 例句朗讀模式顯示分析狀態（綠色=已分析）
                                      isReadingMode
                                      ? hasAssessment
                                        ? "bg-green-100 text-green-800 border-green-400 hover:border-blue-400"
                                        : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                                      : isCompleted
                                        ? "bg-green-100 text-green-800 border-green-400"
                                        : "bg-white text-gray-600 border-gray-300 hover:border-blue-400",
                                  isActiveItem && "border-2 border-blue-600",
                                )}
                                title={
                                  isWordSelectionMode
                                    ? `第 ${itemIndex + 1} 題`
                                    : isReadingMode
                                      ? hasAssessment
                                        ? `第 ${itemIndex + 1} 題 (已分析)`
                                        : `第 ${itemIndex + 1} 題 (未分析)`
                                      : needsCorrection
                                        ? "老師要求訂正"
                                        : isTeacherPassed
                                          ? "老師已通過"
                                          : isCompleted
                                            ? "已完成"
                                            : "未完成"
                                }
                              >
                                {itemIndex + 1}
                                {/* 老師評分圖標 - 右上角圓點徽章 */}
                                {hasTeacherGraded && (
                                  <span
                                    className={cn(
                                      "absolute top-0 right-0 w-3 h-3 rounded-full border border-white",
                                      teacherPassed
                                        ? "bg-green-500"
                                        : "bg-red-500",
                                    )}
                                    aria-label={
                                      teacherPassed
                                        ? t(
                                            "studentActivityPage.feedback.passed",
                                          )
                                        : t(
                                            "studentActivityPage.feedback.failed",
                                          )
                                    }
                                  />
                                )}
                              </button>
                            );
                          })}
                        </div>

                        {activityIndex < activities.length - 1 && (
                          <div className="w-px h-8 bg-gray-300 ml-2" />
                        )}
                      </div>
                    );
                  }

                  return (
                    <Button
                      key={activity.id}
                      variant={isActiveActivity ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleActivitySelect(activityIndex)}
                      disabled={isAnalyzing} // 🔒 分析中禁用
                      className="flex-shrink-0 h-8"
                    >
                      <div className="flex items-center gap-2">
                        {getStatusIcon(activity, answer)}
                        <span className="text-xs">{activity.title}</span>
                      </div>
                    </Button>
                  );
                })
              )}
            </div>
          )}

          <Progress value={progress} className="h-1 mt-1" />
        </div>
      </div>

      {/* Main content */}
      <div className="w-full px-2 sm:px-4 mt-3">
        <Card>
          {/* CardHeader - 單字選擇模式不顯示（WordSelectionActivity 自帶 header） */}
          {!isVocabularySetType(currentActivity?.type || "") && (
            <CardHeader className="py-2 sm:py-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0">
                <CardTitle className="text-base sm:text-lg leading-tight">
                  {t("studentActivityPage.labels.questionNumber", {
                    number: currentActivity.order,
                  })}{" "}
                  {currentActivity.title}
                </CardTitle>
                {getActivityTypeBadge(currentActivity.type)}
              </div>
            </CardHeader>
          )}

          <CardContent className="p-2 sm:p-3">
            {renderActivityContent(currentActivity)}

            {/* Navigation buttons */}
            {(() => {
              // 🎯 單字選擇/朗讀模式：WordSelectionActivity/WordReadingActivity 自帶導航，不顯示外部導航按鈕
              if (
                practiceMode === "word_selection" ||
                practiceMode === "word_reading"
              ) {
                return null;
              }

              let isAssessed = false;

              if (currentActivity.items && currentActivity.items.length > 0) {
                const currentItem =
                  currentActivity.items[currentSubQuestionIndex];
                isAssessed = !!currentItem?.ai_assessment;
              } else if (isExampleSentencesType(currentActivity.type)) {
                isAssessed = !!currentActivity.ai_scores;
              } else if (currentActivity.type === "listening_cloze") {
                const answer = answers.get(currentActivity.id);
                isAssessed = !!(
                  answer?.userAnswers && answer.userAnswers.length > 0
                );
              }

              // 🎯 Issue #118: 判斷是否為例句朗讀模式
              const isReadingMode =
                isExampleSentencesType(currentActivity.type) &&
                practiceMode !== "rearrangement";

              // 🎯 Issue #118: 例句朗讀模式始終顯示導航按鈕（即使未分析）
              // 其他模式維持原行為：未分析時不顯示導航按鈕
              if (!isAssessed && !isPreviewMode && !isReadingMode) {
                return null;
              }

              // 檢查是否為例句重組模式
              const isRearrangementMode =
                isExampleSentencesType(currentActivity.type) &&
                practiceMode === "rearrangement" &&
                rearrangementQuestions.length > 0;

              // 例句重組模式：檢查是否有未完成的題目
              let hasPrevUnanswered = false;
              let hasNextUnanswered = false;

              if (isRearrangementMode) {
                // 檢查當前題目之前是否有未完成的
                for (let i = 0; i < rearrangementQuestionIndex; i++) {
                  const state = rearrangementQuestionStates.get(
                    rearrangementQuestions[i].content_item_id,
                  );
                  if (state && !state.completed && !state.challengeFailed) {
                    hasPrevUnanswered = true;
                    break;
                  }
                }
                // 檢查當前題目之後是否有未完成的
                for (
                  let i = rearrangementQuestionIndex + 1;
                  i < rearrangementQuestions.length;
                  i++
                ) {
                  const state = rearrangementQuestionStates.get(
                    rearrangementQuestions[i].content_item_id,
                  );
                  if (state && !state.completed && !state.challengeFailed) {
                    hasNextUnanswered = true;
                    break;
                  }
                }
              }

              // 例句重組模式的上一題/下一題處理函數
              const handleRearrangementPrev = () => {
                // 從當前位置向前找第一個未完成的題目
                for (let i = rearrangementQuestionIndex - 1; i >= 0; i--) {
                  const state = rearrangementQuestionStates.get(
                    rearrangementQuestions[i].content_item_id,
                  );
                  if (state && !state.completed && !state.challengeFailed) {
                    setRearrangementQuestionIndex(i);
                    return;
                  }
                }
              };

              const handleRearrangementNext = () => {
                // 從當前位置向後找第一個未完成的題目
                for (
                  let i = rearrangementQuestionIndex + 1;
                  i < rearrangementQuestions.length;
                  i++
                ) {
                  const state = rearrangementQuestionStates.get(
                    rearrangementQuestions[i].content_item_id,
                  );
                  if (state && !state.completed && !state.challengeFailed) {
                    setRearrangementQuestionIndex(i);
                    return;
                  }
                }
              };

              return (
                <div className="flex items-center justify-center gap-2 sm:gap-3 mt-6 pt-4 border-t border-gray-200">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={
                      isRearrangementMode
                        ? handleRearrangementPrev
                        : handlePreviousActivity
                    }
                    disabled={
                      isAnalyzing || // 🔒 分析中禁用
                      isAutoAnalyzing || // 🔒 Issue #141: 自動分析中禁用
                      (isRearrangementMode
                        ? !hasPrevUnanswered
                        : // 🎯 Issue #227: 無 AI 分析額度時不需等待分析即可切換
                          (isReadingMode && canUseAiAnalysis && !isAssessed) ||
                          (currentActivityIndex === 0 &&
                            currentSubQuestionIndex === 0))
                    }
                    className="flex-1 sm:flex-none min-w-0"
                  >
                    <ChevronLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                    <span className="hidden sm:inline">
                      {t("studentActivityPage.buttons.previous")}
                    </span>
                    <span className="sm:hidden">
                      {t("studentActivityPage.buttons.previous")}
                    </span>
                  </Button>

                  {(() => {
                    const isLastActivity =
                      currentActivityIndex === activities.length - 1;
                    const isLastSubQuestion = currentActivity.items
                      ? currentSubQuestionIndex ===
                        currentActivity.items.length - 1
                      : true;

                    // Issue #110: 例句重組模式只在所有題目完成時顯示提交按鈕
                    const allRearrangementCompleted = isRearrangementMode
                      ? rearrangementQuestions.every((q) => {
                          const state = rearrangementQuestionStates.get(
                            q.content_item_id,
                          );
                          return state?.completed || state?.challengeFailed;
                        })
                      : false;

                    // 非例句重組模式：最後一題顯示提交
                    // 例句重組模式：所有題目完成後顯示提交
                    const shouldShowSubmit = isRearrangementMode
                      ? allRearrangementCompleted && !isPreviewMode
                      : isLastActivity && isLastSubQuestion && !isPreviewMode;

                    if (shouldShowSubmit) {
                      return (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={handleSubmit}
                          disabled={submitting} // 🔒 提交中禁用
                          className="flex-1 sm:flex-none min-w-0"
                        >
                          <span className="hidden sm:inline">
                            {submitting
                              ? t("studentActivityPage.buttons.submitting")
                              : t("studentActivityPage.buttons.submit")}
                          </span>
                          <span className="sm:hidden">
                            {submitting
                              ? t("studentActivityPage.buttons.submittingShort")
                              : t("studentActivityPage.buttons.submitShort")}
                          </span>
                          <Send className="h-3 w-3 sm:h-4 sm:w-4 ml-1" />
                        </Button>
                      );
                    }

                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={
                          isRearrangementMode
                            ? handleRearrangementNext
                            : handleNextActivity
                        }
                        disabled={
                          isAnalyzing || // 🔒 分析中禁用
                          isAutoAnalyzing || // 🔒 Issue #141: 自動分析中禁用
                          (isRearrangementMode
                            ? !hasNextUnanswered
                            : // 🎯 Issue #227: 無 AI 分析額度時不需等待分析即可下一題
                              isReadingMode && canUseAiAnalysis && !isAssessed)
                        }
                        className="flex-1 sm:flex-none min-w-0"
                      >
                        <span className="hidden sm:inline">
                          {t("studentActivityPage.buttons.next")}
                        </span>
                        <span className="sm:hidden">
                          {t("studentActivityPage.buttons.next")}
                        </span>
                        <ChevronRight className="h-3 w-3 sm:h-4 sm:w-4 ml-1" />
                      </Button>
                    );
                  })()}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* 提交確認 Dialog */}
      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              {t("studentActivityPage.validation.title")}
            </DialogTitle>
            <DialogDescription className="text-base pt-2">
              {t("studentActivityPage.validation.incompleteItems")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 max-h-[300px] overflow-y-auto">
              <ul className="space-y-2">
                {incompleteItems.map((item, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <span className="text-amber-600 mt-0.5">•</span>
                    <span className="text-gray-700">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowSubmitDialog(false)}
            >
              {t("studentActivityPage.buttons.cancel")}
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={handleConfirmSubmit}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {t("studentActivityPage.buttons.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 🔒 全屏分析遮罩 (GroupedQuestionsTemplate 使用) */}
      {isAnalyzing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-8 shadow-2xl max-w-md mx-4 text-center">
            <div className="relative w-24 h-24 mx-auto mb-6">
              {/* 外圈脈動動畫 */}
              <div className="absolute inset-0 rounded-full bg-purple-100 animate-ping opacity-75"></div>
              {/* 中圈脈動動畫 */}
              <div className="absolute inset-2 rounded-full bg-purple-200 animate-pulse"></div>
              {/* 大腦圖示 - 旋轉動畫 */}
              <Loader2
                className="w-24 h-24 absolute inset-0 animate-spin text-purple-600"
                style={{ animationDuration: "2s" }}
              />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">
              {t("studentActivityPage.messages.analyzingRecording")}
            </h3>
            <p className="text-gray-600 mb-4">
              {t("studentActivityPage.messages.pleaseWait")}
            </p>
            <p className="text-sm text-gray-500">
              {t("studentActivityPage.messages.doNotLeave")}
            </p>
          </div>
        </div>
      )}

      {/* 🎯 Issue #141: 自動分析遮罩（跳題時觸發） */}
      {isAutoAnalyzing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-8 shadow-2xl max-w-md mx-4 text-center">
            <div className="relative w-24 h-24 mx-auto mb-6">
              {/* 外圈脈動動畫 */}
              <div className="absolute inset-0 rounded-full bg-blue-100 animate-ping opacity-75"></div>
              {/* 中圈脈動動畫 */}
              <div className="absolute inset-2 rounded-full bg-blue-200 animate-pulse"></div>
              {/* 圖示 - 旋轉動畫 */}
              <Loader2
                className="w-24 h-24 absolute inset-0 animate-spin text-blue-600"
                style={{ animationDuration: "2s" }}
              />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">
              {analyzingMessage || "正在分析錄音..."}
            </h3>
            <p className="text-gray-600 mb-4">分析完成後將自動跳轉</p>
            <p className="text-sm text-gray-500">請稍候，不要離開此頁面</p>
          </div>
        </div>
      )}

      {/* 🔒 提交中遮罩 */}
      {submitting && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-8 shadow-2xl max-w-md mx-4 text-center">
            <div className="relative w-24 h-24 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full bg-blue-100 animate-ping opacity-75"></div>
              <div className="absolute inset-2 rounded-full bg-blue-200 animate-pulse"></div>
              <Loader2
                className="w-24 h-24 absolute inset-0 animate-spin text-blue-600"
                style={{ animationDuration: "1.5s" }}
              />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">
              {t("studentActivityPage.messages.submittingAssignment") ||
                "正在提交作業..."}
            </h3>
            <p className="text-gray-600 mb-4">
              {t("studentActivityPage.messages.pleaseWait") || "請稍候"}
            </p>
            <p className="text-sm text-gray-500">
              {t("studentActivityPage.messages.doNotLeave") || "請勿離開此頁面"}
            </p>
          </div>
        </div>
      )}

      {/* 🎯 背景分析進度指示器（輕量版，右下角浮動提示） */}
      {!isAnalyzing && pendingAnalysisCount > 0 && (
        <div className="fixed bottom-4 right-4 bg-blue-600 text-white px-4 py-3 rounded-lg shadow-lg z-40 flex items-center gap-3 max-w-xs">
          <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {t("studentActivityPage.messages.backgroundAnalyzing") ||
                "背景分析中"}
            </p>
            <p className="text-xs text-blue-100">
              {t("studentActivityPage.messages.backgroundAnalyzingCount", {
                count: pendingAnalysisCount,
              }) || `${pendingAnalysisCount} 題進行中...`}
            </p>
          </div>
        </div>
      )}

      {/* Demo 模式：每日配額用盡提示 */}
      {isDemoMode && demoLimitExceeded && demoLimitError && (
        <DemoLimitModal
          open={demoLimitExceeded}
          onClose={clearDemoLimitError}
          resetAt={demoLimitError.resetAt}
          limit={demoLimitError.limit}
        />
      )}
    </div>
  );
}
