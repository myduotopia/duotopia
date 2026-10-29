/**
 * 上傳題本・綜合確認畫面（逐題核對，#1112 C4b；設計文件第五節）。按「開始擷取」或提示列「繼續」後
 * 直接進這裡（C4 定案 A1），題目邊處理邊出現；原「處理進度」畫面退場，它的每頁狀態與按鈕在
 * 「原卷第 N 頁」那一行（ExamImportReviewPageRow），「繼續處理」等提示在頂部（ExamImportReviewTop）。
 *
 * 版面（上到下）：
 * - 頂部（不捲動）：整份設定＋藍色進度條＋提示
 * - 中間：左側題號導覽（共用 QuestionNumberNav：琥珀＝缺答案、紅＝失敗、灰虛線＝處理中、藍＝題庫已有／
 *   題目文字相同／本份重複；目前這題粗框淡底；需注意的格子旁有短豎線；標籤＝原卷題號），下方
 *   「需注意 N 題」「跳到下一題」。點題庫已有的格子會打開原題。小螢幕（< md）導覽收起，只留
 *   「需注意 N 題」「跳到下一題」一列（▦ 抽屜在 C4c）。右側捲動區：依原卷頁碼排列的頁與題目卡，
 *   預留「整頁對照原卷」分頁（C4c）的位置
 * - 頁尾：「放棄這次匯入」（紅字次要）、「略過核對，直接存入」（次要，先確認）、「全部儲存」（主按鈕；
 *   還有頁在處理時停用＋說明「還有 N 頁處理中」）
 * 捲動區與頁尾右側 `pr-8 sm:pr-16`：閃避老師後台右側的數位教學工具列（同 ScenarioSheetLayout）。
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/organization/ConfirmDialog";
import {
  QuestionNumberNav,
  type QuestionNumberNavItem,
  type QuestionNumberTone,
} from "@/components/shared/QuestionNumberNav";
import type { Program } from "@/types";
import ExamImportReviewCard from "./ExamImportReviewCard";
import {
  AddCardDialog,
  DuplicateOriginalDialog,
} from "./ExamImportReviewDialogs";
import ExamImportReviewPageRow from "./ExamImportReviewPageRow";
import ExamImportReviewTop from "./ExamImportReviewTop";
import { errorKey } from "./examImportErrors";
import {
  needsAttention,
  pagesInProgress,
  type ReviewEntry,
  type ReviewIssue,
} from "./reviewModel";
import { pageMergeInfo, type ExamImportCard } from "./types";
import type { ExamImportController } from "./useExamImport";
import { useExamImportReview } from "./useExamImportReview";

const TONE: Record<ReviewIssue, QuestionNumberTone> = {
  missing: "warning",
  failed: "error",
  saveFailed: "error",
  duplicate: "info",
  sameStem: "info",
  importDuplicate: "info",
  processing: "pending",
};

interface Props {
  controller: ExamImportController;
  programs: Program[];
  onRequestAbandon: (importId: number) => void;
}

export default function ExamImportReview({
  controller,
  programs,
  onRequestAbandon,
}: Props) {
  const { t } = useTranslation();
  const review = useExamImportReview(controller);
  const { detail, loadingDetail, runError } = controller;
  const [confirmSkip, setConfirmSkip] = useState(false);
  const mergeInfo = useMemo(() => pageMergeInfo(detail?.pages ?? []), [detail]);
  const cardsById = useMemo(() => {
    const map = new Map<string, ExamImportCard>();
    review.pages.forEach((p) => p.cards.forEach((c) => map.set(c.card_id, c)));
    return map;
  }, [review.pages]);
  const labelsByCard = useMemo(() => {
    const map = new Map<string, string[]>();
    review.entries.forEach((e) => {
      if (!e.cardId) return;
      const list = map.get(e.cardId) ?? [];
      list[e.questionIndex] = e.label;
      map.set(e.cardId, list);
    });
    return map;
  }, [review.entries]);

  if (!detail) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-gray-500">
        {loadingDetail ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : runError ? (
          t(errorKey(runError.key), runError.params)
        ) : null}
      </div>
    );
  }

  const issueText = (e: ReviewEntry) => {
    if (e.issue === "processing")
      return t("questionBank.examImport.review.pageProcessing", {
        n: e.pageNo,
      });
    if (!e.issue) return null;
    return t(`questionBank.examImport.review.issue.${e.issue}`);
  };
  const navItems: QuestionNumberNavItem[] = review.entries.map((e) => {
    const text = issueText(e);
    const base = t("questionBank.examImport.review.questionLabel", {
      label: e.label,
    });
    return {
      key: e.key,
      label: e.label,
      tone: e.issue ? TONE[e.issue] : "default",
      marker: needsAttention(e.issue),
      title: text ?? undefined,
      ariaLabel: text ? `${base}，${text}` : base,
    };
  });
  const selectEntry = (key: string) => {
    const entry = review.entries.find((e) => e.key === key);
    if (!entry) return;
    if (!entry.cardId) {
      // 處理中的頁：捲到那一頁
      review.setCurrentKey(key);
      document
        .querySelector(`[data-testid="exam-page-${entry.pageNo}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    review.scrollTo(key);
    const dup = cardsById.get(entry.cardId)?.duplicate_of;
    if (dup?.type === "bank")
      review.showDuplicate({ kind: dup.kind, id: dup.id });
  };

  const inProgress = pagesInProgress(detail);
  const unsavedCards = review.pages.reduce((n, p) => n + p.cards.length, 0);
  const saveDisabledReason =
    inProgress > 0
      ? t("questionBank.examImport.review.saveBlocked", { count: inProgress })
      : unsavedCards === 0
        ? t("questionBank.examImport.review.nothingToSave")
        : null;
  const attentionCount = review.attention.length;

  const attentionBar = (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span
        className={
          attentionCount > 0 ? "font-medium text-amber-700" : "text-gray-500"
        }
        data-testid="exam-review-attention"
      >
        {t("questionBank.examImport.review.attention", {
          count: attentionCount,
        })}
      </span>
      <span
        title={
          attentionCount === 0
            ? t("questionBank.examImport.review.noAttention")
            : undefined
        }
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={review.jumpToNextAttention}
          disabled={attentionCount === 0}
          data-testid="exam-review-next"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          {t("questionBank.examImport.review.next")}
        </Button>
      </span>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="exam-review">
      <div className="shrink-0 border-b border-gray-200 px-6 py-3 pr-8 sm:pr-16">
        <ExamImportReviewTop
          controller={controller}
          review={review}
          programs={programs}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <aside
          className="hidden w-60 shrink-0 flex-col gap-3 overflow-y-auto border-r border-gray-200 p-4 md:flex"
          data-testid="exam-review-nav-panel"
        >
          <QuestionNumberNav
            items={navItems}
            currentKey={review.currentKey}
            onSelect={selectEntry}
            columns={4}
            ariaLabel={t("questionBank.examImport.review.navLabel")}
            testId="exam-review-nav"
          />
          {attentionBar}
        </aside>

        <div
          className="min-h-0 flex-1 overflow-y-auto p-6 pr-8 sm:pr-16"
          data-testid="exam-review-scroll"
        >
          <div className="mb-3 md:hidden">{attentionBar}</div>
          <p
            className="mb-3 text-xs text-gray-500"
            data-testid="exam-review-page-order-hint"
          >
            {t("questionBank.examImport.progress.pageOrderHint")}
          </p>
          <div className="space-y-4">
            {review.pages.map(({ page, cards }) => (
              <section key={page.page_no} className="space-y-2">
                <ExamImportReviewPageRow
                  page={page}
                  hasCards={cards.length > 0}
                  merge={mergeInfo.get(page.page_no)}
                  controller={controller}
                  onAddCard={review.requestAdd}
                />
                {cards.map((card) => (
                  <ExamImportReviewCard
                    key={card.card_id}
                    card={card}
                    pageImageUrl={page.image_url}
                    labels={labelsByCard.get(card.card_id) ?? []}
                    review={review}
                    programs={programs}
                    retryLimit={detail.retry_limits.question_retries}
                    failure={review.failures[card.card_id]}
                  />
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-200 bg-white px-6 py-3 pr-8 sm:pr-16">
        <Button
          type="button"
          variant="outline"
          className="text-red-600 hover:text-red-700"
          onClick={() => onRequestAbandon(detail.id)}
          disabled={review.saving !== null}
          data-testid="exam-review-abandon"
        >
          {t("questionBank.examImport.abandon.button")}
        </Button>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {saveDisabledReason && (
            <span
              className="text-xs text-gray-500"
              data-testid="exam-review-save-reason"
            >
              {saveDisabledReason}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmSkip(true)}
            disabled={review.saving !== null || detail.auto_save === true}
            title={
              detail.auto_save
                ? t("questionBank.examImport.review.skipOn")
                : undefined
            }
            data-testid="exam-review-skip"
          >
            {review.saving === "skip" && (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            )}
            {t("questionBank.examImport.review.skip")}
          </Button>
          <span title={saveDisabledReason ?? undefined}>
            <Button
              type="button"
              onClick={() => void review.saveAll()}
              disabled={saveDisabledReason !== null || review.saving !== null}
              data-testid="exam-review-save"
            >
              {review.saving === "save" && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              {t("questionBank.examImport.review.save")}
            </Button>
          </span>
        </div>
      </div>

      <ConfirmDialog
        open={confirmSkip}
        onOpenChange={setConfirmSkip}
        title={t("questionBank.examImport.review.skipTitle")}
        description={t("questionBank.examImport.review.skipDescription")}
        confirmText={t("questionBank.examImport.review.skipConfirm")}
        cancelText={t("common.cancel", "取消")}
        onConfirm={() => {
          setConfirmSkip(false);
          void review.skipReview();
        }}
      />
      <ConfirmDialog
        open={review.deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) review.requestDelete(null);
        }}
        title={t("questionBank.examImport.review.deleteTitle")}
        description={t("questionBank.examImport.review.deleteDescription")}
        confirmText={t("questionBank.examImport.review.delete")}
        cancelText={t("common.cancel", "取消")}
        variant="destructive"
        onConfirm={() => void review.confirmDelete()}
      />
      <DuplicateOriginalDialog
        target={review.duplicateTarget}
        onClose={() => review.showDuplicate(null)}
      />
      <AddCardDialog
        pageNo={review.addPage}
        onClose={() => review.requestAdd(null)}
        onSubmit={review.addCard}
      />
    </div>
  );
}
