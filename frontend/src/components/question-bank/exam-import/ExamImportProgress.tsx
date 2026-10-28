/**
 * 上傳題本・處理進度畫面（#1112 C3；C4 換成正式的綜合確認畫面）。
 *
 * 與上傳畫面同一個 Sheet，按「開始擷取」或從提示列「繼續」後換成這裡。只用標準元件：
 * - Progress：整份進度（已完成＝處理完的頁，含空白頁略過；「12／16 頁（含 2 頁空白）」，失敗另標）
 * - 每頁一行 Card：頁碼、小縮圖（本機畫好的頁圖，沒有就用後端存的頁圖）、Badge 狀態
 *   （等待中／處理中／完成·擷取 N 題／空白頁略過／失敗），答案頁另標一個 Badge
 * - 失敗頁「重送這一頁」（還有重送次數才有；用完改寫「這一頁讀不出來，請手動補題」）；處理中超過
 *   3 分鐘、被擋下仍待處理（400 圖片過大／格式、畫不出來）的頁也給「重送這一頁」；空白頁略過
 *   「仍要送出這一頁」（用後端存好的頁圖）
 * - 處理停下（網路中斷、有頁被擋下）而還有待處理的頁：上方 Alert「處理停下來了」＋「繼續處理」
 * - 還有沒處理完的頁、但這次沒有檔案（從提示列繼續）→ 上方請老師「再選一次〈檔名〉」，照片要和
 *   第一次同樣順序；雜湊不符提示「不是同一份題本」
 * - 頁尾：放棄這次匯入（紅字次要鈕，ConfirmDialog 由外層處理）、關閉、「開始核對」（停用，即將推出）
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileUp, Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { errorInfo, errorKey } from "./examImportErrors";
import type { ExamImportController, PageNote } from "./useExamImport";
import { pageQuestionCount, type ExamImportPage } from "./types";

interface ExamImportProgressProps {
  controller: ExamImportController;
  onRequestAbandon: (importId: number) => void;
  onClose: () => void;
}

export default function ExamImportProgress({
  controller,
  onRequestAbandon,
  onClose,
}: ExamImportProgressProps) {
  const { t } = useTranslation();
  const {
    detail,
    loadingDetail,
    running,
    activePage,
    pageNotes,
    runError,
    thumbs,
    hasSource,
    needsFile,
    canResume,
    staleProcessing,
  } = controller;
  const inputRef = useRef<HTMLInputElement>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<PageNote | null>(null);

  if (!detail) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        {loadingDetail ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : runError ? (
          t(errorKey(runError.key), runError.params)
        ) : null}
      </div>
    );
  }

  const total = detail.page_count;
  const done = detail.pages_done;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const pageLimit = detail.retry_limits.page_resends;
  const allDone = detail.pages.every(
    (p) => p.status === "done" || p.status === "failed",
  );

  const attach = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setAttaching(true);
    setAttachError(null);
    try {
      await controller.attachFiles(files);
    } catch (err) {
      const info = errorInfo(err);
      setAttachError({ key: info.key, params: info.params });
    } finally {
      setAttaching(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const statusBadge = (p: ExamImportPage) => {
    if (activePage === p.page_no || p.status === "processing")
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
    if (p.status === "done")
      return (
        <Badge variant="success">
          {t("questionBank.examImport.progress.status.done", {
            count: pageQuestionCount(p),
          })}
        </Badge>
      );
    if (p.status === "failed")
      return (
        <Badge variant="destructive">
          {t("questionBank.examImport.progress.status.failed")}
        </Badge>
      );
    return (
      <Badge variant="secondary">
        {t("questionBank.examImport.progress.status.pending")}
      </Badge>
    );
  };

  const pageAction = (p: ExamImportPage) => {
    if (activePage === p.page_no) return null;
    if (p.blank_skipped)
      return (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={running}
          onClick={() => void controller.sendBlankPage(p.page_no)}
          data-testid={`exam-page-${p.page_no}-send-blank`}
        >
          {t("questionBank.examImport.progress.sendBlank")}
        </Button>
      );
    const canResend =
      p.status === "failed" ||
      (p.status === "processing" && staleProcessing(p.page_no)) ||
      // 被擋下（400、畫不出來）仍待處理、這一輪不再自動送的頁
      (p.status === "pending" && !!pageNotes[p.page_no] && !running);
    if (!canResend) return null;
    if (p.resend_count >= pageLimit)
      return (
        <span className="text-xs text-red-600">
          {t("questionBank.examImport.progress.manualFill")}
        </span>
      );
    // 沒有檔案（從提示列繼續、還沒重選）：上方會請老師先選檔案
    if (!hasSource) return null;
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={running}
        onClick={() => void controller.resendPage(p.page_no)}
        data-testid={`exam-page-${p.page_no}-resend`}
      >
        {t("questionBank.examImport.progress.resend")}
      </Button>
    );
  };

  const pageDetail = (p: ExamImportPage) => {
    const note = pageNotes[p.page_no];
    if (note) return t(errorKey(note.key), note.params);
    // 後端的失敗原因是中文句子：逾時另外說明，其餘一律「AI 擷取失敗」（中英都有）
    if (p.status === "failed")
      return t(
        errorKey(
          p.error && p.error.includes("逾時") ? "aiTimeout" : "aiFailed",
        ),
      );
    return null;
  };

  return (
    <div className="flex flex-1 flex-col min-h-0" data-testid="exam-progress">
      <div className="space-y-2 pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-gray-900 break-all">
            {detail.file_name}
          </p>
          <p
            className="text-sm text-gray-700"
            data-testid="exam-progress-count"
          >
            {detail.pages_blank > 0
              ? t("questionBank.examImport.progress.countWithBlank", {
                  done,
                  total,
                  blank: detail.pages_blank,
                })
              : t("questionBank.examImport.progress.count", { done, total })}
            {detail.pages_failed > 0 && (
              <span className="ml-2 text-red-600">
                {t("questionBank.examImport.progress.failedCount", {
                  count: detail.pages_failed,
                })}
              </span>
            )}
          </p>
        </div>
        <Progress
          value={percent}
          className="h-2"
          data-testid="exam-progress-bar"
        />
        <p className="text-xs text-gray-500">
          {allDone
            ? t("questionBank.examImport.progress.allDone", {
                count: detail.question_count,
              })
            : t("questionBank.examImport.progress.keepOpen")}
        </p>
      </div>

      {needsFile && (
        <Alert className="mb-3" data-testid="exam-progress-need-file">
          <AlertDescription className="space-y-2">
            <p>
              {t("questionBank.examImport.progress.reselect", {
                name: detail.file_name,
              })}
            </p>
            <p className="text-xs text-gray-500">
              {t("questionBank.examImport.progress.reselectPhotos")}
            </p>
            <div>
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                onClick={() => inputRef.current?.click()}
                disabled={attaching}
                data-testid="exam-progress-reselect"
              >
                {attaching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="h-4 w-4" />
                )}
                {t("questionBank.examImport.progress.reselectButton")}
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                multiple
                className="sr-only"
                onChange={(e) => void attach(e.target.files)}
              />
            </div>
            {attachError && (
              <p className="text-sm text-red-600">
                {t(errorKey(attachError.key), attachError.params)}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {canResume && (
        <Alert className="mb-3" data-testid="exam-progress-stopped">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t("questionBank.examImport.progress.stopped", {
                count: detail.pages.filter((p) => p.status === "pending")
                  .length,
              })}
            </span>
            <Button
              type="button"
              size="sm"
              onClick={controller.resume}
              data-testid="exam-progress-resume"
            >
              {t("questionBank.examImport.progress.resume")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {runError && (
        <Alert
          variant="destructive"
          className="mb-3"
          data-testid="exam-progress-error"
        >
          <AlertDescription>
            {t(errorKey(runError.key), runError.params)}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
        {[...detail.pages]
          .sort((a, b) => a.page_no - b.page_no)
          .map((p) => {
            const thumb = thumbs[p.page_no] ?? p.image_url;
            const info = pageDetail(p);
            return (
              <Card
                key={p.page_no}
                className="flex items-center gap-3 p-3"
                data-testid={`exam-page-${p.page_no}`}
                data-status={p.blank_skipped ? "blank" : p.status}
              >
                <div className="h-16 w-12 shrink-0 overflow-hidden rounded border border-gray-200 bg-gray-50">
                  {thumb && (
                    <img
                      src={thumb}
                      alt={t("questionBank.examImport.progress.pageNo", {
                        n: p.page_no,
                      })}
                      className="h-full w-full object-cover object-top"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {t("questionBank.examImport.progress.pageNo", {
                        n: p.page_no,
                      })}
                    </span>
                    {statusBadge(p)}
                    {p.is_answer_page && (
                      <Badge variant="outline">
                        {t("questionBank.examImport.progress.answerPage")}
                      </Badge>
                    )}
                  </div>
                  {info && (
                    <p
                      className={`text-xs ${p.status === "failed" ? "text-red-600" : "text-gray-500"}`}
                    >
                      {info}
                    </p>
                  )}
                  {p.blank_skipped && (
                    <p className="text-xs text-gray-500">
                      {t("questionBank.examImport.progress.blankHint")}
                    </p>
                  )}
                </div>
                <div className="shrink-0">{pageAction(p)}</div>
              </Card>
            );
          })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4">
        <Button
          type="button"
          variant="outline"
          className="text-red-600 hover:text-red-700"
          onClick={() => onRequestAbandon(detail.id)}
          data-testid="exam-progress-abandon"
        >
          {t("questionBank.examImport.abandon.button")}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("questionBank.examImport.progress.close")}
          </Button>
          <span title={t("questionBank.comingSoon")}>
            <Button type="button" disabled data-testid="exam-progress-review">
              {t("questionBank.examImport.progress.review")}
              <span className="ml-2 text-xs opacity-80">
                {t("questionBank.comingSoon")}
              </span>
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
