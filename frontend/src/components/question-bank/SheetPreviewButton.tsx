/**
 * 選擇題面板標題列的「預覽」按鈕＋Dialog（Issue #1082）。
 *
 * `QuestionSheet` 已逼近 1000 行，預覽的開關狀態與 Dialog 都放在這裡，sheet 只傳單元進來。
 *
 * - 只看 `single` 單元（題組模式由 sheet 隱藏本按鈕，沿用 `LayoutEditor` 內的題組預覽入口，
 *   避免兩個入口）
 * - 內容：`LayoutPreviewDialog` 的 `questions` 模式 → `QuestionsPreview`，右側「有內容」的單題依
 *   卡片順序編號 1..n（題幹、插圖、選項；不含答案、解析、考點）；完全空白的卡片略過、不佔編號；
 *   電腦／手機切換沿用 Dialog 既有機制
 * - 「有內容」＝有題幹、題幹插圖或任何有字或有圖的選項（`draftHasContent` 或 `optionFilled`）
 * - 一題都沒有內容，或 `disabled`（sheet 傳 `busy`：儲存／語音／AI 進行中）時按鈕 disabled
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import LayoutPreviewDialog from "./LayoutPreviewDialog";
import {
  draftHasContent,
  optionFilled,
  type QuestionDraft,
  type UnitDraft,
} from "./questionDraft";

export interface SheetPreviewButtonProps {
  units: UnitDraft[];
  disabled?: boolean;
}

export default function SheetPreviewButton({
  units,
  disabled = false,
}: SheetPreviewButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // 只送「有內容」的單題；完全空白的卡片不出現、不佔編號
  const questions = useMemo(
    () =>
      units.flatMap((u): QuestionDraft[] =>
        u.kind === "single" &&
        (draftHasContent(u.draft) || u.draft.options.some(optionFilled))
          ? [u.draft]
          : [],
      ),
    [units],
  );
  const hasContent = questions.length > 0;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="gap-1"
        onClick={() => setOpen(true)}
        disabled={disabled || !hasContent}
        data-testid="qb-preview"
      >
        <Eye size={16} />
        {t("questionBank.group.layout.preview")}
      </Button>
      <LayoutPreviewDialog
        open={open}
        onOpenChange={setOpen}
        questions={questions}
        testId="qb-preview-panel"
      />
    </>
  );
}
