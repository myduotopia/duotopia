/**
 * 選項型步驟的直排選項卡（Issue #1158 C 段 commit 3，從 `ScenarioSetupChat.tsx` 抽出；
 * 原為 #1146 第 3 輪）。
 *
 * 等寬、左對齊、粗體主句＋可選的灰色說明行。選項文字變長後橫排按鈕會換行換得很亂，
 * 直排比較好讀。說明行以 `aria-describedby` 掛上，不併入按鈕名稱（按鈕名稱＝主句，
 * 老師泡泡也只顯示主句）。sm 以上內縮 `pl-9`，對齊機器人泡泡的文字。
 *
 * 用法：
 * ```tsx
 * <ChoiceCards
 *   options={[{ value: "none", label: "不需要" }, { value: "existing", label: "我有現成的", hint: "…" }]}
 *   onChoose={(v) => answer("mode", v)}
 * />
 * ```
 */
import { useId } from "react";
import { Button } from "@/components/ui/button";

export interface ChoiceOption<T extends string> {
  value: T;
  /** 粗體主句 —— 也是按鈕的無障礙名稱 */
  label: string;
  /** 選填的灰色說明行 */
  hint?: string;
}

export function ChoiceCards<T extends string>({
  options,
  onChoose,
}: {
  options: ChoiceOption<T>[];
  onChoose: (value: T) => void;
}) {
  const idPrefix = useId();
  return (
    <div className="flex max-w-xl flex-col gap-2 sm:pl-9">
      {options.map((opt) => {
        const hintId = opt.hint ? `${idPrefix}-${opt.value}` : undefined;
        return (
          <Button
            key={opt.value}
            variant="outline"
            aria-label={opt.label}
            aria-describedby={hintId}
            onClick={() => onChoose(opt.value)}
            className="h-auto w-full flex-col items-start justify-start gap-0.5 whitespace-normal px-4 py-3 text-left"
          >
            <span className="text-sm font-semibold text-gray-800">
              {opt.label}
            </span>
            {opt.hint && (
              <span id={hintId} className="text-xs font-normal text-gray-500">
                {opt.hint}
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
}
