/**
 * 右欄的題組卡（Issue #1082：閱讀題組；克漏字同一張卡，差異只在小題）。
 *
 * 修訂後的樣子：淡外框＋標題列（一個面板多個題組時分得開），內容像一份文件
 * |題組標題|
 * |年段|
 * |主圖文：分頁「排版」（LayoutEditor：文件式區塊編輯器；預覽在面板標題列
 *   `SheetPreviewButton`，看整個題組＝主圖文＋小題＋選項，不含答案）｜「文字版」|
 *   標題列右側「整篇加外框」勾選切換 `layout.frame`（還沒有排版時灰掉）。
 *   分頁是受控的：目前分頁存在草稿 `passage_view`（純 UI 狀態，不送後端），標題列「預覽」
 *   跟著它走——在文字版分頁按預覽就以文字版呈現主圖文（給老師檢查用，學生仍看排版）|
 * |單字註解（一個文字框，一行一筆「word 中文」）|
 * |小題列表：QuestionCard compact（編號＋淡分隔線），可拖曳排序（group_order）、新增／刪除|
 *
 * 素材類型不讓老師選：儲存時由內容判定（questionDraft.deriveStimulusType）。
 * 「文字版」（#1083）：不顯示給學生，供搜尋／AI 考點分析／重複偵測。預設由排版推導；
 * 老師改過（`passage_text_edited`）就以老師的為準，排版再變也不覆蓋，可按「重新產生」回推導。
 * 以圖為準的題組（海報／漫畫）排版只有一張圖，文字版就是老師貼上的圖中文字。
 * 圖中有人物對話時（#1083）文字版改為唯讀對話樣式（`DialogueTranscriptView`）：逐句
 * 「說話者: 台詞」由 AI 整理、是題組對話音檔的來源，老師不可修改（原因見 PassageTextTab）。
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
import {
  GripVertical,
  ListOrdered,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";
import { GradeRangeSlider } from "@/components/shared/GradeRangeSlider";
import type { Program } from "@/types";
import type { GlossaryEntry, LayoutDoc } from "@/types/questionBank";
import { DialogueTranscriptView } from "./DialogueTranscriptView";
import { dialogueNarration } from "./dialogueTranscript";
import LayoutEditor from "./LayoutEditor";
import QuestionCard from "./QuestionCard";
import { DOC_TEXTAREA_CLASS, useAutoGrow } from "./useAutoGrow";
import {
  appendClozeBlank,
  clozeCanRenumber,
  clozeOrphanBlanksOf,
  emptyGroupQuestion,
  glossaryToText,
  groupDerivedText,
  groupPassageText,
  isClozeGroup,
  nextClozeBlankIndex,
  parseGlossaryText,
  reinsertClozeBlank,
  renumberClozeBlanks,
  sortClozeQuestions,
  syncClozeQuestions,
  validateDraft,
  type GroupDraft,
  type QuestionDraft,
} from "./questionDraft";

/** AI 標題最多送幾條小題題幹（對齊後端 MAX_TITLE_STEMS） */
const AI_TITLE_MAX_STEMS = 20;
/** AI 標題最多送多少字的主圖文（對齊後端 MAX_PASSAGE_CHARS） */
const AI_TITLE_MAX_PASSAGE_CHARS = 6000;

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
  if (draft.segments.length > 0) {
    // 決策（#1083，2026-10-06，使用者定案）：有對話文稿時文字版「唯讀」。
    // - 對話文稿是題組對話音檔的唯一來源（一題組一個音檔，Gemini 2.5 Flash TTS
    //   多說話者）；老師改了文稿而音檔不重生，文字與聲音就會不一致。
    // - 圖片上的文字本來就改不了（學生看的是圖），所以以 AI 整理的逐句對話為準。
    // - 原本的痛點是圖片擷取出的文字一整坨疊在一起、難以對照；不做「點圖分段修改」，
    //   改用清楚的說話者標示（每句一行、說話者粗體）解決。
    // 因此這裡不顯示編輯框與「重新產生」；沒有對話的題組（海報、地圖、散文）維持可編輯。
    return (
      <DialogueTranscriptView
        narration={dialogueNarration(draft.passage_text, draft.segments)}
        segments={draft.segments}
        testId={testId}
      />
    );
  }
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
      {draft.passage_text_edited && !draft.passage_text.trim() && (
        <p
          className="text-xs text-amber-700"
          data-testid={`${testId.replace(/-text$/, "")}-empty-hint`}
        >
          {t("questionBank.group.passage.emptyReverts")}
        </p>
      )}
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
  // 非同步回填（例如 AI 標題）要以「最新草稿」為底，否則等待期間老師的編輯會被蓋掉
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const patch = (p: Partial<GroupDraft>) =>
    onChange({ ...draftRef.current, ...p });

  // ---- AI 標題（#1084）----
  const [titleBusy, setTitleBusy] = useState(false);
  const titleStems = draft.questions
    .map((q) => q.stem.trim())
    .filter(Boolean)
    .slice(0, AI_TITLE_MAX_STEMS);
  const titlePassage = (groupPassageText(draft) ?? "")
    .trim()
    .slice(0, AI_TITLE_MAX_PASSAGE_CHARS);
  const canSuggestTitle = Boolean(titlePassage) || titleStems.length > 0;
  const suggestTitle = async () => {
    if (!canSuggestTitle || titleBusy) return;
    setTitleBusy(true);
    try {
      // 老師是主動按的，直接覆蓋現有標題
      const res = await apiClient.aiSuggestGroupTitle(titlePassage, titleStems);
      patch({ title: res.title, serverError: null });
    } catch {
      toast.error(t("questionBank.form.tools.aiFailed"));
    } finally {
      setTitleBusy(false);
    }
  };

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
  const scrollToCard = (key: string) =>
    window.setTimeout(() => {
      document
        .getElementById(`question-card-${key}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  const addQuestion = () => {
    const q = emptyGroupQuestion(draft);
    patch({ questions: [...draft.questions, q] });
    scrollToCard(q.key);
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
  // ---- 克漏字（#1085）----
  const isCloze = isClozeGroup(draft);
  // 以 key 為索引：克漏字的顯示順序依 blank_index 排，與陣列順序不一定相同。
  // 克漏字小題沒有自己的題幹（題幹就是文章裡的空格），所以要關掉 stemRequired。
  const questionErrors = useMemo(
    () =>
      new Map(
        draft.questions.map((q) => [
          q.key,
          validateDraft(
            { ...q, visibility: draft.visibility ?? q.visibility },
            { stemOptional: isCloze },
          ),
        ]),
      ),
    [draft.questions, draft.visibility, isCloze],
  );

  /**
   * 排版改動一律經過這裡：空格差集 → 新空格自動建卡、消失的空白小題自動移除。
   * 只有完整 `{{n}}` 配對才算空格，所以打字打到 `{{4` 不會誤新增。
   */
  const setLayout = (layout: LayoutDoc | null) => {
    const base = draftRef.current;
    const before = base.questions;
    const synced = syncClozeQuestions(base, base.layout, layout);
    onChange({ ...synced, layout, serverError: null });
    const added = synced.questions.find(
      (q) => !before.some((p) => p.key === q.key),
    );
    if (added) scrollToCard(added.key);
  };
  const orphanBlanks = clozeOrphanBlanksOf(draft);
  // 下一個空格編號（max+1；>999 才找最小未用；全滿 null）。走一次 layout＋小題，memo 避免每次打字都重算
  const nextBlank = useMemo(
    () => (isCloze ? nextClozeBlankIndex(draft) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isCloze, draft.layout, draft.questions],
  );
  // 1..999 全部用完 → 不能再插空格（插了會跟既有小題撞號）
  const blankLimitReached = isCloze && nextBlank === null;
  const addClozeBlank = () => {
    const base = draftRef.current;
    const next = appendClozeBlank(base);
    onChange({ ...next, serverError: null });
    const added = next.questions.find(
      (q) => !base.questions.some((p) => p.key === q.key),
    );
    if (added) scrollToCard(added.key);
  };

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
        {/* 題組標題（右側「AI 標題」：依主圖文／小題題幹產一個短標題，#1084） */}
        <div className="flex items-center gap-2">
          <Input
            value={draft.title}
            onChange={(e) =>
              patch({ title: e.target.value, serverError: null })
            }
            placeholder={t("questionBank.group.titlePlaceholder")}
            className="h-9"
            disabled={locked}
            data-testid={`qg-${index}-title`}
          />
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 gap-1"
              onClick={suggestTitle}
              disabled={locked || titleBusy || !canSuggestTitle}
              title={
                canSuggestTitle
                  ? t("questionBank.group.titleAi")
                  : t("questionBank.group.titleAiEmpty")
              }
              data-testid={`qg-${index}-title-ai`}
            >
              <Sparkles size={14} />
              {t("questionBank.group.titleAi")}
            </Button>
          )}
        </div>

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
        <Tabs
          value={draft.passage_view}
          onValueChange={(v) =>
            patch({ passage_view: v === "text" ? "text" : "layout" })
          }
          className="space-y-1"
        >
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-gray-600">
              {t("questionBank.group.layout.title")}
            </Label>
            <label className="ml-auto flex items-center gap-1 text-xs text-gray-600">
              <Checkbox
                checked={draft.layout?.frame === true}
                onCheckedChange={(c) =>
                  draft.layout &&
                  setLayout({ ...draft.layout, frame: c === true })
                }
                disabled={locked || !draft.layout}
                data-testid={`qg-${index}-layout-frame`}
              />
              {t("questionBank.group.layout.frameAll")}
            </label>
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
              onChange={setLayout}
              disabled={locked}
              testId={`qg-${index}-layout`}
              clozeMode={isCloze}
              nextBlankIndex={nextBlank ?? undefined}
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
          {isCloze ? (
            // 克漏字：排序由空格編號決定（拖曳沒有意義），所以不包 dnd-kit
            <div className="divide-y divide-gray-100">
              {sortClozeQuestions(draft.questions).map((q, i) => (
                <div key={q.key} className="py-1">
                  {q.blank_index !== null &&
                    orphanBlanks.includes(q.blank_index) && (
                      <div
                        className="mb-1 flex flex-wrap items-center gap-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700"
                        data-testid={`qg-${index}-q-${i}-blank-missing`}
                      >
                        <span>
                          {t("questionBank.group.questions.blankMissing", {
                            n: q.blank_index,
                          })}
                        </span>
                        {!readOnly && (
                          <>
                            <button
                              type="button"
                              className="underline disabled:opacity-50"
                              disabled={disabled}
                              onClick={() =>
                                onChange(
                                  reinsertClozeBlank(
                                    draftRef.current,
                                    q.blank_index as number,
                                  ),
                                )
                              }
                              data-testid={`qg-${index}-q-${i}-reinsert-blank`}
                            >
                              {t("questionBank.group.questions.reinsertBlank")}
                            </button>
                            <button
                              type="button"
                              className="underline disabled:opacity-50"
                              disabled={disabled}
                              onClick={() => removeQuestion(q.key)}
                              data-testid={`qg-${index}-q-${i}-remove-blank`}
                            >
                              {t("questionBank.group.questions.removeBlank")}
                            </button>
                          </>
                        )}
                      </div>
                    )}
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
                      questionErrors.get(q.key)
                        ? t(
                            `questionBank.form.errors.${questionErrors.get(q.key)}`,
                          )
                        : null
                    }
                    readOnly={readOnly}
                    disabled={disabled}
                    stemOptional
                    clozeBlank={q.blank_index}
                    testIdPrefix={`qg-${index}-q`}
                    compact
                  />
                </div>
              ))}
            </div>
          ) : (
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
                          questionErrors.get(q.key)
                            ? t(
                                `questionBank.form.errors.${questionErrors.get(q.key)}`,
                              )
                            : null
                        }
                        readOnly={readOnly}
                        disabled={disabled}
                        testIdPrefix={`qg-${index}-q`}
                        compact
                      />
                    </SortableQuestion>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5"
                onClick={isCloze ? addClozeBlank : addQuestion}
                disabled={disabled || (isCloze && blankLimitReached)}
                title={
                  isCloze && blankLimitReached
                    ? t("questionBank.group.layout.blankLimit")
                    : undefined
                }
                data-testid={`qg-${index}-add-question`}
              >
                <Plus size={14} />
                {t(
                  isCloze
                    ? "questionBank.group.questions.appendBlank"
                    : "questionBank.group.questions.add",
                )}
              </Button>
              {isCloze && clozeCanRenumber(draft) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() =>
                    onChange(renumberClozeBlanks(draftRef.current))
                  }
                  disabled={disabled}
                  data-testid={`qg-${index}-renumber-blanks`}
                >
                  <ListOrdered size={14} />
                  {t("questionBank.group.questions.renumber")}
                </Button>
              )}
            </div>
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
