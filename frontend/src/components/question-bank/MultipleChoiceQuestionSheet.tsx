/**
 * 新增／編輯選擇題側邊面板（Issue #1061 / #1064）。
 *
 * 與「新增教材內容」同構：從 sidebar 右緣滑出的全高面板，
 * - 標題列：儲存（擋住時下方一行寫原因）、刪除（編輯模式）、關閉
 * - 左欄（md 以上 sticky）：工具區 QuestionBankToolsPanel + 整批共用設定 QuestionBankSettingsPanel
 * - 右欄：多張 QuestionCard +「新增題目」
 *
 * 新增：右側每題各自一筆，逐題 createQuestion，共用設定併入每題；中途失敗停在該題、
 * 已成功的保留、該卡顯示後端訊息。編輯：單卡 + updateQuestion。
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
import { getVoiceAndRate } from "@/utils/ttsVoiceResolver";
import type { Program } from "@/types";
import type { Question } from "@/types/questionBank";
import QuestionCard from "./QuestionCard";
import QuestionBankToolsPanel from "./QuestionBankToolsPanel";
import QuestionBankSettingsPanel from "./QuestionBankSettingsPanel";
import {
  MAX_QUESTIONS_PER_BATCH,
  defaultSharedSettings,
  draftFromQuestion,
  emptyDraft,
  findBatchDuplicateKeys,
  sharedSettingsFromQuestion,
  toCreateInput,
  validateDraft,
  validateShared,
  type QuestionDraft,
  type SharedSettings,
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
  question = null,
  programs,
  organizationId,
  readOnly = false,
  canDelete = false,
  onSaved,
  onDeleted,
}: MultipleChoiceQuestionSheetProps) {
  const { t } = useTranslation();
  const { sidebarWidth, setEditorBusy } = useSidebar();
  const isEdit = question !== null;

  const [drafts, setDrafts] = useState<QuestionDraft[]>([emptyDraft()]);
  const [shared, setShared] = useState<SharedSettings>(defaultSharedSettings());
  const [ttsSettings, setTtsSettings] = useState<TTSSettingsState>(DEFAULT_TTS);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const dirtyRef = useRef(false);

  // 開啟時依模式初始化
  useEffect(() => {
    if (!open) return;
    if (question) {
      setDrafts([draftFromQuestion(question)]);
      setShared(sharedSettingsFromQuestion(question));
    } else {
      setDrafts([emptyDraft()]);
      setShared(defaultSharedSettings());
    }
    setTtsSettings(loadTtsSettings());
    dirtyRef.current = false;
  }, [open, question]);

  const busy = saving || deleting || generatingAudio;
  useEffect(() => {
    setEditorBusy(busy);
    return () => setEditorBusy(false);
  }, [busy, setEditorBusy]);

  const updateDraft = useCallback((key: string, next: QuestionDraft) => {
    dirtyRef.current = true;
    setDrafts((prev) => prev.map((d) => (d.key === key ? next : d)));
  }, []);

  const updateShared = (next: SharedSettings) => {
    dirtyRef.current = true;
    setShared(next);
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
  const sharedErrorKey = validateShared(shared);
  const firstErrorIndex = errorKeys.findIndex((k) => k !== null);
  const validationMessage: string | null = readOnly
    ? null
    : sharedErrorKey
      ? t(`questionBank.form.errors.${sharedErrorKey}`)
      : firstErrorIndex >= 0
        ? t("questionBank.form.errors.atQuestion", {
            n: firstErrorIndex + 1,
            message: t(
              `questionBank.form.errors.${errorKeys[firstErrorIndex]}`,
            ),
          })
        : null;

  // ---- 題目增減 ----
  const addQuestion = () => {
    if (drafts.length >= MAX_QUESTIONS_PER_BATCH) {
      toast.info(
        t("questionBank.form.limitReached", { max: MAX_QUESTIONS_PER_BATCH }),
      );
      return;
    }
    dirtyRef.current = true;
    const d = emptyDraft();
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

  // ---- 批次語音（只對題幹） ----
  const pendingAudio = drafts.filter((d) => d.stem.trim() && !d.stem_audio_url);
  const generateAllAudio = async () => {
    if (pendingAudio.length === 0 || generatingAudio) return;
    setGeneratingAudio(true);
    try {
      const { voice, rate } = getVoiceAndRate(
        ttsSettings.accent,
        ttsSettings.gender,
        ttsSettings.speed,
      );
      const res = (await apiClient.batchGenerateTTS(
        pendingAudio.map((d) => d.stem.trim()),
        voice,
        rate,
        "+0%",
      )) as { audio_urls?: (string | null)[] };
      const urls = res?.audio_urls ?? [];
      const byKey = new Map<string, string>();
      pendingAudio.forEach((d, i) => {
        const u = urls[i];
        if (u) byKey.set(d.key, absoluteAudioUrl(u));
      });
      dirtyRef.current = true;
      setDrafts((prev) =>
        prev.map((d) =>
          byKey.has(d.key) ? { ...d, stem_audio_url: byKey.get(d.key)! } : d,
        ),
      );
      toast.success(
        t("questionBank.form.tools.generated", { count: byKey.size }),
      );
    } catch (err) {
      console.error("Batch TTS failed:", err);
      toast.error(t("questionBank.form.ttsFailed"));
    } finally {
      setGeneratingAudio(false);
    }
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
      if (isEdit && question) {
        const payload = toCreateInput(drafts[0], shared);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { question_type, organization_id, school_id, ...update } =
          payload;
        const saved = await apiClient.updateQuestion(question.id, update);
        toast.success(t("questionBank.messages.updated"));
        dirtyRef.current = false;
        onSaved(saved);
        onClose();
        return;
      }

      // 新增：逐題送，失敗停在該題
      const remaining = [...drafts];
      let savedCount = 0;
      let last: Question | null = null;
      while (remaining.length > 0) {
        const d = remaining[0];
        try {
          last = await apiClient.createQuestion(
            toCreateInput(d, shared, organizationId),
          );
          savedCount += 1;
          remaining.shift();
        } catch (err) {
          const message =
            extractApiMessage(err) ?? t("questionBank.messages.saveFailed");
          setDrafts(
            remaining.map((r, i) =>
              i === 0 ? { ...r, serverError: message } : r,
            ),
          );
          if (savedCount > 0) {
            toast.warning(
              t("questionBank.messages.partiallySaved", {
                saved: savedCount,
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
      toast.success(
        t("questionBank.messages.createdCount", { count: savedCount }),
      );
      dirtyRef.current = false;
      onSaved(last as Question);
      onClose();
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
      dirtyRef.current = false;
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
    : isEdit
      ? t("questionBank.form.titleEdit")
      : t("questionBank.form.titleCreate");
  const hasAnyStem = drafts.some((d) => d.stem.trim() !== "");

  const leftColumn = (
    <>
      {!readOnly && (
        <QuestionBankToolsPanel
          ttsSettings={ttsSettings}
          onTtsSettingsChange={handleTtsSettingsChange}
          pendingAudioCount={pendingAudio.length}
          onGenerateAllAudio={generateAllAudio}
          generatingAudio={generatingAudio}
          hasAnyStem={hasAnyStem}
          disabled={saving}
        />
      )}
      <QuestionBankSettingsPanel
        value={shared}
        onChange={updateShared}
        programs={programs}
        readOnly={readOnly || saving}
        errorMessage={
          sharedErrorKey
            ? t(`questionBank.form.errors.${sharedErrorKey}`)
            : null
        }
      />
    </>
  );

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
      >
        {/* 標題列 */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            {!isEdit && !readOnly && (
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

        {/* 兩欄 */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          <div className="flex gap-4 items-start">
            {/* 左欄（md 以上） */}
            <div className="hidden md:flex md:w-[35%] flex-col gap-4 border rounded-lg bg-gray-50 p-4 sticky top-0 self-start max-h-[calc(100vh-180px)] overflow-y-auto overscroll-contain">
              {leftColumn}
            </div>

            {/* 右欄 */}
            <div className="flex-1 min-w-0 space-y-4">
              {/* 手機：左欄內容摺疊在上方 */}
              <details className="md:hidden border rounded-lg bg-gray-50 p-3">
                <summary className="text-sm font-medium text-gray-800 cursor-pointer">
                  {t("questionBank.form.settings.title")}
                </summary>
                <div className="mt-3 space-y-4">{leftColumn}</div>
              </details>

              {drafts.map((d, i) => (
                <QuestionCard
                  key={d.key}
                  index={i}
                  draft={d}
                  onChange={(next) => updateDraft(d.key, next)}
                  onRemove={
                    !isEdit && drafts.length > 1
                      ? () => removeQuestion(d.key)
                      : undefined
                  }
                  excludeId={question?.id}
                  ttsSettings={ttsSettings}
                  errorMessage={
                    errorKeys[i]
                      ? t(`questionBank.form.errors.${errorKeys[i]}`)
                      : null
                  }
                  readOnly={readOnly}
                  disabled={saving}
                />
              ))}

              {!isEdit && !readOnly && (
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
