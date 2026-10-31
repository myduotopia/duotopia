/**
 * 出題設定卡（Issue #1146）—— 引導式對話「請 AI 出題」的最後一步。
 *
 * 出題設定集中在這一張卡，對話中一次確認，不逐項問：題目難度、題數（預設 min(5, 剩餘名額)，
 * 上限＝剩餘名額，#1158）、評分標準（時態／語態）、翻譯（開關＋語言）、語音（開關＋設定）、作答指引
 * （選填，學生看得到）。每一項都看得到、可改、有預設。
 *
 * 卡片頂端的確認句帶出老師原話（出題方向），讓他在按「開始產生」前看得到 AI 會照什麼出題。
 *
 * 卡片只放設定欄位：「開始產生」與額度提示由 `ScenarioSetupChat` 畫在卡片下方（#1158 C
 * commit 4 起卡片自帶確認鈕，沒有底部操作列了）。「設定」標籤的小框也用這張卡的精簡版
 * （`showCount={false}`）。
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
  /**
   * 題數選項的上限＝剩餘名額（10 − 已有非空白題數，#1158 使用者決定）。預設 10。
   * 0 ＝已滿：不顯示題數（「開始產生」由呼叫端停用並說明「已滿 10 題」）。
   */
  maxCount?: number;
  /** 「設定」小框的精簡版不放題數（規格第 2 點） */
  showCount?: boolean;
}

/**
 * 題數選項：下限照舊是 3（一份最少 3 題），剩餘名額不到 3 時從 1 開始；上限＝剩餘名額。
 */
export function countOptions(maxCount: number): number[] {
  const max = Math.max(0, Math.min(MAX_ITEMS, maxCount));
  if (max === 0) return [];
  const min = Math.min(MIN_ITEMS, max);
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/** 實際要產的題數：預設 5，超過剩餘名額就以剩餘名額為準（＝min(5, 剩餘)） */
export const effectiveCount = (count: number, maxCount: number) =>
  Math.max(0, Math.min(count, maxCount));

export function QuestionSettingsCard(props: QuestionSettingsCardProps) {
  const { t } = useTranslation();
  const { maxCount = MAX_ITEMS, showCount = true } = props;
  const options = countOptions(maxCount);

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

        {showCount && options.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-700">
              {t("scenarioDialogue.labels.generateCount")}
            </span>
            <Select
              value={String(effectiveCount(props.count, maxCount))}
              onValueChange={(v) => props.onCountChange(Number(v))}
            >
              <SelectTrigger
                className="h-8 w-28"
                aria-label={t("scenarioDialogue.labels.generateCount")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {t("scenarioDialogue.setup.countOption", { count: n })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
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
