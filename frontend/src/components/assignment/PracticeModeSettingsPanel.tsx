/**
 * PracticeModeSettingsPanel — 派發作業「進階條件設定區」共用元件（#878 Stage 3）
 *
 * 由 registry（`getModeConfig(mode).settings`）驅動，依每個 SettingSpec 的 `kind` 分派
 * renderer（toggle / segmented / select / number / ranked）。新增作業模式只需在
 * `practiceMode.ts` 的 registry 加 setting，不必改這支元件。
 *
 * 取代 AssignmentDialog.tsx 原本硬寫的兩大塊條件 JSX（例句集 + 單字集），外觀沿用原樣
 * （native checkbox / select / range + 手刻 segmented 雙按鈕）。耦合邏輯（互斥、segmented
 * 多 key patch、音檔鎖答案、score 提示）全走 `practiceModeSettings.ts` 的純函式 → #846 根治、
 * Stage 3.5 的 AssignmentDetailSheet 可直接複用。
 *
 * 範圍：只含「進階條件設定區」。模式 chip 列、頂部 score badge、右側即時預覽不在此元件。
 */
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  getModeConfig,
  type PracticeMode,
  type SettingSpec,
  type SettingKey,
  type SettingValue,
} from "@/lib/practiceMode";
import type { ScoreCategory } from "@/utils/scoreCategory";
import {
  applySettingChange,
  isSegmentedOptionActive,
  isShowAnswerLockedByAudio,
  segmentedScoreCategory,
  type PracticeModeSettings,
} from "./practiceModeSettings";

const PM = "dialogs.assignmentDialog.practiceMode";

const TOGGLE_I18N: Partial<
  Record<SettingKey, { labelKey: string; descKey: string }>
> = {
  shuffle_questions: {
    labelKey: `${PM}.shuffleQuestions`,
    descKey: `${PM}.shuffleQuestionsDesc`,
  },
  show_answer: {
    labelKey: `${PM}.showAnswer`,
    descKey: `${PM}.wordSelectionShowAnswerDesc`,
  },
  show_translation: {
    labelKey: `${PM}.showTranslation`,
    descKey: `${PM}.showTranslationDesc`,
  },
  show_image: { labelKey: `${PM}.showImage`, descKey: `${PM}.showImageDesc` },
  show_option_images: {
    labelKey: `${PM}.showOptionImages`,
    descKey: `${PM}.showOptionImagesDesc`,
  },
};

const SELECT_LABEL: Partial<Record<SettingKey, string>> = {
  time_limit_per_question: `${PM}.timeLimit`,
  quiz_time_limit_seconds: `${PM}.quizTimeLimit`,
};

const SEGMENTED_LABEL: Partial<Record<SettingKey, string>> = {
  play_audio: `${PM}.playAudio`,
  show_word: `${PM}.questionDisplay`,
  show_translation: `${PM}.questionDisplay`,
};

const SCORE_I18N: Record<ScoreCategory, string> = {
  listening: `${PM}.scoreListening`,
  writing: `${PM}.scoreWriting`,
  reading: `${PM}.scoreReading`,
  speaking: `${PM}.scoreSpeaking`,
};

export interface PracticeModeSettingsPanelProps {
  mode: PracticeMode;
  value: PracticeModeSettings;
  onChange: (next: PracticeModeSettings) => void;
  /**
   * runtime 限制傳入口（registry 說「能調什麼」、context 說「現在能不能調」）。
   * Stage 3（AssignmentDialog 派發）目前不需傳；保留給 Stage 3.5 接 `locked`（學生已開始）。
   */
  context?: { locked?: boolean };
}

export function PracticeModeSettingsPanel({
  mode,
  value,
  onChange,
}: PracticeModeSettingsPanelProps) {
  const { t } = useTranslation();
  const config = getModeConfig(mode);
  if (!config || config.settings.length === 0) return null;

  const v = value as unknown as Record<SettingKey, SettingValue>;
  const apply = (spec: SettingSpec, raw: SettingValue) =>
    onChange(applySettingChange(value, spec, raw));

  // 「(預設)」標記參考值：跟著各模式自己的單題時間預設跑（無覆寫者 fallback 30）。
  const timeDefault = Number(config.defaults.time_limit_per_question ?? 30);

  const renderToggle = (spec: SettingSpec & { kind: "toggle" }) => {
    const i18n = TOGGLE_I18N[spec.key];
    // show_answer 在例句重組用不同描述
    const descKey =
      spec.key === "show_answer" && mode === "rearrangement"
        ? `${PM}.showAnswerDesc`
        : (i18n?.descKey ?? "");
    const locked =
      spec.key === "show_answer" && isShowAnswerLockedByAudio(mode, value);
    return (
      <div className="space-y-1.5">
        <Label className="text-xs text-gray-600">
          {t(i18n?.labelKey ?? "")}
        </Label>
        <div className="flex items-center h-9">
          <input
            type="checkbox"
            checked={Boolean(v[spec.key])}
            disabled={locked}
            onChange={(e) => apply(spec, e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="ml-2 text-sm text-gray-600">{t(descKey)}</span>
        </div>
        {locked && (
          <p className="text-xs text-red-600">
            {t(`${PM}.showAnswerLockedByAudio`)}
          </p>
        )}
      </div>
    );
  };

  const renderSelect = (spec: SettingSpec & { kind: "select" }) => (
    <div className="space-y-1.5">
      <Label className="text-xs text-gray-600">
        {t(SELECT_LABEL[spec.key] ?? "")}
      </Label>
      <select
        value={Number(v[spec.key])}
        onChange={(e) => apply(spec, Number(e.target.value))}
        className="w-full h-9 px-3 rounded-md border border-gray-200 text-sm"
      >
        {spec.options.map((opt) => {
          const label =
            opt.value === 0
              ? t(`${PM}.unlimited`)
              : opt.label
                ? opt.label
                : opt.labelKey
                  ? `${opt.value} ${t(opt.labelKey)}`
                  : String(opt.value);
          const isDefault =
            spec.key === "time_limit_per_question" && opt.value === timeDefault;
          return (
            <option key={opt.value} value={opt.value}>
              {label}
              {isDefault ? ` (${t(`${PM}.default`)})` : ""}
            </option>
          );
        })}
      </select>
    </div>
  );

  const renderNumber = (spec: SettingSpec & { kind: "number" }) => (
    <div className="pb-3 border-b border-gray-100 space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-gray-600">
          {t(`${PM}.targetProficiency`)}
        </Label>
        <span className="text-sm font-medium text-blue-600">
          {Number(v[spec.key])}%
        </span>
      </div>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={Number(v[spec.key])}
        onChange={(e) => apply(spec, Number(e.target.value))}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
      <p className="text-xs text-gray-500">
        {t(`${PM}.targetProficiencyDesc`)}
      </p>
    </div>
  );

  const renderSegmented = (spec: SettingSpec & { kind: "segmented" }) => (
    <div className="pb-3 border-b border-gray-100 space-y-1.5">
      <Label className="text-xs text-gray-600 mb-2 block">
        {t(SEGMENTED_LABEL[spec.key] ?? "")}
      </Label>
      <div className="flex gap-3">
        {spec.options.map((opt) => {
          const active = isSegmentedOptionActive(value, spec, opt);
          const sub = opt.descKey
            ? t(opt.descKey)
            : spec.scoreHint
              ? t(SCORE_I18N[segmentedScoreCategory(mode, spec, opt, value)])
              : null;
          return (
            <button
              type="button"
              key={String(opt.value)}
              onClick={() => apply(spec, opt.value)}
              className={cn(
                "flex-1 p-3 rounded-lg border text-sm",
                active
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 hover:border-gray-300",
              )}
            >
              {opt.emoji ? `${opt.emoji} ` : ""}
              {t(opt.labelKey)}
              {sub && (
                <span className="block text-xs text-gray-500 mt-0.5">
                  {sub}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderSpec = (spec: SettingSpec) => {
    switch (spec.kind) {
      case "toggle":
        return renderToggle(spec);
      case "select":
        return renderSelect(spec);
      case "number":
        return renderNumber(spec);
      case "segmented":
        return renderSegmented(spec);
      case "ranked":
        return null; // #864 預留型態，現有模式不使用
    }
  };

  return (
    <Card className="p-3 border-gray-200">
      <h4 className="text-xs font-semibold mb-2 text-gray-700">
        {t(`${PM}.advancedSettings`)}
      </h4>
      <div className="space-y-3">
        {config.settings.map((spec, i) => (
          <div key={`${spec.kind}-${spec.key}-${i}`}>{renderSpec(spec)}</div>
        ))}
      </div>
    </Card>
  );
}

export default PracticeModeSettingsPanel;
