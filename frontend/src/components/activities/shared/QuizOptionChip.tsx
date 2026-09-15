/**
 * QuizOptionChip — 小考選項唯讀格（含 A/B/C/D 左上角標）
 *
 * #1045：學生檢討頁（WordSelectionQuizActivity review）與老師批改頁（QuizGradingPanel）共用。
 * - 正解：綠框綠底＋ ✓
 * - 學生選的錯誤選項：紅框紅底＋ ✗
 * - 其他：灰框灰字
 */
import { cn } from "@/lib/utils";

interface QuizOptionChipProps {
  text: string;
  label?: string;
  isCorrect: boolean;
  isStudentPick: boolean;
  className?: string;
}

export default function QuizOptionChip({
  text,
  label,
  isCorrect,
  isStudentPick,
  className,
}: QuizOptionChipProps) {
  return (
    <div
      data-testid="quiz-option-chip"
      className={cn(
        "relative p-2 rounded border text-sm",
        label && "pl-7",
        isCorrect
          ? "border-emerald-400 bg-emerald-50 text-emerald-800"
          : isStudentPick
            ? "border-rose-400 bg-rose-50 text-rose-800"
            : "border-gray-200 text-gray-500",
        className,
      )}
    >
      {label && (
        <span
          aria-hidden="true"
          className="absolute top-1 left-1.5 text-[11px] font-bold leading-none opacity-70"
        >
          {label}
        </span>
      )}
      {text}
      {isCorrect && " ✓"}
      {isStudentPick && !isCorrect && " ✗"}
    </div>
  );
}
