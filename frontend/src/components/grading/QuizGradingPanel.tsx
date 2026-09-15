/**
 * QuizGradingPanel — 批改頁中間欄：小考（word_*_quiz）
 *
 * Issue #830：小考自動判分。此面板呈現「成績紀錄」＝學生第一次作答
 * （後端取最早 completed PracticeSession），逐題顯示：
 *   - 學生答案 / 正解 / 對錯（錯題清單）
 *   - 頂部彙總：分數、單題分數、答對題數
 *
 * Issue #1045 題目區：依派發設定（submission.quiz_settings）還原學生看到的題目
 *   - word_selection_quiz：開 show_example_sentence 顯示挖空例句（ClozeBlankText），
 *     否則顯示單字（＋翻譯）；選項用 shared/QuizOptionChip（A-D 角標、正解綠、學生選錯紅），
 *     選項優先為學生作答當下存的 options_shown（後端已處理 fallback）
 *   - word_spelling_quiz：開 show_example_sentence 顯示挖空例句，否則顯示翻譯（＋單字）
 *   - word_cloze_quiz：一律顯示挖空例句（無挖空句時退回單字）
 *   - show_image 且有圖 → 題目圖
 *   窄版（手機）時選項改單欄、題目與答案上下排。
 *
 * 退回（要求訂正）鈕沿用右欄 OverallFeedbackPanel；訂正不改成績紀錄（成績以舊
 * 的為準），故此面板永遠顯示第一次作答的對錯，與凍結分數一致。
 *
 * 詳見 docs/design/grading-page-architecture.md
 */

import { useTranslation } from "react-i18next";
import { CheckCircle, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import ClozeBlankText from "@/components/activities/shared/ClozeBlankText";
import QuizOptionChip from "@/components/activities/shared/QuizOptionChip";
import { optionLabelAt } from "@/components/activities/shared/optionLabels";
import type {
  StudentSubmission,
  SubmissionItem,
} from "@/pages/teacher/GradingPage";

interface QuizGradingPanelProps {
  submission: StudentSubmission;
  activeTab: "students" | "content" | "grading";
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

function QuestionArea({
  item,
  practiceMode,
  showExampleSentence,
  showImage,
}: {
  item: SubmissionItem;
  practiceMode: string;
  showExampleSentence: boolean;
  showImage: boolean;
}) {
  const { t } = useTranslation();
  const blanked = item.blanked_sentence || "";
  const useCloze =
    !!blanked && (practiceMode === "word_cloze_quiz" || showExampleSentence);
  const options = practiceMode === "word_selection_quiz" ? item.options : null;

  return (
    <div className="space-y-2" data-testid="quiz-question-area">
      <div className="flex flex-col sm:flex-row sm:items-start gap-2">
        {showImage && item.image_url && (
          <img
            src={item.image_url}
            alt=""
            data-testid="quiz-question-image"
            className="max-h-24 w-auto self-start object-contain rounded"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs text-gray-400">
            {t("gradingPage.quiz.question") || "題目"}
          </div>
          {useCloze ? (
            <div
              className="text-gray-800 break-words"
              data-testid="quiz-question-cloze"
            >
              <ClozeBlankText text={blanked} />
            </div>
          ) : practiceMode === "word_spelling_quiz" ? (
            <div
              className="text-gray-800 break-words"
              data-testid="quiz-question-word"
            >
              {item.question_translation || item.question_text}
              {item.question_translation && (
                <span className="ml-2 text-sm text-gray-400">
                  {item.question_text}
                </span>
              )}
            </div>
          ) : (
            <div
              className="font-medium text-gray-800 break-words"
              data-testid="quiz-question-word"
            >
              {item.question_text}
              {item.question_translation && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  {item.question_translation}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {options && options.length > 0 && (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 gap-1.5"
          aria-label={t("gradingPage.quiz.options") || "選項"}
        >
          {options.map((opt, index) => {
            const isCorrect = norm(opt.text) === norm(item.correct_answer);
            const isStudentPick =
              !!item.student_answer &&
              norm(opt.text) === norm(item.student_answer);
            return (
              <QuizOptionChip
                key={`${index}-${opt.text}`}
                text={opt.text}
                label={optionLabelAt(index)}
                isCorrect={isCorrect}
                isStudentPick={isStudentPick}
              />
            );
          })}
        </div>
      )}
    </div>
  );
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
  // 單題分數 = 100 / 題數（#1045：與後端 compute_quiz_score 同為不先捨入，顯示時 round 1）
  const perQuestionPoints = total > 0 ? Math.round(1000 / total) / 10 : 0;
  const score = submission.score ?? submission.current_score ?? null;
  const practiceMode = submission.practice_mode ?? "";
  const settings = submission.quiz_settings;
  const showExampleSentence = settings?.show_example_sentence ?? false;
  const showImage = settings?.show_image ?? true;

  return (
    <div
      className={`col-span-12 lg:col-span-6 ${
        activeTab === "content" ? "block" : "hidden lg:block"
      }`}
    >
      <div className="space-y-3">
        {/* 彙總：分數 / 單題分數 / 答對題數 */}
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
                {perQuestionPoints}
              </div>
              <div className="text-xs text-gray-500">
                {t("gradingPage.quiz.perQuestionPoints") || "單題分數"}
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

        {/* 逐題：題目區 + 學生答案 / 正解 */}
        <Card className="p-3 sm:p-4">
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
                    key={item.content_item_id ?? idx}
                    data-testid="quiz-question-row"
                    className="flex items-start gap-2 sm:gap-3 py-3 first:pt-0 last:pb-0"
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
                    <div className="flex-1 min-w-0 space-y-2">
                      <QuestionArea
                        item={item}
                        practiceMode={practiceMode}
                        showExampleSentence={showExampleSentence}
                        showImage={showImage}
                      />
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
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
