/**
 * ClassQuizStats — 批改頁中間欄【班級報告】（小考每題答對/答錯/未作答）#830
 *
 * 由左欄「班級報告」入口開啟,顯示在中間大欄。橫向堆疊長條:
 *   綠=答對、紅=答錯、黃=未作答;每題一列;hover 顯示三類學生座號+姓名。
 * 資料取每位「已提交」學生第一次作答（凍結那筆）;未作答=該題無答案紀錄。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { BarChart3, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { apiClient } from "@/lib/api";

interface StudentRef {
  student_id: number;
  name: string;
  number: string | number;
}
interface QuestionStat {
  question_number: number;
  content_item_id: number;
  prompt: string; // 題目（提示）
  answer: string; // 正確答案
  correct: StudentRef[];
  wrong: StudentRef[];
  unanswered: StudentRef[];
}
interface StatsResponse {
  is_quiz: boolean;
  total_submitted: number;
  questions: QuestionStat[];
}
interface ChartRow extends QuestionStat {
  correct_count: number;
  wrong_count: number;
  unanswered_count: number;
}

const COLORS = {
  correct: "#22c55e",
  wrong: "#ef4444",
  unanswered: "#eab308",
};
// 題目 / 答案 在 Y 軸標籤的顏色（兩色不同）
const PROMPT_COLOR = "#6b7280"; // 題目：灰
const ANSWER_COLOR = "#2563eb"; // 答案：藍

function truncate(s: string, n = 8): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

interface YTickProps {
  x?: number;
  y?: number;
  payload?: { value: number };
  byNum: Record<number, QuestionStat>;
}

/** Y 軸客製：題號 + 題目(灰) + 答案(藍)。 */
function YQuestionTick({ x = 0, y = 0, payload, byNum }: YTickProps) {
  const q = payload ? byNum[payload.value] : undefined;
  return (
    <text x={x} y={y} textAnchor="end" dominantBaseline="middle" fontSize={11}>
      <tspan fill="#9ca3af">{payload?.value}.</tspan>
      {q?.prompt ? (
        <tspan fill={PROMPT_COLOR} dx={4}>
          {truncate(q.prompt)}
        </tspan>
      ) : null}
      {q?.answer ? (
        <tspan fill={ANSWER_COLOR} dx={4}>
          {q.answer}
        </tspan>
      ) : null}
    </text>
  );
}

export function ClassQuizStats({
  assignmentId,
}: {
  assignmentId: string | number;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    apiClient
      .get(`/api/teachers/assignments/${assignmentId}/quiz-question-stats`)
      .then((resp) => {
        if (!cancelled) setData(resp as StatsResponse);
      })
      .catch(() => {
        // 統計失敗不擋批改頁，但需與「尚無提交資料」區分 — 標記 error 並提示老師
        if (!cancelled) {
          setError(true);
          toast.error(
            t(
              "gradingPage.classStats.loadError",
              "班級報告載入失敗，請稍後再試",
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, t]);

  return (
    <Card className="p-4">
      <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-gray-100">
        <BarChart3 className="h-5 w-5" />
        {t("gradingPage.classStats.title", "班級報告")}
        {data && (
          <span className="ml-auto text-sm font-normal text-gray-400">
            {t("gradingPage.classStats.submitted", "已交 {{n}}", {
              n: data.total_submitted,
            })}
          </span>
        )}
      </h3>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : error ? (
        <p className="flex items-center justify-center gap-2 py-12 text-center text-sm text-red-400">
          <AlertCircle className="h-4 w-4" />
          {t(
            "gradingPage.classStats.loadError",
            "班級報告載入失敗，請稍後再試",
          )}
        </p>
      ) : !data || !data.is_quiz || data.questions.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">
          {t("gradingPage.classStats.noData", "尚無提交資料")}
        </p>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
            <LegendDot
              color={COLORS.correct}
              label={t("gradingPage.classStats.correct", "答對")}
            />
            <LegendDot
              color={COLORS.wrong}
              label={t("gradingPage.classStats.wrong", "答錯")}
            />
            <LegendDot
              color={COLORS.unanswered}
              label={t("gradingPage.classStats.unanswered", "未作答")}
            />
          </div>
          <ResponsiveContainer
            width="100%"
            height={Math.max(220, data.questions.length * 44 + 40)}
          >
            <BarChart
              layout="vertical"
              data={toChartRows(data.questions)}
              margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
            >
              <XAxis
                type="number"
                allowDecimals={false}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                type="category"
                dataKey="question_number"
                width={150}
                interval={0}
                tick={
                  <YQuestionTick
                    byNum={Object.fromEntries(
                      data.questions.map((q) => [q.question_number, q]),
                    )}
                  />
                }
              />
              <Tooltip content={<StatTooltip />} cursor={{ fill: "#f3f4f6" }} />
              <Bar dataKey="correct_count" stackId="a" fill={COLORS.correct} />
              <Bar dataKey="wrong_count" stackId="a" fill={COLORS.wrong} />
              <Bar
                dataKey="unanswered_count"
                stackId="a"
                fill={COLORS.unanswered}
              />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </Card>
  );
}

function toChartRows(questions: QuestionStat[]): ChartRow[] {
  return questions.map((q) => ({
    ...q,
    correct_count: q.correct.length,
    wrong_count: q.wrong.length,
    unanswered_count: q.unanswered.length,
  }));
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

interface StatTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
}

function StatTooltip({ active, payload }: StatTooltipProps) {
  const { t } = useTranslation();
  if (!active || !payload || payload.length === 0) return null;
  const q = payload[0].payload;
  const names = (list: StudentRef[]) =>
    list.map((s) => `${s.number} ${s.name}`).join("、");
  const Row = ({
    color,
    label,
    list,
  }: {
    color: string;
    label: string;
    list: StudentRef[];
  }) => (
    <div className="mb-1 last:mb-0">
      <span className="font-medium" style={{ color }}>
        {label}（{list.length}）
      </span>
      {list.length > 0 && (
        <div className="text-gray-600 dark:text-gray-300">{names(list)}</div>
      )}
    </div>
  );
  return (
    <div className="max-w-[280px] rounded-md border border-gray-200 bg-white p-2.5 text-xs shadow-md dark:border-gray-600 dark:bg-gray-800">
      <div className="mb-1.5 font-semibold text-gray-800 dark:text-gray-100">
        {t("gradingPage.classStats.questionLabel", "第 {{n}} 題", {
          n: q.question_number,
        })}
        {q.prompt ? (
          <span className="ml-1 font-normal" style={{ color: PROMPT_COLOR }}>
            {q.prompt}
          </span>
        ) : null}
        {q.answer ? (
          <span className="ml-1 font-normal" style={{ color: ANSWER_COLOR }}>
            {q.answer}
          </span>
        ) : null}
      </div>
      <Row
        color={COLORS.correct}
        label={t("gradingPage.classStats.correct", "答對")}
        list={q.correct}
      />
      <Row
        color={COLORS.wrong}
        label={t("gradingPage.classStats.wrong", "答錯")}
        list={q.wrong}
      />
      <Row
        color={COLORS.unanswered}
        label={t("gradingPage.classStats.unanswered", "未作答")}
        list={q.unanswered}
      />
    </div>
  );
}
