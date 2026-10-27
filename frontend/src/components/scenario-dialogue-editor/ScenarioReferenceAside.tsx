/**
 * 題目清單左欄：對話結果的唯讀對照（情境內容、情境圖、作答指引、整體評分標準）＋
 * 「回對話修改」。Issue #1146 review 6 從 `ScenarioDialoguePanel.tsx` 原樣搬出來。
 */
import { useTranslation } from "react-i18next";
import { ClipboardList, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TenseSetting } from "@/lib/scenarioDialogue";
import { ScenarioImageStrip } from "./ScenarioImageStrip";
import type { ScenarioImageActions } from "./useScenarioImages";
import {
  Chip,
  isTenseSet,
  tenseLabel,
  voiceLabel,
} from "./ScenarioQuestionRow";

export interface ScenarioReferenceAsideProps {
  scenarioContent: string;
  imageActions: ScenarioImageActions;
  globalRubric: string;
  globalTense: TenseSetting;
  globalVoice: string;
  onEditSettings: () => void;
}

export function ScenarioReferenceAside({
  scenarioContent,
  imageActions,
  globalRubric,
  globalTense,
  globalVoice,
  onEditSettings,
}: ScenarioReferenceAsideProps) {
  const { t } = useTranslation();
  return (
    <aside className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-3 lg:sticky lg:top-0">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-blue-600 shrink-0" />
        <span className="text-sm font-semibold text-gray-800">
          {t("scenarioDialogue.labels.reference")}
        </span>
      </div>
      <p className="text-xs text-gray-600">
        {t("scenarioDialogue.hints.referenceNote")}
      </p>

      <div className="rounded-md border border-blue-100 bg-white p-2.5 space-y-3">
        <div className="space-y-1">
          <span className="block text-xs font-semibold text-gray-500">
            {t("scenarioDialogue.labels.scenarioContent")}
          </span>
          {scenarioContent.trim() ? (
            <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
              {scenarioContent}
            </p>
          ) : (
            <p className="text-sm text-gray-400">
              {t("scenarioDialogue.hints.noContextYet")}
            </p>
          )}
        </div>

        <ScenarioImageStrip actions={imageActions} readOnly />

        <div className="space-y-1">
          <span className="block text-xs font-semibold text-gray-500">
            {t("scenarioDialogue.labels.globalRubric")}
          </span>
          {globalRubric.trim() ? (
            <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
              {globalRubric}
            </p>
          ) : (
            <p className="text-sm text-gray-400">
              {t("scenarioDialogue.hints.noRubricYet")}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <span className="block text-xs font-semibold text-gray-500">
            {t("scenarioDialogue.labels.globalTense")}
          </span>
          {isTenseSet(globalTense) || globalVoice ? (
            <div className="flex flex-wrap gap-1.5">
              {isTenseSet(globalTense) && (
                <Chip
                  label={t("scenarioDialogue.chips.tense", {
                    value: tenseLabel(globalTense, t),
                  })}
                />
              )}
              {globalVoice && (
                <Chip
                  label={t("scenarioDialogue.chips.voice", {
                    value: voiceLabel(globalVoice, t),
                  })}
                />
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400">
              {t("scenarioDialogue.labels.notSpecified")}
            </p>
          )}
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full bg-white"
        onClick={onEditSettings}
      >
        <PencilLine className="mr-1 h-3.5 w-3.5" />
        {t("scenarioDialogue.buttons.editSettings")}
      </Button>
    </aside>
  );
}
