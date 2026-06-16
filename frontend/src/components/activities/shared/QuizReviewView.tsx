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
}

export default function QuizReviewView<W extends QuizReviewWord>({
  data,
  renderQuestion,
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
          <p className="text-xs text-gray-500">
            {t("wordQuiz.locked.desc") ||
              "提交後不可重做；等待老師退回才能訂正錯題。"}
          </p>
        </CardContent>
      </Card>

      {data.words.map((word) => (
        <Card
          key={word.content_item_id}
          className={cn(
            "p-4",
            word.is_correct
              ? "border-emerald-200 bg-emerald-50/40"
              : "border-rose-200 bg-rose-50/40",
          )}
        >
          <CardContent className="p-0 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                {t("wordQuiz.questionLabel", {
                  current: word.question_number,
                  total,
                }) || `第 ${word.question_number} / ${total} 題`}
              </span>
              {word.is_correct ? (
                <span className="inline-flex items-center gap-1 text-sm text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  {t("wordQuiz.review.correct") || "答對"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-sm text-rose-700">
                  <XCircle className="h-4 w-4" />
                  {t("wordQuiz.review.wrong") || "答錯"}
                </span>
              )}
            </div>

            <div>{renderQuestion(word)}</div>

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
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
