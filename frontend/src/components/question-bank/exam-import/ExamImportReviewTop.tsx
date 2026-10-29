/**
 * 上傳題本核對畫面・頂部（#1112 C4b；C4c 改成一行摘要，設計文件第五節「版面」）。不隨題目捲動，
 * 把空間留給考卷閱讀：
 *
 * - **一行摘要**（C4c 第 1 點、cold-read E5）：檔名＋「N／M 頁（含空白頁、失敗頁數）」＋整份設定摘要
 *   「年段 7–9 年級・來源 X・教材 未選・公開」＋「編輯設定 ▾」（展開後變「收合設定 ▴」）。缺必填（年段、
 *   來源、公開）用琥珀字「未選（必填）」標出；教材是選填，未選灰字。手機（< sm）檔名一行、摘要一行（截斷）。
 * - **細進度線**：已處理頁數／總頁數，摘要下方一條細藍線。
 * - **展開的整份設定**：年段（GradeRangeSlider）、考題來源（CreatableCombobox，只取一個）、教材與單元
 *   （ProgramLessonPicker）、公開（VisibilitySelect，機構題庫顯示「僅機構／公開」）。改了就 PATCH 設定，
 *   套用到全部還沒存的卡。年段拖曳時等 0.5 秒沒再動才送（狀態在 useExamImportReview）。來源名稱用整份
 *   摘要的 `source`；改來源失敗時改回。口音不在這裡改。展開與否由外層控制：按「全部儲存」或「略過核對」時
 *   缺設定 → 外層展開並遞增 `focusRequest`，這裡把焦點放到第一個缺的欄位（不捲動）。手機展開時最高半個
 *   螢幕、裡面自己捲。
 * - 摘要下方「有才出現」的提示（E6）：處理中「網頁開著才會繼續」、處理停下＋「繼續處理」、從提示列繼續時
 *   請老師「再選一次〈檔名〉」、整份錯誤、上次存入「N 題因題庫已有而略過」。頁碼說明小字在捲動區最上方。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  FileUp,
  Loader2,
} from "lucide-react";

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
import {
  VisibilitySelect,
  visibilityLabelKey,
} from "@/components/shared/VisibilitySelect";
import { cn } from "@/lib/utils";
import type { Program } from "@/types";
import type { QuestionVisibility } from "@/types/questionBank";
import { makeCreateSource, searchSources } from "../sourcesCombobox";
import { errorInfo, errorKey } from "./examImportErrors";
import type { SettingKey } from "./reviewModel";
import type { ExamImportController, PageNote } from "./useExamImport";
import type { ExamImportReviewState } from "./useExamImportReview";

interface Props {
  controller: ExamImportController;
  review: ExamImportReviewState;
  programs: Program[];
  /** 整份設定展開中 */
  expanded: boolean;
  onToggle: () => void;
  /** 缺的必填欄位（摘要琥珀字、焦點用） */
  missing: SettingKey[];
  /** 每加 1 就把焦點放到第一個缺的欄位 */
  focusRequest: number;
}

export default function ExamImportReviewTop({
  controller,
  review,
  programs,
  expanded,
  onToggle,
  missing,
  focusRequest,
}: Props) {
  const { t } = useTranslation();
  const { detail, needsFile, canResume, runError } = controller;
  const settings = detail?.settings ?? {};
  const org = controller.organizationId;
  const p = "questionBank.examImport.review.summary";

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

  // 缺設定時焦點到第一個缺的欄位（不捲動，E5）
  const fieldRefs = useRef<Partial<Record<SettingKey, HTMLDivElement | null>>>(
    {},
  );
  useEffect(() => {
    if (focusRequest === 0 || !expanded || missing.length === 0) return;
    const el = fieldRefs.current[missing[0]]?.querySelector<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    el?.focus({ preventScroll: true });
    // 只在要求焦點時跑（展開狀態一起變）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest, expanded]);

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
    (pg) => pg.status === "done" || pg.status === "failed",
  );

  // ---- 摘要文字 ----
  const [lo, hi] = review.grade;
  const gradeText =
    lo === null || hi === null
      ? null
      : lo === hi
        ? t("questionBank.gradeSingle", { grade: lo })
        : t("questionBank.gradeRange", { min: lo, max: hi });
  const program = link
    ? programs.find((pg) => pg.id === link.program_id)
    : null;
  const lesson = link?.lesson_id
    ? program?.lessons?.find((l) => l.id === link.lesson_id)
    : null;
  const programText = program
    ? lesson
      ? `${program.name}／${lesson.name}`
      : program.name
    : null;
  const required = t(`${p}.required`);
  const summaryParts: { key: string; text: string; missing: boolean }[] = [
    {
      key: "grade",
      text: t(`${p}.grade`, { value: gradeText ?? required }),
      missing: gradeText === null,
    },
    {
      key: "source",
      text: t(`${p}.source`, { value: detail.source?.name ?? required }),
      missing: missing.includes("source"),
    },
    {
      key: "program",
      text: t(`${p}.program`, { value: programText ?? t(`${p}.notSet`) }),
      missing: false,
    },
    {
      key: "visibility",
      text: visibility
        ? t(visibilityLabelKey(visibility, org ? "organization" : "personal"))
        : t(`${p}.visibilityMissing`),
      missing: !visibility,
    },
  ];

  const field = (
    key: SettingKey | "program",
    label: string,
    body: ReactNode,
  ) => (
    <div
      className="space-y-1"
      ref={(el) => {
        if (key !== "program") fieldRefs.current[key] = el;
      }}
      data-testid={`exam-review-field-${key}`}
    >
      <Label
        className={cn(
          "text-xs",
          key !== "program" && missing.includes(key)
            ? "text-amber-700"
            : "text-gray-600",
        )}
      >
        {label}
      </Label>
      {body}
    </div>
  );

  return (
    <div data-testid="exam-review-top">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 pr-8 text-sm sm:px-6 sm:pr-16">
        <div className="flex min-w-0 items-center gap-1.5 max-sm:w-full">
          <FileText className="h-4 w-4 shrink-0 text-gray-400" />
          <span className="min-w-0 truncate font-medium text-gray-900">
            {detail.file_name}
          </span>
          <span
            className="ml-auto shrink-0 text-xs text-gray-500 sm:ml-1"
            data-testid="exam-review-count"
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
          </span>
        </div>
        <p
          className="min-w-0 flex-1 truncate text-gray-700"
          data-testid="exam-review-summary"
        >
          {summaryParts.map((part, i) => (
            <span key={part.key}>
              {i > 0 && <span className="mx-1.5 text-gray-400">・</span>}
              <span
                className={part.missing ? "font-medium text-amber-700" : ""}
                data-testid={`exam-review-summary-${part.key}`}
                data-missing={part.missing || undefined}
              >
                {part.text}
              </span>
            </span>
          ))}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1"
          onClick={onToggle}
          aria-expanded={expanded}
          data-testid="exam-review-settings-toggle"
        >
          {expanded ? t(`${p}.collapse`) : t(`${p}.edit`)}
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <Progress
        value={percent}
        className="h-1 rounded-none"
        data-testid="exam-review-progress"
      />

      {expanded && (
        <div
          className="grid max-h-[50vh] gap-3 overflow-y-auto border-b border-gray-200 bg-gray-50 px-4 py-3 pr-8 sm:max-h-none sm:grid-cols-2 sm:px-6 sm:pr-16 xl:grid-cols-4"
          data-testid="exam-review-settings"
        >
          {field(
            "grade",
            t("questionBank.examImport.upload.grade"),
            <GradeRangeSlider
              value={review.grade}
              onChange={review.changeGrade}
              compact
              emptyLabel={t("questionBank.examImport.upload.gradeEmpty")}
              data-testid="exam-review-grade"
            />,
          )}
          {field(
            "source",
            t("questionBank.examImport.upload.source"),
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
            />,
          )}
          {field(
            "program",
            t("questionBank.examImport.upload.program"),
            <ProgramLessonPicker
              programs={programs}
              value={link}
              onChange={(next) =>
                void review.patchSettings({
                  program_links: next ? [next] : [],
                })
              }
              compact
              data-testid="exam-review-program"
            />,
          )}
          {field(
            "visibility",
            t("questionBank.examImport.upload.visibility"),
            <VisibilitySelect
              value={visibility}
              onChange={(v) => void review.patchSettings({ visibility: v })}
              scope={org ? "organization" : "personal"}
              required
              data-testid="exam-review-visibility"
            />,
          )}
        </div>
      )}

      <div className="space-y-2 px-4 py-2 pr-8 empty:hidden sm:px-6 sm:pr-16">
        {!allDone && (
          <p
            className="text-xs text-gray-500"
            data-testid="exam-review-keep-open"
          >
            {t(
              org
                ? "questionBank.examImport.progress.keepOpenOrg"
                : "questionBank.examImport.progress.keepOpen",
            )}
          </p>
        )}

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
                  count: detail.pages.filter((pg) => pg.status === "pending")
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
    </div>
  );
}
