/**
 * 出題設定卡（Issue #1146）—— 引導式對話「請 AI 出題」的最後一步。
 *
 * 出題設定集中在這一張卡，對話中一次確認，不逐項問：題目難度、題數（預設 5，範圍
 * 3~10）、評分標準（時態／語態）、翻譯（開關＋語言）、語音（開關＋設定）、作答指引
 * （選填，學生看得到）。每一項都看得到、可改、有預設。
 *
 * 卡片頂端的確認句帶出老師原話（出題方向），讓他在按「開始產生」前看得到 AI 會照什麼出題。
 *
 * 卡片只放設定欄位（修正第 2 輪）：「開始產生」、「查看題目清單」、額度提示都移到對話的
 * 底部列右側（`ScenarioSetupChat`），跟「回上一步」同一列。
 *
 * 題目難度的 CEFR 小方塊改用共用的 `guided-chat/CefrChips`（#1158 C 段 commit 3）。
 */
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { BatchTranslateSettings } from "@/components/shared/BatchTranslateSettings";
import {
  BatchTTSSettings,
  type TTSSettingsState,
} from "@/components/shared/BatchTTSSettings";
import type { TenseSetting } from "@/lib/scenarioDialogue";
import { CefrChips } from "@/components/shared/guided-chat/CefrChips";
import { MAX_ITEMS, MIN_ITEMS, TRANSLATION_LANGUAGES } from "./constants";
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
}

const COUNT_OPTIONS = Array.from(
  { length: MAX_ITEMS - MIN_ITEMS + 1 },
  (_, i) => MIN_ITEMS + i,
);

export function QuestionSettingsCard(props: QuestionSettingsCardProps) {
  const { t } = useTranslation();

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
          <CefrChips
            value={props.questionLevel}
            onChange={props.onQuestionLevelChange}
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-700">
            {t("scenarioDialogue.labels.generateCount")}
          </span>
          <Select
            value={String(props.count)}
            onValueChange={(v) => props.onCountChange(Number(v))}
          >
            <SelectTrigger
              className="h-8 w-28"
              aria-label={t("scenarioDialogue.labels.generateCount")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNT_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {t("scenarioDialogue.setup.countOption", { count: n })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
        <Textarea
          value={props.globalRubric}
          onChange={(e) => props.onGlobalRubricChange(e.target.value)}
          rows={2}
          placeholder={t("scenarioDialogue.placeholders.globalRubric")}
          className="min-h-0 resize-y"
        />
      </div>
    </div>
  );
}
