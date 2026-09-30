/**
 * 右欄的題組卡（Issue #1082：閱讀題組；克漏字同一張卡，差異只在小題）。
 *
 * 修訂後的樣子：淡外框＋標題列（一個面板多個題組時分得開），內容像一份文件
 * |題組標題|
 * |年段|
 * |主圖文：分頁「排版」（LayoutEditor：文件式區塊編輯器，預覽另開 Dialog）｜「文字版」|
 * |單字註解（一個文字框，一行一筆「word 中文」）|
 * |小題列表：QuestionCard compact（編號＋淡分隔線），可拖曳排序（group_order）、新增／刪除|
 *
 * 素材類型不讓老師選：儲存時由內容判定（questionDraft.deriveStimulusType）。
 * 「文字版」（#1083）：不顯示給學生，供搜尋／AI 考點分析／重複偵測。預設由排版推導；
 * 老師改過（`passage_text_edited`）就以老師的為準，排版再變也不覆蓋，可按「重新產生」回推導。
 * 以圖為準的題組（海報／漫畫）排版只有一張圖，文字版就是老師貼上的圖中文字。
 * 小題的考點、來源、教材關聯仍在各自的 QuestionCard；公開設定與年段跟隨題組（左欄套用）。
 */

import { useMemo, useRef, useState } from "react";
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
import { GripVertical, Plus, RefreshCw, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";
import { GradeRangeSlider } from "@/components/shared/GradeRangeSlider";
import type { Program } from "@/types";
import type { GlossaryEntry } from "@/types/questionBank";
import LayoutEditor from "./LayoutEditor";
import QuestionCard from "./QuestionCard";
import { DOC_TEXTAREA_CLASS, useAutoGrow } from "./useAutoGrow";
import {
  emptyGroupQuestion,
  glossaryToText,
  groupDerivedText,
  parseGlossaryText,
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

/**
 * 單字註解文字框：跟段落區塊一樣的無框、自動長高文字框，一行一筆「word 中文」。
 * 本地保留字串（打到一半的行不會被丟掉），每次輸入同步 parse 回陣列。
 */
function GlossaryTextarea({
  entries,
  onChange,
  disabled,
  testId,
}: {
  entries: GlossaryEntry[];
  onChange: (entries: GlossaryEntry[]) => void;
  disabled: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(() => glossaryToText(entries));
  useAutoGrow(ref, text);
  return (
    <Textarea
      ref={ref}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseGlossaryText(e.target.value));
      }}
      rows={1}
      placeholder={t("questionBank.group.glossary.placeholder")}
      className={cn(DOC_TEXTAREA_CLASS, "text-sm leading-relaxed")}
      disabled={disabled}
      data-testid={testId}
    />
  );
}

/**
 * 文字版分頁：不顯示給學生的純文字（搜尋／AI）。沒改過時顯示排版推導的文字，
 * 一打字就變成老師的版本（`passage_text_edited`）；「重新產生」回到推導文字。
 */
function PassageTextTab({
  draft,
  onPatch,
  disabled,
  testId,
}: {
  draft: GroupDraft;
  onPatch: (p: Partial<GroupDraft>) => void;
  disabled: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const derived = groupDerivedText(draft);
  const value = draft.passage_text_edited ? draft.passage_text : derived;
  useAutoGrow(ref, value);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-400">
          {t("questionBank.group.passage.hint")}
        </p>
        {draft.passage_text_edited && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 text-xs text-gray-600"
            onClick={() =>
              onPatch({
                passage_text: derived,
                passage_text_edited: false,
                serverError: null,
              })
            }
            data-testid={`${testId}-regen`}
          >
            <RefreshCw size={12} />
            {t("questionBank.group.passage.regenerate")}
          </Button>
        )}
      </div>
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) =>
          onPatch({
            passage_text: e.target.value,
            passage_text_edited: true,
            serverError: null,
          })
        }
        rows={1}
        placeholder={t("questionBank.group.passage.placeholder")}
        className={cn(
          DOC_TEXTAREA_CLASS,
          "rounded-md border border-gray-200 px-3 py-2 text-sm leading-relaxed",
        )}
        disabled={disabled}
        data-testid={testId}
      />
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
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
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

  const hasError = errorMessage !== null || draft.serverError !== null;

  return (
    <div
      id={`question-card-${draft.key}`}
      className={cn(
        "rounded-lg border bg-white",
        hasError ? "border-red-300" : "border-gray-200",
      )}
      data-testid={`qb-group-card-${index}`}
    >
      {/* 標題列：淡底，一個面板多個題組時用來分隔 */}
      <div
        className="flex items-center justify-between rounded-t-lg border-b border-gray-200 bg-gray-50 px-4 py-2"
        data-testid={`qg-${index}-header`}
      >
        <span className="min-w-0 truncate text-sm font-semibold text-gray-700">
          {index + 1}. {t(`questionBank.groupTypes.${draft.question_type}`)}
          {draft.title && (
            <span className="ml-2 font-normal text-gray-500">
              {draft.title}
            </span>
          )}
        </span>
        {onRemove && !readOnly && (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="shrink-0 text-gray-400 hover:text-red-600"
            aria-label={t("questionBank.form.removeQuestion")}
            data-testid={`qg-${index}-remove`}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className="space-y-4 p-4">
        {/* 題組標題 */}
        <Input
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value, serverError: null })}
          placeholder={t("questionBank.group.titlePlaceholder")}
          className="h-9"
          disabled={locked}
          data-testid={`qg-${index}-title`}
        />

        {/* 年段 */}
        <div className="space-y-1">
          <Label className="text-xs text-gray-600">
            {t("questionBank.form.grade")}
          </Label>
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

        {/* 主圖文：排版｜文字版 */}
        <Tabs defaultValue="layout" className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-gray-600">
              {t("questionBank.group.layout.title")}
            </Label>
            <TabsList className="h-7 p-0.5">
              <TabsTrigger
                value="layout"
                className="h-6 px-2 text-xs"
                data-testid={`qg-${index}-tab-layout`}
              >
                {t("questionBank.group.passage.tabLayout")}
              </TabsTrigger>
              <TabsTrigger
                value="text"
                className="h-6 gap-1 px-2 text-xs"
                data-testid={`qg-${index}-tab-text`}
              >
                {t("questionBank.group.passage.tabText")}
                {draft.passage_text_edited && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-amber-500"
                    title={t("questionBank.group.passage.edited")}
                    data-testid={`qg-${index}-passage-edited`}
                  />
                )}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="layout" className="mt-0">
            <LayoutEditor
              key={draft.key}
              layout={draft.layout}
              onChange={(layout) => patch({ layout, serverError: null })}
              glossary={draft.glossary}
              disabled={locked}
              testId={`qg-${index}-layout`}
            />
          </TabsContent>
          <TabsContent value="text" className="mt-0">
            <PassageTextTab
              draft={draft}
              onPatch={patch}
              disabled={locked}
              testId={`qg-${index}-passage-text`}
            />
          </TabsContent>
        </Tabs>

        {/* 單字註解：一個文字框，一行一筆 */}
        <div className="space-y-1.5">
          <Label className="text-xs text-gray-600">
            {t("questionBank.group.glossary.title")}
          </Label>
          <GlossaryTextarea
            key={draft.key}
            entries={draft.glossary}
            onChange={setGlossary}
            disabled={locked}
            testId={`qg-${index}-glossary`}
          />
        </div>

        {/* 小題：編號＋淡分隔線，不再每題一個外框 */}
        <div className="space-y-2 border-t border-gray-200 pt-3">
          <Label className="text-xs text-gray-600">
            {t("questionBank.group.questions.title", {
              count: draft.questions.length,
            })}
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
              <div className="divide-y divide-gray-100">
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
                      onRemove={
                        readOnly ? undefined : () => removeQuestion(q.key)
                      }
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
                      compact
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
    </div>
  );
}
