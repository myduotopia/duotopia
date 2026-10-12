/**
 * 題庫 sheet 的 AI／語音工具（#1065 / #1082；自 QuestionSheet.tsx 拆出）。
 *
 * - 語音設定（口音／性別／語速）：狀態在這裡，改動寫回 localStorage（`TTS_STORAGE_KEY`）；
 *   sheet 開啟時以 `loadTtsSettings()` 重新載入（經回傳的 `setTtsSettings`）
 * - 批次語音：只對題幹（含題組小題）；`fillMissingAudio` 也給儲存流程的「自動生成語音」用
 * - AI 作答／考點分析：只填空的（`applyAiAnswers`／`applyAiAnalysis`），題組小題附主圖文
 *   （`passageByKey`）；套用有變更才標 dirty
 *
 * 單元狀態仍由 sheet 擁有：本 hook 只透過 `setUnits` 寫回、透過 `dirtyRef` 標記有變更。
 * `extractApiMessage` 是 sheet 共用的後端錯誤訊息擷取（AI、儲存、刪除都用）。
 */

import { useState, type Dispatch, type MutableRefObject } from "react";
import type { SetStateAction } from "react";
import type { TFunction } from "i18next";
import { toast } from "sonner";

import { apiClient } from "@/lib/api";
import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";
import { getVoiceAndRate } from "@/utils/ttsVoiceResolver";
import {
  applyAiAnalysis,
  applyAiAnswers,
  draftsEligibleForAi,
  mapUnitQuestions,
  toAiInputs,
  unitQuestions,
  type ApplyResult,
  type QuestionDraft,
  type UnitDraft,
} from "./questionDraft";

const TTS_STORAGE_KEY = "duotopia_batch_tts_settings";
const DEFAULT_TTS: TTSSettingsState = {
  accent: "Random",
  gender: "Random",
  speed: "Normal x1",
};

export function loadTtsSettings(): TTSSettingsState {
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
export function extractApiMessage(err: unknown): string | null {
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

interface Options {
  units: UnitDraft[];
  setUnits: Dispatch<SetStateAction<UnitDraft[]>>;
  /** 所有單題草稿（含題組小題） */
  drafts: QuestionDraft[];
  /** 題組小題 → 主圖文純文字（AI 上下文） */
  passageByKey: Map<string, string>;
  dirtyRef: MutableRefObject<boolean>;
  t: TFunction;
}

export function useSheetAiTools({
  units,
  setUnits,
  drafts,
  passageByKey,
  dirtyRef,
  t,
}: Options) {
  const [ttsSettings, setTtsSettings] = useState<TTSSettingsState>(DEFAULT_TTS);
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const handleTtsSettingsChange = (s: TTSSettingsState) => {
    setTtsSettings(s);
    try {
      localStorage.setItem(TTS_STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* localStorage 不可用時忽略 */
    }
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

  return {
    ttsSettings,
    setTtsSettings,
    handleTtsSettingsChange,
    pendingAudio,
    fillMissingAudio,
    generateAllAudio,
    generatingAudio,
    aiBusy,
    handleAiAnswer,
    handleAiAnalyze,
  };
}
