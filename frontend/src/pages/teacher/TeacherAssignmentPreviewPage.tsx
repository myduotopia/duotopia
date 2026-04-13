/**
 * 老師作業預覽頁面
 *
 * 完全重用 StudentActivityPage 元件
 * 只是從老師 preview API 載入資料，不儲存進度
 */

import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Info } from "lucide-react";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

// 導入學生元件
import StudentActivityPageContent, {
  type Activity,
} from "../student/StudentActivityPageContent";

interface ActivityResponse {
  assignment_id: number;
  title: string;
  status?: string;
  practice_mode?: string | null;
  score_category?: string | null;
  show_answer?: boolean; // 例句重組：答題結束後是否顯示正確答案
  time_limit_per_question?: number;
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

  useEffect(() => {
    fetchPreviewData();
  }, [assignmentId]);

  const fetchPreviewData = async () => {
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
  };

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

          {/* Info Banner */}
          <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-start gap-2">
            <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-blue-700 dark:text-blue-300">
              <strong>{t("previewPage.badge.previewMode")}</strong>
              {t("previewPage.info.suffix")}
            </p>
          </div>
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
        isPreviewMode={true}
        authToken={token || undefined}
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
