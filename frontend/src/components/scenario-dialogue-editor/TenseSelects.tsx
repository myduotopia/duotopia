/**
 * 時間／動貌／語態三個下拉 —— 整份設定（出題設定卡）與單題共用同一組 UI。
 *
 * Issue #1146 從 `ScenarioDialoguePanel.tsx` 搬出來：出題設定卡（`QuestionSettingsCard`）
 * 也要用，放在面板檔裡會讓設定卡反過來 import 面板。
 */
import { useTranslation } from "react-i18next";
import type { TenseSetting } from "@/lib/scenarioDialogue";
import { TENSE_ASPECTS, TENSE_TIMES, VOICES } from "./constants";

export function TenseSelects({
  tense,
  voice,
  onTenseChange,
  onVoiceChange,
}: {
  tense: TenseSetting;
  voice: string;
  onTenseChange: (time: string, aspect: string) => void;
  onVoiceChange: (voice: string) => void;
}) {
  const { t } = useTranslation();
  const selectClass =
    "px-1.5 py-1 border border-gray-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
  const notSpecified = t("scenarioDialogue.labels.notSpecified");

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">
          {t("scenarioDialogue.rubricPresets.tenseTime")}
        </span>
        <select
          value={tense.time}
          onChange={(e) => onTenseChange(e.target.value, tense.aspect)}
          className={selectClass}
        >
          <option value="">{notSpecified}</option>
          {TENSE_TIMES.map((o) => (
            <option key={o} value={o}>
              {t(`scenarioDialogue.tenseTimes.${o}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">
          {t("scenarioDialogue.rubricPresets.tenseAspect")}
        </span>
        <select
          value={tense.aspect}
          onChange={(e) => onTenseChange(tense.time, e.target.value)}
          className={selectClass}
        >
          <option value="">{notSpecified}</option>
          {TENSE_ASPECTS.map((o) => (
            <option key={o} value={o}>
              {t(`scenarioDialogue.tenseAspects.${o}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">
          {t("scenarioDialogue.rubricPresets.voice")}
        </span>
        <select
          value={voice}
          onChange={(e) => onVoiceChange(e.target.value)}
          className={selectClass}
        >
          <option value="">{notSpecified}</option>
          {VOICES.map((o) => (
            <option key={o} value={o}>
              {t(`scenarioDialogue.voices.${o}`)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
