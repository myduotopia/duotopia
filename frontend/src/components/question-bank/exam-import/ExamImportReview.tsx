/**
 * 上傳題本・綜合確認畫面（逐題核對，#1112 C4b／C4c；設計文件第五節）。按「開始擷取」或提示列「繼續」後
 * 直接進這裡（C4 定案 A1），題目邊處理邊出現；原「處理進度」畫面退場，它的每頁狀態與按鈕在
 * 「原卷第 N 頁」那一行（ExamImportReviewPageRow），「繼續處理」等提示在頂部（ExamImportReviewTop）。
 *
 * 版面（上到下；C4c 把空間留給考卷閱讀，維持整份考卷一路往下看）：
 * - 頂部（不捲動）：一行整份設定摘要＋「編輯設定 ▾」＋細進度線＋有才出現的提示（ExamImportReviewTop）
 * - 題號列（不捲動）：左邊分頁「逐題核對／整頁對照原卷」（Tabs；手機 < md 不顯示，視窗變窄時自動回到
 *   逐題核對，U3），右邊在逐題核對時是「第 [N ▾] 題・還有 M 題待核對」＋「需注意 K 題 ‹ ›」
 *   （ExamImportQuestionPicker；左側題號方格 QuestionNumberNav 已移除），N 隨捲動更新（useReviewScrollSpy）；
 *   在整頁對照時換成「‹ 第 N／總 頁 ›」（E1）。
 * - 逐題核對：頁碼說明小字、依原卷頁碼排列的頁與題目卡；考卷最寬約 920px 置中（E7）
 * - 整頁對照原卷（ExamImportCompareView）：左原卷頁圖＋題目框、右該頁題目（可原位編輯，U2）。
 *   切過去開目前這題所在的頁，切回捲到那一頁的第一題（E1）；有題目正在編輯時換分頁、換頁都先存回草稿，
 *   存不進去就不換（E9）。
 * - 頁尾：「放棄這次匯入」（紅字次要）、「略過核對，直接存入」（次要，先確認）、「全部儲存」（主按鈕；
 *   還有頁在處理時停用＋說明「還有 N 頁處理中」；還沒處理的頁要重選檔案才能送時說明「請先重選檔案」，
 *   C4b 審查 8）。按存入或略過核對時整份設定還缺必填 → 不送、展開設定並把焦點放到第一個缺的欄位（E5）。
 *   手機（< sm，U5）：三個按鈕一排短字「放棄／略過核對／全部儲存」，完整文字放 aria-label／title，
 *   停用原因另起一行小字；確認視窗照舊。
 * - 題目卡另外帶 `locked`（頁上最後一張題組、下一頁還沒處理完 → 不能編輯）與 `unmergedContinuation`
 *   （延續上一頁卻沒自動合併）說明。
 * 捲動區與頁尾右側 `pr-8 sm:pr-16`：閃避老師後台右側的數位教學工具列（同 ScenarioSheetLayout）。
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/organization/ConfirmDialog";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { Program } from "@/types";
import ExamImportCompareView, {
  ExamImportComparePager,
} from "./ExamImportCompareView";
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

type ReviewTab = "questions" | "compare";

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
  const scrollRef = review.scrollRootRef;
  const mergeInfo = useMemo(() => pageMergeInfo(detail?.pages ?? []), [detail]);
  const missing = missingSettings(detail?.settings, review.grade);
  // 分頁：逐題核對／整頁對照原卷（手機 < md 不顯示整頁對照，U3）
  const [tab, setTab] = useState<ReviewTab>("questions");
  const [comparePage, setComparePage] = useState(1);
  const wide = useMediaQuery("(min-width: 768px)");
  const comparing = tab === "compare" && wide;
  useEffect(() => {
    if (!wide) setTab("questions");
  }, [wide]);
  const comparePos = review.pages.findIndex(
    (p) => p.page.page_no === comparePage,
  );
  useReviewScrollSpy({
    rootRef: scrollRef,
    entries: review.entries,
    enabled: !comparing,
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

  /**
   * 換分頁（E1／E9）：有題目正在編輯先存回草稿，存不進去就不換。切到整頁對照開目前這題所在的頁；
   * 切回逐題核對捲到那一頁的第一題。
   */
  const switchTab = async (next: ReviewTab) => {
    if (next === tab) return;
    if (review.editing && !(await review.finishEditing())) return;
    if (next === "compare") {
      const at = review.entries.find((e) => e.key === review.currentKey);
      const firstWithCards = review.pages.find((p) => p.cards.length > 0);
      setComparePage(
        at?.pageNo ??
          firstWithCards?.page.page_no ??
          review.pages[0]?.page.page_no ??
          1,
      );
      setTab("compare");
      return;
    }
    setTab("questions");
    const first = review.entries.find(
      (e) => e.cardId && e.pageNo === comparePage,
    );
    window.setTimeout(() => {
      if (first) review.scrollTo(first.key);
      else
        document
          .querySelector(`[data-testid="exam-page-${comparePage}"]`)
          ?.scrollIntoView({ block: "start" });
    }, 0);
  };

  /** 整頁對照換頁：編輯中的題先存回，存不進去就不換 */
  const moveComparePage = async (dir: 1 | -1) => {
    const target = review.pages[comparePos + dir];
    if (!target) return;
    if (review.editing && !(await review.finishEditing())) return;
    setComparePage(target.page.page_no);
  };

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
        <Tabs value={tab} onValueChange={(v) => void switchTab(v as ReviewTab)}>
          <TabsList
            className="hidden h-9 md:inline-flex"
            data-testid="exam-review-tabs"
          >
            <TabsTrigger
              value="questions"
              data-testid="exam-review-tab-questions"
            >
              {t("questionBank.examImport.review.tabs.questions")}
            </TabsTrigger>
            <TabsTrigger value="compare" data-testid="exam-review-tab-compare">
              {t("questionBank.examImport.review.tabs.compare")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {comparing && comparePos >= 0 ? (
          <ExamImportComparePager
            pageNo={review.pages[comparePos].page.page_no}
            total={detail.page_count}
            canPrev={comparePos > 0}
            canNext={comparePos < review.pages.length - 1}
            onMove={(dir) => void moveComparePage(dir)}
          />
        ) : (
          <ExamImportQuestionPicker
            entries={review.entries}
            currentKey={review.currentKey}
            statusOf={statusOf}
            remaining={remaining}
            attentionCount={review.attention.length}
            onPick={review.scrollTo}
            onAttention={review.jumpToAttention}
          />
        )}
      </div>

      {comparing ? (
        <ExamImportCompareView
          controller={controller}
          review={review}
          programs={programs}
          pageNo={comparePage}
          merge={mergeInfo.get(comparePage)}
          labelsByCard={labelsByCard}
        />
      ) : (
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
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-200 bg-white px-4 py-3 pr-8 sm:px-6 sm:pr-16">
        {/* 手機：按鈕一排短字，停用原因另起一行（U5） */}
        {(saveDisabledReason || detail.auto_save) && (
          <p
            className="w-full text-right text-xs text-gray-500 sm:hidden"
            data-testid="exam-review-save-reason-mobile"
          >
            {saveDisabledReason ?? t("questionBank.examImport.review.skipOn")}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          className="text-red-600 hover:text-red-700"
          onClick={() => onRequestAbandon(detail.id)}
          disabled={review.saving !== null}
          aria-label={t("questionBank.examImport.abandon.button")}
          title={t("questionBank.examImport.abandon.button")}
          data-testid="exam-review-abandon"
        >
          <span className="sm:hidden">
            {t("questionBank.examImport.review.short.abandon")}
          </span>
          <span className="hidden sm:inline">
            {t("questionBank.examImport.abandon.button")}
          </span>
        </Button>
        <div className="ml-auto flex items-center justify-end gap-2">
          {saveDisabledReason && (
            <span
              className="hidden text-xs text-gray-500 sm:inline"
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
            aria-label={t("questionBank.examImport.review.skip")}
            title={
              detail.auto_save
                ? t("questionBank.examImport.review.skipOn")
                : t("questionBank.examImport.review.skip")
            }
            data-testid="exam-review-skip"
          >
            {review.saving === "skip" && (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            )}
            <span className="sm:hidden">
              {t("questionBank.examImport.review.short.skip")}
            </span>
            <span className="hidden sm:inline">
              {t("questionBank.examImport.review.skip")}
            </span>
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
