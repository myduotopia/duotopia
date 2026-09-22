/**
 * 新增／編輯選擇題側邊面板（Issue #1061 / #1064）。
 *
 * 與「新增教材內容」同構：從 sidebar 右緣滑出的全高面板，
 * - 標題列：儲存（擋住時下方一行寫原因）、刪除（單題編輯）、關閉
 * - 左欄：QuestionBankBatchPanel（單字集同一個 BatchWorkPanel 殼 + 批次設定卡）
 * - 右欄：多張 QuestionCard +「新增題目」
 *
 * 三種模式（由 `questions` 決定）：
 * - 新增（未傳／空）：左欄完整；批次值套到所有卡；公開設定由左欄選（必選）
 * - 單題編輯（1 題）：左欄 editOnly 只剩來源／公開，值預填該題
 * - 批次編輯（≥2 題，列表勾選同題型）：左欄完整但批次值**一律空白**（語音設定除外），
 *   老師改左欄才覆寫全部卡；每張卡各自帶自己的值（含公開／來源）；儲存逐題 PATCH，
 *   上傳擷取附加的新卡走 POST
 *
 * 批次設定（考點／年段／教材關聯／公開／來源）一改就覆寫右側所有題；新增的題帶左側目前值。
 * 新增：逐題 createQuestion；中途失敗停在該題、已成功的保留、該卡顯示後端訊息。
 * 「自動生成語音」勾選時，儲存前先補齊缺語音的題幹。
 * 語音／儲存進行中 setEditorBusy，關閉鍵跟著 disabled；有變更時關閉前 confirm。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/contexts/SidebarContext";
import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";
import type { ComboboxItem } from "@/components/shared/CreatableCombobox";
import type { MagicPasteMcItem } from "@/components/shared/MagicPasteInput";
import { getVoiceAndRate } from "@/utils/ttsVoiceResolver";
import type { Program } from "@/types";
import type { Question, QuestionVisibility } from "@/types/questionBank";
import QuestionCard from "./QuestionCard";
import QuestionBankBatchPanel from "./QuestionBankBatchPanel";
import {
  MAX_QUESTIONS_PER_BATCH,
  applyAiAnalysis,
  applyAiAnswers,
  batchDefaultsFromQuestion,
  draftFromQuestion,
  draftHasContent,
  draftsEligibleForAi,
  draftsFromExtracted,
  emptyBatchDefaults,
  emptyDraft,
  findBatchDuplicateKeys,
  toAiInputs,
  toCreateInput,
  toUpdateInput,
  validateDraft,
  type ApplyResult,
  type BatchDefaults,
  type QuestionDraft,
} from "./questionDraft";

const TTS_STORAGE_KEY = "duotopia_batch_tts_settings";
const DEFAULT_TTS: TTSSettingsState = {
  accent: "Random",
  gender: "Random",
  speed: "Normal x1",
};

export interface MultipleChoiceQuestionSheetProps {
  open: boolean;
  onClose: () => void;
  /** 編輯模式帶題目（1 題＝單題編輯；≥2 題＝批次編輯）；新增為空／未傳 */
  questions?: Question[] | null;
  /** 可關聯的教材包（含 lessons） */
  programs: Program[];
  /** 建到機構題庫時帶 organization_id（編輯時忽略） */
  organizationId?: string;
  /** 只讀（看別人公開的題目） */
  readOnly?: boolean;
  /** 是否可刪除（單題編輯） */
  canDelete?: boolean;
  onSaved: (question: Question) => void;
  onDeleted?: (questionId: number) => void;
}

function loadTtsSettings(): TTSSettingsState {
  try {
    const raw = localStorage.getItem(TTS_STORAGE_KEY);
    if (!raw) return DEFAULT_TTS;
    const parsed = JSON.parse(raw);
    return {
      accent: parsed.accent ?? DEFAULT_TTS.accent,
      gender: parsed.gender ?? DEFAULT_TTS.gender,
      speed: parsed.speed ?? DEFAULT_TTS.speed,
    };
  } catch {
    return DEFAULT_TTS;
  }
}

function absoluteAudioUrl(url: string): string {
  return url.startsWith("http") ? url : `${import.meta.env.VITE_API_URL}${url}`;
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

export default function MultipleChoiceQuestionSheet({
  open,
  onClose,
  questions = null,
  programs,
  organizationId,
  readOnly = false,
  canDelete = false,
  onSaved,
  onDeleted,
}: MultipleChoiceQuestionSheetProps) {
  const { t } = useTranslation();
  const { sidebarWidth, setEditorBusy } = useSidebar();
  const existing = questions ?? [];
  const mode: "create" | "edit" | "bulk" =
    existing.length === 0 ? "create" : existing.length === 1 ? "edit" : "bulk";
  const isEdit = mode === "edit";
  const single = isEdit ? existing[0] : null;

  const [drafts, setDrafts] = useState<QuestionDraft[]>([emptyDraft()]);
  const [batch, setBatch] = useState<BatchDefaults>(emptyBatchDefaults());
  // 左欄「套用到全部」的公開／來源；新增與批次編輯初始空白，單題編輯預填該題
  const [batchSources, setBatchSources] = useState<ComboboxItem[]>([]);
  const [batchVisibility, setBatchVisibility] =
    useState<QuestionVisibility | null>(null);
  const [ttsSettings, setTtsSettings] = useState<TTSSettingsState>(DEFAULT_TTS);
  const [autoTTS, setAutoTTS] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const dirtyRef = useRef(false);

  // 開啟時依模式初始化
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && single) {
      const d = draftFromQuestion(single);
      setDrafts([d]);
      setBatch(batchDefaultsFromQuestion(single));
      setBatchSources(d.sources);
      setBatchVisibility(d.visibility);
    } else if (mode === "bulk") {
      // 批次編輯：每張卡帶自己的值；左欄批次值一律空白，不從任何題預填（使用者定案）
      setDrafts(existing.map(draftFromQuestion));
      setBatch(emptyBatchDefaults());
      setBatchSources([]);
      setBatchVisibility(null);
    } else {
      const defaults = emptyBatchDefaults();
      setDrafts([emptyDraft(defaults)]);
      setBatch(defaults);
      setBatchSources([]);
      setBatchVisibility(null);
    }
    setTtsSettings(loadTtsSettings());
    setAutoTTS(false);
    dirtyRef.current = false;
    // existing 每次 render 都是新陣列，用 questions 當依賴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, questions]);

  const busy = saving || deleting || generatingAudio || aiBusy;
  useEffect(() => {
    setEditorBusy(busy);
    return () => setEditorBusy(false);
  }, [busy, setEditorBusy]);

  const updateDraft = useCallback((key: string, next: QuestionDraft) => {
    dirtyRef.current = true;
    setDrafts((prev) => prev.map((d) => (d.key === key ? next : d)));
  }, []);

  /** 左側批次設定（考點／年段／教材）：改了就覆寫右側所有題 */
  const applyBatch = (patch: Partial<BatchDefaults>) => {
    dirtyRef.current = true;
    setBatch((prev) => ({ ...prev, ...patch }));
    setDrafts((prev) => prev.map((d) => ({ ...d, ...patch })));
  };
  const applyVisibility = (v: QuestionVisibility) => {
    dirtyRef.current = true;
    setBatchVisibility(v);
    setDrafts((prev) => prev.map((d) => ({ ...d, visibility: v })));
  };
  const applySources = (next: ComboboxItem[]) => {
    dirtyRef.current = true;
    setBatchSources(next);
    setDrafts((prev) => prev.map((d) => ({ ...d, sources: next })));
  };

  const handleTtsSettingsChange = (s: TTSSettingsState) => {
    setTtsSettings(s);
    try {
      localStorage.setItem(TTS_STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* localStorage 不可用時忽略 */
    }
  };

  // ---- 驗證 ----
  const batchDupKeys = useMemo(() => findBatchDuplicateKeys(drafts), [drafts]);
  const errorKeys = useMemo(
    () =>
      drafts.map((d) =>
        validateDraft(d, { duplicateInBatch: batchDupKeys.has(d.key) }),
      ),
    [drafts, batchDupKeys],
  );
  const firstErrorIndex = errorKeys.findIndex((k) => k !== null);
  const validationMessage: string | null = readOnly
    ? null
    : firstErrorIndex >= 0
      ? t("questionBank.form.errors.atQuestion", {
          n: firstErrorIndex + 1,
          message: t(`questionBank.form.errors.${errorKeys[firstErrorIndex]}`),
        })
      : null;

  // ---- 題目增減 ----
  const newDraft = () => {
    const d = emptyDraft(batch);
    d.visibility = batchVisibility;
    d.sources = batchSources;
    return d;
  };
  const addQuestion = () => {
    if (drafts.length >= MAX_QUESTIONS_PER_BATCH) {
      toast.info(
        t("questionBank.form.limitReached", { max: MAX_QUESTIONS_PER_BATCH }),
      );
      return;
    }
    dirtyRef.current = true;
    const d = newDraft();
    setDrafts((prev) => [...prev, d]);
    window.setTimeout(() => {
      document
        .getElementById(`question-card-${d.key}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };
  const removeQuestion = (key: string) => {
    if (drafts.length <= 1) return;
    dirtyRef.current = true;
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  };

  // ---- 批次語音（只對題幹）----
  const pendingAudio = drafts.filter((d) => d.stem.trim() && !d.stem_audio_url);

  /** 對缺語音的題幹批次生成；回傳補上語音後的 drafts（儲存流程也用） */
  const fillMissingAudio = async (
    current: QuestionDraft[],
  ): Promise<QuestionDraft[]> => {
    const pending = current.filter((d) => d.stem.trim() && !d.stem_audio_url);
    if (pending.length === 0) return current;
    const { voice, rate } = getVoiceAndRate(
      ttsSettings.accent,
      ttsSettings.gender,
      ttsSettings.speed,
    );
    const res = (await apiClient.batchGenerateTTS(
      pending.map((d) => d.stem.trim()),
      voice,
      rate,
      "+0%",
    )) as { audio_urls?: (string | null)[] };
    const urls = res?.audio_urls ?? [];
    const byKey = new Map<string, string>();
    pending.forEach((d, i) => {
      const u = urls[i];
      if (u) byKey.set(d.key, absoluteAudioUrl(u));
    });
    return current.map((d) =>
      byKey.has(d.key) ? { ...d, stem_audio_url: byKey.get(d.key)! } : d,
    );
  };

  const generateAllAudio = async () => {
    if (pendingAudio.length === 0 || generatingAudio) return;
    setGeneratingAudio(true);
    try {
      const before = pendingAudio.length;
      const next = await fillMissingAudio(drafts);
      const after = next.filter(
        (d) => d.stem.trim() && !d.stem_audio_url,
      ).length;
      dirtyRef.current = true;
      setDrafts(next);
      toast.success(
        t("questionBank.form.tools.generated", { count: before - after }),
      );
    } catch (err) {
      console.error("Batch TTS failed:", err);
      toast.error(t("questionBank.form.ttsFailed"));
    } finally {
      setGeneratingAudio(false);
    }
  };

  // ---- AI 工具（#1065）：只填空的 ----
  const runAi = async (
    call: (inputs: ReturnType<typeof toAiInputs>) => Promise<{
      results:
        | Parameters<typeof applyAiAnswers>[1]
        | Parameters<typeof applyAiAnalysis>[1];
      skipped: string[];
    }>,
    apply: (current: QuestionDraft[], results: never) => ApplyResult,
  ) => {
    const eligible = draftsEligibleForAi(drafts);
    if (eligible.length === 0 || aiBusy) {
      toast.info(t("questionBank.form.tools.aiNothingToSend"));
      return;
    }
    setAiBusy(true);
    try {
      const res = await call(toAiInputs(eligible));
      const outcome = apply(drafts, res.results as never);
      dirtyRef.current = dirtyRef.current || outcome.applied > 0;
      setDrafts(outcome.drafts);
      const undecided = res.skipped.length;
      toast.success(
        t("questionBank.form.tools.aiApplied", {
          applied: outcome.applied,
          skipped: outcome.skipped + undecided,
        }),
      );
    } catch (err) {
      toast.error(
        extractApiMessage(err) ?? t("questionBank.form.tools.aiFailed"),
      );
    } finally {
      setAiBusy(false);
    }
  };
  const handleAiAnswer = () =>
    runAi(
      (inputs) => apiClient.aiAnswerQuestions(inputs),
      (current, results) => applyAiAnswers(current, results),
    );
  const handleAiAnalyze = () =>
    runAi(
      (inputs) => apiClient.aiAnalyzeQuestions(inputs),
      (current, results) => applyAiAnalysis(current, results),
    );

  /** 考卷擷取結果：第一張卡全空就取代，否則附加；超過上限截斷 */
  const handleInsertExtracted = (items: MagicPasteMcItem[]) => {
    if (items.length === 0) return;
    dirtyRef.current = true;
    setDrafts((prev) => {
      const base =
        prev.length === 1 && !draftHasContent(prev[0]) && !prev[0].existingId
          ? []
          : prev;
      const room = Math.max(0, MAX_QUESTIONS_PER_BATCH - base.length);
      const incoming = draftsFromExtracted(items.slice(0, room), batch).map(
        (d) => ({ ...d, visibility: batchVisibility, sources: batchSources }),
      );
      if (items.length > room) {
        toast.info(
          t("questionBank.form.limitReached", { max: MAX_QUESTIONS_PER_BATCH }),
        );
      }
      return [...base, ...incoming];
    });
  };

  // ---- 儲存 ----
  const scrollToCard = (key: string) =>
    document
      .getElementById(`question-card-${key}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });

  const handleSave = async () => {
    if (validationMessage || saving || readOnly) {
      if (firstErrorIndex >= 0) scrollToCard(drafts[firstErrorIndex].key);
      return;
    }
    setSaving(true);
    try {
      // 「自動生成語音」勾選：先補齊缺語音的題幹
      let toSubmit = drafts;
      if (autoTTS && pendingAudio.length > 0) {
        try {
          toSubmit = await fillMissingAudio(drafts);
          setDrafts(toSubmit);
        } catch (err) {
          console.error("Auto TTS before save failed:", err);
          toast.error(t("questionBank.form.ttsFailed"));
          return;
        }
      }

      // 逐題送：既有題 PATCH、新題 POST；失敗停在該題
      const remaining = [...toSubmit];
      let created = 0;
      let updated = 0;
      let last: Question | null = null;
      while (remaining.length > 0) {
        const d = remaining[0];
        try {
          if (d.existingId !== null) {
            last = await apiClient.updateQuestion(
              d.existingId,
              toUpdateInput(d),
            );
            updated += 1;
          } else {
            last = await apiClient.createQuestion(
              toCreateInput(d, organizationId),
            );
            created += 1;
          }
          remaining.shift();
        } catch (err) {
          const message =
            extractApiMessage(err) ?? t("questionBank.messages.saveFailed");
          setDrafts(
            remaining.map((r, i) =>
              i === 0 ? { ...r, serverError: message } : r,
            ),
          );
          if (created + updated > 0) {
            toast.warning(
              t("questionBank.messages.partiallySaved", {
                saved: created + updated,
                failed: remaining.length,
              }),
            );
            onSaved(last as Question);
          } else {
            toast.error(message);
          }
          scrollToCard(d.key);
          return;
        }
      }
      if (mode === "edit") toast.success(t("questionBank.messages.updated"));
      else if (mode === "bulk")
        toast.success(
          t("questionBank.messages.bulkSaved", { updated, created }),
        );
      else
        toast.success(
          t("questionBank.messages.createdCount", { count: created }),
        );
      dirtyRef.current = false;
      onSaved(last as Question);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!single || deleting) return;
    if (!window.confirm(t("questionBank.form.confirmDelete"))) return;
    setDeleting(true);
    try {
      await apiClient.deleteQuestion(single.id);
      toast.success(t("questionBank.messages.deleted"));
      dirtyRef.current = false;
      onDeleted?.(single.id);
      onClose();
    } catch (err) {
      toast.error(
        extractApiMessage(err) ?? t("questionBank.messages.deleteFailed"),
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleClose = () => {
    if (busy) return;
    if (
      dirtyRef.current &&
      !readOnly &&
      !window.confirm(t("contentEditor.labels.unsavedChangesConfirm"))
    )
      return;
    onClose();
  };

  if (!open) return null;

  const title = readOnly
    ? t("questionBank.form.titleView")
    : mode === "edit"
      ? t("questionBank.form.titleEdit")
      : mode === "bulk"
        ? t("questionBank.form.titleBulkEdit", { count: existing.length })
        : t("questionBank.form.titleCreate");
  const hasAnyStem = drafts.some((d) => d.stem.trim() !== "");
  const canAddOrExtract = !readOnly && mode !== "edit";

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-20 z-40 transition-opacity pointer-events-none" />
      <div
        className="editor-panel fixed top-0 right-0 h-screen bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col animate-in slide-in-from-right duration-300"
        style={{ left: `${sidebarWidth}px` }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="qb-sheet"
        data-mode={mode}
      >
        {/* 標題列 */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            {mode === "create" && !readOnly && (
              <p className="text-xs text-gray-500">
                {t("questionBank.form.batchHint", {
                  count: drafts.length,
                  max: MAX_QUESTIONS_PER_BATCH,
                })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isEdit && canDelete && !readOnly && (
              <Button
                type="button"
                variant="ghost"
                className="text-red-600 hover:text-red-700 gap-1"
                onClick={handleDelete}
                disabled={busy}
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
                disabled={!!validationMessage || busy}
                title={validationMessage ?? undefined}
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
              onClick={handleClose}
              disabled={busy}
              aria-label={t("common.close", "關閉")}
              data-testid="qb-close"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>
        {validationMessage && (
          <p
            className="px-6 py-1.5 text-xs text-gray-500 bg-gray-50 border-b border-gray-100 shrink-0"
            data-testid="qb-validation"
          >
            {validationMessage}
          </p>
        )}

        {/* 兩欄：左 = 單字集同款批次工作區（md 以上），右 = 題目卡 */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          <div className="flex gap-4 items-start">
            {/* 左欄：新增／批次編輯 = 完整批次區；單題編輯 = 只剩考題來源與是否公開（editOnly） */}
            {!readOnly && (
              <QuestionBankBatchPanel
                editOnly={isEdit}
                ttsSettings={ttsSettings}
                onTtsSettingsChange={handleTtsSettingsChange}
                autoTTS={autoTTS}
                onAutoTTSChange={setAutoTTS}
                pendingAudioCount={pendingAudio.length}
                onGenerateAllAudio={generateAllAudio}
                generatingAudio={generatingAudio}
                hasAnyStem={hasAnyStem}
                onAiAnswer={canAddOrExtract ? handleAiAnswer : undefined}
                onAiAnalyze={canAddOrExtract ? handleAiAnalyze : undefined}
                aiBusy={aiBusy}
                onInsertExtracted={
                  canAddOrExtract ? handleInsertExtracted : undefined
                }
                batch={batch}
                onBatchChange={applyBatch}
                programs={programs}
                sources={batchSources}
                onSourcesChange={applySources}
                visibility={batchVisibility}
                onVisibilityChange={applyVisibility}
                organizationId={organizationId}
                disabled={saving}
              />
            )}

            <div className="flex-1 min-w-0 space-y-4">
              {drafts.map((d, i) => (
                <QuestionCard
                  key={d.key}
                  index={i}
                  draft={d}
                  onChange={(next) => updateDraft(d.key, next)}
                  onRemove={
                    mode !== "edit" && drafts.length > 1
                      ? () => removeQuestion(d.key)
                      : undefined
                  }
                  excludeId={d.existingId ?? undefined}
                  ttsSettings={ttsSettings}
                  programs={programs}
                  errorMessage={
                    errorKeys[i]
                      ? t(`questionBank.form.errors.${errorKeys[i]}`)
                      : null
                  }
                  readOnly={readOnly}
                  disabled={saving}
                />
              ))}

              {canAddOrExtract && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-1.5"
                  onClick={addQuestion}
                  disabled={saving || drafts.length >= MAX_QUESTIONS_PER_BATCH}
                  data-testid="qb-add-question"
                >
                  <Plus size={16} />
                  {t("questionBank.form.addQuestion")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
