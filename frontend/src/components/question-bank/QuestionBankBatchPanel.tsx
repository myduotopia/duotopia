/**
 * 題庫編輯面板・左欄批次設定（Issue #1064）。
 *
 * 用單字集同一個殼 BatchWorkPanel（hideTextTab + showTranslate=false），所以
 * 「PDF/圖片上傳」「語音生成設定」兩張跟單字集**完全相同**。其餘卡片用
 * BatchSettingCard 堆，順序（使用者定案）：
 *   1. PDF/圖片上傳（MagicPasteInput；AI 擷取選擇題在 #1065，本輪 disabled 遮罩）
 *   2. 語音生成設定（BatchTTSSettings card；checkbox = 儲存時自動補題幹語音）+「立即生成全部」
 *   3. AI 作答（設答案＋填解析）、AI 考點分析（填考點）— #1065 接後端，本輪 disabled
 *   4. 年段關聯設定 → 覆寫所有題
 *   5. 教材關聯設定 → 覆寫所有題
 *   6. 考題來源（可打字下拉：選、搜、新增）— 整批共用
 *   7. 是否公開分享考題（必選、不預設）— 整批共用
 * 考點不做批次設定（使用者定案）：只在右側單題設定，或由 AI 考點分析填入。
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  FileText,
  GraduationCap,
  Globe,
  Loader2,
  Sparkles,
  Target,
  Volume2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  BatchSettingCard,
  BatchWorkPanel,
  type TTSSettingsState,
} from "@/components/shared/batch";
import {
  CreatableCombobox,
  type ComboboxItem,
} from "@/components/shared/CreatableCombobox";
import { GradeRangeSlider } from "@/components/shared/GradeRangeSlider";
import MagicPasteInput, {
  type MagicPasteMcItem,
} from "@/components/shared/MagicPasteInput";
import { ProgramLessonPicker } from "@/components/shared/ProgramLessonPicker";
import { VisibilitySelect } from "@/components/shared/VisibilitySelect";
import type { Program } from "@/types";
import type { QuestionVisibility } from "@/types/questionBank";
import type { BatchDefaults } from "./questionDraft";
import { makeCreateSource, searchSources } from "./sourcesCombobox";

export interface QuestionBankBatchPanelProps {
  // 語音
  ttsSettings: TTSSettingsState;
  onTtsSettingsChange: (s: TTSSettingsState) => void;
  autoTTS: boolean;
  onAutoTTSChange: (enabled: boolean) => void;
  /** 有題幹且尚無語音的題數（0 → 立即生成鍵 disabled） */
  pendingAudioCount: number;
  onGenerateAllAudio: () => void;
  generatingAudio: boolean;
  // AI（#1065 接上後傳入；未傳 = 尚未實作）
  hasAnyStem: boolean;
  onAiAnswer?: () => void;
  onAiAnalyze?: () => void;
  /** AI 作答／分析進行中（spinner + 兩鍵 disabled） */
  aiBusy?: boolean;
  /** 考卷擷取結果 → 右側題目卡 */
  onInsertExtracted?: (items: MagicPasteMcItem[]) => void;
  // 批次覆寫
  batch: BatchDefaults;
  onBatchChange: (patch: Partial<BatchDefaults>) => void;
  programs: Program[];
  // 整批共用
  sources: ComboboxItem[];
  onSourcesChange: (next: ComboboxItem[]) => void;
  visibility: QuestionVisibility | null;
  onVisibilityChange: (v: QuestionVisibility) => void;
  /** 建到機構題庫時，來源也建成機構來源 */
  organizationId?: string;
  disabled?: boolean;
  /** 編輯單題：左欄只顯示「考題來源」與「是否公開」（使用者定案） */
  editOnly?: boolean;
}

export default function QuestionBankBatchPanel({
  ttsSettings,
  onTtsSettingsChange,
  autoTTS,
  onAutoTTSChange,
  pendingAudioCount,
  onGenerateAllAudio,
  generatingAudio,
  hasAnyStem,
  onAiAnswer,
  onAiAnalyze,
  aiBusy = false,
  onInsertExtracted,
  batch,
  onBatchChange,
  programs,
  sources,
  onSourcesChange,
  visibility,
  onVisibilityChange,
  organizationId,
  disabled = false,
  editOnly = false,
}: QuestionBankBatchPanelProps) {
  const { t } = useTranslation();
  const comingSoon = t("questionBank.comingSoon");

  const createSource = useMemo(
    () => makeCreateSource(organizationId),
    [organizationId],
  );

  // 考題來源 + 是否公開：新增與編輯都會看到（編輯模式左欄只剩這兩張）
  const sharedCards = (
    <>
      <BatchSettingCard
        icon={<FileText className="h-4 w-4 text-gray-600" />}
        title={t("questionBank.form.batch.sources")}
        hint={t("questionBank.form.batch.sourcesHint")}
        tone="gray"
        data-testid="qb-batch-sources"
      >
        <CreatableCombobox
          value={sources}
          onChange={onSourcesChange}
          onSearch={searchSources}
          onCreate={createSource}
          disabled={disabled}
          triggerLabel={t("questionBank.form.batch.pickSources")}
          searchPlaceholder={t(
            "questionBank.form.batch.sourceSearchPlaceholder",
          )}
          emptyText={t("questionBank.form.batch.noSources")}
          createLabel={(name) =>
            t("questionBank.form.batch.createSource", { name })
          }
          data-testid="qb-sources"
        />
      </BatchSettingCard>

      <BatchSettingCard
        icon={<Globe className="h-4 w-4 text-sky-600" />}
        title={t("questionBank.form.batch.visibility")}
        hint={t("questionBank.form.batch.visibilityHint")}
        tone="gray"
        data-testid="qb-batch-visibility"
      >
        <VisibilitySelect
          value={visibility}
          onChange={onVisibilityChange}
          scope={organizationId ? "organization" : "personal"}
          disabled={disabled}
          required
          data-testid="qb-visibility"
        />
      </BatchSettingCard>
    </>
  );

  if (editOnly) {
    // 編輯單題：同一個左欄外觀（與 BatchWorkPanel 相同的容器），只放這兩張卡
    return (
      <div
        className="hidden md:flex md:w-[35%] flex-col border rounded-lg bg-gray-50 p-4 sticky top-0 self-start max-h-[calc(100vh-180px)] overflow-y-auto overscroll-contain"
        data-testid="qb-edit-panel"
      >
        <div className="space-y-3 flex-1 flex flex-col">{sharedCards}</div>
      </div>
    );
  }

  return (
    <BatchWorkPanel
      hideTextTab
      showTranslate={false}
      autoTTS={autoTTS}
      onAutoTTSChange={onAutoTTSChange}
      ttsSettings={ttsSettings}
      onTTSSettingsChange={onTtsSettingsChange}
      onConfirm={() => undefined}
      isBusy={generatingAudio}
      imageTab={
        // 1. PDF/圖片上傳：與單字集同一個 MagicPasteInput；擷取完直接進右側題目卡（不預覽）
        <div
          className={disabled ? "opacity-50 pointer-events-none" : ""}
          data-testid="qb-upload"
        >
          <MagicPasteInput
            extractMode="multiple_choice"
            onInsertQuestions={onInsertExtracted}
          />
        </div>
      }
    >
      {/* 2b. 立即生成全部（語音設定卡下方） */}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full gap-1.5"
        onClick={onGenerateAllAudio}
        disabled={disabled || generatingAudio || pendingAudioCount === 0}
        data-testid="qb-generate-all-audio"
      >
        {generatingAudio ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Volume2 size={14} />
        )}
        {generatingAudio
          ? t("questionBank.form.tools.generating")
          : t("questionBank.form.tools.generateAll", {
              count: pendingAudioCount,
            })}
      </Button>

      {/* 3. AI 作答 / AI 考點分析 */}
      <BatchSettingCard
        icon={<Sparkles className="h-4 w-4 text-purple-600" />}
        title={t("questionBank.form.tools.aiTitle")}
        hint={t("questionBank.form.tools.aiHint")}
        tone="purple"
        data-testid="qb-ai-card"
      >
        <div className="space-y-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 bg-white"
            disabled={disabled || aiBusy || !hasAnyStem || !onAiAnswer}
            onClick={onAiAnswer}
            title={
              !onAiAnswer
                ? comingSoon
                : !hasAnyStem
                  ? t("questionBank.form.tools.needStem")
                  : undefined
            }
            data-testid="qb-ai-answer"
          >
            {aiBusy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} className="text-violet-600" />
            )}
            {t("questionBank.form.tools.aiAnswer")}
            {!onAiAnswer && (
              <span className="ml-auto text-xs text-gray-400">
                {comingSoon}
              </span>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 bg-white"
            disabled={disabled || aiBusy || !hasAnyStem || !onAiAnalyze}
            onClick={onAiAnalyze}
            title={
              !onAiAnalyze
                ? comingSoon
                : !hasAnyStem
                  ? t("questionBank.form.tools.needStem")
                  : undefined
            }
            data-testid="qb-ai-analyze"
          >
            <Target size={14} className="text-emerald-600" />
            {t("questionBank.form.tools.aiAnalyze")}
            {!onAiAnalyze && (
              <span className="ml-auto text-xs text-gray-400">
                {comingSoon}
              </span>
            )}
          </Button>
        </div>
      </BatchSettingCard>

      {/* 4. 年段關聯設定 */}
      <BatchSettingCard
        icon={<GraduationCap className="h-4 w-4 text-blue-600" />}
        title={t("questionBank.form.batch.grade")}
        hint={t("questionBank.form.batch.applyAllHint")}
        tone="blue"
        data-testid="qb-batch-grade"
      >
        <GradeRangeSlider
          value={batch.grade}
          onChange={(grade) => onBatchChange({ grade })}
          disabled={disabled}
          data-testid="qb-batch-grade-slider"
        />
      </BatchSettingCard>

      {/* 5. 教材關聯設定 */}
      <BatchSettingCard
        icon={<BookOpen className="h-4 w-4 text-orange-600" />}
        title={t("questionBank.form.batch.programLink")}
        hint={t("questionBank.form.batch.applyAllHint")}
        tone="orange"
        data-testid="qb-batch-program-link"
      >
        <ProgramLessonPicker
          programs={programs}
          value={batch.program_link}
          onChange={(program_link) => onBatchChange({ program_link })}
          disabled={disabled}
          data-testid="qb-batch-program-link-picker"
        />
      </BatchSettingCard>

      {sharedCards}
    </BatchWorkPanel>
  );
}
