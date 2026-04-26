/**
 * 學生作業活動頁面 - 含重試機制 (#280)
 *
 * 從 API 載入資料，然後使用共用的 StudentActivityPageContent 元件顯示
 */

import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { toast } from "sonner";
import { Loader2, BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  setErrorLoggingContext,
  clearErrorLoggingContext,
} from "@/contexts/ErrorLoggingContext";
import { retryWithBackoff } from "@/utils/retryHelper";
import StudentActivityPageContent from "./StudentActivityPageContent";

// Activity type from API
interface Activity {
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
      error_type: string;
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
          error_type: string;
        }>;
        detailed_words?: unknown[];
        reference_text?: string;
        recognized_text?: string;
        analysis_summary?: unknown;
      }
    >;
  };
}

interface ActivityResponse {
  assignment_id: number;
  title: string;
  status?: string;
  returned_at?: string | null; // Issue #689: 待訂正時間，前端用作 hearts reset cycle marker
  practice_mode?: string | null;
  score_category?: string | null;
  show_answer?: boolean; // 例句重組：答題結束後是否顯示正確答案
  time_limit_per_question?: number;
  total_activities: number;
  activities: Activity[];
  can_use_ai_analysis?: boolean; // 教師/機構是否有 AI 分析額度
}

export default function StudentActivityPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const { token, user } = useStudentAuthStore();
  const { t } = useTranslation();

  // State management
  const [activities, setActivities] = useState<Activity[]>([]);
  const [assignmentTitle, setAssignmentTitle] = useState("");
  const [assignmentStatus, setAssignmentStatus] = useState<string>("");
  const [returnedAt, setReturnedAt] = useState<string | null>(null);
  const [practiceMode, setPracticeMode] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState<boolean>(false);
  const [canUseAiAnalysis, setCanUseAiAnalysis] = useState<boolean>(true);
  const [timeLimitPerQuestion, setTimeLimitPerQuestion] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [_isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  // Cleanup toasts on unmount
  useEffect(() => {
    return () => {
      toast.dismiss();
    };
  }, []);

  // Set error logging context for audio error tracking
  useEffect(() => {
    if (assignmentId) {
      setErrorLoggingContext({
        assignmentId: parseInt(assignmentId),
        studentId: user?.id,
      });
    }

    return () => {
      clearErrorLoggingContext();
    };
  }, [assignmentId, user]);

  // Load activities from API
  useEffect(() => {
    if (assignmentId && token) {
      loadActivities();
    }
  }, [assignmentId, token]);

  const loadActivities = async () => {
    try {
      setLoading(true);
      const apiUrl = import.meta.env.VITE_API_URL || "";
      const response = await fetch(
        `${apiUrl}/api/students/assignments/${assignmentId}/activities`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to load activities: ${response.status}`);
      }

      const data: ActivityResponse = await response.json();
      console.log("Loaded activities from API:", data.activities);

      setActivities(data.activities);
      setAssignmentTitle(data.title);
      setAssignmentStatus(data.status || "");
      setReturnedAt(data.returned_at ?? null);
      setPracticeMode(data.practice_mode || null);
      setShowAnswer(data.show_answer || false);
      setCanUseAiAnalysis(data.can_use_ai_analysis ?? true);
      setTimeLimitPerQuestion(data.time_limit_per_question ?? 0);
    } catch (error) {
      console.error("Failed to load activities:", error);
      toast.error(t("studentActivityPage.errors.loadFailed"));
      navigate("/student/assignments");
    } finally {
      setLoading(false);
    }
  };

  // Handle final submission with retry
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSubmit = async (_data?: { answers: any[] }) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    const apiUrl = import.meta.env.VITE_API_URL || "";
    const maxRetries = 3;
    const toastId = toast.loading(
      t("studentActivityPage.errors.submitRetrying", {
        attempt: 1,
        maxRetries,
      }),
    );

    try {
      await retryWithBackoff(
        async () => {
          const response = await fetch(
            `${apiUrl}/api/students/assignments/${assignmentId}/submit`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            },
          );

          if (!response.ok) {
            const errorText = await response.text();
            console.error("Failed to submit:", response.status, errorText);
            throw new Error(`Failed to submit assignment: ${response.status}`);
          }
        },
        {
          maxRetries,
          initialDelay: 1000,
          maxDelay: 5000,
          shouldRetry: (error) => {
            const retryableErrors = [
              "NetworkError",
              "TimeoutError",
              "500",
              "502",
              "503",
              "504",
              "ECONNRESET",
              "ETIMEDOUT",
            ];
            const errorMessage = error.message || "";
            return retryableErrors.some((err) => errorMessage.includes(err));
          },
          onRetry: (attempt, error) => {
            console.error(
              `Submit attempt ${attempt}/${maxRetries} failed:`,
              error,
            );
            toast.loading(
              t("studentActivityPage.errors.submitRetrying", {
                attempt: attempt + 1,
                maxRetries,
              }),
              { id: toastId },
            );
          },
        },
      );

      toast.dismiss(toastId);
      navigate("/student/assignments");
    } catch (error) {
      toast.error(t("studentActivityPage.errors.submitFailed"), {
        id: toastId,
      });
      throw error;
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <div className="text-center">
          <div className="relative">
            <div className="absolute inset-0 animate-ping">
              <div className="h-16 w-16 rounded-full border-4 border-blue-200 opacity-75"></div>
            </div>
            <Loader2 className="h-16 w-16 animate-spin text-blue-600 mx-auto relative" />
          </div>
          <p className="mt-6 text-lg font-medium text-gray-700">
            {t("studentActivityPage.loading.title")}
          </p>
          <p className="mt-2 text-sm text-gray-500">
            {t("studentActivityPage.loading.subtitle")}
          </p>
        </div>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <BookOpen className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-4">
            {t("studentActivityPage.messages.noActivities")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <StudentActivityPageContent
      activities={activities}
      assignmentTitle={assignmentTitle}
      assignmentId={parseInt(assignmentId!)}
      assignmentStatus={assignmentStatus}
      returnedAt={returnedAt}
      practiceMode={practiceMode}
      showAnswer={showAnswer}
      canUseAiAnalysis={canUseAiAnalysis}
      timeLimitPerQuestion={timeLimitPerQuestion}
      onBack={() => navigate("/student/assignments")}
      onSubmit={handleSubmit}
    />
  );
}
