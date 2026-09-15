/**
 * 老師作業預覽頁面
 *
 * 完全重用 StudentActivityPage 元件
 * 只是從老師 preview API 載入資料，不儲存進度
 *
 * #1045 階段 4：小考（*_quiz）預覽有兩種示範模式
 *   - 考前說明（explain）：提交後不顯示分數/✓✗/正解，只顯示「示範結束」＋「重新示範」
 *   - 考後檢討（review）：提交後顯示 QuizReviewView（分數＋逐題對錯＋正解）＋「重新示範」
 * 進頁提示 Dialog 對小考改為兩個模式選項。未明確選「考後檢討」前一律視為考前說明：
 * Dialog 開著尚未選、或用 X / Esc / 點外面直接關閉，都不揭示答案（避免投影時意外洩漏正解）；
 * 頁面頂端常駐切換鈕，切換時遞增 quizResetKey 讓作答重置。非小考 Dialog 維持只有「關閉」。
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
// #854: 即刻練習練習畫面上的可收合進階設定
import InstantPracticeSettingsPanel from "@/components/InstantPracticeSettingsPanel";
import type { PracticeMode } from "@/lib/practiceMode";
import type { PracticeModeSettings } from "@/components/assignment/practiceModeSettings";
import { buildInstantPracticeSettings } from "@/lib/instantPracticeSettings";

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
  show_example_sentence?: boolean;
  // #854: 即刻練習進階設定面板初值 + 顯示判斷
  quiz_time_limit_seconds?: number | null;
  is_live_quiz?: boolean;
  shuffle_questions?: boolean;
  target_proficiency?: number | null;
  is_instant_practice?: boolean;
  student_assignment_id?: number;
  total_activities: number;
  activities: Activity[];
}

/** 由 preview 回傳組出進階設定面板初值（缺項用合理預設）。 */
const buildSettings = (d: ActivityResponse): PracticeModeSettings =>
  buildInstantPracticeSettings(d);

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
  // #854: 套用即刻練習新設定後 +1，用來重掛 StudentActivityPageContent → 從第 1 題重練
  const [reloadKey, setReloadKey] = useState(0);
  const [applyingSettings, setApplyingSettings] = useState(false);
  // #830: 小考每題班級表現（已提交學生第一次作答那筆）。非小考時為 null。
  const [quizStats, setQuizStats] = useState<{
    total: number;
    byItem: Map<number, QuizStatQuestion>;
  } | null>(null);

  const practiceMode = activityData?.practice_mode || null;
  const isQuiz = !!practiceMode && practiceMode.endsWith("_quiz");
  // #1045 階段 4：小考示範模式（null＝尚未在 Dialog 選）。未選（含直接關閉 Dialog）一律
  // 視為考前說明 → revealAnswersOnSubmit 只有老師明確選「考後檢討」才會是 true。
  const [previewRevealMode, setPreviewRevealMode] = useState<
    "explain" | "review" | null
  >(null);
  const effectiveRevealMode = previewRevealMode ?? "explain";
  // 遞增 → 重掛載小考 Activity（回第一題、作答清空）
  const [quizResetKey, setQuizResetKey] = useState(0);
  const chooseRevealMode = (mode: "explain" | "review") => {
    setPreviewRevealMode(mode);
    setQuizResetKey((k) => k + 1);
    setShowBanner(false);
  };
  const toggleRevealMode = () => {
    setPreviewRevealMode(
      effectiveRevealMode === "explain" ? "review" : "explain",
    );
    setQuizResetKey((k) => k + 1);
  };
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

  // #854: 即時調整即刻練習設定 → 後端重設進度 → 重載並從第 1 題重練
  const handleApplySettings = useCallback(
    async (mode: PracticeMode, settings: PracticeModeSettings) => {
      if (applyingSettings) return;
      setApplyingSettings(true);
      try {
        await apiClient.patch(
          `/api/teachers/instant-practice/${assignmentId}/reconfigure`,
          {
            practice_mode: mode,
            time_limit_per_question: settings.time_limit_per_question,
            quiz_time_limit_seconds: settings.quiz_time_limit_seconds,
            shuffle_questions: settings.shuffle_questions,
            show_answer: settings.show_answer,
            play_audio: settings.play_audio,
            show_translation: settings.show_translation,
            show_word: settings.show_word,
            show_image: settings.show_image,
            show_option_images: settings.show_option_images,
            show_example_sentence: settings.show_example_sentence,
            target_proficiency: settings.target_proficiency,
          },
        );
        await fetchPreviewData();
        setReloadKey((k) => k + 1);
        toast.success(t("instantPractice.reconfigured"));
      } catch (error) {
        console.error("Failed to reconfigure instant practice:", error);
        toast.error(t("instantPractice.reconfigureError"));
      } finally {
        setApplyingSettings(false);
      }
    },
    [applyingSettings, assignmentId, fetchPreviewData, t],
  );

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
      {/* #830: 外層 header 與返回鈕已移除（與題號列返回鈕重複），返回入口統一由題號列提供。
          原 Info Banner 改為進頁自動跳出的 Modal，由使用者自行關閉。 */}
      <Dialog open={showBanner} onOpenChange={setShowBanner}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t("previewPage.badge.previewMode")}</DialogTitle>
            <DialogDescription className="text-base pt-2">
              {t("previewPage.info.description")}
            </DialogDescription>
          </DialogHeader>
          {isQuiz ? (
            // #1045 階段 4：小考 → 選擇示範方式
            <div className="space-y-2" data-testid="quiz-mode-options">
              <div className="text-sm font-medium text-gray-700">
                {t("previewPage.quizMode.chooseTitle")}
              </div>
              <button
                type="button"
                data-testid="quiz-mode-explain"
                onClick={() => chooseRevealMode("explain")}
                className="w-full text-left rounded-lg border border-gray-200 px-4 py-3 hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <div className="font-medium text-gray-800">
                  {t("previewPage.quizMode.explain")}
                </div>
                <div className="text-sm text-gray-500">
                  {t("previewPage.quizMode.explainDesc")}
                </div>
              </button>
              <button
                type="button"
                data-testid="quiz-mode-review"
                onClick={() => chooseRevealMode("review")}
                className="w-full text-left rounded-lg border border-gray-200 px-4 py-3 hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <div className="font-medium text-gray-800">
                  {t("previewPage.quizMode.review")}
                </div>
                <div className="text-sm text-gray-500">
                  {t("previewPage.quizMode.reviewDesc")}
                </div>
              </button>
            </div>
          ) : (
            <DialogFooter>
              <Button onClick={() => setShowBanner(false)}>
                {t("common.close")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* #1045 階段 4：小考示範模式常駐切換列（顯示目前模式，點擊切換並重置作答） */}
      {isQuiz && (
        <div className="flex flex-wrap items-center justify-end gap-2 px-4 pt-3">
          <span
            className="text-sm text-gray-600 dark:text-gray-300"
            data-testid="quiz-mode-current"
            data-mode={effectiveRevealMode}
          >
            {t("previewPage.quizMode.current", {
              mode: t(`previewPage.quizMode.${effectiveRevealMode}Short`),
            })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="quiz-mode-toggle"
            onClick={toggleRevealMode}
          >
            {t("previewPage.quizMode.switchTo", {
              mode: t(
                `previewPage.quizMode.${
                  effectiveRevealMode === "explain" ? "review" : "explain"
                }Short`,
              ),
            })}
          </Button>
        </div>
      )}

      {/* 使用學生的完整 Activity Page 內容 */}
      <StudentActivityPageContent
        key={reloadKey}
        // #854: 即刻練習 → 把「⚡ 進階設定」觸發鈕放進頂部 header 列右側（向下下拉浮層）
        headerActions={
          activityData.is_instant_practice ? (
            <InstantPracticeSettingsPanel
              mode={(activityData.practice_mode || "reading") as PracticeMode}
              contentType={activityData.activities[0]?.type ?? ""}
              initialSettings={buildSettings(activityData)}
              applying={applyingSettings}
              onApply={handleApplySettings}
            />
          ) : undefined
        }
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
          show_example_sentence: activityData.show_example_sentence,
        }}
        isPreviewMode={true}
        // #1045 階段 4：只有小考帶模式；非小考不帶（undefined）→ 行為不變
        quizPreviewRevealAnswers={
          isQuiz ? effectiveRevealMode === "review" : undefined
        }
        quizPreviewResetKey={quizResetKey}
        onQuizPreviewRestart={
          isQuiz ? () => setQuizResetKey((k) => k + 1) : undefined
        }
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
