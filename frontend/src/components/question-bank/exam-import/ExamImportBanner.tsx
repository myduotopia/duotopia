/**
 * 「我的題庫」最上方的未完成匯入提示列（#1112 C3，計畫檔 C3 定案 Q1）。標準 Alert，只有一條：
 * - 1 份：「你有 1 份題本還沒處理完（檔名，12／16 頁）[繼續][放棄]」
 * - 多份：「你有 N 份題本還沒處理完 [查看]」→ 展開每份的檔名、日期、進度，各有 [繼續][放棄]
 * 沒有未完成的匯入就不顯示。不用 BulkActionBar（那是列表勾選後的批次操作列）。
 * 「放棄」先跳 ConfirmDialog（ExamImportSheet 顯示）。
 * C4：我的題庫、機構題庫各列各的（controller 依題庫範圍抓列表）；已處理完、等老師核對（`ready`）的
 * 匯入進度改顯示「待核對」，「繼續」直接進核對畫面（不需要另外的「開始核對」，A1）。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ExamImportController } from "./useExamImport";
import type { ExamImportSummary } from "./types";

interface ExamImportBannerProps {
  controller: ExamImportController;
}

export default function ExamImportBanner({
  controller,
}: ExamImportBannerProps) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const items = controller.unfinished;
  if (items.length === 0) return null;

  const progress = (i: ExamImportSummary) =>
    i.status === "ready"
      ? t("questionBank.examImport.banner.ready")
      : i.pages_blank > 0
        ? t("questionBank.examImport.progress.countWithBlank", {
            done: i.pages_done,
            total: i.page_count,
            blank: i.pages_blank,
          })
        : t("questionBank.examImport.progress.count", {
            done: i.pages_done,
            total: i.page_count,
          });

  const actions = (i: ExamImportSummary) => (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        type="button"
        size="sm"
        onClick={() => void controller.openImport(i.id)}
        data-testid={`exam-banner-continue-${i.id}`}
      >
        {t("questionBank.examImport.banner.continue")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="text-red-600 hover:text-red-700"
        onClick={() => controller.requestAbandon(i.id)}
        data-testid={`exam-banner-abandon-${i.id}`}
      >
        {t("questionBank.examImport.banner.abandon")}
      </Button>
    </div>
  );

  if (items.length === 1) {
    const only = items[0];
    return (
      <Alert className="py-3" data-testid="exam-import-banner">
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <FileText className="h-4 w-4 shrink-0 text-gray-500" />
          <span className="min-w-0 flex-1">
            {t("questionBank.examImport.banner.one", {
              name: only.file_name,
              progress: progress(only),
            })}
          </span>
          {actions(only)}
        </AlertDescription>
      </Alert>
    );
  }

  const dateText = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(i18n.language) : "";

  return (
    <Alert className="py-3" data-testid="exam-import-banner">
      <AlertDescription className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <FileText className="h-4 w-4 shrink-0 text-gray-500" />
          <span className="min-w-0 flex-1">
            {t("questionBank.examImport.banner.many", { count: items.length })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            data-testid="exam-banner-toggle"
          >
            {expanded
              ? t("questionBank.examImport.banner.hide")
              : t("questionBank.examImport.banner.view")}
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
        {expanded && (
          <ul className="divide-y divide-gray-200 border-t border-gray-200">
            {items.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center gap-3 py-2"
                data-testid={`exam-banner-item-${i.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-900">
                    {i.file_name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {dateText(i.created_at)} · {progress(i)}
                  </p>
                </div>
                {actions(i)}
              </li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}
