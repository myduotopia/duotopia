/**
 * 上傳題本核對畫面・「原卷第 N 頁」換頁那一行（#1112 C4b；C4 定案 A1：原進度畫面每頁的狀態與按鈕
 * 搬到這裡，ExamImportProgress 退場）。
 *
 * - 虛線＋「原卷第 N 頁」＋小縮圖（本機畫好的頁圖，沒有就用後端存的頁圖；ZoomableImage 點開放大）
 * - 狀態 Badge：處理中／等待中／空白頁略過／失敗／答案頁；完成的頁依 `pageMergeInfo` 說明
 *   0 題原因：「已併入第 N 頁的題組（第 a–b 題）」（題號取不到省略括號）、「完成・擷取 N 題（跨第
 *   a–b 頁）」、「沒有題目」。有題的一般頁不另外標（題目就在下面）
 * - 按鈕：空白頁「仍要送出這一頁」（用後端存好的頁圖）；失敗頁、處理中超過 3 分鐘、被擋下仍待處理的頁
 *   「重送這一頁」（沒有檔案時上方會請老師先選檔案）；重送次數用完 → 紅字「這一頁讀不出來，請手動補題」
 *   ＋「手動補一題」。處理完的頁也有小字按鈕「手動補一題」（擷取時漏掉的題）
 * - 處理中、等待中的頁：下方「第 N 頁處理中…」＋灰色佔位條（設計文件第五節）
 */
import { useTranslation } from "react-i18next";
import { Loader2, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ZoomableImage } from "../LayoutRenderer";
import { errorKey } from "./examImportErrors";
import {
  pageQuestionCount,
  type ExamImportPage,
  type PageMergeInfo,
} from "./types";
import type { ExamImportController } from "./useExamImport";

interface Props {
  page: ExamImportPage;
  /** 這一頁還有沒存的卡 */
  hasCards: boolean;
  merge: PageMergeInfo | undefined;
  controller: ExamImportController;
  onAddCard: (pageNo: number) => void;
}

export default function ExamImportReviewPageRow({
  page: p,
  hasCards,
  merge,
  controller,
  onAddCard,
}: Props) {
  const { t } = useTranslation();
  const {
    activePage,
    running,
    pageNotes,
    thumbs,
    hasSource,
    staleProcessing,
    detail,
  } = controller;
  const pageLimit = detail?.retry_limits.page_resends ?? 2;
  const thumb = thumbs[p.page_no] ?? p.image_url;
  const processing = activePage === p.page_no || p.status === "processing";
  const tid = (s: string) => `exam-page-${p.page_no}-${s}`;

  const statusBadge = () => {
    if (processing)
      return (
        <Badge variant="info" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("questionBank.examImport.progress.status.processing")}
        </Badge>
      );
    if (p.blank_skipped)
      return (
        <Badge variant="outline" className="text-gray-600">
          {t("questionBank.examImport.progress.status.blank")}
        </Badge>
      );
    if (p.status === "failed")
      return (
        <Badge variant="destructive">
          {t("questionBank.examImport.progress.status.failed")}
        </Badge>
      );
    if (p.status === "pending")
      return (
        <Badge variant="secondary">
          {t("questionBank.examImport.progress.status.pending")}
        </Badge>
      );
    const count = pageQuestionCount(p);
    if (count === 0 && merge?.kind === "merged")
      return (
        <Badge
          variant="outline"
          className="text-gray-600"
          data-testid={tid("merged")}
        >
          {merge.from !== undefined && merge.to !== undefined
            ? t("questionBank.examImport.progress.status.merged", {
                target: merge.target,
                range:
                  merge.from === merge.to
                    ? `${merge.from}`
                    : `${merge.from}–${merge.to}`,
              })
            : t("questionBank.examImport.progress.status.mergedNoRange", {
                target: merge.target,
              })}
        </Badge>
      );
    if (count === 0)
      return (
        <Badge
          variant="outline"
          className="text-gray-600"
          data-testid={tid("empty")}
        >
          {t("questionBank.examImport.progress.status.empty")}
        </Badge>
      );
    if (merge?.kind === "span")
      return (
        <Badge variant="success" data-testid={tid("span")}>
          {t("questionBank.examImport.progress.status.doneSpan", {
            count,
            from: merge.from,
            to: merge.to,
          })}
        </Badge>
      );
    return null;
  };

  const canResend =
    p.status === "failed" ||
    (p.status === "processing" && staleProcessing(p.page_no)) ||
    (p.status === "pending" && !!pageNotes[p.page_no] && !running);
  const unreadable = canResend && p.resend_count >= pageLimit;

  const note = pageNotes[p.page_no];
  const detailText = note
    ? t(errorKey(note.key), note.params)
    : p.status === "failed"
      ? t(
          errorKey(
            p.error && p.error.includes("逾時") ? "aiTimeout" : "aiFailed",
          ),
        )
      : null;

  const addButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1"
      onClick={() => onAddCard(p.page_no)}
      disabled={processing}
      data-testid={tid("add")}
    >
      <Plus className="h-3.5 w-3.5" />
      {t("questionBank.examImport.review.addCard")}
    </Button>
  );

  return (
    <div
      data-testid={`exam-page-${p.page_no}`}
      data-status={p.blank_skipped ? "blank" : p.status}
    >
      <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-gray-300 pt-3">
        <div className="h-10 w-8 shrink-0 overflow-hidden rounded border border-gray-200 bg-gray-50">
          {thumb && (
            <ZoomableImage
              src={thumb}
              alt={t("questionBank.examImport.review.pageLabel", {
                n: p.page_no,
              })}
              buttonClassName="block h-full w-full"
              className="h-full w-full object-cover object-top"
              testId={tid("thumb")}
            />
          )}
        </div>
        <span className="text-sm font-medium text-gray-500">
          {t("questionBank.examImport.review.pageLabel", { n: p.page_no })}
        </span>
        {statusBadge()}
        {p.is_answer_page && (
          <Badge variant="outline">
            {t("questionBank.examImport.progress.answerPage")}
          </Badge>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {p.blank_skipped && activePage !== p.page_no && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={running}
              onClick={() => void controller.sendBlankPage(p.page_no)}
              data-testid={tid("send-blank")}
            >
              {t("questionBank.examImport.progress.sendBlank")}
            </Button>
          )}
          {canResend &&
            !unreadable &&
            hasSource &&
            activePage !== p.page_no && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={running}
                onClick={() => void controller.resendPage(p.page_no)}
                data-testid={tid("resend")}
              >
                {t("questionBank.examImport.progress.resend")}
              </Button>
            )}
          {(p.status === "done" || unreadable) && addButton}
        </div>
      </div>
      {unreadable && (
        <p
          className="mt-1 text-xs text-red-600"
          data-testid={tid("manual-fill")}
        >
          {t("questionBank.examImport.progress.manualFill")}
        </p>
      )}
      {detailText && !unreadable && (
        <p
          className={`mt-1 text-xs ${p.status === "failed" ? "text-red-600" : "text-gray-500"}`}
        >
          {detailText}
        </p>
      )}
      {p.blank_skipped && (
        <p className="mt-1 text-xs text-gray-500">
          {t("questionBank.examImport.progress.blankHint")}
        </p>
      )}
      {(processing || p.status === "pending") && !hasCards && (
        <div className="mt-3 space-y-2" data-testid={tid("placeholder")}>
          <p className="text-xs text-gray-500">
            {t("questionBank.examImport.review.pageProcessing", {
              n: p.page_no,
            })}
          </p>
          <div className="h-3 w-3/4 animate-pulse rounded bg-gray-200" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-gray-200" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-gray-200" />
        </div>
      )}
    </div>
  );
}
