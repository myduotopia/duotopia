/**
 * 題庫面板標題列的「預覽」按鈕＋Dialog（Issue #1082）。
 *
 * `QuestionSheet` 已逼近 1000 行，預覽的開關狀態與 Dialog 都放在這裡，sheet 只傳單元進來。
 * 選擇題、閱讀題組、克漏字題組都用這一顆（位置、樣式、testid `qb-preview` 一致）；
 * 排版編輯器（`LayoutEditor`）工具列不再有預覽入口。
 *
 * - 單題模式（`units` 沒有 group 單元）：`LayoutPreviewDialog` 的 `questions` 模式 →
 *   `QuestionsPreview`，右側「有內容」的單題依卡片順序編號 1..n（題幹、插圖、選項；不含答案、
 *   解析、考點）；完全空白的卡片略過、不佔編號。「有內容」＝有題幹、題幹插圖或任何有字或有圖的
 *   選項（`draftHasContent` 或 `optionFilled`）
 * - 題組模式（`units` 有 group 單元，一個面板只有一個題組）：`LayoutPreviewDialog` 的 `draft`
 *   模式 → `GroupPreview`（主圖文＋小題＋選項，不含答案）。讀的是 sheet 的題組草稿；排版編輯器
 *   每次編輯都即時 `onChange` 回草稿，所以內容就是編輯器當下的樣子
 * - 電腦／手機切換沿用 Dialog 既有機制
 * - disabled：`disabled`（sheet 傳 `busy`：儲存／語音／AI 進行中），或沒有可預覽的內容——
 *   單題模式一題都沒有內容；題組模式 `groupPreviewHasContent` 為否（無排版、無題組圖、無文字版、
 *   無有效註解、無小題）
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import LayoutPreviewDialog from "./LayoutPreviewDialog";
import { groupPreviewHasContent } from "./GroupPreview";
import {
  draftHasContent,
  optionFilled,
  type GroupDraft,
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
  // 題組模式：面板只有一個題組單元
  const group = useMemo(
    () =>
      units.find(
        (u): u is { kind: "group"; draft: GroupDraft } => u.kind === "group",
      )?.draft ?? null,
    [units],
  );
  // 單題模式：只送「有內容」的單題；完全空白的卡片不出現、不佔編號
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
  const hasContent = group
    ? groupPreviewHasContent(group)
    : questions.length > 0;

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
      {group ? (
        <LayoutPreviewDialog
          open={open}
          onOpenChange={setOpen}
          draft={group}
          testId="qb-preview-panel"
        />
      ) : (
        <LayoutPreviewDialog
          open={open}
          onOpenChange={setOpen}
          questions={questions}
          testId="qb-preview-panel"
        />
      )}
    </>
  );
}
