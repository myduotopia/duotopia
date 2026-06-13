/**
 * QuizGradingPanel — 批改頁中間欄：小考（word_*_quiz）
 *
 * Issue #830：小考自動判分，老師不需手動批改。此面板僅唯讀呈現「成績紀錄」＝
 * 學生第一次作答（後端取最早 completed PracticeSession），逐題顯示：
 *   - 學生答案 / 正解 / 對錯（錯題清單）
 *   - 頂部彙總：分數、答對率、答對題數
 *
 * 退回（要求訂正）鈕沿用右欄 OverallFeedbackPanel；訂正不改成績紀錄（成績以舊
 * 的為準），故此面板永遠顯示第一次作答的對錯，與凍結分數一致。
 *
 * 詳見 docs/design/grading-page-architecture.md
 */

import { useTranslation } from "react-i18next";
import { CheckCircle, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { StudentSubmission } from "@/pages/teacher/GradingPage";

interface QuizGradingPanelProps {
  submission: StudentSubmission;
  activeTab: "students" | "content" | "grading";
}

export function QuizGradingPanel({
  submission,
  activeTab,
}: QuizGradingPanelProps) {
  const { t } = useTranslation();

  const items = submission.submissions || [];
  const total = submission.total ?? items.length;
  const correctCount =
    submission.correct_count ?? items.filter((i) => i.is_correct).length;
  const accuracy =
    submission.accuracy ??
    (total > 0 ? Math.round((correctCount / total) * 1000) / 10 : 0);
  const score = submission.score ?? submission.current_score ?? null;

  return (
    <div
      className={`col-span-12 lg:col-span-6 ${
        activeTab === "content" ? "block" : "hidden lg:block"
      }`}
    >
      <div className="space-y-3">
        {/* 彙總：分數 / 答對率 / 答對題數 */}
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-around gap-3 text-center">
            <div>
              <div className="text-2xl font-bold text-gray-800">
                {score != null ? score : "—"}
              </div>
              <div className="text-xs text-gray-500">
                {t("gradingPage.quiz.score") || "分數"}
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">
                {accuracy}%
              </div>
              <div className="text-xs text-gray-500">
                {t("gradingPage.quiz.accuracy") || "答對率"}
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">
                {correctCount} / {total}
              </div>
              <div className="text-xs text-gray-500">
                {t("gradingPage.quiz.correctCount") || "答對題數"}
              </div>
            </div>
          </div>
        </Card>

        {/* 逐題對錯（錯題清單） */}
        <Card className="p-4">
          {items.length === 0 ? (
            <div className="text-center text-gray-500 py-6">
              {t("gradingPage.quiz.noAnswers") || "尚無作答紀錄"}
            </div>
          ) : (
            <div className="space-y-0 divide-y">
              {items.map((item, idx) => {
                const correct = item.is_correct === true;
                return (
                  <div
                    key={idx}
                    className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="mt-0.5 shrink-0 text-sm font-medium text-gray-400 w-6 text-right">
                      {item.question_number ?? idx + 1}
                    </span>
                    <span className="mt-0.5 shrink-0">
                      {correct ? (
                        <CheckCircle className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <X className="h-5 w-5 text-rose-500" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-800 break-words">
                        {item.question_text}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
                        <span
                          className={
                            correct ? "text-emerald-700" : "text-rose-700"
                          }
                        >
                          {t("gradingPage.quiz.studentAnswer") || "學生答案"}：
                          {item.student_answer ? (
                            item.student_answer
                          ) : (
                            <span className="text-gray-400">
                              {t("gradingPage.quiz.blank") || "（未作答）"}
                            </span>
                          )}
                        </span>
                        {!correct && (
                          <span className="text-emerald-700">
                            {t("gradingPage.quiz.correctAnswer") || "正解"}：
                            {item.correct_answer}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
