/**
 * TeacherFeedbackBar — issue #892 訂正模式老師評語條。
 *
 * 一行呈現「✓/✗ + 老師回饋文字」，位置在卡片下方、底部控制列上方（不進卡片內，
 * 避免撐破固定高度卡片）。
 * - passed === true  → ✓ 綠（通過）
 * - passed === false → ✗ 紅（未通過）
 * - passed == null   → 中性藍（有回饋但未判定通過與否）
 * 無 feedback 時不渲染。
 *
 * 設計依據：docs/design/recording-card-redesign.pen「C5 訂正模式」frame。
 */
import { Check, X, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TeacherFeedbackBarProps {
  /** true=通過(✓綠) / false=未通過(✗紅) / null=中性(藍) */
  passed: boolean | null;
  /** 老師回饋文字；空值時整條不渲染 */
  feedback?: string | null;
  className?: string;
}

const VARIANTS = {
  pass: {
    key: "pass",
    border: "border-recording-pass",
    bg: "bg-recording-pass/10",
    icon: "text-recording-pass",
    Icon: Check,
  },
  fail: {
    key: "fail",
    border: "border-recording-danger",
    bg: "bg-recording-danger/10",
    icon: "text-recording-danger",
    Icon: X,
  },
  neutral: {
    key: "neutral",
    border: "border-recording-rerecord",
    bg: "bg-recording-rerecord/10",
    icon: "text-recording-rerecord",
    Icon: MessageSquare,
  },
} as const;

export const TeacherFeedbackBar = ({
  passed,
  feedback,
  className,
}: TeacherFeedbackBarProps) => {
  if (!feedback) return null;

  const variant =
    passed === true
      ? VARIANTS.pass
      : passed === false
        ? VARIANTS.fail
        : VARIANTS.neutral;
  const { Icon } = variant;

  return (
    <div
      data-testid="teacher-feedback-bar"
      data-variant={variant.key}
      className={cn(
        "flex items-center gap-3 rounded-2xl border-l-4 px-5 py-3",
        variant.border,
        variant.bg,
        className,
      )}
    >
      <Icon
        data-testid="feedback-mark"
        strokeWidth={3}
        className={cn("h-6 w-6 flex-shrink-0", variant.icon)}
      />
      <span className="text-base font-medium text-recording-text-primary sm:text-lg">
        {feedback}
      </span>
    </div>
  );
};

export default TeacherFeedbackBar;
