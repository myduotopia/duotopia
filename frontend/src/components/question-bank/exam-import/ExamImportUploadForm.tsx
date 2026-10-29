/**
 * 上傳題本・上傳畫面（#1112 C3；設計文件 docs/design/question-bank-exam-import.md 第二節）。
 *
 * 寬版 Sheet 內：左邊上傳區、右邊整份設定，頁尾「開始擷取」。
 * - 上傳區：PDF 一個，或照片多張（PNG／JPEG／WebP），兩種不能混；最多 20 頁（上傳區直接寫出）；
 *   選好後顯示「共 N 頁」。拆頁、雜湊在 `pageSource.ts`。
 * - 整份設定（每份只填一次）：年段（GradeRangeSlider，必選；還沒選時顯示「請拖曳選擇年段」，
 *   不顯示「不限」）、考題來源（CreatableCombobox，必填、
 *   只取一個）、教材與單元（ProgramLessonPicker，選填）、公開（VisibilitySelect，必選、無預設）、
 *   朗讀口音（Checkbox 多選、至少一種、**預設全不選、不記預設**）。
 * - 沒填完時「開始擷取」停用，旁邊寫出還缺哪幾項。
 * - 建立失敗：409 重複題本 → 提示＋「打開那次匯入」；429 每天 1 本；其他錯誤白話提示。
 * - 機構題庫（C4）：`organizationId` 有值時，公開設定顯示「僅機構／公開」、新增的來源建成機構來源；
 *   重複題本的「打開那次匯入」帶著那次所在的題庫（切到對應題庫再打開）。
 * 全部用標準元件（components/ui、components/shared），不新增元件。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileUp, Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  CreatableCombobox,
  type ComboboxItem,
} from "@/components/shared/CreatableCombobox";
import {
  GradeRangeSlider,
  type GradeRange,
} from "@/components/shared/GradeRangeSlider";
import {
  ProgramLessonPicker,
  type ProgramLessonLink,
} from "@/components/shared/ProgramLessonPicker";
import { VisibilitySelect } from "@/components/shared/VisibilitySelect";
import type { Program } from "@/types";
import type { QuestionVisibility } from "@/types/questionBank";
import { TTS_ACCENTS } from "@/utils/ttsVoiceResolver";
import { makeCreateSource, searchSources } from "../sourcesCombobox";
import {
  errorInfo,
  errorKey,
  type ExamImportErrorInfo,
} from "./examImportErrors";
import {
  EXAM_IMPORT_MAX_PAGES,
  preparePageSource,
  type PageSource,
} from "./pageSource";
import type { ExistingImportTarget, StartInput } from "./useExamImport";

const ACCENTS = TTS_ACCENTS.filter((a) => a !== "Random");
const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

export function accentLabelKey(accent: string): string {
  return `questionBank.examImport.accents.${accent.split(" ")[0].toLowerCase()}`;
}

interface ExamImportUploadFormProps {
  programs: Program[];
  onStart: (input: StartInput) => Promise<void>;
  onCancel: () => void;
  onOpenExisting: (target: ExistingImportTarget) => void;
  /** 機構題庫的機構 id；不給＝我的題庫 */
  organizationId?: string | null;
}

export default function ExamImportUploadForm({
  programs,
  onStart,
  onCancel,
  onOpenExisting,
  organizationId = null,
}: ExamImportUploadFormProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<PageSource | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [fileError, setFileError] = useState<ExamImportErrorInfo | null>(null);
  const [grade, setGrade] = useState<GradeRange>([null, null]);
  const [sources, setSources] = useState<ComboboxItem[]>([]);
  const [programLink, setProgramLink] = useState<ProgramLessonLink | null>(
    null,
  );
  const [visibility, setVisibility] = useState<QuestionVisibility | null>(null);
  const [accents, setAccents] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ExamImportErrorInfo | null>(
    null,
  );
  const [dragOver, setDragOver] = useState(false);
  const createSource = useMemo(
    () => makeCreateSource(organizationId ?? undefined),
    [organizationId],
  );
  // 選了檔案卻沒開始擷取就關掉：釋放 PDF（開始後由 useExamImport 接手）
  const ownedSource = useRef<PageSource | null>(null);
  ownedSource.current = source;
  const started = useRef(false);
  useEffect(
    () => () => {
      if (!started.current) ownedSource.current?.dispose();
    },
    [],
  );

  const pickFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setPreparing(true);
    setFileError(null);
    setSubmitError(null);
    try {
      const next = await preparePageSource(files);
      source?.dispose();
      setSource(next);
      setFileCount(files.length);
    } catch (err) {
      setFileError(errorInfo(err));
    } finally {
      setPreparing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const missing = [
    !source && "file",
    grade[0] === null && grade[1] === null && "grade",
    sources.length === 0 && "source",
    visibility === null && "visibility",
    accents.length === 0 && "accents",
  ].filter((x): x is string => !!x);

  const submit = async () => {
    if (!source || missing.length > 0 || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      started.current = true;
      await onStart({
        source,
        accents,
        settings: {
          grade_min: grade[0],
          grade_max: grade[1],
          source_id: sources[0]?.id ?? null,
          program_links: programLink ? [programLink] : [],
          visibility: visibility as "private" | "public",
        },
      });
    } catch (err) {
      started.current = false;
      setSubmitError(errorInfo(err));
    } finally {
      setSubmitting(false);
    }
  };

  const fileLabel = !source
    ? null
    : source.kind === "images" && fileCount > 1
      ? t("questionBank.examImport.upload.photosName", {
          name: source.fileName,
          count: fileCount,
        })
      : source.fileName;

  return (
    <div className="flex flex-1 flex-col min-h-0" data-testid="exam-upload">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid gap-6 md:grid-cols-2">
          {/* 左：上傳區 */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-gray-900">
              {t("questionBank.examImport.upload.fileLabel")}{" "}
              <span className="text-red-500">*</span>
            </Label>
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors ${
                dragOver
                  ? "border-blue-400 bg-blue-50"
                  : "border-gray-300 bg-gray-50 hover:bg-gray-100"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void pickFiles(e.dataTransfer.files);
              }}
              data-testid="exam-upload-drop"
            >
              {preparing ? (
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              ) : (
                <FileUp className="h-8 w-8 text-gray-400" />
              )}
              <span className="text-sm text-gray-700">
                {preparing
                  ? t("questionBank.examImport.upload.preparing")
                  : t("questionBank.examImport.upload.dropHint")}
              </span>
              <span className="text-xs text-gray-500">
                {t("questionBank.examImport.upload.limitHint", {
                  max: EXAM_IMPORT_MAX_PAGES,
                })}
              </span>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="sr-only"
                onChange={(e) => void pickFiles(e.target.files)}
                disabled={preparing || submitting}
                data-testid="exam-upload-input"
              />
            </label>
            {fileLabel && (
              <p
                className="text-sm text-gray-700 break-all"
                data-testid="exam-upload-file"
              >
                {fileLabel}
              </p>
            )}
            {fileError && (
              <Alert variant="destructive" data-testid="exam-upload-file-error">
                <AlertDescription>
                  {t(errorKey(fileError.key), fileError.params)}
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* 右：整份設定 */}
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              {t("questionBank.examImport.upload.settingsHint")}
            </p>
            <div className="space-y-1">
              <Label className="text-sm text-gray-700">
                {t("questionBank.examImport.upload.grade")}{" "}
                <span className="text-red-500">*</span>
              </Label>
              <GradeRangeSlider
                value={grade}
                onChange={setGrade}
                disabled={submitting}
                emptyLabel={t("questionBank.examImport.upload.gradeEmpty")}
                data-testid="exam-upload-grade"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm text-gray-700">
                {t("questionBank.examImport.upload.source")}{" "}
                <span className="text-red-500">*</span>
              </Label>
              <CreatableCombobox
                value={sources}
                // 整份只掛一個來源：選新的就取代舊的
                onChange={(next) => setSources(next.slice(-1))}
                onSearch={searchSources}
                onCreate={createSource}
                closeOnSelect
                disabled={submitting}
                triggerLabel={t("questionBank.form.batch.pickSources")}
                searchPlaceholder={t(
                  "questionBank.form.batch.sourceSearchPlaceholder",
                )}
                emptyText={t("questionBank.form.batch.noSources")}
                createLabel={(name) =>
                  t("questionBank.form.batch.createSource", { name })
                }
                data-testid="exam-upload-source"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm text-gray-700">
                {t("questionBank.examImport.upload.program")}
              </Label>
              <ProgramLessonPicker
                programs={programs}
                value={programLink}
                onChange={setProgramLink}
                disabled={submitting}
                data-testid="exam-upload-program"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm text-gray-700">
                {t("questionBank.examImport.upload.visibility")}{" "}
                <span className="text-red-500">*</span>
              </Label>
              <VisibilitySelect
                value={visibility}
                onChange={setVisibility}
                disabled={submitting}
                required
                scope={organizationId ? "organization" : "personal"}
                data-testid="exam-upload-visibility"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm text-gray-700">
                {t("questionBank.examImport.upload.accents")}{" "}
                <span className="text-red-500">*</span>
              </Label>
              <p className="text-xs text-gray-500">
                {t("questionBank.examImport.upload.accentsHint")}
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                {ACCENTS.map((accent) => (
                  <label
                    key={accent}
                    className="flex items-center gap-2 text-sm text-gray-700"
                  >
                    <Checkbox
                      checked={accents.includes(accent)}
                      onCheckedChange={(c) =>
                        setAccents((prev) =>
                          c === true
                            ? [...prev, accent]
                            : prev.filter((a) => a !== accent),
                        )
                      }
                      disabled={submitting}
                      data-testid={`exam-upload-accent-${accent.split(" ")[0].toLowerCase()}`}
                    />
                    {t(accentLabelKey(accent))}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {submitError && (
          <Alert
            variant="destructive"
            className="mt-4"
            data-testid="exam-upload-error"
          >
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>{t(errorKey(submitError.key), submitError.params)}</span>
              {submitError.existingImportId !== undefined && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onOpenExisting({
                      id: submitError.existingImportId!,
                      organizationId:
                        submitError.existingOrganizationId ?? null,
                      schoolId: submitError.existingSchoolId ?? null,
                    })
                  }
                  data-testid="exam-upload-open-existing"
                >
                  {t("questionBank.examImport.upload.openExisting")}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* 頁尾：共 N 頁＋按鈕 */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4">
        <span className="text-sm text-gray-700" data-testid="exam-upload-pages">
          {source
            ? t("questionBank.examImport.upload.pageCount", {
                count: source.pageCount,
              })
            : ""}
        </span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {missing.length > 0 && (
            <span
              className="text-xs text-gray-500"
              data-testid="exam-upload-missing"
            >
              {t("questionBank.examImport.upload.missing", {
                items: missing
                  .map((m) => t(`questionBank.examImport.upload.need.${m}`))
                  .join(t("questionBank.examImport.upload.listSeparator")),
              })}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
          >
            {t("common.cancel", "取消")}
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={missing.length > 0 || submitting || preparing}
            data-testid="exam-upload-start"
          >
            {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t("questionBank.examImport.upload.start")}
          </Button>
        </div>
      </div>
    </div>
  );
}
