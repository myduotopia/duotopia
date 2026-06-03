/**
 * QuizAnswerInput — 小考拼寫 / 克漏字共用的答題輸入元件
 *
 * 行為：
 *   - 樣式對齊艾賓浩斯版 (WordSpellingActivity)：底線、置中、text-2xl，
 *     右側 Send 按鈕。
 *   - 答案含空格（如 "take pictures"）→ 自動依空格拆成多個 slot，每單字
 *     一個 input；自動聚焦下一個 slot、空 slot 按 Backspace 跳回前一個。
 *   - 過濾允許字元：英文字母、連字號、撇號、句號、逗號、問號、驚嘆號。
 *     （單字 slot 內不允許空格 — 空格是分隔，不該由學生輸入）
 *   - 完整支援標準編輯（Backspace、刪除、游標移動、選取重打）。
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Loader2, Send } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const ALLOWED_CHAR = /[a-zA-Z\-' .,?!]/;
const ALLOWED_CHAR_NO_SPACE = /[a-zA-Z\-' .,?!]/;
const sanitize = (raw: string, allowSpace: boolean) => {
  const pattern = allowSpace ? ALLOWED_CHAR : ALLOWED_CHAR_NO_SPACE;
  return Array.from(raw)
    .filter((c) =>
      allowSpace ? pattern.test(c) : pattern.test(c) && c !== " ",
    )
    .join("");
};

interface Props {
  /** Full joined-by-space answer the student is building. */
  value: string;
  /** The expected (correct) answer — used only to decide slot count. */
  expectedAnswer: string;
  /** Visual state. `null` while unanswered. */
  state?: "neutral" | "correct" | "wrong";
  /** Optional placeholder displayed when value is empty. */
  placeholder?: string;
  /** Lock the inputs (e.g., after submit). */
  disabled?: boolean;
  /** Show a spinner on the Send button. */
  submitting?: boolean;
  /** Auto-focus the first slot on mount / when value resets. */
  autoFocus?: boolean;
  onChange: (next: string) => void;
  /** Called when student presses Enter or clicks the Send button. */
  onSubmit?: () => void;
}

/** Split an expected answer string into slot widths (one per word). */
function slotsFor(expected: string): string[] {
  const trimmed = (expected || "").trim();
  if (!trimmed) return [""];
  return trimmed.split(/\s+/);
}

export default function QuizAnswerInput({
  value,
  expectedAnswer,
  state = "neutral",
  placeholder,
  disabled = false,
  submitting = false,
  autoFocus = false,
  onChange,
  onSubmit,
}: Props) {
  const slotWords = useMemo(() => slotsFor(expectedAnswer), [expectedAnswer]);
  const multi = slotWords.length > 1;

  // Per-slot values derived from the joined value. Pad to match slot count.
  const currentSlots = useMemo(() => {
    const parts = (value || "").split(/\s+/);
    while (parts.length < slotWords.length) parts.push("");
    return parts.slice(0, slotWords.length);
  }, [value, slotWords.length]);

  const refs = useRef<Array<HTMLInputElement | null>>([]);
  useEffect(() => {
    refs.current = refs.current.slice(0, slotWords.length);
  }, [slotWords.length]);

  // Focus first slot when autoFocus + value resets
  useEffect(() => {
    if (autoFocus && refs.current[0]) {
      refs.current[0]?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, slotWords.length]);

  const writeSlot = useCallback(
    (idx: number, next: string) => {
      const cleaned = sanitize(next, false);
      const newSlots = currentSlots.slice();
      newSlots[idx] = cleaned;
      onChange(newSlots.join(" ").trim());
    },
    [currentSlots, onChange],
  );

  const handleKeyDown = useCallback(
    (idx: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && currentSlots[idx] === "" && idx > 0) {
        e.preventDefault();
        refs.current[idx - 1]?.focus();
        return;
      }
      if (e.key === " " && multi && idx < slotWords.length - 1) {
        // Space jumps to next slot
        e.preventDefault();
        refs.current[idx + 1]?.focus();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (onSubmit && !submitting && !disabled) onSubmit();
      }
    },
    [currentSlots, multi, slotWords.length, onSubmit, submitting, disabled],
  );

  const stateBorder =
    state === "correct"
      ? "border-green-500 text-green-700"
      : state === "wrong"
        ? "border-red-500 text-red-600 placeholder:text-red-400"
        : "border-gray-300 focus:border-indigo-500";

  return (
    <div className="max-w-md mx-auto relative">
      <div
        className={cn(
          "flex items-center gap-2 sm:gap-3 pl-2 pr-10",
          multi ? "justify-center" : "block",
        )}
      >
        {slotWords.map((slotExpected, idx) => (
          <Input
            key={idx}
            ref={(el) => {
              refs.current[idx] = el;
            }}
            type="text"
            inputMode="text"
            value={currentSlots[idx] || ""}
            onChange={(e) => writeSlot(idx, e.target.value)}
            onKeyDown={handleKeyDown(idx)}
            onPaste={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
            placeholder={idx === 0 ? placeholder : ""}
            disabled={disabled}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            // Each slot's width hints expected length so layout matches the answer.
            // The hint isn't enforced — student can type fewer/more chars.
            style={
              multi
                ? { width: `${Math.max(slotExpected.length, 3) + 1}ch` }
                : undefined
            }
            className={cn(
              "text-center text-2xl h-14 bg-transparent shadow-none rounded-none border-0 border-b-2 transition-colors",
              "focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none",
              !multi && "w-full",
              stateBorder,
            )}
          />
        ))}
      </div>
      {onSubmit && (
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || submitting || (value || "").trim().length === 0}
          aria-label="Submit answer"
          className={cn(
            "absolute right-0 top-1/2 -translate-y-1/2 p-2 rounded-full transition-colors",
            "text-indigo-600 hover:bg-indigo-50",
            "disabled:text-gray-300 disabled:hover:bg-transparent disabled:cursor-not-allowed",
          )}
        >
          {submitting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          )}
        </button>
      )}
    </div>
  );
}
