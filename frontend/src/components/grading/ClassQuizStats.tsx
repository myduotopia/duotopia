/**
 * ClassQuizStats — 批改頁左欄【班級統計】（小考每題答對/答錯/未作答堆疊長條）#830
 *
 * 取自每位「已提交」學生第一次作答（凍結那筆）。
 * 堆疊長條:綠=答對、紅=答錯、黃=未作答;hover 顯示三類學生座號+姓名。
 * 只在小考顯示(由 GradingPage 依作業 practice_mode 決定是否渲染本元件)。
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
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api";

interface StudentRef {
  student_id: number;
  name: string;
  number: string | number;
}
interface QuestionStat {
  question_number: number;
  content_item_id: number;
  text: string;
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

export function ClassQuizStats({
  assignmentId,
}: {
  assignmentId: string | number;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient
      .get(`/api/teachers/assignments/${assignmentId}/quiz-question-stats`)
      .then((resp) => {
        if (!cancelled) setData(resp as StatsResponse);
      })
      .catch(() => {
        /* 統計失敗不擋批改頁 */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-3 text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  if (!data || !data.is_quiz || data.questions.length === 0) return null;

  const chartData: ChartRow[] = data.questions.map((q) => ({
    ...q,
    correct_count: q.correct.length,
    wrong_count: q.wrong.length,
    unanswered_count: q.unanswered.length,
  }));

  return (
    <div className="mb-3 border-b border-gray-200 dark:border-gray-700 pb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 w-full text-sm font-medium text-gray-700 dark:text-gray-200 mb-2"
      >
        {open ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        {t("gradingPage.classStats.title", "班級統計")}
        <span className="ml-auto text-xs text-gray-400">
          {t("gradingPage.classStats.submitted", "已交 {{n}}", {
            n: data.total_submitted,
          })}
        </span>
      </button>
      {open && (
        <>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart
              data={chartData}
              margin={{ top: 4, right: 4, bottom: 0, left: -24 }}
            >
              <XAxis
                dataKey="question_number"
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={28} />
              <Tooltip content={<StatTooltip />} />
              <Bar dataKey="correct_count" stackId="a" fill={COLORS.correct} />
              <Bar dataKey="wrong_count" stackId="a" fill={COLORS.wrong} />
              <Bar
                dataKey="unanswered_count"
                stackId="a"
                fill={COLORS.unanswered}
              />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-3 text-[10px] text-gray-500 dark:text-gray-400 mt-1">
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
        </>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block w-2.5 h-2.5 rounded-sm"
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
    <div className="max-w-[220px] rounded-md border border-gray-200 bg-white p-2 text-[11px] shadow-md dark:border-gray-600 dark:bg-gray-800">
      <div className="mb-1 font-semibold text-gray-800 dark:text-gray-100">
        {t("gradingPage.classStats.questionLabel", "第 {{n}} 題", {
          n: q.question_number,
        })}
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
