/**
 * QuestionStatBar — 老師預覽頁每張小考卡片底部的「該題班級表現」百分比條 #830
 *
 * 一條滿格(100%)橫條:綠=答對% / 紅=答錯% / 黃=未作答%(以已提交人數為分母)。
 * hover 各色段 → 該類學生(座號 姓名)。資料來自 quiz-question-stats(每位已提交
 * 學生第一次作答那筆,凍結成績)。學生實際作答頁不會傳入此元件 → 僅老師預覽時出現。
 */
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

export interface StudentRef {
  student_id: number;
  name: string;
  number: string | number;
}

const COLORS = {
  correct: "#22c55e",
  wrong: "#ef4444",
  unanswered: "#eab308",
};

interface Props {
  correct: StudentRef[];
  wrong: StudentRef[];
  unanswered: StudentRef[];
  total: number;
}

export default function QuestionStatBar({
  correct,
  wrong,
  unanswered,
  total,
}: Props) {
  const { t } = useTranslation();

  if (!total || total <= 0) {
    return (
      <p className="mt-3 border-t pt-2 text-center text-xs text-gray-400">
        {t("gradingPage.classStats.noData", "尚無提交資料")}
      </p>
    );
  }

  const names = (list: StudentRef[]) =>
    list.map((s) => `${s.number} ${s.name}`).join("、");

  const segments = [
    {
      key: "correct",
      color: COLORS.correct,
      label: t("gradingPage.classStats.correct", "答對"),
      list: correct,
    },
    {
      key: "wrong",
      color: COLORS.wrong,
      label: t("gradingPage.classStats.wrong", "答錯"),
      list: wrong,
    },
    {
      key: "unanswered",
      color: COLORS.unanswered,
      label: t("gradingPage.classStats.unanswered", "未作答"),
      list: unanswered,
    },
  ].filter((s) => s.list.length > 0);

  return (
    <div className="mt-3 border-t pt-3">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-medium">
          {t("gradingPage.classStats.title", "班級報告")}
        </span>
        <span className="ml-auto">
          {t("gradingPage.classStats.submitted", "已交 {{n}}", { n: total })}
        </span>
      </div>
      <TooltipProvider delayDuration={80}>
        <div className="flex h-5 w-full overflow-hidden rounded">
          {segments.map((s) => (
            <Tooltip key={s.key}>
              <TooltipTrigger
                className="h-full border-0 p-0 transition-opacity hover:opacity-80"
                style={{
                  width: `${(s.list.length / total) * 100}%`,
                  backgroundColor: s.color,
                }}
                aria-label={`${s.label} ${s.list.length}/${total}`}
              />
              <TooltipContent className="max-w-[280px]">
                <div className="mb-1 font-semibold" style={{ color: s.color }}>
                  {s.label}（{s.list.length}/{total}）
                </div>
                <div className="text-gray-600 dark:text-gray-300">
                  {names(s.list)}
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    </div>
  );
}
