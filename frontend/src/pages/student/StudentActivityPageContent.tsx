/**
 * 學生作業活動內容元件（可重用）
 *
 * 此元件包含完整的學生作業活動介面，可被以下場景使用：
 * 1. 學生作業頁面 (StudentActivityPage)
 * 2. 老師預覽示範頁面 (TeacherAssignmentPreviewPage)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { TugOfWarGame } from "@/components/activities/TugOfWarGame";
import RecordingAttemptsIndicator from "@/components/activities/RecordingAttemptsIndicator";
import {
  useRecordingAttempts,
  incrementRecordingAttemptForItem,
} from "@/hooks/useRecordingAttempts";
import { getItemPassFailStatus } from "@/utils/itemPassFailStatus";
import WordSpellingActivity from "@/components/activities/WordSpellingActivity";
import WordClozeActivity from "@/components/activities/WordClozeActivity";
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
import { useDemoAzurePronunciation } from "@/hooks/useDemoAzurePronunciation";
import { azureSpeechService } from "@/services/azureSpeechService";
import { useAutoAnalysis } from "@/hooks/useAutoAnalysis"; // Issue #141: 例句朗讀自動分析
import { DemoLimitModal } from "@/components/demo/DemoLimitModal";
import { appendAudioToFormData } from "@/utils/audioFormatDetection";

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
    // Server-authoritative AI analysis count for this item; used by the
    // recording-attempts hook to seed its initial state cross-device.
    ai_analysis_count?: number;
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
  /** True when the GCS upload failed; recording is still available locally. */
  uploadFailed?: boolean;
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
  returnedAt?: string | null; // Issue #689: 退回時間，前端 hearts reset cycle marker
  practiceMode?: string | null; // 例句重組/朗讀模式
  showAnswer?: boolean; // 例句重組：答題結束後是否顯示正確答案
  canUseAiAnalysis?: boolean; // 教師/機構是否有 AI 分析額度
  timeLimitPerQuestion?: number; // 每題錄音時間限制（秒）
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

// API 回傳的 activity.type 可能為大寫 enum（EXAMPLE_SENTENCES）或舊資料的小寫，
// 故所有比對一律 normalize 成大寫。
const RECORDING_REQUIRED_TYPES = new Set([
  "READING_ASSESSMENT",
  "EXAMPLE_SENTENCES",
  "GROUPED_QUESTIONS",
  "SPEAKING",
]);

// 單字集搭配需要錄音的練習模式：
// - reading       → 朗讀單字的例句
// - word_reading  → 單字朗讀
// rearrangement / word_selection 不需錄音。
const VOCABULARY_RECORDING_PRACTICE_MODES = new Set([
  "reading",
  "word_reading",
]);

const activityNeedsRecording = (
  activity: Activity,
  practiceMode?: string | null,
): boolean => {
  // Rearrangement 是拖拉重組題，任何 content type 下都不使用麥克風，
  // 因此 early-return，避免 content-type 檢查誤判為需要錄音。
  if (practiceMode === "rearrangement") return false;

  const normalizedType = activity.type?.toUpperCase() ?? "";
  if (RECORDING_REQUIRED_TYPES.has(normalizedType)) return true;
  if (
    isVocabularySetType(activity.type) &&
    !!practiceMode &&
    VOCABULARY_RECORDING_PRACTICE_MODES.has(practiceMode)
  ) {
    return true;
  }
  return false;
};

/**
 * 判斷是否有任何題目尚未完成錄音或尚未上傳到 GCS。
 * - 空字串 / undefined / null：未錄音
 * - blob: URL：已錄音但尚未上傳到 GCS
 */
const isRecordingMissingOrPending = (url?: string | null): boolean =>
  !url || url.startsWith("blob:");

const hasIncompleteRecordings = (
  activities: Activity[],
  practiceMode?: string | null,
): boolean => {
  return activities.some((activity) => {
    if (!activityNeedsRecording(activity, practiceMode)) return false;

    if (activity.items && activity.items.length > 0) {
      return activity.items.some((item) =>
        isRecordingMissingOrPending(item.recording_url),
      );
    }

    return isRecordingMissingOrPending(activity.audio_url);
  });
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
  returnedAt = null,
  practiceMode = null,
  showAnswer = false,
  canUseAiAnalysis = true,
  timeLimitPerQuestion = 0,
}: StudentActivityPageContentProps) {
  const { t } = useTranslation();

  // 🚀 Azure Speech Service hook for direct API calls (background analysis)
  // Use demo hook when in demo mode (no authentication required)
  const demoHook = useDemoAzurePronunciation();

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

  // 任何題目未錄音 / 錄音未上傳到 GCS 時，禁用提交按鈕
  const isSubmitBlockedByRecording = useMemo(
    () => hasIncompleteRecordings(activities, practiceMode),
    [activities, practiceMode],
  );

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

  const [itemAnalysisStates] = useState<Map<string, ItemAnalysisState>>(
    new Map(),
  );
  const [pendingAnalysisCount] = useState(0); // 🔒 追蹤背景分析數量（由 useAutoAnalysis 管理）

  // 例句重組導航狀態
  const [rearrangementQuestions, setRearrangementQuestions] = useState<
    RearrangementQuestion[]
  >([]);
  const [rearrangementQuestionStates, setRearrangementQuestionStates] =
    useState<Map<number, RearrangementQuestionState>>(new Map());
  const [rearrangementQuestionIndex, setRearrangementQuestionIndex] =
    useState(0);

  // Word spelling / word cloze: lift state up so the top question-number bar
  // can navigate them (controlled-component pattern, like rearrangement).
  const [wordSpellingTotal, setWordSpellingTotal] = useState(0);
  const [wordSpellingIndex, setWordSpellingIndex] = useState(0);
  const [wordClozeTotal, setWordClozeTotal] = useState(0);
  const [wordClozeIndex, setWordClozeIndex] = useState(0);

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

  // Issue #689: 前端錄音次數限制 — 為當前可見題目維持 attempts 狀態。
  // - 多題題組（GroupedQuestionsTemplate）：以 items[currentSubQuestionIndex] 為 key
  // - 單題例句朗讀（ReadingAssessmentTemplate, no items）：以 activity.id 為 key
  // WordReadingActivity 自帶內部閘門，這裡的狀態不影響它。
  const _currentActivityForGate = activities[currentActivityIndex];
  const _currentItemForGate =
    _currentActivityForGate?.items?.[currentSubQuestionIndex];
  const _gateItemId =
    (_currentItemForGate?.id as number | undefined) ??
    _currentActivityForGate?.id ??
    0;
  const _gateTeacherPassed =
    (_currentItemForGate?.teacher_passed as boolean | undefined) ?? null;
  const _gateTeacherReviewedAt =
    (_currentItemForGate?.teacher_reviewed_at as string | undefined) ?? null;
  const _gateExistingRecordingUrl =
    (_currentItemForGate?.recording_url as string | undefined) ?? null;
  const _gateServerInitialCount =
    typeof _currentItemForGate?.ai_analysis_count === "number"
      ? (_currentItemForGate.ai_analysis_count as number)
      : null;
  const _gateAiAssessment = _currentItemForGate?.ai_assessment as
    | { pronunciation_score?: number; accuracy_score?: number }
    | undefined;
  // 優先用 pronunciation_score（發音準確度，比較貼近「念對沒」的題目本質）；
  // 若沒有再退到 accuracy_score。兩者皆無則 null（待分析）。
  const _gateAiScore =
    _gateAiAssessment?.pronunciation_score ??
    _gateAiAssessment?.accuracy_score ??
    null;
  // Issue #689 後續：在訂正模式下，已 passed 的題目鎖唯讀且藏愛心；
  // 訂正模式下「passed」純看 teacher_passed === true，不做 AI 分數 fallback
  // （否則學生重錄高分 → 老師沒審過的題目誤標訂正過 → 家長以為作業完成）。
  // getItemPassFailStatus 已封裝這個分流邏輯。
  const _gateItemStatus = getItemPassFailStatus({
    teacherPassed: _gateTeacherPassed,
    aiScore: _gateAiScore,
    assignmentStatus: assignmentStatus ?? null,
  });
  // RESUBMITTED 是第二次以後的訂正循環，鎖定行為要與 RETURNED 一致，
  // 否則老師之前已打勾的題目，學生在二次訂正時還能重錄，白扣愛心。
  // Defensive: RESUBMITTED 目前已被 isReadOnly 覆蓋，recordingGateActive=false
  // 時這個 flag 不會啟動，但保留以防未來 isReadOnly 規則調整。
  const itemLockedInReturnedMode =
    (assignmentStatus === "RETURNED" || assignmentStatus === "RESUBMITTED") &&
    _gateItemStatus.passed;

  const recordingGate = useRecordingAttempts({
    studentAssignmentId: assignmentId,
    itemId: _gateItemId,
    assignmentStatus: assignmentStatus ?? null,
    returnedAt: returnedAt ?? null,
    teacherPassed: _gateTeacherPassed,
    teacherReviewedAt: _gateTeacherReviewedAt,
    existingRecordingUrl: _gateExistingRecordingUrl,
    serverInitialCount: _gateServerInitialCount,
  });
  // readOnly（已提交 / 已批改 / 已訂正）下隱藏愛心。
  const recordingGateActive =
    !isReadOnly && !isPreviewMode && !isDemoMode && canUseAiAnalysis !== false;
  // 訂正模式下單題已通過 → 把錄音/分析鎖死、藏愛心，不讓學生重錄
  const recordingDisabledForCurrent =
    itemLockedInReturnedMode ||
    (recordingGateActive && !recordingGate.canRecord);
  const handleAnalysisSuccess = useCallback(
    (serverCount?: number) => {
      if (recordingGateActive && !itemLockedInReturnedMode) {
        recordingGate.recordAttempt();
        // Reconcile localStorage with the server-authoritative count
        // when available. The hook caps + max-merges so it can never
        // grant extra attempts.
        recordingGate.syncServerCount(serverCount);
      }
    },
    [recordingGateActive, itemLockedInReturnedMode, recordingGate],
  );
  const recordingAttemptsHint =
    recordingGateActive && !itemLockedInReturnedMode ? (
      <RecordingAttemptsIndicator attemptsUsed={recordingGate.attemptsUsed} />
    ) : null;

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
            const formData = new FormData();
            formData.append("assignment_id", assignmentId.toString());
            formData.append("content_item_id", contentItemId.toString());
            formData.append(
              "duration_seconds",
              Math.round(actualRecordingDuration).toString(),
            );
            await appendAudioToFormData(formData, "audio_file", audioBlob);

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
                markUploadFailed(activityId);
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
            if (recorder && recorder.state === "recording") {
              recorder.stop();
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

  const markUploadFailed = useCallback(
    (activityId: number) => {
      toast.error(
        t("studentActivity.toast.uploadFailed", "錄音上傳失敗，請重新錄音"),
      );
      setAnswers((prev) => {
        const next = new Map(prev);
        const ans = next.get(activityId);
        if (ans) {
          ans.uploadFailed = true;
          ans.status = "in_progress";
        }
        return next;
      });
    },
    [t],
  );

  const handleRecordingComplete = useCallback(
    async (blob: Blob, url: string, durationSeconds?: number) => {
      // Caller (AudioRecorder.onRecordingComplete) doesn't await this Promise,
      // so swallow + log any rejection here to avoid silent unhandled rejections.
      try {
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
            const formData = new FormData();
            formData.append("assignment_id", assignmentId.toString());
            formData.append("content_item_id", contentItemId.toString());
            if (durationSeconds !== undefined) {
              formData.append(
                "duration_seconds",
                Math.round(durationSeconds).toString(),
              );
            }
            await appendAudioToFormData(formData, "audio_file", blob);

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
                markUploadFailed(currentActivity.id);
              });
          }
        }
      } catch (err) {
        console.error("handleRecordingComplete failed:", err);
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
      markUploadFailed,
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
          await appendAudioToFormData(formData, "audio_file", audioBlob);

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

  // 🎯 Issue #75: analyzeInBackground 已移除 - 改用 useAutoAnalysis hook

  const handleNextActivity = async () => {
    const currentActivity = activities[currentActivityIndex];

    // Issue #677: removed fire-and-forget supplementary analysis on next.
    // Auto-analysis only happens at recording completion now.

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
   * 處理題號按鈕跳題（純切換，不再自動補分析 — Issue #677）
   * 補分析只在錄音完成那一刻發生；跳題時不再為「之前未分析的題目」追加分析。
   */
  const handleQuestionJump = async (
    targetActivityIndex: number,
    targetItemIndex: number,
  ) => {
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
        const needsRecording = activityNeedsRecording(activity, practiceMode);

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

            const formData = new FormData();
            formData.append("assignment_id", assignmentId!.toString());
            formData.append("content_item_id", contentItemId.toString());
            await appendAudioToFormData(formData, "audio_file", audioBlob);

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

    // Issue #677: removed pre-submit supplementary analysis pass.
    // Items without `ai_assessment` at submit time are submitted as-is;
    // analysis only happens at the moment the recording is finished.

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
    // 練習模式優先：spelling/cloze 都顯示對應模式名稱
    // （否則克漏字/拼寫題會誤顯示為「例句朗讀」或「單字練習」）
    if (practiceMode === "word_cloze") {
      return (
        <Badge variant="outline">
          {t("studentActivityPage.activityTypes.wordCloze")}
        </Badge>
      );
    }
    if (practiceMode === "word_spelling") {
      return (
        <Badge variant="outline">
          {t("studentActivityPage.activityTypes.wordSpelling")}
        </Badge>
      );
    }

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

    // 🎯 克漏字 / 單字拼寫：根據 practiceMode 直接路由（與內容類型無關，
    // 因克漏字可選例句集或單字集；拼寫雖只接單字集，但邏輯一致）。
    // 必須在 isExampleSentencesType / isVocabularySetType 判斷前先早退，
    // 避免被 ReadingAssessmentTemplate 攔截。
    if (practiceMode === "word_cloze") {
      return (
        <WordClozeActivity
          assignmentId={assignmentId}
          isPreviewMode={isPreviewMode}
          isDemoMode={isDemoMode}
          externalQuestionIndex={wordClozeIndex}
          onQuestionIndexChange={setWordClozeIndex}
          onTotalQuestionsChange={setWordClozeTotal}
          onComplete={() => {
            toast.success(t("wordCloze.toast.completed") || "作業已完成！");
            onBack?.();
          }}
        />
      );
    }

    if (practiceMode === "word_spelling") {
      return (
        <WordSpellingActivity
          assignmentId={assignmentId}
          isPreviewMode={isPreviewMode}
          isDemoMode={isDemoMode}
          externalQuestionIndex={wordSpellingIndex}
          onQuestionIndexChange={setWordSpellingIndex}
          onTotalQuestionsChange={setWordSpellingTotal}
          onComplete={() => {
            toast.success(t("wordSpelling.toast.completed") || "作業已完成！");
            onBack?.();
          }}
        />
      );
    }

    // 單字集類型使用新的 SentenceMakingActivity 組件，不要進入舊的 GroupedQuestionsTemplate
    // 例句集/單字集 + rearrangement 模式使用 RearrangementActivity，也不要進入 GroupedQuestionsTemplate
    const isRearrangementMode =
      (isExampleSentencesType(activity.type) ||
        isVocabularySetType(activity.type)) &&
      practiceMode === "rearrangement";
    // 單字集 + 例句模式（reading/rearrangement）→ 走例句模式組件
    const isVocabInSentenceMode =
      isVocabularySetType(activity.type) &&
      (practiceMode === "reading" || practiceMode === "rearrangement");

    if (
      activity.items &&
      activity.items.length > 0 &&
      (!isVocabularySetType(activity.type) || isVocabInSentenceMode) &&
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
          timeLimit={timeLimitPerQuestion}
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
            // Issue #689: 分析成功 → 替該題計入 +1（mirror 後端 attempts 欄位）
            if (assessmentResult && recordingGateActive) {
              const itemIdForCount = activity.items?.[index]?.id;
              if (itemIdForCount !== undefined) {
                if (index === currentSubQuestionIndex) {
                  // current item: 透過 hook 讓 UI 立刻反映
                  recordingGate.recordAttempt();
                  // Reconcile localStorage with the server-authoritative
                  // count when the response carries it. The hook handles
                  // undefined as a no-op and caps overflow itself.
                  recordingGate.syncServerCount(
                    assessmentResult.ai_analysis_count,
                  );
                } else {
                  incrementRecordingAttemptForItem(
                    assignmentId,
                    itemIdForCount as number | string,
                  );
                }
              }
            }
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
          recordingDisabled={recordingDisabledForCurrent}
          attemptsHint={recordingAttemptsHint}
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
            isPracticeMode={
              assignmentStatus === "SUBMITTED" ||
              assignmentStatus === "RESUBMITTED" ||
              assignmentStatus === "GRADED"
            }
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
            timeLimit={timeLimitPerQuestion}
            canUseAiAnalysis={canUseAiAnalysis}
            recordingDisabled={recordingDisabledForCurrent}
            attemptsHint={recordingAttemptsHint}
            onAnalysisSuccess={handleAnalysisSuccess}
          />
        );
      }
    }

    // 單字集類型（包含 SENTENCE_MAKING 和 VOCABULARY_SET）
    if (isVocabularySetType(activity.type)) {
      // 單字集 + 例句重組模式 → 使用 RearrangementActivity
      // （reading 模式已在上方 guard 進入 GroupedQuestionsTemplate）
      if (isVocabInSentenceMode && practiceMode === "rearrangement") {
        return (
          <RearrangementActivity
            studentAssignmentId={assignmentId}
            isPreviewMode={isPreviewMode}
            isDemoMode={isDemoMode}
            showAnswer={showAnswer}
            isPracticeMode={
              assignmentStatus === "SUBMITTED" ||
              assignmentStatus === "RESUBMITTED" ||
              assignmentStatus === "GRADED"
            }
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
      }

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
            readOnly={isReadOnly}
            timeLimitPerQuestion={timeLimitPerQuestion}
            assignmentStatus={assignmentStatus ?? null}
            returnedAt={returnedAt ?? null}
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
            initialPracticeMode={assignmentStatus === "GRADED"}
            showAnswer={showAnswer}
            onComplete={() => {
              toast.success(
                t("wordSelection.toast.completed") || "作業已完成！",
              );
              // 導航回作業列表
              onBack?.();
            }}
          />
        );
      }

      if (practiceMode === "tug_of_war") {
        // 拔河遊戲：純前端，不寫入資料庫
        return (
          <TugOfWarGame
            assignmentId={assignmentId}
            isPreviewMode={isPreviewMode}
            isDemoMode={isDemoMode}
            onComplete={() => {
              onBack?.();
            }}
          />
        );
      }

      // 注意：word_spelling / word_cloze 已在函式開頭早退路由

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
            timeLimit={timeLimitPerQuestion}
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
            (practiceMode === "word_selection" ||
              practiceMode === "word_spelling" ||
              practiceMode === "word_cloze") &&
            isPreviewMode
              ? "max-w-7xl mx-auto px-4 py-2"
              : "max-w-6xl mx-auto px-2 sm:px-4 py-2"
          }
        >
          {/* Mobile header layout */}
          <div className="flex flex-row items-center justify-between gap-2 mb-2">
            {/* 🎯 單字選擇/拼寫/克漏字預覽模式：只顯示標題（外層已有返回按鈕）；學生端保留返回按鈕 */}
            {(practiceMode === "word_selection" ||
              practiceMode === "word_spelling" ||
              practiceMode === "word_cloze") &&
            isPreviewMode ? (
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
                  單字選擇模式也不需要（自動根據熟悉度完成）
                  Issue #689: 單字朗讀有自帶 submit，header 那顆會因為外層
                  activities state 沒同步而永遠被 disabled，故一併隱藏。 */}
              {!isReadOnly &&
                !isPreviewMode &&
                practiceMode !== "rearrangement" &&
                practiceMode !== "word_selection" &&
                practiceMode !== "word_reading" &&
                practiceMode !== "word_spelling" &&
                practiceMode !== "word_cloze" && (
                  <Button
                    onClick={handleSubmit}
                    disabled={submitting || isSubmitBlockedByRecording}
                    title={
                      isSubmitBlockedByRecording
                        ? t("studentActivityPage.buttons.submitDisabledTooltip")
                        : undefined
                    }
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

          {/* Activity navigation - 單字選擇模式不顯示此區塊（但單字集+例句模式 / 拼寫 / 克漏字例外） */}
          {(!isVocabularySetType(currentActivity?.type || "") ||
            practiceMode === "reading" ||
            practiceMode === "rearrangement" ||
            practiceMode === "word_spelling" ||
            practiceMode === "word_cloze") && (
            <div className="flex gap-2 sm:gap-4 overflow-x-auto pb-2 scrollbar-hide">
              {/* 單字拼寫 / 克漏字：使用 activity 內部 question index */}
              {(practiceMode === "word_spelling" && wordSpellingTotal > 0) ||
              (practiceMode === "word_cloze" && wordClozeTotal > 0) ? (
                <div className="flex gap-0.5 sm:gap-1 overflow-x-auto scrollbar-hide">
                  {Array.from(
                    {
                      length:
                        practiceMode === "word_spelling"
                          ? wordSpellingTotal
                          : wordClozeTotal,
                    },
                    (_, qIndex) => {
                      const activeIndex =
                        practiceMode === "word_spelling"
                          ? wordSpellingIndex
                          : wordClozeIndex;
                      const setIndex =
                        practiceMode === "word_spelling"
                          ? setWordSpellingIndex
                          : setWordClozeIndex;
                      const isActiveItem = activeIndex === qIndex;
                      return (
                        <button
                          key={qIndex}
                          onClick={() => setIndex(qIndex)}
                          className={cn(
                            "relative w-8 h-8 sm:w-8 sm:h-8 rounded border transition-all",
                            "flex items-center justify-center text-sm sm:text-xs font-medium",
                            "min-w-[32px]",
                            "bg-white text-gray-600 border-gray-300 hover:border-blue-400",
                            isActiveItem && "border-2 border-blue-600",
                          )}
                        >
                          {qIndex + 1}
                        </button>
                      );
                    },
                  )}
                </div>
              ) : /* 例句重組模式：所有題目合併顯示，不分 activity */
              practiceMode === "rearrangement" &&
                rearrangementQuestions.length > 0 ? (
                <div className="flex gap-0.5 sm:gap-1 overflow-x-auto scrollbar-hide">
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
                          "min-w-[32px]",
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
                  // 但單字集+例句模式（reading/rearrangement）需要顯示題號
                  const isVocabSentenceMode =
                    isVocabularySetType(activity.type) &&
                    (practiceMode === "reading" ||
                      practiceMode === "rearrangement");
                  if (
                    activity.items &&
                    activity.items.length > 0 &&
                    (!isVocabularySetType(activity.type) || isVocabSentenceMode)
                  ) {
                    return (
                      <div
                        key={activity.id}
                        className="flex items-center gap-1 sm:gap-2 flex-shrink-0"
                      >
                        <div className="flex items-center gap-1">
                          <span className="text-sm sm:text-xs font-medium text-gray-600 whitespace-nowrap max-w-[120px] sm:max-w-none truncate sm:overflow-visible sm:whitespace-normal">
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
                                ? (item.teacher_passed as
                                    | boolean
                                    | null
                                    | undefined)
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
                              (isExampleSentencesType(activity.type) ||
                                isVocabSentenceMode) &&
                              practiceMode !== "rearrangement";

                            // 🎯 Issue #147: 判斷是否為單字選擇模式（禁止跳題）
                            // 單字集+例句模式不算單字選擇模式
                            const isWordSelectionMode =
                              isVocabularySetType(activity.type) &&
                              !isVocabSentenceMode;

                            // 🎯 Issue #118: 檢查當前題目是否已分析（用於顯示狀態）
                            const hasAssessment = !!item?.ai_assessment;

                            // Issue #689 後續：依 teacher_passed + AI 分數決定通過 / 未通過。
                            // RETURNED 模式不做 AI fallback —— 老師沒審過的題目
                            // 不會因為學生重錄高分被誤標為訂正過。
                            const aiAssessmentObj = item?.ai_assessment as
                              | {
                                  pronunciation_score?: number;
                                  accuracy_score?: number;
                                }
                              | undefined;
                            const aiScore =
                              aiAssessmentObj?.pronunciation_score ??
                              aiAssessmentObj?.accuracy_score ??
                              null;
                            const {
                              passed: passedByScore,
                              failed: failedByScore,
                            } = getItemPassFailStatus({
                              teacherPassed,
                              aiScore,
                              assignmentStatus: assignmentStatus ?? null,
                            });

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
                                  "min-w-[32px]",
                                  // 🎯 Issue #147: 單字選擇模式只顯示狀態，不能點擊
                                  isWordSelectionMode
                                    ? isCompleted
                                      ? "bg-green-100 text-green-800 border-green-400 cursor-default"
                                      : "bg-white text-gray-600 border-gray-300 cursor-default"
                                    : // Issue #689 後續：例句朗讀模式依 teacher_passed + AI 分數決定通過 / 未通過
                                      isReadingMode
                                      ? passedByScore
                                        ? "bg-green-100 text-green-800 border-green-400 hover:border-blue-400"
                                        : failedByScore
                                          ? "bg-red-100 text-red-800 border-red-400 hover:border-blue-400"
                                          : hasAssessment
                                            ? "bg-yellow-100 text-yellow-800 border-yellow-400 hover:border-blue-400"
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
              // 🎯 單字選擇/朗讀/拼寫/克漏字模式：自帶導航，不顯示外部導航按鈕
              if (
                practiceMode === "word_selection" ||
                practiceMode === "word_reading" ||
                practiceMode === "tug_of_war" ||
                practiceMode === "word_spelling" ||
                practiceMode === "word_cloze"
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
                    // Issue #689 後續：已提交 / 已批改 / 已訂正狀態下不再顯示 submit
                    const shouldShowSubmit = isRearrangementMode
                      ? allRearrangementCompleted &&
                        !isPreviewMode &&
                        !isReadOnly
                      : isLastActivity &&
                        isLastSubQuestion &&
                        !isPreviewMode &&
                        !isReadOnly;

                    if (shouldShowSubmit) {
                      return (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={handleSubmit}
                          disabled={submitting || isSubmitBlockedByRecording} // 🔒 提交中 / 有題目未上傳音檔 時禁用
                          title={
                            isSubmitBlockedByRecording
                              ? t(
                                  "studentActivityPage.buttons.submitDisabledTooltip",
                                )
                              : undefined
                          }
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
