/**
 * 右欄的題組卡（Issue #1082：閱讀題組；克漏字同一張卡，差異只在小題）。
 *
 * |題組標題｜素材類型（文章／圖片／混合）|
 * |年段|
 * |主圖文區塊編輯器（LayoutEditor：結構 + 即時預覽）|
 * |單字註解（word／中文 列表）|
 * |小題列表：沿用 QuestionCard，可拖曳排序（group_order）、新增／刪除|
 *
 * 小題的考點、來源、教材關聯仍在各自的 QuestionCard；公開設定與年段跟隨題組（左欄套用）。
 * `passage_text` 儲存時由 layout 拼出（questionDraft.toCreateGroupInput）。
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";
import { GradeRangeSlider } from "@/components/shared/GradeRangeSlider";
import type { Program } from "@/types";
import type { GlossaryEntry, StimulusType } from "@/types/questionBank";
import LayoutEditor from "./LayoutEditor";
import QuestionCard from "./QuestionCard";
import {
  emptyGroupQuestion,
  validateDraft,
  type GroupDraft,
  type QuestionDraft,
} from "./questionDraft";

export interface GroupCardProps {
  index: number;
  draft: GroupDraft;
  onChange: (next: GroupDraft) => void;
  onRemove?: () => void;
  ttsSettings: TTSSettingsState;
  programs: Program[];
  /** 整組的驗證訊息（由外層算） */
  errorMessage: string | null;
  readOnly?: boolean;
  disabled?: boolean;
}

const STIMULUS_OPTIONS: StimulusType[] = ["passage", "image", "mixed"];

function SortableQuestion({
  id,
  disabled,
  handleLabel,
  children,
}: {
  id: string;
  disabled: boolean;
  handleLabel: string;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex items-start gap-1"
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        disabled={disabled}
        className="mt-4 shrink-0 cursor-grab touch-none text-gray-400 hover:text-gray-700 disabled:cursor-default"
        title={handleLabel}
        aria-label={handleLabel}
      >
        <GripVertical size={16} />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export default function GroupCard({
  index,
  draft,
  onChange,
  onRemove,
  ttsSettings,
  programs,
  errorMessage,
  readOnly = false,
  disabled = false,
}: GroupCardProps) {
  const { t } = useTranslation();
  const locked = readOnly || disabled;
  const patch = (p: Partial<GroupDraft>) => onChange({ ...draft, ...p });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ---- 小題 ----
  const updateQuestion = (key: string, next: QuestionDraft) =>
    patch({
      questions: draft.questions.map((q) => (q.key === key ? next : q)),
      serverError: null,
    });
  const addQuestion = () => {
    const q = emptyGroupQuestion(draft);
    patch({ questions: [...draft.questions, q] });
    window.setTimeout(() => {
      document
        .getElementById(`question-card-${q.key}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  };
  const removeQuestion = (key: string) =>
    patch({ questions: draft.questions.filter((q) => q.key !== key) });
  const onQuestionDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = draft.questions.findIndex((q) => q.key === active.id);
    const to = draft.questions.findIndex((q) => q.key === over.id);
    if (from < 0 || to < 0) return;
    patch({ questions: arrayMove(draft.questions, from, to) });
  };
  const questionErrors = useMemo(
    () =>
      draft.questions.map((q) =>
        validateDraft({ ...q, visibility: draft.visibility ?? q.visibility }),
      ),
    [draft.questions, draft.visibility],
  );

  // ---- 單字註解 ----
  const setGlossary = (glossary: GlossaryEntry[]) => patch({ glossary });
  const patchGlossary = (i: number, p: Partial<GlossaryEntry>) =>
    setGlossary(draft.glossary.map((g, idx) => (idx === i ? { ...g, ...p } : g)));

  const hasError = errorMessage !== null || draft.serverError !== null;

  return (
    <div
      id={`question-card-${draft.key}`}
      className={`rounded-lg border bg-white p-4 space-y-4 ${
        hasError ? "border-red-300" : "border-gray-200"
      }`}
      data-testid={`qb-group-card-${index}`}
    >
      {/* 標題列 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">
          {index + 1}. {t(`questionBank.types.${draft.question_type}`)}
        </span>
        {onRemove && !readOnly && (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="text-gray-400 hover:text-red-600"
            aria-label={t("questionBank.form.removeQuestion")}
            data-testid={`qg-${index}-remove`}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* 題組標題 / 素材類型 */}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
        <Input
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value, serverError: null })}
          placeholder={t("questionBank.group.titlePlaceholder")}
          className="h-9"
          disabled={locked}
          data-testid={`qg-${index}-title`}
        />
        <Select
          value={draft.stimulus_type}
          onValueChange={(v) => patch({ stimulus_type: v as StimulusType })}
          disabled={locked}
        >
          <SelectTrigger className="h-9" data-testid={`qg-${index}-stimulus`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STIMULUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`questionBank.group.stimulus.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 年段 */}
      <div className="space-y-1">
        <Label className="text-xs text-gray-600">{t("questionBank.form.grade")}</Label>
        <GradeRangeSlider
          value={draft.grade}
          onChange={(grade) =>
            patch({
              grade,
              questions: draft.questions.map((q) => ({ ...q, grade })),
            })
          }
          disabled={locked}
          compact
          data-testid={`qg-${index}-grade`}
        />
      </div>

      {/* 主圖文 */}
      <div className="space-y-1">
        <Label className="text-xs text-gray-600">
          {t("questionBank.group.layout.title")}
        </Label>
        <LayoutEditor
          key={draft.key}
          layout={draft.layout}
          onChange={(layout) => patch({ layout, serverError: null })}
          glossary={draft.glossary}
          disabled={locked}
          testId={`qg-${index}-layout`}
        />
      </div>

      {/* 單字註解 */}
      <div className="space-y-1.5">
        <Label className="text-xs text-gray-600">
          {t("questionBank.group.glossary.title")}
        </Label>
        {draft.glossary.map((g, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              value={g.word}
              onChange={(e) => patchGlossary(i, { word: e.target.value })}
              placeholder={t("questionBank.group.glossary.word")}
              className="h-8 text-sm"
              disabled={locked}
              data-testid={`qg-${index}-glossary-word-${i}`}
            />
            <Input
              value={g.zh}
              onChange={(e) => patchGlossary(i, { zh: e.target.value })}
              placeholder={t("questionBank.group.glossary.zh")}
              className="h-8 text-sm"
              disabled={locked}
              data-testid={`qg-${index}-glossary-zh-${i}`}
            />
            <button
              type="button"
              onClick={() => setGlossary(draft.glossary.filter((_, idx) => idx !== i))}
              disabled={locked}
              className="text-gray-400 hover:text-red-600 disabled:opacity-40"
              aria-label={t("questionBank.group.glossary.remove")}
              data-testid={`qg-${index}-glossary-remove-${i}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-gray-600"
            onClick={() => setGlossary([...draft.glossary, { word: "", zh: "" }])}
            disabled={disabled}
            data-testid={`qg-${index}-glossary-add`}
          >
            <Plus size={12} />
            {t("questionBank.group.glossary.add")}
          </Button>
        )}
      </div>

      {/* 小題 */}
      <div className="space-y-3 border-t border-gray-100 pt-3">
        <Label className="text-xs text-gray-600">
          {t("questionBank.group.questions.title", { count: draft.questions.length })}
        </Label>
        {draft.questions.length === 0 && (
          <p className="text-xs text-gray-400">
            {t("questionBank.group.questions.empty")}
          </p>
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onQuestionDragEnd}
        >
          <SortableContext
            items={draft.questions.map((q) => q.key)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3">
              {draft.questions.map((q, i) => (
                <SortableQuestion
                  key={q.key}
                  id={q.key}
                  disabled={locked}
                  handleLabel={t("questionBank.group.questions.drag")}
                >
                  <QuestionCard
                    index={i}
                    draft={q}
                    onChange={(next) => updateQuestion(q.key, next)}
                    onRemove={readOnly ? undefined : () => removeQuestion(q.key)}
                    excludeId={q.existingId ?? undefined}
                    ttsSettings={ttsSettings}
                    programs={programs}
                    errorMessage={
                      questionErrors[i]
                        ? t(`questionBank.form.errors.${questionErrors[i]}`)
                        : null
                    }
                    readOnly={readOnly}
                    disabled={disabled}
                    stemOptional={draft.question_type === "cloze"}
                    testIdPrefix={`qg-${index}-q`}
                  />
                </SortableQuestion>
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            onClick={addQuestion}
            disabled={disabled}
            data-testid={`qg-${index}-add-question`}
          >
            <Plus size={14} />
            {t("questionBank.group.questions.add")}
          </Button>
        )}
      </div>

      {(errorMessage || draft.serverError) && (
        <p className="text-xs text-red-600" data-testid={`qg-${index}-error`}>
          {draft.serverError ?? errorMessage}
        </p>
      )}
    </div>
  );
}
