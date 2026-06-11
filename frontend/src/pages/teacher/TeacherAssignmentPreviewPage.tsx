/**
 * 老師作業預覽頁面
 *
 * 完全重用 StudentActivityPage 元件
 * 只是從老師 preview API 載入資料，不儲存進度
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Info, X } from "lucide-react";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

// 導入學生元件
import StudentActivityPageContent, {
  type Activity,
} from "../student/StudentActivityPageContent";
// #830: 小考預覽每張卡底部的「該題班級表現」%條
import QuestionStatBar, {
  type StudentRef,
} from "@/components/grading/QuestionStatBar";

interface QuizStatQuestion {
  content_item_id: number;
  correct: StudentRef[];
  wrong: StudentRef[];
  unanswered: StudentRef[];
}
interface QuizStatsResponse {
  is_quiz: boolean;
  total_submitted: number;
  questions: QuizStatQuestion[];
}

interface ActivityResponse {
  assignment_id: number;
  title: string;
  status?: string;
  practice_mode?: string | null;
  score_category?: string | null;
  show_answer?: boolean; // 例句重組：答題結束後是否顯示正確答案
  time_limit_per_question?: number;
  // Issue #828: 老師的顯示設定，預覽小考時透傳給 QuizPreview
  play_audio?: boolean;
  show_translation?: boolean;
  show_word?: boolean;
  show_image?: boolean;
  show_option_images?: boolean;
  total_activities: number;
  activities: Activity[];
}

export default function TeacherAssignmentPreviewPage() {
  const { t } = useTranslation();
  const { classroomId, assignmentId } = useParams<{
    classroomId?: string;
    assignmentId: string;
  }>();
  const navigate = useNavigate();

  const goBack = () => {
    if (classroomId) {
      navigate(`/teacher/classroom/${classroomId}?tab=assignments`);
    } else {
      navigate(-1);
    }
  };
  const { token } = useTeacherAuthStore();

  const [activityData, setActivityData] = useState<ActivityResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [showBanner, setShowBanner] = useState(true);
  // #830: 小考每題班級表現（已提交學生第一次作答那筆）。非小考時為 null。
  const [quizStats, setQuizStats] = useState<{
    total: number;
    byItem: Map<number, QuizStatQuestion>;
  } | null>(null);

  const practiceMode = activityData?.practice_mode || null;
  useEffect(() => {
    if (!practiceMode || !practiceMode.endsWith("_quiz")) {
      setQuizStats(null);
      return;
    }
    let cancelled = false;
    apiClient
      .get<QuizStatsResponse>(
        `/api/teachers/assignments/${assignmentId}/quiz-question-stats`,
      )
      .then((resp) => {
        if (cancelled || !resp?.is_quiz) return;
        setQuizStats({
          total: resp.total_submitted,
          byItem: new Map(resp.questions.map((q) => [q.content_item_id, q])),
        });
      })
      .catch(() => {
        /* 統計失敗不擋預覽頁 */
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, practiceMode]);

  const fetchPreviewData = useCallback(async () => {
    try {
      setLoading(true);

      const response = await apiClient.get<ActivityResponse>(
        `/api/teachers/assignments/${assignmentId}/preview`,
      );

      setActivityData(response);
    } catch (error) {
      console.error("Failed to fetch preview data:", error);
      toast.error(t("previewPage.messages.loadError"));
    } finally {
      setLoading(false);
    }
  }, [assignmentId, t]);

  useEffect(() => {
    fetchPreviewData();
  }, [fetchPreviewData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">
            {t("previewPage.loading")}
          </p>
        </div>
      </div>
    );
  }

  if (!activityData) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {t("previewPage.messages.loadError")}
          </p>
          <Button onClick={() => navigate(-1)}>{t("common.back")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Preview Mode Header */}
      <div className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={goBack}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("previewPage.buttons.backToList")}
            </Button>
          </div>

          {/* Info Banner — dismissible */}
          {showBanner && (
            <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-blue-700 dark:text-blue-300 flex-1">
                <strong>{t("previewPage.badge.previewMode")}</strong>
                {t("previewPage.info.suffix")}
              </p>
              <button
                onClick={() => setShowBanner(false)}
                className="text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-300 flex-shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 使用學生的完整 Activity Page 內容 */}
      <StudentActivityPageContent
        activities={activityData.activities}
        assignmentTitle={activityData.title}
        assignmentId={parseInt(assignmentId!)}
        practiceMode={activityData.practice_mode || null}
        showAnswer={activityData.show_answer || false}
        timeLimitPerQuestion={activityData.time_limit_per_question ?? 0}
        previewSettings={{
          play_audio: activityData.play_audio,
          show_translation: activityData.show_translation,
          show_word: activityData.show_word,
          show_image: activityData.show_image,
          show_option_images: activityData.show_option_images,
        }}
        isPreviewMode={true}
        authToken={token || undefined}
        renderCardFooter={
          quizStats
            ? (id) => {
                const q = quizStats.byItem.get(id);
                if (!q) return null;
                return (
                  <QuestionStatBar
                    correct={q.correct}
                    wrong={q.wrong}
                    unanswered={q.unanswered}
                    total={quizStats.total}
                  />
                );
              }
            : undefined
        }
        onBack={goBack}
        onSubmit={async () => {
          // 預覽模式完成時，跳回作業列表
          toast.success(t("previewPage.messages.previewComplete"));
          goBack();
        }}
      />
    </div>
  );
}
