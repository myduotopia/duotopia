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
import { Switch } from "@/components/ui/switch";
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

// 開關只顯示「說明」一行（移除原本與說明重複的短標題）—— #878 review
const TOGGLE_DESC: Partial<Record<SettingKey, string>> = {
  shuffle_questions: `${PM}.shuffleQuestionsDesc`,
  show_answer: `${PM}.wordSelectionShowAnswerDesc`,
  show_translation: `${PM}.showTranslationDesc`,
  show_image: `${PM}.showImageDesc`,
  show_option_images: `${PM}.showOptionImagesDesc`,
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
   * - `locked`：學生已開始作答（Stage 3.5 AssignmentDetailSheet），鎖住影響計分的
   *   segmented 控制（播放音檔 / 題目呈現方式），避免改動 score_category。
   * - `hasMissingImage`：購物車有項目缺題目圖片時，禁止開啟「顯示選項圖片」（Issue #631），
   *   否則學生會看到空白圖框。
   */
  context?: { locked?: boolean; hasMissingImage?: boolean };
}

export function PracticeModeSettingsPanel({
  mode,
  value,
  onChange,
  context,
}: PracticeModeSettingsPanelProps) {
  const { t } = useTranslation();
  const config = getModeConfig(mode);
  if (!config || config.settings.length === 0) return null;

  const locked = Boolean(context?.locked);
  const hasMissingImage = Boolean(context?.hasMissingImage);

  const v = value as unknown as Record<SettingKey, SettingValue>;
  const apply = (spec: SettingSpec, raw: SettingValue) =>
    onChange(applySettingChange(value, spec, raw));

  // 「(預設)」標記參考值：跟著各模式自己的單題時間預設跑（無覆寫者 fallback 30）。
  const timeDefault = Number(config.defaults.time_limit_per_question ?? 30);

  const renderToggle = (spec: SettingSpec & { kind: "toggle" }) => {
    // show_answer 在例句重組用不同描述
    const descKey =
      spec.key === "show_answer" && mode === "rearrangement"
        ? `${PM}.showAnswerDesc`
        : (TOGGLE_DESC[spec.key] ?? "");
    const lockedByAudio =
      spec.key === "show_answer" && isShowAnswerLockedByAudio(mode, value);
    // Issue #631：缺題目圖片時禁止「開啟」顯示選項圖片（已開啟者可關閉）。
    const lockedByMissingImage =
      spec.key === "show_option_images" && hasMissingImage && !v[spec.key];
    const disabled = lockedByAudio || lockedByMissingImage;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 h-9">
          <Switch
            checked={Boolean(v[spec.key])}
            disabled={disabled}
            onCheckedChange={(checked) => apply(spec, checked)}
          />
          <span
            className={cn(
              "text-sm",
              disabled ? "text-gray-400" : "text-gray-600",
            )}
            title={
              lockedByMissingImage
                ? t(`${PM}.showOptionImagesMissing`)
                : undefined
            }
          >
            {t(descKey)}
          </span>
        </div>
        {lockedByAudio && (
          <p className="text-xs text-red-600">
            {t(`${PM}.showAnswerLockedByAudio`)}
          </p>
        )}
        {lockedByMissingImage && (
          <p className="text-xs text-amber-600">
            {t(`${PM}.showOptionImagesMissing`)}
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
        className="w-full h-9 px-3 rounded-md border border-gray-200 text-sm dark:border-gray-600 dark:bg-gray-800"
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
              disabled={locked}
              onClick={() => apply(spec, opt.value)}
              className={cn(
                "flex-1 p-3 rounded-lg border text-sm",
                locked && "opacity-50 cursor-not-allowed",
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
      {locked && (
        <p className="text-xs text-amber-600 mb-2">
          {t("assignmentDetail.sheet.lockedSettingHint")}
        </p>
      )}
      <div className="space-y-3">
        {config.settings.map((spec, i) => (
          <div key={`${spec.kind}-${spec.key}-${i}`}>{renderSpec(spec)}</div>
        ))}
      </div>
    </Card>
  );
}

export default PracticeModeSettingsPanel;
