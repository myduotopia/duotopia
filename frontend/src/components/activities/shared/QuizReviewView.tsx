/**
 * QuizReviewView — 小考提交後的複盤畫面
 *
 * 提交後 GET /api/students/.../{mode}_quiz/review 取得：
 *   - summary: score, correct_count, total_questions
 *   - words: 每題 {question_number, correct_answer, student_answer, is_correct, ...}
 *
 * 此元件負責共用骨架（summary header + 每題卡片框 + ✓/✗）；
 * 題目本身的呈現（翻譯 / 例句 / 選項）由 caller 透過 renderQuestion 注入，
 * 因為三種小考的題目展示差異夠大、不宜強塞同一個元件。
 *
 * #1045 階段 4：老師預覽「考後檢討」重用本元件，傳 `isPreview` 隱藏「提交後不可重做」
 * 文案、傳 `footer` 放「重新示範」。學生正式作答與派發 dialog 即時預覽不傳，外觀不變。
 */

import { CheckCircle2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface QuizReviewWord {
  content_item_id: number;
  question_number: number;
  is_correct: boolean;
  student_answer: string | null;
  correct_answer: string;
}

export interface QuizReviewPayload<W extends QuizReviewWord = QuizReviewWord> {
  practice_mode: string;
  words: W[];
  total_questions: number;
  correct_count: number;
  score: number;
  status: string | null;
  submitted_at: string | null;
}

interface Props<W extends QuizReviewWord> {
  data: QuizReviewPayload<W>;
  renderQuestion: (word: W) => React.ReactNode;
  // #1045 階段 4：老師預覽頁 → 隱藏「提交後不可重做」文案（學生正式作答不傳）
  isPreview?: boolean;
  // #1045 階段 4：列表最下方的附加區（老師預覽「考後檢討」放「重新示範」）
  footer?: React.ReactNode;
  // Issue #1088：隱藏「你的答案／正確答案」列（單字選擇的選項上已有 ✓／✗）
  hideAnswerRow?: boolean;
}

// Issue #1088：題號旁三態狀態 chip（正確／錯誤／未作答）
function statusOf(word: QuizReviewWord): "correct" | "wrong" | "unanswered" {
  if (!word.student_answer) return "unanswered";
  return word.is_correct ? "correct" : "wrong";
}

export default function QuizReviewView<W extends QuizReviewWord>({
  data,
  renderQuestion,
  isPreview = false,
  footer,
  hideAnswerRow = false,
}: Props<W>) {
  const { t } = useTranslation();
  const total = data.total_questions || data.words.length;
  return (
    <div className="space-y-4">
      <Card className="p-4 border-gray-200 bg-gray-50">
        <CardContent className="p-0 space-y-2">
          <div className="text-2xl font-bold text-gray-800 tabular-nums">
            {data.score} <span className="text-base text-gray-500">分</span>
          </div>
          <div className="text-sm text-gray-600">
            {t("wordQuiz.review.scoreSummary", {
              correct: data.correct_count,
              total,
            }) || `${data.correct_count} / ${total} 答對`}
          </div>
          {!isPreview && (
            <p className="text-xs text-gray-500">
              {t("wordQuiz.locked.desc") ||
                "提交後不可重做；等待老師退回才能訂正錯題。"}
            </p>
          )}
        </CardContent>
      </Card>

      {data.words.map((word) => {
        const status = statusOf(word);
        return (
          <Card
            key={word.content_item_id}
            // Issue #1088：卡片統一白底，狀態改由題號旁 chip 表達
            className="p-4 bg-white border-gray-200"
          >
            <CardContent className="p-0 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-gray-800">
                  {t("wordQuiz.questionLabel", {
                    current: word.question_number,
                    total,
                  }) || `第 ${word.question_number} / ${total} 題`}
                </span>
                {status === "correct" && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-lg font-semibold bg-emerald-100 text-emerald-800"
                    data-testid="quiz-review-status"
                    data-status="correct"
                  >
                    <CheckCircle2 className="h-5 w-5" />
                    {t("wordQuiz.review.correct") || "正確"}
                  </span>
                )}
                {status === "wrong" && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-lg font-semibold bg-rose-100 text-rose-800"
                    data-testid="quiz-review-status"
                    data-status="wrong"
                  >
                    <XCircle className="h-5 w-5" />
                    {t("wordQuiz.review.wrong") || "錯誤"}
                  </span>
                )}
                {status === "unanswered" && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-lg font-semibold bg-amber-100 text-amber-800"
                    data-testid="quiz-review-status"
                    data-status="unanswered"
                  >
                    {t("wordQuiz.review.unanswered") || "未作答"}
                  </span>
                )}
              </div>

              <div>{renderQuestion(word)}</div>

              {!hideAnswerRow && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-gray-200/60">
                  <div>
                    <div className="text-xs text-gray-500">
                      {t("wordQuiz.review.yourAnswer") || "你的答案"}
                    </div>
                    <div
                      className={cn(
                        "text-base font-medium",
                        word.student_answer
                          ? word.is_correct
                            ? "text-emerald-700"
                            : "text-rose-700"
                          : "text-gray-400 italic",
                      )}
                    >
                      {word.student_answer ||
                        t("wordQuiz.review.unanswered") ||
                        "未作答"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">
                      {t("wordQuiz.review.correctAnswer") || "正確答案"}
                    </div>
                    <div className="text-base font-medium text-gray-800">
                      {word.correct_answer}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      {footer}
    </div>
  );
}
