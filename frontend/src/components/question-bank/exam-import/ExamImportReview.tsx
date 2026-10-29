/**
 * 上傳題本・綜合確認畫面（逐題核對，#1112 C4b／C4c；設計文件第五節）。按「開始擷取」或提示列「繼續」後
 * 直接進這裡（C4 定案 A1），題目邊處理邊出現；原「處理進度」畫面退場，它的每頁狀態與按鈕在
 * 「原卷第 N 頁」那一行（ExamImportReviewPageRow），「繼續處理」等提示在頂部（ExamImportReviewTop）。
 *
 * 版面（上到下；C4c 把空間留給考卷閱讀，維持整份考卷一路往下看）：
 * - 頂部（不捲動）：一行整份設定摘要＋「編輯設定 ▾」＋細進度線＋有才出現的提示（ExamImportReviewTop）
 * - 題號列（不捲動）：「第 [N ▾] 題・還有 M 題待核對」＋「需注意 K 題 ‹ ›」（ExamImportQuestionPicker；
 *   左側題號方格 QuestionNumberNav 已移除）。N 隨捲動更新（useReviewScrollSpy）。
 * - 捲動區：頁碼說明小字、依原卷頁碼排列的頁與題目卡；考卷最寬約 920px 置中（E7）
 * - 頁尾：「放棄這次匯入」（紅字次要）、「略過核對，直接存入」（次要，先確認）、「全部儲存」（主按鈕；
 *   還有頁在處理時停用＋說明「還有 N 頁處理中」；還沒處理的頁要重選檔案才能送時說明「請先重選檔案」，
 *   C4b 審查 8）。按存入或略過核對時整份設定還缺必填 → 不送、展開設定並把焦點放到第一個缺的欄位（E5）。
 * - 題目卡另外帶 `locked`（頁上最後一張題組、下一頁還沒處理完 → 不能編輯）與 `unmergedContinuation`
 *   （延續上一頁卻沒自動合併）說明。
 * 捲動區與頁尾右側 `pr-8 sm:pr-16`：閃避老師後台右側的數位教學工具列（同 ScenarioSheetLayout）。
 */
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/organization/ConfirmDialog";
import type { Program } from "@/types";
import ExamImportQuestionPicker from "./ExamImportQuestionPicker";
import ExamImportReviewCard from "./ExamImportReviewCard";
import {
  AddCardDialog,
  DuplicateOriginalDialog,
} from "./ExamImportReviewDialogs";
import ExamImportReviewPageRow from "./ExamImportReviewPageRow";
import ExamImportReviewTop from "./ExamImportReviewTop";
import { errorKey } from "./examImportErrors";
import {
  continuationNotMerged,
  missingSettings,
  pagesInProgress,
  pickerStatus,
  type ReviewEntry,
} from "./reviewModel";
import { pageMergeInfo } from "./types";
import type { ExamImportController } from "./useExamImport";
import { useExamImportReview } from "./useExamImportReview";
import { useReviewScrollSpy } from "./useReviewScrollSpy";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mergeInfo = useMemo(() => pageMergeInfo(detail?.pages ?? []), [detail]);
  const missing = missingSettings(detail?.settings, review.grade);
  useReviewScrollSpy({
    rootRef: scrollRef,
    entries: review.entries,
    enabled: true,
    onCurrent: review.setCurrentKey,
    pausedAtRef: review.jumpedAtRef,
    version: review.editing?.cardId,
  });
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

  const statusOf = (e: ReviewEntry) =>
    pickerStatus(
      e,
      e.cardId ? review.failures[e.cardId] : undefined,
      e.cardId ? review.locked.has(e.cardId) : false,
    );
  const remaining = review.entries.filter((e) => e.cardId).length;

  const inProgress = pagesInProgress(detail);
  const unsavedCards = review.pages.reduce((n, p) => n + p.cards.length, 0);
  const saveDisabledReason =
    inProgress > 0 && controller.needsFile
      ? t("questionBank.examImport.review.saveNeedsFile")
      : inProgress > 0
        ? t("questionBank.examImport.review.saveBlocked", { count: inProgress })
        : unsavedCards === 0
          ? t("questionBank.examImport.review.nothingToSave")
          : null;

  /** 存入前檢查整份設定：缺必填 → 展開設定、焦點到第一個缺的欄位，不送（E5） */
  const settingsReady = () => {
    if (missing.length === 0) return true;
    setSettingsOpen(true);
    setFocusRequest((n) => n + 1);
    toast.info(t(errorKey("settingsIncomplete")));
    return false;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="exam-review">
      <div className="shrink-0 border-b border-gray-200">
        <ExamImportReviewTop
          controller={controller}
          review={review}
          programs={programs}
          expanded={settingsOpen}
          onToggle={() => setSettingsOpen((o) => !o)}
          missing={missing}
          focusRequest={focusRequest}
        />
      </div>

      <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 px-4 py-2 pr-8 sm:px-6 sm:pr-16">
        <ExamImportQuestionPicker
          entries={review.entries}
          currentKey={review.currentKey}
          statusOf={statusOf}
          remaining={remaining}
          attentionCount={review.attention.length}
          onPick={review.scrollTo}
          onAttention={review.jumpToAttention}
        />
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pr-8 sm:px-6 sm:pr-16"
        data-testid="exam-review-scroll"
      >
        <div className="mx-auto max-w-[920px]">
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
                    locked={review.locked.has(card.card_id)}
                    unmergedContinuation={continuationNotMerged(detail, card)}
                  />
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-200 bg-white px-4 py-3 pr-8 sm:px-6 sm:pr-16">
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
            onClick={() => {
              if (settingsReady()) setConfirmSkip(true);
            }}
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
              onClick={() => {
                if (settingsReady()) void review.saveAll();
              }}
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
