/**
 * Demo Assignment Page
 *
 * Public demo page for showcasing assignment features.
 * No authentication required - uses demo API endpoints.
 *
 * #923: renders the same "進階設定" panel teachers get in instant-practice, so
 * unauthenticated visitors can switch the same material into other practice
 * modes / toggle settings live. Applying re-fetches the preview with settings as
 * query-param overrides (stateless — the shared demo row is never mutated) and
 * remounts the activity from question 1. See lib/demoOverrides.ts.
 */

import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Info } from "lucide-react";
import { toast } from "sonner";
import { demoApi, type DemoAccessStatus } from "@/lib/demoApi";
import DemoAccessGate from "@/components/demo/DemoAccessGate";
import {
  setDemoOverrides,
  clearDemoOverrides,
  type DemoOverrides,
} from "@/lib/demoOverrides";

// Import student component
import StudentActivityPageContent, {
  type Activity,
} from "./student/StudentActivityPageContent";
// #923: 免登入訪客也能用「進階設定」把同一份教材切成別的玩法/設定
import InstantPracticeSettingsPanel from "@/components/InstantPracticeSettingsPanel";
import {
  instantPracticeModesForContentType,
  type PracticeMode,
} from "@/lib/practiceMode";
import type { PracticeModeSettings } from "@/components/assignment/practiceModeSettings";
import { buildInstantPracticeSettings } from "@/lib/instantPracticeSettings";

interface DemoActivityResponse {
  assignment_id: number;
  title: string;
  // #989: 派發時設定的開始/結束時間。非 active 時後端不回 activities，
  // 改由 DemoAccessGate 顯示引導畫面。
  access_status?: DemoAccessStatus;
  start_date?: string | null;
  due_date?: string | null;
  resource_program_id?: number | null;
  resource_program_name?: string | null;
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
  show_example_sentence?: boolean;
  // #923: 進階設定面板初值（後端 build_assignment_preview 已回傳）
  score_category?: string | null;
  shuffle_questions?: boolean;
  target_proficiency?: number | null;
  quiz_time_limit_seconds?: number | null;
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
  // #923: 進階設定面板 — 套用後重掛 StudentActivityPageContent 從第 1 題重來
  const [applying, setApplying] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!assignmentId) {
      navigate("/");
      return;
    }
    // Fresh demo session → no overrides until the visitor applies the panel.
    clearDemoOverrides();
    fetchDemoData();
    return () => clearDemoOverrides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  const fetchDemoData = async (ov?: DemoOverrides) => {
    try {
      setLoading(true);
      setError(null);

      // Keep the module-level holder in sync so the inner activity's own
      // start call carries the same overrides (#923).
      setDemoOverrides(ov ?? {});
      const response = await demoApi.getPreview(parseInt(assignmentId!), ov);
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

  // #923: visitor applied the advanced-settings panel — re-preview the same
  // material in the chosen mode/settings (stateless, no persistence) and remount.
  const handleApplySettings = async (
    mode: PracticeMode,
    settings: PracticeModeSettings,
  ) => {
    if (applying || !assignmentId) return;
    setApplying(true);
    const ov: DemoOverrides = {
      practice_mode: mode,
      show_answer: settings.show_answer,
      play_audio: settings.play_audio,
      show_translation: settings.show_translation,
      show_word: settings.show_word,
      show_image: settings.show_image,
      show_option_images: settings.show_option_images,
      show_example_sentence: settings.show_example_sentence,
      shuffle_questions: settings.shuffle_questions,
      time_limit_per_question: settings.time_limit_per_question,
      target_proficiency: settings.target_proficiency,
    };
    // null = 不限時；作為 query param 送 "null" 會 422，故僅在有值時帶上。
    if (settings.quiz_time_limit_seconds != null) {
      ov.quiz_time_limit_seconds = settings.quiz_time_limit_seconds;
    }
    try {
      await fetchDemoData(ov);
      setReloadKey((k) => k + 1);
    } finally {
      setApplying(false);
    }
  };

  const handleComplete = () => {
    toast.success(t("demo.messages.complete"));
    navigate("/");
  };

  const handleBack = () => {
    navigate("/");
  };

  // Shared between the activity view and the #989 access-gate screen.
  const demoBanner = (
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
  );

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

  // #989: 派發期限外不進入活動，改顯示「尚未開放 / 已結束」引導畫面。
  // 後端此時不回 activities，所以這個分支必須擋在活動渲染之前。
  const accessStatus = activityData.access_status ?? "active";
  if (accessStatus !== "active") {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        {demoBanner}
        <DemoAccessGate
          status={accessStatus}
          startDate={activityData.start_date}
          resourceProgramId={activityData.resource_program_id}
          resourceProgramName={activityData.resource_program_name}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {demoBanner}

      {/* Demo Content - uses StudentActivityPageContent */}
      <StudentActivityPageContent
        // #923: 套用進階設定後 key 變動 → 重掛，從第 1 題以新玩法/設定重來
        key={reloadKey}
        // #923: 免登入訪客的「進階設定」— 只有當內容型別支援多種玩法時才顯示
        headerActions={
          instantPracticeModesForContentType(
            activityData.activities[0]?.type ?? "",
          ).length > 1 ? (
            <InstantPracticeSettingsPanel
              mode={(activityData.practice_mode || "reading") as PracticeMode}
              contentType={activityData.activities[0]?.type ?? ""}
              initialSettings={buildInstantPracticeSettings(activityData)}
              applying={applying}
              onApply={handleApplySettings}
            />
          ) : undefined
        }
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
          show_example_sentence: activityData.show_example_sentence,
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
