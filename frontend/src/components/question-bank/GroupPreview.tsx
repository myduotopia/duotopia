/**
 * 題組完整預覽（Issue #1082）：主圖文＋小題＋選項，**不含答案**。
 *
 * 老師按「預覽」看到的就是學生拿到的整個題組；之後學生端作答畫面（P4）也以這個元件為基礎，
 * 所以它是純展示：不顯示正確答案、解析、考點，也不吃任何編輯狀態。
 *
 * - 上：主圖文用共用 `LayoutRenderer`（含單字註解、圖片點擊放大）。沒有 layout 時退回顯示
 *   題組圖（`image_url`）、`passage_text` 與單字註解（共用 `GlossaryBox`）
 * - 下：小題列表交給共用 `QuestionsPreview`（選擇題面板的預覽也用它）
 *   - 閱讀題組依陣列順序 1..n；克漏字依 `blank_index` 排序、顯示徽章「空格 n」且不顯示題幹；
 *     小題指向的空格已不在文章裡（或沒有編號）時顯示「找不到空格」標記
 *   - 題幹／選項的規則（無字無圖不顯示、2×2／直排、圖片可放大）見 `QuestionsPreview`
 * - 根元素 `break-words`，長單字／網址不撐破版面
 * - 全空（無主圖文、無小題）顯示「還沒有內容」
 */

import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import LayoutRenderer, {
  GlossaryBox,
  InlineText,
  ZoomableImage,
} from "./LayoutRenderer";
import QuestionsPreview from "./QuestionsPreview";
import {
  clozeOrphanBlanksOf,
  sortClozeQuestions,
  type GroupDraft,
} from "./questionDraft";

/** 預覽只需要的欄位；`GroupDraft` 可直接傳入 */
export type GroupPreviewData = Pick<
  GroupDraft,
  | "question_type"
  | "layout"
  | "glossary"
  | "image_url"
  | "passage_text"
  | "questions"
>;

export interface GroupPreviewProps {
  draft: GroupPreviewData;
  /** 手機預覽：主圖文欄位堆疊、選項一律直排 */
  forceStack?: boolean;
  className?: string;
  testId?: string;
}

export default function GroupPreview({
  draft,
  forceStack = false,
  className,
  testId = "group-preview",
}: GroupPreviewProps) {
  const { t } = useTranslation();
  const cloze = draft.question_type === "cloze";
  const questions = cloze
    ? sortClozeQuestions(draft.questions)
    : draft.questions;
  const hasLayout = Boolean(draft.layout && draft.layout.rows.length > 0);
  const passage = draft.passage_text.trim();
  // 文章裡已找不到的空格（老師刪掉了 {{n}}）；clozeOrphanBlanksOf 只讀 question_type／layout／questions
  const missingBlanks = cloze ? clozeOrphanBlanksOf(draft as GroupDraft) : [];
  const hasStimulus = hasLayout || Boolean(draft.image_url) || passage !== "";

  if (!hasStimulus && questions.length === 0) {
    return (
      <p
        className="py-8 text-center text-sm text-gray-400"
        data-testid={`${testId}-empty`}
      >
        {t("questionBank.group.layout.empty")}
      </p>
    );
  }

  return (
    <div
      className={cn(
        "space-y-6 break-words text-[15px] text-gray-900",
        className,
      )}
      data-testid={testId}
    >
      {hasLayout ? (
        <LayoutRenderer
          layout={draft.layout}
          glossary={draft.glossary}
          forceStack={forceStack}
        />
      ) : (
        hasStimulus && (
          <div className="space-y-3" data-testid={`${testId}-fallback`}>
            {draft.image_url && (
              <div className="flex justify-center">
                <ZoomableImage
                  src={draft.image_url}
                  className="h-auto max-w-full"
                />
              </div>
            )}
            {passage && (
              <p className="whitespace-pre-wrap leading-relaxed">
                <InlineText text={draft.passage_text} />
              </p>
            )}
            <GlossaryBox glossary={draft.glossary} />
          </div>
        )
      )}
      {questions.length > 0 && (
        <section
          className={cn("space-y-4", hasStimulus && "border-t pt-4")}
          data-testid={`${testId}-questions`}
        >
          <h3 className="text-sm font-semibold text-gray-500">
            {t("questionBank.group.preview.questionsTitle")}
          </h3>
          <QuestionsPreview
            questions={questions}
            numbering={cloze ? "blank" : "sequential"}
            missingBlanks={missingBlanks}
            forceStack={forceStack}
            testId={testId}
          />
        </section>
      )}
    </div>
  );
}
