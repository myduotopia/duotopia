/**
 * 選擇題面板標題列的「預覽」按鈕＋Dialog（Issue #1082）。
 *
 * `QuestionSheet` 已逼近 1000 行，預覽的開關狀態與 Dialog 都放在這裡，sheet 只傳單元進來。
 *
 * - 只看 `single` 單元（題組模式由 sheet 隱藏本按鈕，沿用 `LayoutEditor` 內的題組預覽入口，
 *   避免兩個入口）
 * - 內容：`LayoutPreviewDialog` 的 `questions` 模式 → `QuestionsPreview`，右側所有單題依卡片順序
 *   編號 1..n（題幹、插圖、選項；不含答案、解析、考點）；電腦／手機切換沿用 Dialog 既有機制
 * - 右側一題都沒有內容（無題幹、無題幹插圖、無任何有字或有圖的選項）時 disabled
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
  const questions = useMemo(
    () =>
      units.flatMap((u): QuestionDraft[] =>
        u.kind === "single" ? [u.draft] : [],
      ),
    [units],
  );
  const hasContent = questions.some(
    (q) => draftHasContent(q) || q.options.some(optionFilled),
  );

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
