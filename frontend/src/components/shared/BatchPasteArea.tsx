/**
 * BatchPasteArea — 批次貼上文字區域（共用元件）
 *
 * 提供帶行號的 textarea，支援：
 * - 貼上時自動過濾空行並截斷至 maxItems
 * - 行數計數與超限提示
 *
 * @usage
 * <BatchPasteArea
 *   text={text}
 *   onChange={setText}
 *   maxItems={30}
 *   placeholder="apple\nbanana"
 * />
 */
import { useTranslation } from "react-i18next";

export interface BatchPasteAreaProps {
  /** Current textarea value */
  text: string;
  /** Callback when text changes */
  onChange: (text: string) => void;
  /** Maximum number of items (lines) allowed */
  maxItems: number;
  /** Textarea placeholder */
  placeholder?: string;
  /** Label text override (defaults to i18n contentEditor.labels.pasteContent) */
  label?: string;
  /** Whether to show line numbers (desktop inline mode). Default: true */
  showLineNumbers?: boolean;
  /** Variant: "inline" for desktop left panel, "dialog" for mobile modal */
  variant?: "inline" | "dialog";
}

export function BatchPasteArea({
  text,
  onChange,
  maxItems,
  placeholder = "apple\nbanana\norange",
  label,
  showLineNumbers = true,
  variant = "inline",
}: BatchPasteAreaProps) {
  const { t } = useTranslation();
  const lines = text.split("\n");
  const lineCount = lines.filter((line: string) => line.trim()).length;
  const overLimit = lineCount > maxItems;

  const handleChange = (newValue: string) => {
    const newLines = newValue.split("\n");
    const prevLineCount = text.split("\n").length;
    const isPaste = newLines.length - prevLineCount > 1;

    if (isPaste) {
      const filtered = newLines
        .filter((l: string) => l.trim())
        .slice(0, maxItems);
      onChange(filtered.join("\n"));
    } else if (newLines.length > maxItems) {
      onChange(newLines.slice(0, maxItems).join("\n"));
    } else {
      onChange(newValue);
    }
  };

  const displayLabel = label || t("contentEditor.labels.pasteContent");

  if (variant === "dialog") {
    return (
      <div>
        <label className="text-base font-semibold text-gray-800 mb-3 block">
          {displayLabel}
        </label>
        <textarea
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          className="w-full min-h-80 max-h-[60vh] px-4 py-3 border-2 border-gray-300 rounded-lg font-mono text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all resize-y overflow-y-auto"
        />
        <div className="text-xs mt-2 flex items-center justify-between">
          <span className="text-gray-500">
            {lineCount || 0} {t("contentEditor.messages.items")}
          </span>
          {overLimit && (
            <span className="text-amber-600 font-medium">
              {t("contentEditor.messages.batchLimitWarning", {
                count: maxItems,
              })}
            </span>
          )}
        </div>
      </div>
    );
  }

  // inline variant (desktop left panel with line numbers)
  return (
    <>
      <label className="text-sm font-semibold text-gray-800">
        {displayLabel}
      </label>
      <div
        className="flex-1 min-h-[calc(1.625rem*8+1rem)] max-h-[calc(1.625rem*10+1rem)] border border-gray-300 rounded-lg focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-200 transition-all overflow-y-auto cursor-text"
        onClick={(e) => {
          const ta = (e.currentTarget as HTMLElement).querySelector("textarea");
          if (ta) ta.focus();
        }}
      >
        <div className="flex">
          {showLineNumbers && (
            <div className="flex flex-col py-2 px-2 text-gray-300 font-mono text-sm select-none min-w-[2rem] text-right sticky left-0">
              {Array.from({ length: Math.max(lines.length, 1) }, (_, i) => (
                <div key={i} className="leading-[1.625rem]">
                  {i + 1}
                </div>
              ))}
            </div>
          )}
          <textarea
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 px-3 py-2 font-mono text-sm resize-none outline-none leading-[1.625rem] overflow-y-auto"
            style={{
              height: `${Math.max(lines.length, 8) * 1.625 + 1}rem`,
            }}
          />
        </div>
      </div>
      <div
        className={`text-xs ${overLimit ? "text-red-500 font-medium" : "text-gray-500"}`}
      >
        {lineCount || 0} {t("contentEditor.messages.items")}
        {` / ${maxItems}`}
        {overLimit &&
          ` (${t("contentEditor.messages.batchPasteLimitShort", { count: maxItems })})`}
      </div>
    </>
  );
}
