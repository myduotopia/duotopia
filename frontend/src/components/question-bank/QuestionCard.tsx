/**
 * 右欄單題卡片（Issue #1064）。
 *
 * |題幹 textarea + 麥克風|
 * |A 選項|B 選項|
 * |C 選項(選填)|D 選項(選填)|
 * |新增選項| → 展開 E/F
 * |考點（必填，AI 填或手動）|
 * |解析（選填）|
 * ▼ 進階設定（預設收起）：|關聯教材｜關聯單元|、年段拉桿
 *
 * 每格 = 正確答案 checkbox + 文字 input + 圖片 icon。文字或圖片至少一個才算「有填」。
 * 麥克風 = 單題語音：用目前 TTS 設定直接呼叫 generateTTS（不開 modal）；按鈕組
 * （播放／麥克風／移除）樣式與位置與單字集完全相同，接在 textarea 之後。
 * 重複偵測每卡各自 debounce 呼叫 similar API；結果存回 draft.similar。
 * 考點／年段／教材關聯用共用元件（ExamPointPicker / GradeRangeSlider / ProgramLessonPicker），
 * 與左側批次設定同一套。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Mic,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";
import ExamPointPicker from "@/components/shared/ExamPointPicker";
import { GradeRangeSlider } from "@/components/shared/GradeRangeSlider";
import { ProgramLessonPicker } from "@/components/shared/ProgramLessonPicker";
import { getVoiceAndRate } from "@/utils/ttsVoiceResolver";
import type { Program } from "@/types";
import OptionImageButton from "./OptionImageButton";
import {
  BASE_OPTION_SLOTS,
  MAX_OPTION_SLOTS,
  emptyOption,
  optionFilled,
  type OptionDraft,
  type QuestionDraft,
} from "./questionDraft";

export interface QuestionCardProps {
  index: number;
  draft: QuestionDraft;
  onChange: (next: QuestionDraft) => void;
  onRemove?: () => void;
  /** 編輯既有題目時帶 id，讓 similar API 排除自己 */
  excludeId?: number;
  ttsSettings: TTSSettingsState;
  programs: Program[];
  /** 這張卡目前的驗證訊息（由外層算，含批內重複） */
  errorMessage: string | null;
  readOnly?: boolean;
  disabled?: boolean;
}

function absoluteAudioUrl(url: string): string {
  return url.startsWith("http") ? url : `${import.meta.env.VITE_API_URL}${url}`;
}

export default function QuestionCard({
  index,
  draft,
  onChange,
  onRemove,
  excludeId,
  ttsSettings,
  programs,
  errorMessage,
  readOnly = false,
  disabled = false,
}: QuestionCardProps) {
  const { t } = useTranslation();
  const [ttsBusy, setTtsBusy] = useState(false);
  const locked = readOnly || disabled;

  const patch = (p: Partial<QuestionDraft>) => onChange({ ...draft, ...p });

  // ---- 相似題（debounce 400ms） ----
  const stemTrimmed = draft.stem.trim();
  useEffect(() => {
    if (readOnly) return;
    if (!stemTrimmed) {
      if (draft.similar) patch({ similar: null });
      return;
    }
    let cancelled = false;
    const h = window.setTimeout(() => {
      apiClient
        .findSimilarQuestions(stemTrimmed, excludeId)
        .then((res) => {
          if (!cancelled) onChange({ ...draft, similar: res });
        })
        .catch(() => {
          /* 查不到相似題不影響編輯 */
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(h);
    };
    // draft 其他欄位變動不需要重查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stemTrimmed, excludeId, readOnly]);

  // ---- 選項 ----
  const updateOption = (i: number, p: Partial<OptionDraft>) => {
    const options = draft.options.map((o, idx) => {
      if (idx !== i) return o;
      const next = { ...o, ...p };
      // 清空文字且無圖 → 取消正確答案
      if (!optionFilled(next)) next.is_correct = false;
      return next;
    });
    patch({ options });
  };

  const toggleCorrect = (i: number, checked: boolean) => {
    const options = draft.options.map((o, idx) => {
      if (idx === i) return { ...o, is_correct: checked };
      // 單選：勾一個就取消其他
      if (!draft.allow_multiple && checked) return { ...o, is_correct: false };
      return o;
    });
    patch({ options });
  };

  const setAllowMultiple = (checked: boolean) => {
    if (checked) {
      patch({ allow_multiple: true });
      return;
    }
    // 關掉複選只保留第一個正確答案
    let kept = false;
    const options = draft.options.map((o) => {
      if (o.is_correct && !kept) {
        kept = true;
        return o;
      }
      return { ...o, is_correct: false };
    });
    patch({ allow_multiple: false, options });
  };

  const showExtra = () => {
    const options = [...draft.options];
    while (options.length < MAX_OPTION_SLOTS) options.push(emptyOption());
    patch({ options, extraOptionsShown: true });
  };

  // ---- 單題語音 ----
  const generateAudio = async () => {
    if (!stemTrimmed || ttsBusy) return;
    setTtsBusy(true);
    try {
      const { voice, rate } = getVoiceAndRate(
        ttsSettings.accent,
        ttsSettings.gender,
        ttsSettings.speed,
      );
      const res = await apiClient.generateTTS(stemTrimmed, voice, rate, "+0%");
      patch({ stem_audio_url: absoluteAudioUrl(res.audio_url) });
    } catch (err) {
      console.error("Question TTS failed:", err);
      toast.error(t("questionBank.form.ttsFailed"));
    } finally {
      setTtsBusy(false);
    }
  };

  /** 播放題幹語音（同單字集：直接 new Audio，不掛播放器） */
  const playAudio = () => {
    if (!draft.stem_audio_url) return;
    const audio = new Audio(draft.stem_audio_url);
    audio.onerror = () =>
      toast.error(t("contentEditor.messages.cannotPlayRecording"));
    audio.play().catch(() => {
      toast.error(t("contentEditor.messages.cannotPlayRecording"));
    });
  };

  const exact = draft.similar?.exact_duplicate ?? null;
  const similarList = useMemo(
    () => (exact ? [] : (draft.similar?.similar ?? [])),
    [draft.similar, exact],
  );
  const hasError = errorMessage !== null || draft.serverError !== null;
  const letter = (i: number) => String.fromCharCode(65 + i);

  return (
    <div
      id={`question-card-${draft.key}`}
      className={`rounded-lg border bg-white p-4 space-y-3 ${
        hasError ? "border-red-300" : "border-gray-200"
      }`}
      data-testid={`question-card-${index}`}
    >
      {/* 卡片標題列 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">
          {t("questionBank.form.questionN", { n: index + 1 })}
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <Switch
              checked={draft.allow_multiple}
              onCheckedChange={setAllowMultiple}
              disabled={locked}
              data-testid={`qc-${index}-allow-multiple`}
            />
            {t("questionBank.form.allowMultiple")}
          </label>
          {onRemove && !readOnly && (
            <button
              type="button"
              onClick={onRemove}
              disabled={disabled}
              className="text-gray-400 hover:text-red-600"
              aria-label={t("questionBank.form.removeQuestion")}
              data-testid={`qc-${index}-remove`}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 題幹 + 麥克風 */}
      <div className="flex gap-2 items-start">
        <Textarea
          value={draft.stem}
          onChange={(e) => patch({ stem: e.target.value, serverError: null })}
          placeholder={t("questionBank.form.stemPlaceholder")}
          rows={2}
          disabled={locked}
          className="flex-1"
          data-testid={`qc-${index}-stem`}
        />
        {/* 語音按鈕組：樣式同單字集；題幹是多行 textarea，所以直排（麥克風 → 播放 → 移除） */}
        <div className="flex flex-col items-center gap-1 shrink-0 self-start">
          <button
            type="button"
            onClick={generateAudio}
            disabled={locked || !stemTrimmed || ttsBusy}
            className={`p-1.5 rounded disabled:opacity-50 ${
              draft.stem_audio_url
                ? "text-blue-600 hover:bg-blue-100"
                : "text-gray-600 bg-yellow-100 hover:bg-yellow-200"
            }`}
            title={
              draft.stem_audio_url
                ? t("contentEditor.tooltips.rerecordOrGenerate")
                : t("contentEditor.tooltips.openTTSRecording")
            }
            aria-label={t("questionBank.form.generateAudio")}
            data-testid={`qc-${index}-mic`}
          >
            {ttsBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>
          {draft.stem_audio_url && (
            <button
              type="button"
              onClick={playAudio}
              className="p-1.5 rounded text-green-600 hover:bg-green-100"
              title={t("contentEditor.tooltips.playAudio")}
              aria-label={t("contentEditor.tooltips.playAudio")}
              data-testid={`qc-${index}-play`}
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          {draft.stem_audio_url && !readOnly && (
            <button
              type="button"
              onClick={() => patch({ stem_audio_url: null })}
              className="p-1.5 rounded text-red-600 hover:bg-red-100"
              title={t("contentEditor.tooltips.removeAudio")}
              aria-label={t("contentEditor.tooltips.removeAudio")}
              data-testid={`qc-${index}-audio-remove`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 重複／相似提示 */}
      {exact && (
        <div
          className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
          data-testid={`qc-${index}-duplicate`}
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            {t("questionBank.form.duplicateFound")}
            <div className="text-red-600/80 line-clamp-2">{exact.stem}</div>
          </div>
        </div>
      )}
      {similarList.length > 0 && (
        <div
          className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800"
          data-testid={`qc-${index}-similar`}
        >
          <div className="font-medium">
            {t("questionBank.form.similarFound")}
          </div>
          <ul className="mt-1 space-y-0.5 text-amber-700/90">
            {similarList.map((s) => (
              <li key={s.id} className="line-clamp-1">
                • {s.stem}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 選項格 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {draft.options.map((o, i) => {
          const optional = i >= 2;
          return (
            <div key={i} className="flex items-center gap-1.5">
              <Checkbox
                checked={o.is_correct}
                onCheckedChange={(c) => toggleCorrect(i, c === true)}
                disabled={locked || !optionFilled(o)}
                aria-label={t("questionBank.form.markCorrect", {
                  index: i + 1,
                })}
                data-testid={`qc-${index}-correct-${i}`}
              />
              <span className="w-4 text-xs text-gray-500">{letter(i)}</span>
              <Input
                value={o.text}
                onChange={(e) => updateOption(i, { text: e.target.value })}
                placeholder={
                  optional
                    ? t("questionBank.form.optionOptionalPlaceholder", {
                        letter: letter(i),
                      })
                    : t("questionBank.form.optionRequiredPlaceholder", {
                        letter: letter(i),
                      })
                }
                className="h-9 flex-1 min-w-0"
                disabled={locked}
                data-testid={`qc-${index}-option-${i}`}
              />
              <OptionImageButton
                imageUrl={o.image_url}
                onChange={(url) => updateOption(i, { image_url: url })}
                disabled={locked}
                label={t("questionBank.form.optionImage", {
                  letter: letter(i),
                })}
              />
            </div>
          );
        })}
      </div>
      {!draft.extraOptionsShown &&
        draft.options.length <= BASE_OPTION_SLOTS &&
        !readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1 text-gray-600"
            onClick={showExtra}
            disabled={disabled}
            data-testid={`qc-${index}-add-option`}
          >
            <Plus size={14} />
            {t("questionBank.form.addOption")}
          </Button>
        )}

      {/* 考點（必填） */}
      <div className="space-y-1">
        <Label className="text-xs text-gray-600">
          {t("questionBank.form.examPoints")}{" "}
          <span className="text-red-500">*</span>
        </Label>
        <ExamPointPicker
          value={draft.exam_points}
          onChange={(exam_points) => patch({ exam_points })}
          disabled={locked}
          required
          compact
          data-testid={`qc-${index}-exam-points`}
        />
      </div>

      {/* 解析 */}
      <Input
        value={draft.explanation}
        onChange={(e) => patch({ explanation: e.target.value })}
        placeholder={t("questionBank.form.explanationPlaceholder")}
        className="h-9 text-sm"
        disabled={locked}
        data-testid={`qc-${index}-explanation`}
      />

      {/* ▼ 進階設定 */}
      <div className="border-t border-gray-100 pt-2">
        <button
          type="button"
          onClick={() => patch({ advancedOpen: !draft.advancedOpen })}
          className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
          aria-expanded={draft.advancedOpen}
          data-testid={`qc-${index}-advanced-toggle`}
        >
          {draft.advancedOpen ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
          {t("questionBank.form.advancedSettings")}
        </button>
        {draft.advancedOpen && (
          <div className="mt-2 space-y-3" data-testid={`qc-${index}-advanced`}>
            <div className="space-y-1">
              <Label className="text-xs text-gray-600">
                {t("questionBank.form.programLinks")}
              </Label>
              <ProgramLessonPicker
                programs={programs}
                value={draft.program_link}
                onChange={(program_link) => patch({ program_link })}
                disabled={locked}
                compact
                data-testid={`qc-${index}-program-link`}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-600">
                {t("questionBank.form.grade")}
              </Label>
              <GradeRangeSlider
                value={draft.grade}
                onChange={(grade) => patch({ grade })}
                disabled={locked}
                compact
                data-testid={`qc-${index}-grade`}
              />
            </div>
          </div>
        )}
      </div>

      {(errorMessage || draft.serverError) && (
        <p className="text-xs text-red-600" data-testid={`qc-${index}-error`}>
          {draft.serverError ?? errorMessage}
        </p>
      )}
    </div>
  );
}
