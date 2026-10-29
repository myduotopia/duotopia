/**
 * 上傳題本核對畫面・頂部（#1112 C4b；設計文件第五節「版面」）。不隨題目捲動：
 *
 * - **整份設定**：年段（GradeRangeSlider）、考題來源（CreatableCombobox，只取一個）、教材與單元
 *   （ProgramLessonPicker）、公開（VisibilitySelect，機構題庫顯示「僅機構／公開」）。改了就 PATCH 設定，
 *   套用到全部還沒存的卡（題目卡上不顯示這四個欄位）。年段拖曳時等 0.5 秒沒再動才送（狀態在
 *   useExamImportReview：存入前先送出、送失敗滑桿改回）。來源名稱直接用整份摘要的 `source`（C4a 修正，
 *   不再另查來源列表）；改來源失敗時改回摘要的來源。口音不在這裡改。
 * - **藍色進度條**：已處理頁數／總頁數（含空白頁說明、失敗頁數），處理中時提醒「網頁開著才會繼續」
 *   （機構題庫的文字寫「機構教材」頁／「機構題庫」上方，C4b 審查 9）。
 * - 原進度畫面的頂部提示（C4 定案 A1 搬過來）：處理停下＋「繼續處理」、從提示列繼續時請老師
 *   「再選一次〈檔名〉」、整份錯誤；頁碼說明小字；上次存入「N 題因題庫已有而略過」。
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileUp, Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  CreatableCombobox,
  type ComboboxItem,
} from "@/components/shared/CreatableCombobox";
import { GradeRangeSlider } from "@/components/shared/GradeRangeSlider";
import { ProgramLessonPicker } from "@/components/shared/ProgramLessonPicker";
import { VisibilitySelect } from "@/components/shared/VisibilitySelect";
import type { Program } from "@/types";
import type { QuestionVisibility } from "@/types/questionBank";
import { makeCreateSource, searchSources } from "../sourcesCombobox";
import { errorInfo, errorKey } from "./examImportErrors";
import type { ExamImportController, PageNote } from "./useExamImport";
import type { ExamImportReviewState } from "./useExamImportReview";

interface Props {
  controller: ExamImportController;
  review: ExamImportReviewState;
  programs: Program[];
}

export default function ExamImportReviewTop({
  controller,
  review,
  programs,
}: Props) {
  const { t } = useTranslation();
  const { detail, needsFile, canResume, runError } = controller;
  const settings = detail?.settings ?? {};
  const org = controller.organizationId;

  // 來源：整份摘要帶 id＋名稱（C4a 修正）；本機先換，送失敗改回摘要的來源
  const summarySourceId = detail?.source?.id ?? null;
  const summarySourceName = detail?.source?.name ?? "";
  const summarySource = (): ComboboxItem[] =>
    summarySourceId === null
      ? []
      : [{ id: summarySourceId, label: summarySourceName }];
  const [source, setSource] = useState<ComboboxItem[]>(summarySource);
  useEffect(() => {
    setSource(
      summarySourceId === null
        ? []
        : [{ id: summarySourceId, label: summarySourceName }],
    );
  }, [summarySourceId, summarySourceName]);
  const changeSource = async (next: ComboboxItem[]) => {
    const picked = next.slice(-1);
    setSource(picked);
    if (!picked[0]) return;
    if (!(await review.patchSettings({ source_id: picked[0].id })))
      setSource(summarySource());
  };

  const link = settings.program_links?.[0] ?? null;
  const visibility = (settings.visibility ?? null) as QuestionVisibility | null;

  // 重選檔案（從提示列繼續、還有沒處理完的頁）
  const inputRef = useRef<HTMLInputElement>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<PageNote | null>(null);
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

  if (!detail) return null;
  const total = detail.page_count;
  const done = detail.pages_done;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = detail.pages.every(
    (p) => p.status === "done" || p.status === "failed",
  );

  return (
    <div className="space-y-3" data-testid="exam-review-top">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs text-gray-600">
            {t("questionBank.examImport.upload.grade")}
          </Label>
          <GradeRangeSlider
            value={review.grade}
            onChange={review.changeGrade}
            compact
            emptyLabel={t("questionBank.examImport.upload.gradeEmpty")}
            data-testid="exam-review-grade"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-600">
            {t("questionBank.examImport.upload.source")}
          </Label>
          <CreatableCombobox
            value={source}
            onChange={(next) => void changeSource(next)}
            onSearch={searchSources}
            onCreate={makeCreateSource(org ?? undefined)}
            closeOnSelect
            triggerLabel={t("questionBank.form.batch.pickSources")}
            searchPlaceholder={t(
              "questionBank.form.batch.sourceSearchPlaceholder",
            )}
            emptyText={t("questionBank.form.batch.noSources")}
            createLabel={(name) =>
              t("questionBank.form.batch.createSource", { name })
            }
            data-testid="exam-review-source"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-600">
            {t("questionBank.examImport.upload.program")}
          </Label>
          <ProgramLessonPicker
            programs={programs}
            value={link}
            onChange={(next) =>
              void review.patchSettings({ program_links: next ? [next] : [] })
            }
            compact
            data-testid="exam-review-program"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-600">
            {t("questionBank.examImport.upload.visibility")}
          </Label>
          <VisibilitySelect
            value={visibility}
            onChange={(v) => void review.patchSettings({ visibility: v })}
            scope={org ? "organization" : "personal"}
            required
            data-testid="exam-review-visibility"
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="min-w-0 break-all font-medium text-gray-900">
            {detail.file_name}
          </span>
          <span className="text-gray-700" data-testid="exam-review-count">
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
          </span>
        </div>
        <Progress
          value={percent}
          className="h-2"
          data-testid="exam-review-progress"
        />
        {!allDone && (
          <p className="text-xs text-gray-500">
            {t(
              org
                ? "questionBank.examImport.progress.keepOpenOrg"
                : "questionBank.examImport.progress.keepOpen",
            )}
          </p>
        )}
      </div>

      {needsFile && (
        <Alert data-testid="exam-review-need-file">
          <AlertDescription className="space-y-2">
            <p>
              {t("questionBank.examImport.progress.reselect", {
                name: detail.file_name,
              })}
            </p>
            <p className="text-xs text-gray-500">
              {t("questionBank.examImport.progress.reselectPhotos")}
            </p>
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={() => inputRef.current?.click()}
              disabled={attaching}
              data-testid="exam-review-reselect"
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
            {attachError && (
              <p className="text-sm text-red-600">
                {t(errorKey(attachError.key), attachError.params)}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {canResume && (
        <Alert data-testid="exam-review-stopped">
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
              data-testid="exam-review-resume"
            >
              {t("questionBank.examImport.progress.resume")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {runError && (
        <Alert variant="destructive" data-testid="exam-review-error">
          <AlertDescription>
            {t(errorKey(runError.key), runError.params)}
          </AlertDescription>
        </Alert>
      )}

      {review.skippedDuplicates > 0 && (
        <Alert data-testid="exam-review-skipped">
          <AlertDescription>
            {t("questionBank.examImport.review.skippedDuplicates", {
              count: review.skippedDuplicates,
            })}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
