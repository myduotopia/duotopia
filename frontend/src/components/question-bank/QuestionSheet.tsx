/**
 * 題庫新增／編輯側邊面板（Issue #1061 / #1064 / #1082）。
 *
 * 三層：本檔是外殼（標題列、左欄批次、送出流程、AI／語音工具、mode 判定）；
 * 右欄交給 `QuestionUnitList` 依單元 kind 分流（單題 → `QuestionCard`；題組 → GroupCard）；
 * 卡片本身不知道 sheet。舊名 `MultipleChoiceQuestionSheet` 仍可 import（re-export）。
 *
 * 與「新增教材內容」同構：從 sidebar 右緣滑出的全高面板，
 * - 標題列：預覽（單題模式；`SheetPreviewButton`，題組模式用 LayoutEditor 內的入口）、
 *   儲存（擋住時下方一行寫原因）、刪除（單題編輯）、關閉
 * - 左欄：QuestionBankBatchPanel（單字集同一個 BatchWorkPanel 殼 + 批次設定卡）
 * - 右欄：多個「單元」+「新增題目」
 *
 * 四種模式（由 `questions` / `groupId` / `createType` 決定）：
 * - 新增（未傳／空）：左欄完整；批次值套到所有單元；公開設定由左欄選（必選）。
 *   `createType` 為題組題型（reading）時右欄是一張 `GroupCard`，一次只建一個題組
 * - 單題編輯（1 題）：左欄 editOnly 只剩來源／公開，值預填該題
 * - 題組編輯（`groupId`）：開啟時 getQuestionGroup 載入 → 一張 GroupCard；左欄 editOnly；
 *   儲存 updateQuestionGroup（整組替換、單交易）、刪除 deleteQuestionGroup（整組軟刪除）
 * - 批次編輯（≥2 題，列表勾選同題型）：左欄完整但批次值**一律空白**（語音設定除外），
 *   老師改左欄才覆寫全部卡；每張卡各自帶自己的值（含公開／來源）；儲存逐題 PATCH，
 *   上傳擷取附加的新卡走 POST
 *
 * 批次設定（考點／年段／教材關聯／公開／來源）一改就覆寫右側所有單元；新增的帶左側目前值。
 * 儲存逐單元送：單題 createQuestion／updateQuestion，題組 createQuestionGroup／updateQuestionGroup；
 * 中途失敗停在該單元、已成功的保留、該卡顯示後端訊息。
 * AI 作答／考點分析：題組小題附主圖文純文字當上下文。
 * 「自動生成語音」勾選時，儲存前先補齊缺語音的題幹（含題組小題）。
 * 語音／儲存進行中 setEditorBusy，關閉鍵跟著 disabled；有變更時關閉前 confirm。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSidebar } from "@/contexts/SidebarContext";
import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";
import type { ComboboxItem } from "@/components/shared/CreatableCombobox";
import type { MagicPasteMcItem } from "@/components/shared/MagicPasteInput";
import { getVoiceAndRate } from "@/utils/ttsVoiceResolver";
import type { Program } from "@/types";
import type {
  Question,
  QuestionGroup,
  QuestionType,
  QuestionVisibility,
} from "@/types/questionBank";
import QuestionBankBatchPanel from "./QuestionBankBatchPanel";
import QuestionUnitList from "./QuestionUnitList";
import SheetPreviewButton from "./SheetPreviewButton";
import { uploadExtractedQuestionImages } from "./extractedImages";
import { useExtractedGroup } from "./useExtractedGroup";
import {
  MAX_QUESTIONS_PER_BATCH,
  applyAiAnalysis,
  applyAiAnswers,
  batchDefaultsFromQuestion,
  draftFromQuestion,
  draftsEligibleForAi,
  draftsFromExtracted,
  emptyBatchDefaults,
  emptyDraft,
  emptyGroupDraft,
  errorKeyParts,
  findBatchDuplicateKeys,
  groupDraftFromGroup,
  mapUnitQuestions,
  toAiInputs,
  toCreateGroupInput,
  toCreateInput,
  toUpdateGroupInput,
  toUpdateInput,
  unitHasContent,
  unitKey,
  unitPassageByKey,
  unitQuestions,
  validateDraft,
  validateGroupDraft,
  type ApplyResult,
  type BatchDefaults,
  type GroupDraft,
  type QuestionDraft,
  type UnitDraft,
} from "./questionDraft";

/** 走題組端點的題型（與後端 GROUP_CREATABLE_TYPES 對齊） */
const GROUP_TYPES: QuestionType[] = ["reading", "cloze"];

const TTS_STORAGE_KEY = "duotopia_batch_tts_settings";
const DEFAULT_TTS: TTSSettingsState = {
  accent: "Random",
  gender: "Random",
  speed: "Normal x1",
};

export interface QuestionSheetProps {
  open: boolean;
  onClose: () => void;
  /** 編輯模式帶題目（1 題＝單題編輯；≥2 題＝批次編輯）；新增為空／未傳 */
  questions?: Question[] | null;
  /** 編輯題組：帶 id，開啟時載入整組 */
  groupId?: number | null;
  /** 新增時的題型：reading／cloze 開題組卡；預設選擇題 */
  createType?: QuestionType;
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

const single = (draft: QuestionDraft): UnitDraft => ({ kind: "single", draft });
const groupUnit = (draft: GroupDraft): UnitDraft => ({ kind: "group", draft });

function withServerError(u: UnitDraft, message: string): UnitDraft {
  return u.kind === "single"
    ? { kind: "single", draft: { ...u.draft, serverError: message } }
    : { kind: "group", draft: { ...u.draft, serverError: message } };
}

export default function QuestionSheet({
  open,
  onClose,
  questions = null,
  groupId = null,
  createType = "multiple_choice",
  programs,
  organizationId,
  readOnly = false,
  canDelete = false,
  onSaved,
  onDeleted,
}: QuestionSheetProps) {
  const { t } = useTranslation();
  const { sidebarWidth, setEditorBusy } = useSidebar();
  const existing = questions ?? [];
  const mode: "create" | "edit" | "bulk" | "editGroup" =
    groupId !== null
      ? "editGroup"
      : existing.length === 0
        ? "create"
        : existing.length === 1
          ? "edit"
          : "bulk";
  const isEdit = mode === "edit";
  const singleQuestion = isEdit ? existing[0] : null;
  /** 右欄是題組（新增題組或編輯題組）：一次只有一個單元，沒有「新增題目」；擷取走 reading_group（整份檔 → 這個題組） */
  const groupMode =
    mode === "editGroup" ||
    (mode === "create" && GROUP_TYPES.includes(createType));

  const [units, setUnits] = useState<UnitDraft[]>([single(emptyDraft())]);
  const [loadedGroup, setLoadedGroup] = useState<QuestionGroup | null>(null);
  const [loadingGroup, setLoadingGroup] = useState(false);
  /** 題組編輯時依載入結果的 can_edit 決定只讀 */
  const effectiveReadOnly =
    readOnly ||
    (mode === "editGroup" && loadedGroup !== null && !loadedGroup.can_edit);
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

  /** 所有單題草稿（含題組小題）：驗證重複、語音、AI 都沿用單題邏輯 */
  const drafts = useMemo(() => unitQuestions(units), [units]);

  // 開啟時依模式初始化
  useEffect(() => {
    if (!open) return;
    setLoadedGroup(null);
    if (mode === "editGroup" && groupId !== null) {
      // 題組編輯：先放空卡佔位，載入後換成整組
      setUnits([]);
      setBatch(emptyBatchDefaults());
      setBatchSources([]);
      setBatchVisibility(null);
      setLoadingGroup(true);
      let cancelled = false;
      apiClient
        .getQuestionGroup(groupId)
        .then((g) => {
          if (cancelled) return;
          const d = groupDraftFromGroup(g);
          setLoadedGroup(g);
          setUnits([groupUnit(d)]);
          setBatch({
            exam_points: [],
            grade: d.grade,
            program_link: d.program_link,
          });
          setBatchSources(d.sources);
          setBatchVisibility(d.visibility);
        })
        .catch((err) => {
          console.error("Load question group failed:", err);
          toast.error(t("questionBank.group.loadFailed"));
          onClose();
        })
        .finally(() => {
          if (!cancelled) setLoadingGroup(false);
        });
      setTtsSettings(loadTtsSettings());
      setAutoTTS(false);
      dirtyRef.current = false;
      return () => {
        cancelled = true;
      };
    }
    if (mode === "edit" && singleQuestion) {
      const d = draftFromQuestion(singleQuestion);
      setUnits([single(d)]);
      setBatch(batchDefaultsFromQuestion(singleQuestion));
      setBatchSources(d.sources);
      setBatchVisibility(d.visibility);
    } else if (mode === "bulk") {
      // 批次編輯：每張卡帶自己的值；左欄批次值一律空白，不從任何題預填（使用者定案）
      setUnits(existing.map((q) => single(draftFromQuestion(q))));
      setBatch(emptyBatchDefaults());
      setBatchSources([]);
      setBatchVisibility(null);
    } else {
      const defaults = emptyBatchDefaults();
      setUnits([
        GROUP_TYPES.includes(createType)
          ? groupUnit(emptyGroupDraft(createType, defaults))
          : single(emptyDraft(defaults)),
      ]);
      setBatch(defaults);
      setBatchSources([]);
      setBatchVisibility(null);
    }
    setTtsSettings(loadTtsSettings());
    setAutoTTS(false);
    dirtyRef.current = false;
    // existing 每次 render 都是新陣列，用 questions 當依賴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, questions, groupId, createType]);

  /** 題組擷取（#1084）：把 AI 結果填進右側題組卡；已有內容先確認覆蓋 */
  const replaceGroup = useCallback((key: string, next: GroupDraft) => {
    dirtyRef.current = true;
    setUnits((prev) =>
      prev.map((u) =>
        u.kind === "group" && u.draft.key === key
          ? { kind: "group", draft: next }
          : u,
      ),
    );
  }, []);
  const groupExtract = useExtractedGroup({ units, replaceGroup, t });

  const busy =
    saving ||
    deleting ||
    generatingAudio ||
    aiBusy ||
    loadingGroup ||
    groupExtract.extracting;
  useEffect(() => {
    setEditorBusy(busy);
    return () => setEditorBusy(false);
  }, [busy, setEditorBusy]);

  const updateQuestion = useCallback((key: string, next: QuestionDraft) => {
    dirtyRef.current = true;
    setUnits((prev) =>
      mapUnitQuestions(prev, (d) => (d.key === key ? next : d)),
    );
  }, []);
  const updateGroup = useCallback((key: string, next: GroupDraft) => {
    dirtyRef.current = true;
    setUnits((prev) =>
      prev.map((u) =>
        u.kind === "group" && u.draft.key === key
          ? { kind: "group", draft: next }
          : u,
      ),
    );
  }, []);

  /** 左側批次設定（考點／年段／教材）：改了就覆寫右側所有單元 */
  const applyBatch = (patch: Partial<BatchDefaults>) => {
    dirtyRef.current = true;
    setBatch((prev) => ({ ...prev, ...patch }));
    setUnits((prev) =>
      mapUnitQuestions(prev, (d) => ({ ...d, ...patch })).map((u) =>
        u.kind === "group"
          ? {
              kind: "group",
              draft: {
                ...u.draft,
                ...(patch.grade ? { grade: patch.grade } : {}),
                ...(patch.program_link !== undefined
                  ? { program_link: patch.program_link }
                  : {}),
              },
            }
          : u,
      ),
    );
  };
  const applyVisibility = (v: QuestionVisibility) => {
    dirtyRef.current = true;
    setBatchVisibility(v);
    setUnits((prev) =>
      mapUnitQuestions(prev, (d) => ({ ...d, visibility: v })).map((u) =>
        u.kind === "group"
          ? { kind: "group", draft: { ...u.draft, visibility: v } }
          : u,
      ),
    );
  };
  const applySources = (next: ComboboxItem[]) => {
    dirtyRef.current = true;
    setBatchSources(next);
    setUnits((prev) =>
      mapUnitQuestions(prev, (d) => ({ ...d, sources: next })).map((u) =>
        u.kind === "group"
          ? { kind: "group", draft: { ...u.draft, sources: next } }
          : u,
      ),
    );
  };

  const handleTtsSettingsChange = (s: TTSSettingsState) => {
    setTtsSettings(s);
    try {
      localStorage.setItem(TTS_STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* localStorage 不可用時忽略 */
    }
  };

  // ---- 驗證（逐單元）----
  const batchDupKeys = useMemo(() => findBatchDuplicateKeys(drafts), [drafts]);
  const errorKeys = useMemo(
    () =>
      units.map((u) =>
        u.kind === "single"
          ? validateDraft(u.draft, {
              duplicateInBatch: batchDupKeys.has(u.draft.key),
            })
          : validateGroupDraft(u.draft),
      ),
    [units, batchDupKeys],
  );
  /** 題組小題 → 主圖文純文字（AI 上下文） */
  const passageByKey = useMemo(() => unitPassageByKey(units), [units]);
  const firstErrorIndex = errorKeys.findIndex((k) => k !== null);
  const validationMessage: string | null = effectiveReadOnly
    ? null
    : firstErrorIndex >= 0
      ? t("questionBank.form.errors.atQuestion", {
          n: firstErrorIndex + 1,
          message: (() => {
            const parts = errorKeyParts(errorKeys[firstErrorIndex] as string);
            return t(`questionBank.form.errors.${parts.key}`, parts.params);
          })(),
        })
      : null;

  // ---- 單元增減 ----
  const newDraft = () => {
    const d = emptyDraft(batch);
    d.visibility = batchVisibility;
    d.sources = batchSources;
    return d;
  };
  const addQuestion = () => {
    if (units.length >= MAX_QUESTIONS_PER_BATCH) {
      toast.info(
        t("questionBank.form.limitReached", { max: MAX_QUESTIONS_PER_BATCH }),
      );
      return;
    }
    dirtyRef.current = true;
    const d = newDraft();
    setUnits((prev) => [...prev, single(d)]);
    window.setTimeout(() => {
      document
        .getElementById(`question-card-${d.key}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };
  const removeUnit = (key: string) => {
    if (units.length <= 1) return;
    dirtyRef.current = true;
    setUnits((prev) => prev.filter((u) => unitKey(u) !== key));
  };

  // ---- 批次語音（只對題幹）----
  const pendingAudio = drafts.filter((d) => d.stem.trim() && !d.stem_audio_url);

  /** 對缺語音的題幹批次生成；回傳補上語音後的單元（儲存流程也用） */
  const fillMissingAudio = async (
    current: UnitDraft[],
  ): Promise<UnitDraft[]> => {
    const pending = unitQuestions(current).filter(
      (d) => d.stem.trim() && !d.stem_audio_url,
    );
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
    return mapUnitQuestions(current, (d) =>
      byKey.has(d.key) ? { ...d, stem_audio_url: byKey.get(d.key)! } : d,
    );
  };

  const generateAllAudio = async () => {
    if (pendingAudio.length === 0 || generatingAudio) return;
    setGeneratingAudio(true);
    try {
      const before = pendingAudio.length;
      const next = await fillMissingAudio(units);
      const after = unitQuestions(next).filter(
        (d) => d.stem.trim() && !d.stem_audio_url,
      ).length;
      dirtyRef.current = true;
      setUnits(next);
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
    const eligible = draftsEligibleForAi(drafts, passageByKey);
    if (eligible.length === 0 || aiBusy) {
      toast.info(t("questionBank.form.tools.aiNothingToSend"));
      return;
    }
    setAiBusy(true);
    try {
      const res = await call(toAiInputs(eligible, passageByKey));
      const outcome = apply(drafts, res.results as never);
      dirtyRef.current = dirtyRef.current || outcome.applied > 0;
      const byKey = new Map(outcome.drafts.map((d) => [d.key, d]));
      setUnits((prev) => mapUnitQuestions(prev, (d) => byKey.get(d.key) ?? d));
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

  /**
   * 考卷擷取結果：第一個單元全空就取代，否則附加；超過上限截斷。
   * 先把題幹圖與選項圖裁好上傳（PDF 不裁，由 helper 提示），再填進卡片。
   */
  const handleInsertExtracted = async (
    items: MagicPasteMcItem[],
    file: File,
  ) => {
    if (items.length === 0) return;
    const images = await uploadExtractedQuestionImages(items, file, t);
    dirtyRef.current = true;
    setUnits((prev) => {
      const base =
        prev.length === 1 &&
        prev[0].kind === "single" &&
        !unitHasContent(prev[0]) &&
        !prev[0].draft.existingId
          ? []
          : prev;
      const room = Math.max(0, MAX_QUESTIONS_PER_BATCH - base.length);
      const incoming = draftsFromExtracted(
        items.slice(0, room),
        batch,
        images,
      ).map((d) =>
        single({ ...d, visibility: batchVisibility, sources: batchSources }),
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

  /** 送出一個單元；回傳可給 onSaved 的 Question（題組回第一個小題） */
  const submitUnit = async (u: UnitDraft): Promise<Question> => {
    if (u.kind === "single") {
      const d = u.draft;
      return d.existingId !== null
        ? apiClient.updateQuestion(d.existingId, toUpdateInput(d))
        : apiClient.createQuestion(toCreateInput(d, organizationId));
    }
    const group =
      u.draft.existingId !== null
        ? await apiClient.updateQuestionGroup(
            u.draft.existingId,
            toUpdateGroupInput(u.draft),
          )
        : await apiClient.createQuestionGroup(
            toCreateGroupInput(u.draft, organizationId),
          );
    return group.questions[0];
  };

  const handleSave = async () => {
    if (validationMessage || saving || effectiveReadOnly) {
      if (firstErrorIndex >= 0) scrollToCard(unitKey(units[firstErrorIndex]));
      return;
    }
    setSaving(true);
    try {
      // 「自動生成語音」勾選：先補齊缺語音的題幹
      let toSubmit = units;
      if (autoTTS && pendingAudio.length > 0) {
        try {
          toSubmit = await fillMissingAudio(units);
          setUnits(toSubmit);
        } catch (err) {
          console.error("Auto TTS before save failed:", err);
          toast.error(t("questionBank.form.ttsFailed"));
          return;
        }
      }

      // 逐單元送：既有題 PATCH、新題／題組 POST；失敗停在該單元
      const remaining = [...toSubmit];
      let created = 0;
      let updated = 0;
      let last: Question | null = null;
      while (remaining.length > 0) {
        const u = remaining[0];
        try {
          last = await submitUnit(u);
          if (u.draft.existingId !== null) updated += 1;
          else created += 1;
          remaining.shift();
        } catch (err) {
          const message =
            extractApiMessage(err) ?? t("questionBank.messages.saveFailed");
          setUnits(
            remaining.map((r, i) =>
              i === 0 ? withServerError(r, message) : r,
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
          scrollToCard(unitKey(u));
          return;
        }
      }
      if (mode === "editGroup")
        toast.success(t("questionBank.messages.groupUpdated"));
      else if (mode === "edit")
        toast.success(t("questionBank.messages.updated"));
      else if (mode === "bulk")
        toast.success(
          t("questionBank.messages.bulkSaved", { updated, created }),
        );
      else if (groupMode)
        toast.success(t("questionBank.messages.groupCreated"));
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
    if (deleting) return;
    const targetGroup = mode === "editGroup" ? loadedGroup : null;
    if (!singleQuestion && !targetGroup) return;
    if (
      !window.confirm(
        t(
          targetGroup
            ? "questionBank.group.confirmDelete"
            : "questionBank.form.confirmDelete",
        ),
      )
    )
      return;
    setDeleting(true);
    try {
      if (targetGroup) {
        await apiClient.deleteQuestionGroup(targetGroup.id);
        toast.success(t("questionBank.messages.groupDeleted"));
        dirtyRef.current = false;
        onDeleted?.(targetGroup.questions[0]?.id ?? targetGroup.id);
        onClose();
        return;
      }
      await apiClient.deleteQuestion(singleQuestion!.id);
      toast.success(t("questionBank.messages.deleted"));
      dirtyRef.current = false;
      onDeleted?.(singleQuestion!.id);
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
      !effectiveReadOnly &&
      !window.confirm(t("contentEditor.labels.unsavedChangesConfirm"))
    )
      return;
    onClose();
  };

  if (!open) return null;

  const groupTypeLabel = t(
    `questionBank.types.${loadedGroup?.question_type ?? createType}`,
  );
  const title = effectiveReadOnly
    ? t("questionBank.form.titleView")
    : mode === "editGroup"
      ? t("questionBank.group.titleEdit", { type: groupTypeLabel })
      : mode === "edit"
        ? t("questionBank.form.titleEdit")
        : mode === "bulk"
          ? t("questionBank.form.titleBulkEdit", { count: existing.length })
          : groupMode
            ? t("questionBank.group.titleCreate", { type: groupTypeLabel })
            : t("questionBank.form.titleCreate");
  // AI 兩鍵的開關：有題幹，**或**是題組小題（題幹由文章承擔）。克漏字小題題幹一律是空的，
  // 只看 d.stem 會讓整個克漏字題組的 AI 作答／考點分析永遠 disabled（#1086）。
  // 判定與 `draftsEligibleForAi` 的第一個條件一致；選項不足 2 個仍由 runAi 的提示處理。
  const hasAnyStem = drafts.some(
    (d) => d.stem.trim() !== "" || passageByKey.has(d.key),
  );
  // 新增與批次編輯可擷取／用 AI（題組模式也可：擷取走 reading_group，AI 帶文章上下文）；
  // 「新增題目」只有單題的新增／批次編輯有（題組一次一個單元）
  const canExtract =
    !effectiveReadOnly && (mode === "create" || mode === "bulk");
  const canAddQuestion = canExtract && !groupMode;
  const canDeleteNow =
    canDelete &&
    !effectiveReadOnly &&
    (isEdit || (mode === "editGroup" && loadedGroup !== null));

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
            {mode === "create" && !groupMode && !effectiveReadOnly && (
              <p className="text-xs text-gray-500">
                {t("questionBank.form.batchHint", {
                  count: units.length,
                  max: MAX_QUESTIONS_PER_BATCH,
                })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* 題組模式沿用 LayoutEditor 內的預覽入口，這裡不重複 */}
            {!groupMode && <SheetPreviewButton units={units} />}
            {canDeleteNow && (
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
            {!effectiveReadOnly && (
              <Button
                type="button"
                onClick={handleSave}
                disabled={!!validationMessage || busy || units.length === 0}
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
        {/* 儲存鈕 disabled 的原因：緊接在標題列下方、醒目色，老師不用 hover 也看得到 */}
        {validationMessage && (
          <p
            className="px-6 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 border-b border-amber-100 shrink-0"
            role="status"
            data-testid="qb-validation"
          >
            {validationMessage}
          </p>
        )}

        {/* 題組擷取：右側已有內容 → 先確認覆蓋（#1084） */}
        <Dialog
          open={groupExtract.pending !== null}
          onOpenChange={(o) => {
            if (!o) groupExtract.cancelPending();
          }}
        >
          <DialogContent
            className="max-w-sm"
            data-testid="qb-extract-overwrite"
          >
            <DialogHeader>
              <DialogTitle>
                {t("questionBank.group.extract.overwriteTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("questionBank.group.extract.overwriteDesc")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={groupExtract.cancelPending}
                data-testid="qb-extract-overwrite-cancel"
              >
                {t("common.cancel", "取消")}
              </Button>
              <Button
                type="button"
                onClick={() => void groupExtract.confirmPending()}
                data-testid="qb-extract-overwrite-confirm"
              >
                {t("questionBank.group.extract.overwriteConfirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 兩欄：左 = 單字集同款批次工作區（md 以上），右 = 單元卡 */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          <div className="flex gap-4 items-start">
            {/* 左欄：新增／批次編輯 = 完整批次區；單題／題組編輯 = 只剩考題來源與是否公開（editOnly） */}
            {!effectiveReadOnly && (
              <QuestionBankBatchPanel
                editOnly={isEdit || mode === "editGroup"}
                ttsSettings={ttsSettings}
                onTtsSettingsChange={handleTtsSettingsChange}
                autoTTS={autoTTS}
                onAutoTTSChange={setAutoTTS}
                pendingAudioCount={pendingAudio.length}
                onGenerateAllAudio={generateAllAudio}
                generatingAudio={generatingAudio}
                hasAnyStem={hasAnyStem}
                onAiAnswer={canExtract ? handleAiAnswer : undefined}
                onAiAnalyze={canExtract ? handleAiAnalyze : undefined}
                aiBusy={aiBusy}
                extractMode={groupMode ? "reading_group" : "multiple_choice"}
                onInsertExtracted={
                  canExtract && !groupMode ? handleInsertExtracted : undefined
                }
                onInsertExtractedGroup={
                  canExtract && groupMode
                    ? groupExtract.onInsertGroup
                    : undefined
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
              {loadingGroup && (
                <p
                  className="py-8 text-center text-sm text-gray-500"
                  data-testid="qb-group-loading"
                >
                  {t("questionBank.group.loading")}
                </p>
              )}
              <QuestionUnitList
                units={units}
                errorKeys={errorKeys}
                onChangeQuestion={updateQuestion}
                onChangeGroup={updateGroup}
                onRemove={
                  mode === "create" && !groupMode && units.length > 1
                    ? removeUnit
                    : mode === "bulk" && units.length > 1
                      ? removeUnit
                      : undefined
                }
                ttsSettings={ttsSettings}
                programs={programs}
                readOnly={effectiveReadOnly}
                disabled={saving}
              />

              {canAddQuestion && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-1.5"
                  onClick={addQuestion}
                  disabled={saving || units.length >= MAX_QUESTIONS_PER_BATCH}
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
