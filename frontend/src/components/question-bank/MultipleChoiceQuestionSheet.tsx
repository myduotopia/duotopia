/**
 * 新增／編輯選擇題（Issue #1061 / #1064）。
 *
 * 欄位：
 * - 題目（必填）：邊打邊呼叫 similar API，下方列出相似題；有完全相同的題目就擋送出
 * - 選項 6 格，至少填 2 個；正確答案勾選，單／複選由「允許複選」開關切換，至少勾 1 個
 * - 解析（選填）
 * - 適合年級 K12（1–12，可只填一端）
 * - 考點（ExamPointPicker）
 * - 教材包／單元關聯（從呼叫端傳入的 programs 選）
 * - 公開設定
 *
 * 工具列（語音生成／AI 作答／AI 考點分析／上傳）在 #1065，這裡不做。
 * 傳 `question` 就是編輯模式；`readOnly` 用在看別人公開的題目。
 *
 * 呈現方式與「新增教材內容」一致：從 sidebar 右緣滑出的全高側邊面板
 * （不是置中 dialog），標題列放儲存／關閉，內容區自己捲動。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSidebar } from "@/contexts/SidebarContext";
import type { Program } from "@/types";
import type {
  ExamPoint,
  Question,
  QuestionCreateInput,
  QuestionProgramLink,
  QuestionVisibility,
  SimilarQuestionsResponse,
} from "@/types/questionBank";
import ExamPointPicker from "./ExamPointPicker";

const OPTION_SLOTS = 6;
const MIN_OPTIONS = 2;
const GRADES = Array.from({ length: 12 }, (_, i) => i + 1);
const VISIBILITIES: QuestionVisibility[] = [
  "private",
  "public",
  "organization_only",
  "individual_only",
];

interface OptionDraft {
  text: string;
  is_correct: boolean;
}

export interface MultipleChoiceQuestionSheetProps {
  open: boolean;
  onClose: () => void;
  /** 編輯模式帶題目；新增為 null */
  question?: Question | null;
  /** 可關聯的教材包（含 lessons） */
  programs: Program[];
  /** 建到機構題庫時帶 organization_id（編輯時忽略） */
  organizationId?: string;
  /** 只讀（看別人公開的題目） */
  readOnly?: boolean;
  /** 是否可刪除（編輯模式） */
  canDelete?: boolean;
  onSaved: (question: Question) => void;
  onDeleted?: (questionId: number) => void;
}

function emptyOptions(): OptionDraft[] {
  return Array.from({ length: OPTION_SLOTS }, () => ({
    text: "",
    is_correct: false,
  }));
}

function optionsFromQuestion(q: Question): OptionDraft[] {
  const drafts = emptyOptions();
  q.options.forEach((o, i) => {
    if (i < OPTION_SLOTS)
      drafts[i] = { text: o.text, is_correct: o.is_correct };
  });
  return drafts;
}

export default function MultipleChoiceQuestionSheet({
  open,
  onClose,
  question = null,
  programs,
  organizationId,
  readOnly = false,
  canDelete = false,
  onSaved,
  onDeleted,
}: MultipleChoiceQuestionSheetProps) {
  const { t } = useTranslation();
  const { sidebarWidth } = useSidebar();
  const isEdit = question !== null;

  const [stem, setStem] = useState("");
  const [options, setOptions] = useState<OptionDraft[]>(emptyOptions());
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [gradeMin, setGradeMin] = useState<number | null>(null);
  const [gradeMax, setGradeMax] = useState<number | null>(null);
  const [examPoints, setExamPoints] = useState<ExamPoint[]>([]);
  const [links, setLinks] = useState<QuestionProgramLink[]>([]);
  const [visibility, setVisibility] = useState<QuestionVisibility>("private");
  const [similar, setSimilar] = useState<SimilarQuestionsResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [linkProgramId, setLinkProgramId] = useState<string>("");
  const [linkLessonId, setLinkLessonId] = useState<string>("");

  // 開啟時依模式初始化
  useEffect(() => {
    if (!open) return;
    if (question) {
      setStem(question.stem);
      setOptions(optionsFromQuestion(question));
      setAllowMultiple(question.allow_multiple_answers);
      setExplanation(question.explanation ?? "");
      setGradeMin(question.grade_min);
      setGradeMax(question.grade_max);
      setExamPoints(
        question.exam_points.map((ep) => ({
          id: ep.id,
          code: ep.code,
          names: ep.names,
          parent_id: null,
          status: "active",
          order_index: 0,
          aliases: [],
        })),
      );
      setLinks(question.program_links);
      setVisibility(question.visibility);
    } else {
      setStem("");
      setOptions(emptyOptions());
      setAllowMultiple(false);
      setExplanation("");
      setGradeMin(null);
      setGradeMax(null);
      setExamPoints([]);
      setLinks([]);
      setVisibility("private");
    }
    setSimilar(null);
    setLinkProgramId("");
    setLinkLessonId("");
  }, [open, question]);

  // 題幹 debounce → 相似題
  useEffect(() => {
    if (!open || readOnly) return;
    const trimmed = stem.trim();
    if (!trimmed || (question && trimmed === question.stem.trim())) {
      setSimilar(null);
      return;
    }
    let cancelled = false;
    const h = window.setTimeout(() => {
      apiClient
        .findSimilarQuestions(trimmed, question?.id)
        .then((res) => {
          if (!cancelled) setSimilar(res);
        })
        .catch(() => {
          if (!cancelled) setSimilar(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(h);
    };
  }, [stem, open, readOnly, question]);

  const filledOptions = options.filter((o) => o.text.trim() !== "");
  const correctCount = filledOptions.filter((o) => o.is_correct).length;
  const exactDuplicate = similar?.exact_duplicate ?? null;

  const validationError = useMemo<string | null>(() => {
    if (!stem.trim()) return t("questionBank.form.errors.stemRequired");
    if (exactDuplicate) return t("questionBank.form.errors.duplicate");
    if (filledOptions.length < MIN_OPTIONS)
      return t("questionBank.form.errors.minOptions", { min: MIN_OPTIONS });
    if (correctCount === 0) return t("questionBank.form.errors.noCorrect");
    if (!allowMultiple && correctCount > 1)
      return t("questionBank.form.errors.singleOnly");
    if (gradeMin !== null && gradeMax !== null && gradeMin > gradeMax)
      return t("questionBank.form.errors.gradeRange");
    return null;
  }, [
    stem,
    exactDuplicate,
    filledOptions.length,
    correctCount,
    allowMultiple,
    gradeMin,
    gradeMax,
    t,
  ]);

  const updateOption = (index: number, patch: Partial<OptionDraft>) => {
    setOptions((prev) =>
      prev.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    );
  };

  const toggleCorrect = (index: number, checked: boolean) => {
    setOptions((prev) =>
      prev.map((o, i) => {
        if (i === index) return { ...o, is_correct: checked };
        // 單選模式：勾一個就把其他取消
        if (!allowMultiple && checked) return { ...o, is_correct: false };
        return o;
      }),
    );
  };

  const handleAllowMultiple = (checked: boolean) => {
    setAllowMultiple(checked);
    if (!checked) {
      // 關掉複選只保留第一個正確答案
      let kept = false;
      setOptions((prev) =>
        prev.map((o) => {
          if (o.is_correct && !kept) {
            kept = true;
            return o;
          }
          return { ...o, is_correct: false };
        }),
      );
    }
  };

  const selectedProgram = programs.find((p) => String(p.id) === linkProgramId);
  const addLink = () => {
    if (!selectedProgram) return;
    const lessonId = linkLessonId ? Number(linkLessonId) : null;
    const exists = links.some(
      (l) => l.program_id === selectedProgram.id && l.lesson_id === lessonId,
    );
    if (!exists)
      setLinks([
        ...links,
        { program_id: selectedProgram.id, lesson_id: lessonId },
      ]);
    setLinkLessonId("");
  };
  const linkLabel = (l: QuestionProgramLink) => {
    const p = programs.find((x) => x.id === l.program_id);
    const lesson = p?.lessons?.find((x) => x.id === l.lesson_id);
    const pName = p?.name ?? `#${l.program_id}`;
    return lesson ? `${pName} › ${lesson.name}` : pName;
  };

  const buildPayload = (): QuestionCreateInput => ({
    question_type: "multiple_choice",
    stem: stem.trim(),
    options: filledOptions.map((o) => ({
      text: o.text.trim(),
      is_correct: o.is_correct,
    })),
    explanation: explanation.trim() || null,
    grade_min: gradeMin,
    grade_max: gradeMax,
    allow_multiple_answers: allowMultiple,
    visibility,
    exam_point_ids: examPoints.map((ep) => ep.id),
    program_links: links,
    organization_id: organizationId ?? null,
  });

  const handleSave = async () => {
    if (validationError || saving) return;
    setSaving(true);
    try {
      const payload = buildPayload();
      let saved: Question;
      if (isEdit && question) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { question_type, organization_id, school_id, ...update } =
          payload;
        saved = await apiClient.updateQuestion(question.id, update);
        toast.success(t("questionBank.messages.updated"));
      } else {
        saved = await apiClient.createQuestion(payload);
        toast.success(t("questionBank.messages.created"));
      }
      onSaved(saved);
      onClose();
    } catch (err) {
      const message = extractApiMessage(err);
      toast.error(message ?? t("questionBank.messages.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!question || deleting) return;
    if (!window.confirm(t("questionBank.form.confirmDelete"))) return;
    setDeleting(true);
    try {
      await apiClient.deleteQuestion(question.id);
      toast.success(t("questionBank.messages.deleted"));
      onDeleted?.(question.id);
      onClose();
    } catch (err) {
      toast.error(
        extractApiMessage(err) ?? t("questionBank.messages.deleteFailed"),
      );
    } finally {
      setDeleting(false);
    }
  };

  const gradeSelect = (
    value: number | null,
    onChange: (v: number | null) => void,
    testId: string,
  ) => (
    <Select
      value={value === null ? "none" : String(value)}
      onValueChange={(v) => onChange(v === "none" ? null : Number(v))}
      disabled={readOnly}
    >
      <SelectTrigger className="h-9 w-28" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{t("questionBank.form.gradeAny")}</SelectItem>
        {GRADES.map((g) => (
          <SelectItem key={g} value={String(g)}>
            {t("questionBank.gradeSingle", { grade: g })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (!open) return null;

  const title = readOnly
    ? t("questionBank.form.titleView")
    : isEdit
      ? t("questionBank.form.titleEdit")
      : t("questionBank.form.titleCreate");

  return (
    <>
      {/* Backdrop：只遮內容區，sidebar 由頁面 setSidebarDisabled 處理 */}
      <div className="fixed inset-0 bg-black bg-opacity-20 z-40 transition-opacity pointer-events-none" />
      <div
        className="editor-panel fixed top-0 right-0 h-screen bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col animate-in slide-in-from-right duration-300"
        style={{ left: `${sidebarWidth}px` }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="qb-sheet"
      >
        {/* 標題列 */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            <p className="text-xs text-gray-500 truncate">
              {t("questionBank.form.description")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isEdit && canDelete && !readOnly && (
              <Button
                type="button"
                variant="ghost"
                className="text-red-600 hover:text-red-700 gap-1"
                onClick={handleDelete}
                disabled={deleting}
                data-testid="qb-delete"
              >
                <Trash2 size={16} />
                {t("common.delete", "刪除")}
              </Button>
            )}
            {!readOnly && (
              <Button
                type="button"
                onClick={handleSave}
                disabled={!!validationError || saving}
                title={validationError ?? undefined}
                data-testid="qb-save"
              >
                {saving
                  ? t("common.saving", "儲存中...")
                  : t("common.save", "儲存")}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label={t("common.close", "關閉")}
              data-testid="qb-close"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>
        {!readOnly && validationError && (
          <p
            className="px-6 py-1.5 text-xs text-gray-500 bg-gray-50 border-b border-gray-100 shrink-0"
            data-testid="qb-validation"
          >
            {validationError}
          </p>
        )}

        {/* 內容區 */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          <div className="space-y-5 max-w-3xl">
            {/* 題目 */}
            <div className="space-y-1.5">
              <Label htmlFor="qb-stem">
                {t("questionBank.form.stem")}{" "}
                <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="qb-stem"
                value={stem}
                onChange={(e) => setStem(e.target.value)}
                placeholder={t("questionBank.form.stemPlaceholder")}
                rows={3}
                disabled={readOnly}
                data-testid="qb-stem"
              />
              {exactDuplicate && (
                <div
                  className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
                  data-testid="qb-duplicate"
                >
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    {t("questionBank.form.duplicateFound")}
                    <div className="text-red-600/80 line-clamp-2">
                      {exactDuplicate.stem}
                    </div>
                  </div>
                </div>
              )}
              {similar && !exactDuplicate && similar.similar.length > 0 && (
                <div
                  className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800"
                  data-testid="qb-similar"
                >
                  <div className="font-medium">
                    {t("questionBank.form.similarFound")}
                  </div>
                  <ul className="mt-1 space-y-0.5 text-amber-700/90">
                    {similar.similar.map((s) => (
                      <li key={s.id} className="line-clamp-1">
                        • {s.stem}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* 選項 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  {t("questionBank.form.options")}{" "}
                  <span className="text-xs text-gray-500">
                    {t("questionBank.form.optionsHint", { min: MIN_OPTIONS })}
                  </span>
                </Label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <Switch
                    checked={allowMultiple}
                    onCheckedChange={handleAllowMultiple}
                    disabled={readOnly}
                    data-testid="qb-allow-multiple"
                  />
                  {t("questionBank.form.allowMultiple")}
                </label>
              </div>
              <div className="space-y-2">
                {options.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Checkbox
                      checked={o.is_correct}
                      onCheckedChange={(c) => toggleCorrect(i, c === true)}
                      disabled={readOnly || o.text.trim() === ""}
                      aria-label={t("questionBank.form.markCorrect", {
                        index: i + 1,
                      })}
                      data-testid={`qb-option-correct-${i}`}
                    />
                    <span className="w-5 text-sm text-gray-500">
                      {String.fromCharCode(65 + i)}.
                    </span>
                    <Input
                      value={o.text}
                      onChange={(e) => {
                        const text = e.target.value;
                        updateOption(i, {
                          text,
                          is_correct: text.trim() === "" ? false : o.is_correct,
                        });
                      }}
                      placeholder={t("questionBank.form.optionPlaceholder", {
                        index: i + 1,
                      })}
                      className="h-9"
                      disabled={readOnly}
                      data-testid={`qb-option-text-${i}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* 解析 */}
            <div className="space-y-1.5">
              <Label htmlFor="qb-explanation">
                {t("questionBank.form.explanation")}
              </Label>
              <Textarea
                id="qb-explanation"
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                rows={2}
                disabled={readOnly}
                data-testid="qb-explanation"
              />
            </div>

            {/* 設定／關聯區 */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("questionBank.form.grade")}</Label>
                <div className="flex items-center gap-2">
                  {gradeSelect(gradeMin, setGradeMin, "qb-grade-min")}
                  <span className="text-gray-400">–</span>
                  {gradeSelect(gradeMax, setGradeMax, "qb-grade-max")}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t("questionBank.form.visibility")}</Label>
                <Select
                  value={visibility}
                  onValueChange={(v) => setVisibility(v as QuestionVisibility)}
                  disabled={readOnly}
                >
                  <SelectTrigger className="h-9" data-testid="qb-visibility">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VISIBILITIES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {t(`questionBank.visibility.${v}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("questionBank.form.examPoints")}</Label>
              <ExamPointPicker
                value={examPoints}
                onChange={setExamPoints}
                disabled={readOnly}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("questionBank.form.programLinks")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {links.map((l) => (
                  <span
                    key={`${l.program_id}-${l.lesson_id ?? "p"}`}
                    className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
                    data-testid="qb-program-link"
                  >
                    {linkLabel(l)}
                    {!readOnly && (
                      <button
                        type="button"
                        className="rounded-full hover:bg-gray-300/60 p-0.5"
                        onClick={() => setLinks(links.filter((x) => x !== l))}
                        aria-label={t("questionBank.form.removeLink")}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {!readOnly && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <Select
                    value={linkProgramId}
                    onValueChange={(v) => {
                      setLinkProgramId(v);
                      setLinkLessonId("");
                    }}
                  >
                    <SelectTrigger
                      className="h-9 sm:flex-1"
                      data-testid="qb-link-program"
                    >
                      <SelectValue
                        placeholder={t("questionBank.form.pickProgram")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {programs.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={linkLessonId}
                    onValueChange={setLinkLessonId}
                    disabled={!selectedProgram?.lessons?.length}
                  >
                    <SelectTrigger
                      className="h-9 sm:flex-1"
                      data-testid="qb-link-lesson"
                    >
                      <SelectValue
                        placeholder={t("questionBank.form.pickLessonOptional")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(selectedProgram?.lessons ?? []).map((l) => (
                        <SelectItem key={l.id} value={String(l.id)}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1"
                    disabled={!selectedProgram}
                    onClick={addLink}
                    data-testid="qb-link-add"
                  >
                    <Plus size={14} />
                    {t("questionBank.form.addLink")}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** 後端 HTTPException 的 detail 可能是字串或 {message, duplicate} */
function extractApiMessage(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as { message?: unknown; detail?: unknown };
  const detail = anyErr.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const m = (detail as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return typeof anyErr.message === "string" ? anyErr.message : null;
}
