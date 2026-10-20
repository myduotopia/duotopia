/**
 * QuestionDots — 情境對話的題號小點點，快速捲到某一題（#1133）。
 *
 * - 手機（< lg）：標題列下方一排橫向（orientation="horizontal"）；
 *   電腦（≥ lg）：對話欄左側直向一排（orientation="vertical"）。
 * - 狀態：已出現過的題目＝藍色實心、可點；目前這題＝藍色外框放大；
 *   還沒到的題目＝灰色。學生點灰點不會動，跳一行小提示「還沒到這題」
 *   （手機沒有 hover，所以不用 disabled 屬性，而是點了說明原因）。
 * - 學生：點了只捲到那一題，不改變作答進度（由外層 onSelect 處理）。
 * - 老師預覽（allowAll）：每個點都能點，外層用來跳題（沿用「略過」邏輯）。
 * - 觸控目標 44px，視覺上是小圓點。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface Props {
  total: number;
  revealedCount: number;
  /** 目前進行中的題目；開始前傳 null */
  current: number | null;
  allowAll: boolean;
  orientation: "horizontal" | "vertical";
  onSelect: (index: number) => void;
  className?: string;
}

const HINT_MS = 2000;

export function QuestionDots({
  total,
  revealedCount,
  current,
  allowAll,
  orientation,
  onSelect,
  className,
}: Props) {
  const { t } = useTranslation();
  const [hint, setHint] = useState(false);
  const vertical = orientation === "vertical";

  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(id);
  }, [hint]);

  return (
    <nav
      className={cn(
        "flex items-center",
        vertical ? "flex-col" : "flex-row flex-wrap gap-x-2",
        className,
      )}
      aria-label={t("scenarioDialogue.chat.questionNav")}
    >
      <div className={cn("flex items-center", vertical && "flex-col")}>
        {Array.from({ length: total }, (_, i) => {
          const reached = i < revealedCount;
          const isCurrent = i === current;
          const locked = !reached && !allowAll;
          return (
            <button
              key={i}
              type="button"
              className="flex h-11 w-9 items-center justify-center"
              onClick={() => (locked ? setHint(true) : onSelect(i))}
              aria-disabled={locked}
              aria-current={isCurrent ? "step" : undefined}
              aria-label={
                locked
                  ? t("scenarioDialogue.chat.dotLocked", { no: i + 1 })
                  : allowAll
                    ? t("scenarioDialogue.chat.jumpToNo", { no: i + 1 })
                    : t("scenarioDialogue.chat.goToNo", { no: i + 1 })
              }
            >
              <span
                className={cn(
                  "block rounded-full transition-all",
                  isCurrent
                    ? "h-4 w-4 border-2 border-blue-600 bg-white"
                    : reached
                      ? "h-2.5 w-2.5 bg-blue-600"
                      : "h-2.5 w-2.5 bg-gray-300",
                )}
              />
            </button>
          );
        })}
      </div>
      {hint && (
        <p
          className={cn(
            "text-xs text-gray-500",
            vertical && "w-12 text-center",
          )}
          role="status"
        >
          {t("scenarioDialogue.chat.notYet")}
        </p>
      )}
    </nav>
  );
}
