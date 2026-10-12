/**
 * 題庫列表共用的小格子（#1082 自 QuestionBankTab 拆出）。
 *
 * - ChipCell：chip 列純顯示，沒有值顯示「—」
 * - InlineVisibility：公開設定平常是文字，點了才出現下拉
 * - OptionGrid：選擇題選項預覽（短→一列四格、長→兩欄）；只有圖沒有字的選項顯示「(圖片)」
 * - formatGrade：年級只顯示數字
 * - programLinkLabel：教材欄 chip 文字（教材名 › 單元名）
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  VisibilitySelect,
  visibilityLabelKey,
} from "@/components/shared/VisibilitySelect";
import type {
  Question,
  QuestionProgramLink,
  QuestionVisibility,
} from "@/types/questionBank";

/** 表格格子的純顯示：chip 列；沒有值顯示「—」。點整格才開選單（由外層 renderTrigger 包） */
export function ChipCell({ labels }: { labels: string[] }) {
  if (labels.length === 0) return <span className="text-gray-300 px-1">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((l, i) => (
        <span
          key={`${l}-${i}`}
          className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 max-w-full truncate"
          title={l}
        >
          {l}
        </span>
      ))}
    </div>
  );
}

/** 公開設定：平常顯示文字，點了才出現下拉（自動展開），選完或關閉就回純顯示 */
export function InlineVisibility({
  value,
  onChange,
  scope,
  disabled,
  testId,
}: {
  value: QuestionVisibility;
  onChange: (v: QuestionVisibility) => void;
  scope: "personal" | "organization";
  disabled: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="text-left w-full rounded px-1 py-0.5 hover:bg-gray-100 disabled:cursor-default disabled:hover:bg-transparent"
        data-testid={`${testId}-display`}
      >
        {t(visibilityLabelKey(value, scope))}
      </button>
    );
  }
  return (
    <VisibilitySelect
      value={value}
      onChange={(v) => {
        onChange(v);
        setEditing(false);
      }}
      scope={scope}
      disabled={disabled}
      defaultOpen
      onOpenChange={(open) => {
        if (!open) setEditing(false);
      }}
      data-testid={testId}
    />
  );
}

/** 選項全都短（≤ 12 字）且不超過 4 個 → 一列四格；否則兩欄 */
const SHORT_OPTION_CHARS = 12;

/**
 * 列表要顯示的選項文字：沒有字只有圖的選項（#1084 圖片選項）顯示「(圖片)」。
 * 「(圖片)」算短字，不會把一列四格擠成兩欄。
 */
export function optionCellText(
  o: { text: string; image_url: string | null },
  imageLabel: string,
): string {
  const text = o.text.trim();
  if (text) return text;
  return o.image_url ? imageLabel : "";
}

export function OptionGrid({ options }: { options: Question["options"] }) {
  const { t } = useTranslation();
  const imageLabel = t("questionBank.list.imageOption");
  const texts = options.map((o) => optionCellText(o, imageLabel));
  const oneRow =
    options.length <= 4 &&
    // 「(圖片)」當短字：圖片選項的列表一樣排成一列四格
    texts.every(
      (text) => text === imageLabel || text.trim().length <= SHORT_OPTION_CHARS,
    );
  return (
    <div
      className={`mt-1 grid gap-x-3 gap-y-0.5 text-xs text-gray-600 ${
        oneRow ? "grid-cols-4" : "grid-cols-2"
      }`}
      data-testid="qb-option-grid"
      data-layout={oneRow ? "1x4" : "2x2"}
    >
      {options.map((o, i) => (
        <span key={o.id} className="truncate" title={texts[i]}>
          {String.fromCharCode(65 + i)}.{" "}
          {o.is_correct ? (
            <span className="rounded bg-yellow-100 px-1 text-yellow-900">
              {texts[i]}
            </span>
          ) : (
            texts[i]
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * 教材欄 chip 文字：有單元 → 「教材名 › 單元名」，否則只有教材名。
 * 舊回應沒有名稱時退回 id，過長由 ChipCell 的 truncate + title 處理。
 */
export function programLinkLabel(link: QuestionProgramLink): string {
  const program = link.program_name || `#${link.program_id}`;
  return link.lesson_name ? `${program} › ${link.lesson_name}` : program;
}

/** 年級只顯示數字（中英文相同）：7–9、7、不限 — */
export function formatGrade(min: number | null, max: number | null): string {
  if (min === null && max === null) return "—";
  if (min !== null && max !== null && min !== max) return `${min}–${max}`;
  return String(min ?? max);
}
