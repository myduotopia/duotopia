/**
 * 出題設定卡（Issue #1146）—— 引導式對話「請 AI 出題」的最後一步。
 *
 * 出題設定集中在這一張卡，對話中一次確認，不逐項問：題目難度、題數（預設 5，範圍
 * 3~10）、評分標準（時態／語態）、翻譯（開關＋語言）、語音（開關＋設定）、作答指引
 * （選填，學生看得到）。每一項都看得到、可改、有預設。
 *
 * 卡片頂端的確認句帶出老師原話（出題方向），讓他在按「開始產生」前看得到 AI 會照什麼出題。
 */
import { useTranslation } from "react-i18next";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BatchTranslateSettings } from "@/components/shared/BatchTranslateSettings";
import {
  BatchTTSSettings,
  type TTSSettingsState,
} from "@/components/shared/BatchTTSSettings";
import type { TenseSetting } from "@/lib/scenarioDialogue";
import {
  CEFR_LEVELS,
  MAX_ITEMS,
  MIN_ITEMS,
  TRANSLATION_LANGUAGES,
} from "./constants";
import { TenseSelects } from "./TenseSelects";

export interface QuestionSettingsCardProps {
  questionLevel: string;
  onQuestionLevelChange: (level: string) => void;
  count: number;
  onCountChange: (count: number) => void;
  globalTense: TenseSetting;
  onGlobalTenseChange: (tense: TenseSetting) => void;
  globalVoice: string;
  onGlobalVoiceChange: (voice: string) => void;
  autoTranslate: boolean;
  onAutoTranslateChange: (enabled: boolean) => void;
  translateLang: string;
  onTranslateLangChange: (lang: string) => void;
  customLang: string;
  onCustomLangChange: (lang: string) => void;
  autoTTS: boolean;
  onAutoTTSChange: (enabled: boolean) => void;
  ttsSettings: TTSSettingsState;
  onTTSSettingsChange: (settings: TTSSettingsState) => void;
  globalRubric: string;
  onGlobalRubricChange: (rubric: string) => void;
  generating: boolean;
  /** 清單已滿 10 題時不能再產；給原因（按鈕停用要說明） */
  fullReason: string | null;
  hasQuestions: boolean;
  onGenerate: () => void;
  onViewList: () => void;
}

const COUNT_OPTIONS = Array.from(
  { length: MAX_ITEMS - MIN_ITEMS + 1 },
  (_, i) => MIN_ITEMS + i,
);

export function QuestionSettingsCard(props: QuestionSettingsCardProps) {
  const { t } = useTranslation();
  const disabled = props.generating || !!props.fullReason;

  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-4 space-y-4"
      data-testid="question-settings-card"
    >
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div>
          <span className="text-xs font-semibold text-gray-700 mb-1 block">
            {t("scenarioDialogue.labels.questionLevel")}
          </span>
          <div className="flex flex-wrap gap-1">
            {CEFR_LEVELS.map((lv) => (
              <button
                key={lv}
                type="button"
                aria-pressed={props.questionLevel === lv}
                onClick={() => props.onQuestionLevelChange(lv)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                  props.questionLevel === lv
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                {lv}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-700">
            {t("scenarioDialogue.labels.generateCount")}
          </span>
          <select
            value={props.count}
            onChange={(e) => props.onCountChange(Number(e.target.value))}
            className="px-1.5 py-1 border border-gray-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            aria-label={t("scenarioDialogue.labels.generateCount")}
          >
            {COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {t("scenarioDialogue.setup.countOption", { count: n })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-1">
        <span className="text-xs font-semibold text-gray-700">
          {t("scenarioDialogue.labels.globalTense")}
        </span>
        <div className="flex flex-wrap items-end gap-2">
          <TenseSelects
            tense={props.globalTense}
            voice={props.globalVoice}
            onTenseChange={(time, aspect) =>
              props.onGlobalTenseChange({ time, aspect })
            }
            onVoiceChange={props.onGlobalVoiceChange}
          />
        </div>
        <p className="text-xs text-gray-500">
          {t("scenarioDialogue.hints.globalTense")}
        </p>
      </div>

      <div className="space-y-2">
        <BatchTranslateSettings
          enabled={props.autoTranslate}
          onEnabledChange={props.onAutoTranslateChange}
          selectedLanguage={props.translateLang}
          onLanguageChange={props.onTranslateLangChange}
          languages={TRANSLATION_LANGUAGES}
          customLanguage={props.customLang}
          onCustomLanguageChange={props.onCustomLangChange}
          variant="card"
        />
        <BatchTTSSettings
          settings={props.ttsSettings}
          onChange={props.onTTSSettingsChange}
          enabled={props.autoTTS}
          onEnabledChange={props.onAutoTTSChange}
          variant="card"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-gray-700">
            {t("scenarioDialogue.labels.globalRubric")}
          </span>
          <span className="text-xs text-gray-400">
            {t("scenarioDialogue.hints.optional")}
          </span>
        </div>
        <p className="text-xs text-gray-500">
          {t("scenarioDialogue.hints.visibleToStudents")}
        </p>
        <textarea
          value={props.globalRubric}
          onChange={(e) => props.onGlobalRubricChange(e.target.value)}
          rows={2}
          placeholder={t("scenarioDialogue.placeholders.globalRubric")}
          className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm resize-y focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        {props.fullReason && (
          <span className="text-xs text-gray-500 mr-auto">
            {props.fullReason}
          </span>
        )}
        {props.hasQuestions && (
          <Button variant="outline" onClick={props.onViewList}>
            {t("scenarioDialogue.buttons.viewQuestions")}
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        )}
        <Button
          onClick={props.onGenerate}
          disabled={disabled}
          title={props.fullReason ?? undefined}
        >
          {props.generating ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-1 h-4 w-4" />
          )}
          {props.generating
            ? t("scenarioDialogue.buttons.generating")
            : props.hasQuestions
              ? t("scenarioDialogue.buttons.generateAnother")
              : t("scenarioDialogue.setup.startGenerate")}
        </Button>
      </div>
      <p className="text-right text-xs text-gray-400">
        {t("scenarioDialogue.hints.rateLimit")}
      </p>
    </div>
  );
}
