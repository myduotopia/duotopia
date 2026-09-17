/**
 * 左欄・工具區（Issue #1064）。
 *
 * 與「新增教材內容」左欄同構，但只放題庫需要的模組：
 * - 語音生成：BatchTTSSettings（同一份口音／性別／語速設定）+「生成全部題目語音」（只對題幹，不對選項）
 * - AI 作答、AI 考點分析：右側沒有題幹時 disabled；後端在 #1065，這輪一律 disabled +「即將推出」
 * - PDF/圖片上傳：AI 從考卷圖片擷取題目（#1065 補 extract_mode），這輪顯示位置但 disabled
 * 不放「批次貼上」textarea。
 */

import { useTranslation } from "react-i18next";
import { FileUp, Loader2, Sparkles, Target, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  BatchTTSSettings,
  type TTSSettingsState,
} from "@/components/shared/BatchTTSSettings";

export interface QuestionBankToolsPanelProps {
  ttsSettings: TTSSettingsState;
  onTtsSettingsChange: (s: TTSSettingsState) => void;
  /** 有題幹且尚無語音的題數（0 → 生成鍵 disabled） */
  pendingAudioCount: number;
  onGenerateAllAudio: () => void;
  generatingAudio: boolean;
  /** 右側是否至少有一題有題幹（AI 兩顆的前提） */
  hasAnyStem: boolean;
  /** #1065 接上後傳入；未傳 = 尚未實作 */
  onAiAnswer?: () => void;
  onAiAnalyze?: () => void;
  onUpload?: () => void;
  disabled?: boolean;
}

export default function QuestionBankToolsPanel({
  ttsSettings,
  onTtsSettingsChange,
  pendingAudioCount,
  onGenerateAllAudio,
  generatingAudio,
  hasAnyStem,
  onAiAnswer,
  onAiAnalyze,
  onUpload,
  disabled = false,
}: QuestionBankToolsPanelProps) {
  const { t } = useTranslation();
  const comingSoon = t("questionBank.comingSoon");

  const aiDisabledReason = !hasAnyStem
    ? t("questionBank.form.tools.needStem")
    : undefined;

  return (
    <div className="space-y-4" data-testid="qb-tools">
      <h3 className="text-sm font-semibold text-gray-800">
        {t("questionBank.form.tools.title")}
      </h3>

      {/* 語音生成 */}
      <section className="rounded-md border border-gray-200 bg-white p-3 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <Volume2 size={16} className="text-blue-600" />
          {t("questionBank.form.tools.tts")}
        </div>
        <p className="text-xs text-gray-500">
          {t("questionBank.form.tools.ttsHint")}
        </p>
        <BatchTTSSettings
          settings={ttsSettings}
          onChange={onTtsSettingsChange}
          variant="section"
        />
        <Button
          type="button"
          size="sm"
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
      </section>

      {/* AI 作答 / AI 考點分析 */}
      <section className="rounded-md border border-gray-200 bg-white p-3 space-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          disabled={disabled || !hasAnyStem || !onAiAnswer}
          onClick={onAiAnswer}
          title={!onAiAnswer ? comingSoon : aiDisabledReason}
          data-testid="qb-ai-answer"
        >
          <Sparkles size={14} className="text-violet-600" />
          {t("questionBank.form.tools.aiAnswer")}
          {!onAiAnswer && (
            <span className="ml-auto text-xs text-gray-400">{comingSoon}</span>
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          disabled={disabled || !hasAnyStem || !onAiAnalyze}
          onClick={onAiAnalyze}
          title={!onAiAnalyze ? comingSoon : aiDisabledReason}
          data-testid="qb-ai-analyze"
        >
          <Target size={14} className="text-emerald-600" />
          {t("questionBank.form.tools.aiAnalyze")}
          {!onAiAnalyze && (
            <span className="ml-auto text-xs text-gray-400">{comingSoon}</span>
          )}
        </Button>
        <p className="text-xs text-gray-500">
          {t("questionBank.form.tools.aiHint")}
        </p>
      </section>

      {/* PDF / 圖片上傳 */}
      <section className="rounded-md border border-gray-200 bg-white p-3 space-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          disabled={disabled || !onUpload}
          onClick={onUpload}
          title={!onUpload ? comingSoon : undefined}
          data-testid="qb-upload"
        >
          <FileUp size={14} className="text-orange-600" />
          {t("questionBank.form.tools.upload")}
          {!onUpload && (
            <span className="ml-auto text-xs text-gray-400">{comingSoon}</span>
          )}
        </Button>
        <p className="text-xs text-gray-500">
          {t("questionBank.form.tools.uploadHint")}
        </p>
      </section>
    </div>
  );
}
