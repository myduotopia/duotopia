/**
 * LabeledSwitch — 文字寫在軌道裡的開關（#1097）
 *
 * 樣式參考班級詳情頁的監考開關（ClassroomDetail renderLiveQuizControl）：
 * `<button role="switch" aria-checked>`，滑塊是純圓鈕、不寫字，軌道文字落在滑塊的反側。
 * 文字由呼叫端傳入，慣例是顯示「撥下去會變成的狀態」（例：啟用中的班 → 開、寫「停用」）。
 *
 * - 寬度依文字自動長（md：min-w-16；sm：min-w-14），中英文都不截字：
 *   文字在排版流裡撐寬，滑塊 absolute，用 left 轉場從左滑到右。
 * - tone：
 *   - "brand"（一般白底頁面）：開＝bg-blue-600 白字；關＝灰底（同監考開關的灰）深字；滑塊白色。
 *   - "onDark"（放在深藍底的浮動操作列裡）：開＝白色軌道＋深藍字＋深藍滑塊；
 *     關＝半透明白（bg-white/30）軌道＋白字＋白滑塊。
 * - 可見 focus ring、motion-reduce 時不做轉場；原生 button 所以 Space／Enter 都能切換。
 * - aria-label 用完整句（例：「停用此班級」），軌道文字只是視覺標籤。
 */

export interface LabeledSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** 軌道內的文字（慣例：撥下去會變成的狀態） */
  label: string;
  /** 給螢幕閱讀器的完整句子 */
  ariaLabel: string;
  disabled?: boolean;
  tone?: "brand" | "onDark";
  size?: "sm" | "md";
  className?: string;
}

const SIZE = {
  md: {
    track: "h-7 min-w-16 text-xs",
    // 滑塊那一側留 0.25rem + 1.25rem（滑塊）+ 0.25rem
    padOn: "pl-2.5 pr-7",
    padOff: "pl-7 pr-2.5",
    knob: "top-1 h-5 w-5",
    knobOn: "left-[calc(100%_-_1.5rem)]",
  },
  sm: {
    track: "h-6 min-w-14 text-[11px]",
    padOn: "pl-2 pr-6",
    padOff: "pl-6 pr-2",
    knob: "top-1 h-4 w-4",
    knobOn: "left-[calc(100%_-_1.25rem)]",
  },
} as const;

const TONE = {
  brand: {
    on: "bg-blue-600 text-white",
    off: "bg-gray-300 text-gray-700 dark:bg-gray-600 dark:text-gray-200",
    knobOn: "bg-white",
    knobOff: "bg-white",
    focus:
      "focus-visible:ring-blue-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900",
  },
  onDark: {
    on: "bg-white text-blue-700",
    off: "bg-white/30 text-white",
    knobOn: "bg-blue-700",
    knobOff: "bg-white",
    focus:
      "focus-visible:ring-white focus-visible:ring-offset-blue-700 dark:focus-visible:ring-offset-blue-600",
  },
} as const;

export function LabeledSwitch({
  checked,
  onCheckedChange,
  label,
  ariaLabel,
  disabled = false,
  tone = "brand",
  size = "md",
  className = "",
}: LabeledSwitchProps) {
  const s = SIZE[size];
  const c = TONE[tone];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-full font-bold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${s.track} ${
        checked ? `${s.padOn} ${c.on}` : `${s.padOff} ${c.off}`
      } ${c.focus} ${className}`}
    >
      {/* 軌道文字（落在滑塊的反側） */}
      <span className="pointer-events-none">{label}</span>
      {/* 滑塊：純圓鈕、不寫字 */}
      <span
        aria-hidden="true"
        data-testid="labeled-switch-knob"
        className={`pointer-events-none absolute rounded-full shadow transition-[left] duration-200 motion-reduce:transition-none ${s.knob} ${
          checked ? `${s.knobOn} ${c.knobOn}` : `left-1 ${c.knobOff}`
        }`}
      />
    </button>
  );
}

export default LabeledSwitch;
