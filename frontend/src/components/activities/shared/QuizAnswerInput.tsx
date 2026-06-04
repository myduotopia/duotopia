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
 *   - 透過 ref 暴露 VirtualKeyboard 整合：appendChar / backspace / submit /
 *     focusFirst 由父元件的 VK 觸發，作用在當前 focused slot 上。
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2, Send } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const ALLOWED_CHAR = /[a-zA-Z\-' .,?!]/;
const sanitize = (raw: string) =>
  Array.from(raw)
    .filter((c) => ALLOWED_CHAR.test(c) && c !== " ")
    .join("");

export interface QuizAnswerInputHandle {
  appendChar: (ch: string) => void;
  backspace: () => void;
  submit: () => void;
  focusFirst: () => void;
}

interface Props {
  /** Full joined-by-space answer the student is building. */
  value: string;
  /** The expected (correct) answer — used only to decide slot count. */
  expectedAnswer: string;
  /** Visual state. */
  state?: "neutral" | "correct" | "wrong";
  /** Lock the inputs (e.g., after submit). */
  disabled?: boolean;
  /** Show a spinner on the Send button. */
  submitting?: boolean;
  /** Auto-focus the first slot on mount / when value resets. */
  autoFocus?: boolean;
  /** When true, sets inputMode="none" so the system keyboard stays closed —
   * pair with parent-rendered VirtualKeyboard via the imperative ref. */
  useVirtualKeyboard?: boolean;
  /** Hide the inline Send button (parent might trigger submit elsewhere). */
  hideSubmitButton?: boolean;
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

const QuizAnswerInput = forwardRef<QuizAnswerInputHandle, Props>(
  function QuizAnswerInput(
    {
      value,
      expectedAnswer,
      state = "neutral",
      disabled = false,
      submitting = false,
      autoFocus = false,
      useVirtualKeyboard = false,
      hideSubmitButton = false,
      onChange,
      onSubmit,
    },
    ref,
  ) {
    const slotWords = useMemo(() => slotsFor(expectedAnswer), [expectedAnswer]);
    const multi = slotWords.length > 1;

    const currentSlots = useMemo(() => {
      const parts = (value || "").split(/\s+/);
      while (parts.length < slotWords.length) parts.push("");
      return parts.slice(0, slotWords.length);
    }, [value, slotWords.length]);

    const refs = useRef<Array<HTMLInputElement | null>>([]);
    const [focusedIdx, setFocusedIdx] = useState(0);

    useEffect(() => {
      refs.current = refs.current.slice(0, slotWords.length);
    }, [slotWords.length]);

    useEffect(() => {
      if (autoFocus && refs.current[0]) {
        refs.current[0]?.focus();
        setFocusedIdx(0);
      }
    }, [autoFocus, slotWords.length]);

    const writeSlot = useCallback(
      (idx: number, next: string) => {
        const cleaned = sanitize(next);
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

    // VirtualKeyboard integration via imperative handle
    useImperativeHandle(
      ref,
      () => ({
        appendChar: (ch: string) => {
          const cleaned = sanitize(ch);
          if (!cleaned) return;
          const target = Math.max(
            0,
            Math.min(focusedIdx, slotWords.length - 1),
          );
          const newSlots = currentSlots.slice();
          newSlots[target] = (newSlots[target] || "") + cleaned;
          onChange(newSlots.join(" ").trim());
        },
        backspace: () => {
          const target = Math.max(
            0,
            Math.min(focusedIdx, slotWords.length - 1),
          );
          const newSlots = currentSlots.slice();
          if (newSlots[target]) {
            newSlots[target] = newSlots[target].slice(0, -1);
          } else if (target > 0) {
            refs.current[target - 1]?.focus();
            return;
          }
          onChange(newSlots.join(" ").trim());
        },
        submit: () => {
          if (onSubmit && !submitting && !disabled) onSubmit();
        },
        focusFirst: () => {
          refs.current[0]?.focus();
          setFocusedIdx(0);
        },
      }),
      [
        focusedIdx,
        slotWords.length,
        currentSlots,
        onChange,
        onSubmit,
        submitting,
        disabled,
      ],
    );

    const stateBorder =
      state === "correct"
        ? "border-green-500 text-green-700"
        : state === "wrong"
          ? "border-red-500 text-red-600"
          : "border-gray-300 focus:border-indigo-500";

    const showSubmit = !hideSubmitButton && !!onSubmit;

    return (
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-center gap-2 sm:gap-3">
          {slotWords.map((slotExpected, idx) => (
            <Input
              key={idx}
              ref={(el) => {
                refs.current[idx] = el;
              }}
              type="text"
              inputMode={useVirtualKeyboard ? "none" : "text"}
              value={currentSlots[idx] || ""}
              onChange={(e) => writeSlot(idx, e.target.value)}
              onKeyDown={handleKeyDown(idx)}
              onFocus={() => setFocusedIdx(idx)}
              onBeforeInput={(e) => {
                const ev = e.nativeEvent as InputEvent;
                if (ev.inputType === "insertReplacementText") {
                  e.preventDefault();
                }
              }}
              onPaste={(e) => e.preventDefault()}
              onDrop={(e) => e.preventDefault()}
              disabled={disabled}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              // Issue #828: 寬度依答案長度自適應，+4 ch 預留 padding + 較寬字元
              style={
                multi
                  ? { width: `${Math.max(slotExpected.length + 4, 6)}ch` }
                  : { width: `${Math.max(slotExpected.length + 4, 8)}ch` }
              }
              className={cn(
                "text-center text-2xl h-14 bg-transparent shadow-none rounded-none border-0 border-b-2 transition-colors",
                "focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none",
                stateBorder,
              )}
            />
          ))}
          {showSubmit && (
            <button
              type="button"
              onClick={onSubmit}
              disabled={
                disabled || submitting || (value || "").trim().length === 0
              }
              aria-label="Submit answer"
              className={cn(
                "ml-1 sm:ml-2 p-2 rounded-full transition-colors shrink-0",
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
      </div>
    );
  },
);

export default QuizAnswerInput;
