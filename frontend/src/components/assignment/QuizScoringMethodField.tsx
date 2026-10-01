/**
 * QuizScoringMethodField — 打字類小考「評分方式」設定（Issue #1092）
 *
 * 派發 dialog（AssignmentDialog 最後一步）與作業詳情編輯（AssignmentDetailSheet）共用，
 * 只用於 word_spelling_quiz / word_cloze_quiz。內容：
 *   - 五種評分方式單選（新派發不預選，必須選一種才能送出）
 *   - 「每錯一個單字／字母扣固定分數」需填扣分（> 0、≤ 100）
 *   - 區分大小寫開關（預設關）
 *   - 每題配分 X 分（共 Q 題）—— 題數未知時不顯示數字
 *   - 即時試算表：用本次題目中單字最多的答案（抓不到題目就用內建例句），
 *     固定列「全對／差 1 字母／錯 1 單字／漏填 1 格／沒作答」，選項或數字一變就更新
 *
 * 試算只是預覽，用 lib/quizScoring.ts（後端 utils/quiz_scoring.py 的前端鏡像）；
 * 實際成績一律由後端計算。題目答案由 contentIds 逐一讀 getContentDetail 取得
 * （拼寫：單字；克漏字：cloze_answer，沒有則單字）。
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  METHODS_REQUIRING_POINTS,
  QUIZ_SCORING_METHODS,
  allSingleWordAnswers,
  buildPreviewCases,
  deductionReason,
  evaluateAnswer,
  formatSlots,
  isValidScoringPoints,
  perQuestionPoints,
  pickSampleAnswer,
  questionDeduction,
  roundHalfUp1,
  type QuizScoringMethod,
  type QuizScoringSettings,
} from "@/lib/quizScoring";

const QS = "quizScoring";

interface QuizScoringMethodFieldProps {
  value: QuizScoringSettings;
  onChange: (next: QuizScoringSettings) => void;
  practiceMode: string;
  /** 用來抓題目答案（試算例句）與題數；可省略 */
  contentIds?: number[];
  /** 已知的總題數（例如購物車 itemsCount 加總）；未知傳 null，會改用抓到的題目數 */
  questionCount?: number | null;
  /** 讓同頁多個實例的 radio name / id 不衝突 */
  idPrefix?: string;
}

/** 讀題目答案；失敗或沒有就回 null（試算改用內建例句、題數維持未知）。 */
function useQuizAnswers(
  contentIds: number[] | undefined,
  practiceMode: string,
) {
  const [answers, setAnswers] = useState<string[] | null>(null);
  const key = (contentIds || []).join(",");
  useEffect(() => {
    const ids = key ? key.split(",").map(Number) : [];
    if (!ids.length) {
      setAnswers(null);
      return;
    }
    let cancelled = false;
    Promise.all(ids.map((id) => apiClient.getContentDetail(id)))
      .then((details) => {
        if (cancelled) return;
        const list = details.flatMap((d) =>
          (d.items || []).map((item) =>
            practiceMode === "word_cloze_quiz"
              ? (item.cloze_answer || item.text || "").trim()
              : (item.text || "").trim(),
          ),
        );
        setAnswers(list);
      })
      .catch(() => {
        if (!cancelled) setAnswers(null);
      });
    return () => {
      cancelled = true;
    };
  }, [key, practiceMode]);
  return answers;
}

export function QuizScoringMethodField({
  value,
  onChange,
  practiceMode,
  contentIds,
  questionCount,
  idPrefix = "quiz-scoring",
}: QuizScoringMethodFieldProps) {
  const { t } = useTranslation();
  const answers = useQuizAnswers(contentIds, practiceMode);
  const needsPoints =
    !!value.method && METHODS_REQUIRING_POINTS.has(value.method);

  // 扣分輸入的草稿字串（允許輸入中的「0.」等暫時不合法的值）
  const [pointsDraft, setPointsDraft] = useState<string>(
    value.points != null ? String(value.points) : "",
  );
  useEffect(() => {
    // 外部重設（例如取消編輯）時同步草稿
    setPointsDraft((prev) => {
      const parsed = prev.trim() === "" ? null : Number(prev);
      return parsed === value.points
        ? prev
        : value.points != null
          ? String(value.points)
          : "";
    });
  }, [value.points]);
  const pointsInvalid = needsPoints && !isValidScoringPoints(value.points);

  const count =
    questionCount && questionCount > 0
      ? questionCount
      : answers && answers.length > 0
        ? answers.length
        : null;
  const perQ = perQuestionPoints(count);
  const sample = pickSampleAnswer(answers || []);
  const usingBuiltin = !answers || !answers.some((a) => a);
  const singleWordHint = !!answers && allSingleWordAnswers(answers);
  // 題數未知、或固定扣分還沒填好 → 不顯示數字（避免顯示錯的分數）
  const numbersPerQ = perQ != null && !pointsInvalid ? perQ : null;

  const rows = useMemo(() => {
    if (!value.method) return [];
    return buildPreviewCases(sample).map((c) => {
      const evaluation = c.answer
        ? evaluateAnswer(c.answer, sample, value.caseSensitive)
        : null;
      const deduction =
        numbersPerQ != null
          ? questionDeduction(
              value.method,
              value.points,
              numbersPerQ,
              evaluation,
            )
          : null;
      const reason = deductionReason(
        value.method,
        evaluation,
        deduction ?? (evaluation?.isCorrect ? 0 : 1),
        numbersPerQ,
      );
      return {
        key: c.key,
        answer: c.answer ? formatSlots(c.answer) : null,
        deduction,
        score:
          deduction != null && numbersPerQ != null
            ? numbersPerQ - deduction
            : null,
        reason,
      };
    });
  }, [value.method, value.points, value.caseSensitive, sample, numbersPerQ]);

  const setMethod = (method: QuizScoringMethod) =>
    onChange({ ...value, method });

  return (
    <Card className="p-3 space-y-3" data-testid="quiz-scoring-field">
      <div className="space-y-1">
        <div className="text-sm font-medium text-gray-800">
          {t(`${QS}.title`)}{" "}
          <span className="text-red-600">{t(`${QS}.required`)}</span>
        </div>
        {perQ != null && (
          <p className="text-xs text-gray-600" data-testid="quiz-scoring-per-q">
            {t(`${QS}.perQuestion`, {
              points: roundHalfUp1(perQ),
              count: count ?? 0,
            })}
          </p>
        )}
        {!value.method && (
          <p className="text-xs text-amber-700">{t(`${QS}.chooseHint`)}</p>
        )}
      </div>

      <div
        role="radiogroup"
        aria-label={t(`${QS}.title`)}
        className="space-y-1.5"
      >
        {QUIZ_SCORING_METHODS.map((method) => {
          const id = `${idPrefix}-${method}`;
          const checked = value.method === method;
          return (
            <label
              key={method}
              htmlFor={id}
              className={cn(
                "flex items-start gap-2 rounded border p-2 cursor-pointer transition-colors",
                checked
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-blue-300",
              )}
            >
              <input
                id={id}
                type="radio"
                name={`${idPrefix}-method`}
                value={method}
                checked={checked}
                onChange={() => setMethod(method)}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="block text-sm text-gray-800">
                  {t(`${QS}.methods.${method}.label`)}
                </span>
                <span className="block text-xs text-gray-500">
                  {t(`${QS}.methods.${method}.desc`)}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {needsPoints && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Label htmlFor={`${idPrefix}-points`} className="text-sm">
              {value.method === "fixed_per_letter"
                ? t(`${QS}.pointsPerLetter`)
                : t(`${QS}.pointsPerWord`)}
            </Label>
            <Input
              id={`${idPrefix}-points`}
              type="text"
              inputMode="decimal"
              value={pointsDraft}
              onChange={(e) => {
                const next = e.target.value;
                if (next !== "" && !/^\d*(\.\d{0,2})?$/.test(next)) return;
                setPointsDraft(next);
                const parsed = next === "" ? null : Number(next);
                onChange({
                  ...value,
                  points:
                    parsed != null && Number.isFinite(parsed) ? parsed : null,
                });
              }}
              aria-invalid={pointsInvalid}
              className={cn(
                "w-20 h-8 text-right",
                pointsInvalid && "border-red-500",
              )}
            />
            <span>{t(`${QS}.pointsUnit`)}</span>
          </div>
          {pointsInvalid && (
            <p className="text-xs text-red-600">{t(`${QS}.pointsInvalid`)}</p>
          )}
        </div>
      )}

      <div className="flex items-start gap-2">
        <Switch
          id={`${idPrefix}-case`}
          checked={value.caseSensitive}
          onCheckedChange={(checked) =>
            onChange({ ...value, caseSensitive: checked })
          }
        />
        <Label
          htmlFor={`${idPrefix}-case`}
          className="space-y-0.5 cursor-pointer"
        >
          <span className="block text-sm text-gray-800">
            {t(`${QS}.caseSensitive`)}
          </span>
          <span className="block text-xs font-normal text-gray-500">
            {t(`${QS}.caseSensitiveDesc`)}
          </span>
        </Label>
      </div>

      <div className="space-y-1.5" data-testid="quiz-scoring-preview">
        {!value.method ? (
          <p className="text-xs text-gray-500">
            {t(`${QS}.preview.chooseFirst`)}
          </p>
        ) : (
          <>
            <div className="text-xs font-medium text-gray-700">
              {t(`${QS}.preview.title`, { answer: sample })}
              {usingBuiltin && (
                <span className="ml-1 font-normal text-gray-500">
                  {t(`${QS}.preview.builtinNote`)}
                </span>
              )}
            </div>
            {perQ == null && (
              <p className="text-xs text-gray-500">
                {t(`${QS}.preview.noCount`)}
              </p>
            )}
            {singleWordHint && (
              <p className="text-xs text-blue-700">
                {t(`${QS}.preview.singleWordHint`)}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-1 pr-2 font-normal">
                      {t(`${QS}.preview.colAnswer`)}
                    </th>
                    {numbersPerQ != null && (
                      <>
                        <th className="py-1 pr-2 font-normal text-right">
                          {t(`${QS}.preview.colDeduction`)}
                        </th>
                        <th className="py-1 pr-2 font-normal text-right">
                          {t(`${QS}.preview.colScore`)}
                        </th>
                      </>
                    )}
                    <th className="py-1 font-normal">
                      {t(`${QS}.preview.colReason`)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.key}
                      className="border-b last:border-b-0"
                      data-testid={`quiz-scoring-row-${row.key}`}
                    >
                      <td className="py-1 pr-2 text-gray-800 break-words">
                        {row.answer ?? (
                          <span className="text-gray-400">
                            {t(`${QS}.preview.unansweredCell`)}
                          </span>
                        )}
                      </td>
                      {numbersPerQ != null && (
                        <>
                          <td className="py-1 pr-2 text-right tabular-nums text-rose-700">
                            {row.deduction != null
                              ? `−${roundHalfUp1(row.deduction)}`
                              : ""}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums">
                            {row.score != null ? roundHalfUp1(row.score) : ""}
                          </td>
                        </>
                      )}
                      <td className="py-1 text-gray-600">
                        {t(row.reason.key, row.reason.values)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
