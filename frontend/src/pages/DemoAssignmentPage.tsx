/**
 * Demo Assignment Page
 *
 * Public demo page for showcasing assignment features
 * No authentication required - uses demo API endpoints
 */

import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Info } from "lucide-react";
import { toast } from "sonner";
import { demoApi } from "@/lib/demoApi";

// Import student component
import StudentActivityPageContent, {
  type Activity,
} from "./student/StudentActivityPageContent";

interface DemoActivityResponse {
  assignment_id: number;
  title: string;
  practice_mode?: string | null;
  show_answer?: boolean;
  time_limit_per_question?: number;
  // #854 B1: 後端 build_assignment_preview 本來就有回這些設定，先前 demo 漏接，
  // 導致 demo 頁未照老師設定顯示（聲音/翻譯/圖片），與其他四畫面不一致。
  play_audio?: boolean;
  show_translation?: boolean;
  show_word?: boolean;
  show_image?: boolean;
  show_option_images?: boolean;
  total_activities: number;
  activities: Activity[];
}

export default function DemoAssignmentPage() {
  const { t } = useTranslation();
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();

  const [activityData, setActivityData] = useState<DemoActivityResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assignmentId) {
      navigate("/");
      return;
    }
    fetchDemoData();
  }, [assignmentId]);

  const fetchDemoData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await demoApi.getPreview(parseInt(assignmentId!));
      setActivityData(response as DemoActivityResponse);
    } catch (err) {
      console.error("Failed to fetch demo data:", err);
      setError(t("demo.messages.loadError"));
      // Redirect to home after 2 seconds if demo not found
      setTimeout(() => navigate("/"), 2000);
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = () => {
    toast.success(t("demo.messages.complete"));
    navigate("/");
  };

  const handleBack = () => {
    navigate("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">
            {t("demo.loading")}
          </p>
        </div>
      </div>
    );
  }

  if (error || !activityData) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {error || t("demo.messages.loadError")}
          </p>
          <Button onClick={handleBack}>{t("demo.backToHome")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Demo Mode Banner */}
      <div className="bg-blue-600 dark:bg-blue-700 text-white border-b dark:border-blue-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 flex-shrink-0" />
              <span className="text-sm font-medium">{t("demo.banner")}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="text-white hover:bg-blue-700 dark:hover:bg-blue-600 gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("demo.backToHome")}
            </Button>
          </div>
        </div>
      </div>

      {/* Demo Content - uses StudentActivityPageContent */}
      <StudentActivityPageContent
        activities={activityData.activities}
        assignmentTitle={activityData.title}
        assignmentId={activityData.assignment_id}
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
        isDemoMode={true}
        isPreviewMode={true}
        onBack={handleBack}
        onSubmit={async () => {
          handleComplete();
        }}
      />
    </div>
  );
}
