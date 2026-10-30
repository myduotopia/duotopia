/**
 * 題目清單的一列（可拖曳排序）與它用到的小元件 —— Issue #1146 review 6 從
 * `ScenarioDialoguePanel.tsx` 原樣搬出來，讓面板只留 state 與流程。
 *
 * - `SortableRow`：題目、翻譯、參考答案／補充說明、單題評分標準（預設＋覆寫）、題目圖、題目語音。
 * - `ScenarioImageSlot`：每題 1 張的題目圖（上傳／替換／移除；AI 生圖依旗標，#1158 起開
 *   共用的 `AiImageGenerateDialog`，對話框由面板持有）。修正 C6 起圖用標準元件 `ZoomableImage`，
 *   點圖放大；滑過時的替換／移除遮罩不接點擊（只有按鈕接），點按鈕不會觸發放大。
 * - `Chip`、`tenseLabel`、`voiceLabel`、`isTenseSet`：小工具（#1158 C commit 4 起右欄情境區不再
 *   顯示評分標準，目前只有這支檔用到）。
 *
 * 窄版（`compact`，第 3 輪；#1158 C commit 4 起由所在欄寬度決定、不看 viewport 的 sm）：
 * 題目圖移到題目上方直排，右邊欄位才有整張卡的寬度；必用字詞
 * 輸入佔整列，不會超出卡片；評分準則標頭可換行。非窄版維持圖左、欄位右。
 * 停用的刪除（至少留 1 題）與生成語音（還沒輸入題目）用 `title` 說明原因。
 * 複製鍵在題數已滿時停用，`title` 改成上限說明（`duplicateBlockedReason`，第 3b 輪）。
 */
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  ImagePlus,
  Loader2,
  Mic,
  Play,
  RotateCw,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import type { ScenarioDialogueRow, TenseSetting } from "@/lib/scenarioDialogue";
import { ZoomableImage } from "@/components/question-bank/LayoutRenderer";
import { TenseSelects } from "./TenseSelects";

/** 只取字面翻譯用；型別放寬成字串以免每個呼叫點都要轉型 i18next 的 TFunction */
type Translate = (key: string, options?: Record<string, unknown>) => string;
export const isTenseSet = (tense: TenseSetting) =>
  !!tense.time && !!tense.aspect;

export const voiceLabel = (voice: string, t: Translate) =>
  voice ? t(`scenarioDialogue.voices.${voice}`) : "";

/**
 * 中文是「過去簡單式」直接相接，英文要「Past Simple」中間有空格，
 * 所以連接方式本身也交給 i18n（`tenseCombo`）決定。
 */
export const tenseLabel = (tense: TenseSetting, t: Translate) =>
  isTenseSet(tense)
    ? t("scenarioDialogue.tenseCombo", {
        time: t(`scenarioDialogue.tenseTimes.${tense.time}`),
        aspect: t(`scenarioDialogue.tenseAspects.${tense.aspect}`),
      })
    : "";

/** 生效中的條件標籤；`onRemove` 未給則不顯示移除鍵（繼承來的條件要去整體改） */
export function Chip({
  label,
  onRemove,
}: {
  label: string;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={t("contentEditor.tooltips.delete")}
          className="opacity-60 hover:opacity-100"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

/**
 * 情境圖片欄位 —— AI 生成與手動上傳共用同一個位置。
 *
 * 沒有圖時並列兩個入口：自己上傳，或「AI 生成」（#1158：開生圖對話框，由面板處理）。
 * 有圖時滑過縮圖可以換成自己的圖或移除；點圖本身放大（修正 C6）。
 */
export function ScenarioImageSlot({
  imageUrl,
  loading,
  onPick,
  onRemove,
  onGenerate,
  className = "w-[104px] h-[74px]",
}: {
  imageUrl: string | null;
  loading: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
  onGenerate: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  // #1044 關閉、#1158 打開。關閉時只藏生圖入口，上傳／替換／移除不受影響。
  const imageGenerationEnabled = FEATURE_FLAGS.SCENARIO_IMAGE_GENERATION;

  const pick = () => inputRef.current?.click();

  return (
    <div
      className={`${className} relative shrink-0 rounded-md border border-gray-200 bg-gray-100 overflow-hidden group`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          // 清空才能連續選同一個檔案（否則第二次不觸發 change）
          e.target.value = "";
        }}
      />

      {loading ? (
        <div className="w-full h-full flex items-center justify-center">
          <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
        </div>
      ) : imageUrl ? (
        <>
          {/* 修正 C6：點圖放大（標準元件 ZoomableImage） */}
          <ZoomableImage
            src={imageUrl}
            alt={t("scenarioDialogue.labels.questionImage")}
            className="w-full h-full object-cover"
            buttonClassName="block h-full w-full"
            testId="scenario-question-image"
          />
          {/* 有圖時才出現的替換／移除，平常不擋住圖。遮罩本身不接點擊（pointer-events-none），
              點按鈕以外的地方會穿到下面的圖、照樣放大；按鈕自己接點擊，不會觸發放大 */}
          <div className="pointer-events-none absolute inset-0 hidden group-hover:flex group-focus-within:flex items-center justify-center gap-1 bg-black/50 [&>button]:pointer-events-auto">
            <button
              type="button"
              onClick={pick}
              className="px-1.5 py-0.5 rounded bg-white/90 text-xs font-semibold text-gray-700 hover:bg-white"
            >
              {t("scenarioDialogue.buttons.replaceImage")}
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="px-1.5 py-0.5 rounded bg-white/90 text-xs font-semibold text-red-600 hover:bg-white"
            >
              {t("scenarioDialogue.buttons.removeImage")}
            </button>
          </div>
        </>
      ) : (
        /* 兩個入口並列：自己傳，或讓 AI 生。框只有 104px，所以用文字列而非圖示。
         *
         * #1044 把字級從 10px 提到 12px，這一格是**唯一**字變大又寬度固定的地方
         * （其餘放大的字都在 flex / w-full 容器裡，會重排不會溢出）。可用寬度是
         * 104 - 2×6（p-1.5）= 92px，實測四種標籤都塞得下：
         *   上傳圖片 48 + 圖示 14 + gap 4 = 66px
         *   Upload   40 + 圖示 14 + gap 4 = 58px
         *   AI 生成 約 44 + 圖示 14 + gap 4 = 62px
         *   Generate 約 52 + 圖示 14 + gap 4 = 70px
         * 新增語系或改這兩個標籤時請重算 —— 超過 92px 會被 overflow-hidden 切掉。
         */
        <div className="w-full h-full flex flex-col items-stretch justify-center gap-1 p-1.5">
          <button
            type="button"
            onClick={pick}
            className="flex items-center justify-center gap-1 rounded border border-gray-300 bg-white py-1 text-xs font-semibold text-gray-600 whitespace-nowrap hover:bg-gray-50"
          >
            <ImagePlus className="h-3.5 w-3.5 shrink-0" />
            {t("scenarioDialogue.buttons.uploadImage")}
          </button>
          {/* #1158：按下去開共用的「AI 生圖」對話框（描述預填 imagePrompt 或題目本文）。
              開關關閉時不顯示（不再放「即將推出」）。 */}
          {imageGenerationEnabled && (
            <button
              type="button"
              onClick={onGenerate}
              className="flex items-center justify-center gap-1 rounded bg-blue-600 py-1 text-xs font-semibold text-white whitespace-nowrap hover:bg-blue-700"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              {t("scenarioDialogue.buttons.generateImage")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface RowProps {
  row: ScenarioDialogueRow;
  index: number;
  langLabel: string;
  /** 老師是否已選定輔助語言；未選時翻譯欄不顯示語言小標籤 */
  hasLanguage: boolean;
  /** 整份設定的評分標準，本題未覆寫時沿用 */
  globalTense: TenseSetting;
  globalVoice: string;
  canDelete: boolean;
  regenerating: boolean;
  imageLoading: boolean;
  onChange: (patch: Partial<ScenarioDialogueRow>) => void;
  onDuplicate: () => void;
  /** 不能複製時的原因（例如題數已滿）；null＝可以複製 */
  duplicateBlockedReason: string | null;
  onDelete: () => void;
  onRegenerate: () => void;
  onPickImage: (file: File) => void;
  onRemoveImage: () => void;
  onGenerateImage: () => void;
  /** 產生這一題的題目語音（TTS） */
  onGenerateAudio: () => void;
  /** 播放已產生的題目語音 */
  onPlayAudio: () => void;
  /** 這一題的語音正在產生中 */
  audioLoading: boolean;
  /**
   * 窄版排法（題目圖在上、欄位直排、必用字詞佔整列）。由題目清單「所在欄的寬度」決定
   * （#1158 C commit 4），不看 viewport 的 `sm` —— 同頁版面的右欄在大螢幕上也可能很窄。
   */
  compact?: boolean;
}

export function SortableRow({
  row,
  index,
  langLabel,
  hasLanguage,
  globalTense,
  globalVoice,
  canDelete,
  regenerating,
  imageLoading,
  onChange,
  onDuplicate,
  duplicateBlockedReason,
  onDelete,
  onRegenerate,
  onPickImage,
  onRemoveImage,
  onGenerateImage,
  onGenerateAudio,
  onPlayAudio,
  audioLoading,
  compact = false,
}: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: row.id });
  const { t } = useTranslation();

  // 參考答案有內容時預設展開：AI 產題會自動帶入，不能讓老師沒看過就影響評分
  const [noteOpen, setNoteOpen] = useState(
    !!row.rubricNote.trim() || !!row.referenceAnswer.trim(),
  );
  const [keywordDraft, setKeywordDraft] = useState(() =>
    row.keywords.join(", "),
  );

  /** 與 ReadingAssessmentPanel 相同：textarea 依內容自動長高，避免文字被裁切 */
  /** 打字時同步長高。callback ref 只在掛載時跑，光靠它文字會被 overflow-hidden 裁掉 */
  const growOnInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.target.style.height = "auto";
    e.target.style.height = e.target.scrollHeight + "px";
  };

  const autoHeightRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, []);

  // 生效值 = 本題覆寫 ?? 整體設定
  const isOverridden = row.tenseOverride !== null || row.voiceOverride !== null;
  const effTense = row.tenseOverride ?? globalTense;
  const effVoice = row.voiceOverride ?? globalVoice;

  /**
   * 動到任何一個下拉就整組脫鉤成「本題自訂」—— 只覆寫其中一半會讓老師搞不清楚
   * 這題到底跟不跟著整體走。復原鍵把兩者一起設回 null。
   */
  const overrideTense = (time: string, aspect: string) =>
    onChange({ tenseOverride: { time, aspect }, voiceOverride: effVoice });

  const overrideVoice = (voice: string) =>
    onChange({ tenseOverride: effTense, voiceOverride: voice });

  const resetToGlobal = () =>
    onChange({ tenseOverride: null, voiceOverride: null });

  const commitKeywords = () => {
    const list = keywordDraft
      .split(/[,，]/)
      .map((w) => w.trim())
      .filter(Boolean);
    setKeywordDraft(list.join(", "));
    onChange({ keywords: list });
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`p-3 rounded-lg border ${
        regenerating
          ? "bg-gray-50 border-gray-200 opacity-60"
          : "bg-gray-50 border-gray-200"
      }`}
    >
      {/* Header：拖曳把手 + 標號 + 操作（與例句集/單字集一致） */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing touch-none"
            title={t("contentEditor.tooltips.dragToReorder")}
          >
            <GripVertical className="h-5 w-5 text-gray-400 hover:text-gray-700 transition-colors" />
          </div>
          <span className="text-sm font-medium text-gray-600">{index + 1}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            className="p-1 rounded hover:bg-gray-200 disabled:opacity-50"
            title={t("scenarioDialogue.tooltips.regenerateQuestion")}
          >
            {regenerating ? (
              <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
            ) : (
              <RotateCw className="h-4 w-4 text-gray-600" />
            )}
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            disabled={!!duplicateBlockedReason}
            className="p-1 rounded hover:bg-gray-200 disabled:hover:bg-transparent"
            title={
              duplicateBlockedReason ?? t("contentEditor.tooltips.duplicate")
            }
          >
            <Copy
              className={`h-4 w-4 ${duplicateBlockedReason ? "text-gray-300" : "text-gray-600"}`}
            />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={!canDelete}
            className="p-1 rounded hover:bg-gray-200 disabled:hover:bg-transparent"
            title={
              canDelete
                ? t("contentEditor.tooltips.delete")
                : t("scenarioDialogue.tooltips.deleteDisabled")
            }
          >
            <Trash2
              className={`h-4 w-4 ${canDelete ? "text-gray-600" : "text-gray-300"}`}
            />
          </button>
        </div>
      </div>

      <div className={`flex gap-3 ${compact ? "flex-col" : "flex-row"}`}>
        <ScenarioImageSlot
          imageUrl={row.imageUrl}
          loading={imageLoading}
          onPick={onPickImage}
          onRemove={onRemoveImage}
          onGenerate={onGenerateImage}
        />

        <div className="flex-1 min-w-0">
          <div className="min-w-0 space-y-2">
            {/* 題目：AI 產生但可編輯 */}
            <div className="relative">
              <textarea
                value={row.question}
                onChange={(e) => {
                  growOnInput(e);
                  onChange({ question: e.target.value });
                }}
                placeholder={t("scenarioDialogue.placeholders.question")}
                ref={autoHeightRef}
                rows={1}
                className="w-full px-3 py-2 pr-20 border border-gray-300 rounded-md text-sm resize-y min-h-[38px] overflow-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <div className="absolute right-2 top-2 flex items-center space-x-1">
                {row.audioUrl && (
                  <button
                    type="button"
                    onClick={onPlayAudio}
                    className="p-1 rounded text-green-600 hover:bg-green-100"
                    title={t("contentEditor.tooltips.play")}
                  >
                    <Play className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onGenerateAudio}
                  disabled={audioLoading || !row.question.trim()}
                  className={`p-1 rounded disabled:opacity-50 ${
                    row.audioUrl
                      ? "text-blue-600 hover:bg-blue-100"
                      : "text-gray-600 bg-yellow-100 hover:bg-yellow-200"
                  }`}
                  title={
                    // 還沒輸入題目而停用時要說原因；產生中的暫時停用不必
                    !audioLoading && !row.question.trim()
                      ? t("scenarioDialogue.tooltips.generateAudioDisabled")
                      : t("scenarioDialogue.tooltips.generateAudio")
                  }
                >
                  {audioLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* 翻譯：placeholder 即為左側選定的輔助語言 */}
            <div className="relative">
              <textarea
                value={row.translation}
                onChange={(e) => {
                  growOnInput(e);
                  onChange({ translation: e.target.value });
                }}
                placeholder={langLabel}
                ref={autoHeightRef}
                rows={1}
                maxLength={500}
                className="w-full px-3 py-2 pr-16 border border-gray-300 rounded-md text-sm resize-y min-h-[38px] overflow-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              {hasLanguage && (
                <span className="absolute right-3 top-2.5 text-xs text-gray-400">
                  {langLabel}
                </span>
              )}
            </div>

            {/* 參考答案與補充說明：有內容時預設展開，避免看不見卻生效的設定 */}
            <div className="bg-white rounded-md border border-gray-200 px-2.5 py-2">
              <button
                type="button"
                onClick={() => setNoteOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-blue-600"
              >
                {noteOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {t("scenarioDialogue.labels.advanced")}
                {!noteOpen &&
                  (row.rubricNote.trim() || row.referenceAnswer.trim()) && (
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  )}
              </button>
              {noteOpen && (
                <div className="mt-1.5 space-y-2">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-gray-500">
                      {t("scenarioDialogue.labels.referenceAnswer")}
                    </span>
                    <textarea
                      value={row.referenceAnswer}
                      onChange={(e) =>
                        onChange({ referenceAnswer: e.target.value })
                      }
                      rows={2}
                      placeholder={t(
                        "scenarioDialogue.placeholders.referenceAnswer",
                      )}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm resize-y focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-400">
                      {t("scenarioDialogue.hints.referenceAnswer")}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-gray-500">
                      {t("scenarioDialogue.labels.rubricNote")}
                    </span>
                    <textarea
                      value={row.rubricNote}
                      onChange={(e) => onChange({ rubricNote: e.target.value })}
                      rows={2}
                      placeholder={t(
                        "scenarioDialogue.placeholders.rubricNote",
                      )}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm resize-y focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 評分準則：接在題目下方，單題設定一路往下讀 */}
            <div className="bg-white rounded-md border border-gray-200 divide-y divide-gray-100">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2.5 py-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-gray-500" />
                  <span className="text-xs font-semibold text-gray-600">
                    {t("scenarioDialogue.labels.rubric")}
                  </span>
                </div>
                {/* 沿用/自訂狀態必須看得見，否則改了整體卻沒變的題目會像壞掉 */}
                {isOverridden ? (
                  <button
                    type="button"
                    onClick={resetToGlobal}
                    className="flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-blue-600 hover:underline"
                    title={t("scenarioDialogue.tooltips.resetToGlobal")}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {t("scenarioDialogue.labels.overridden")}
                  </button>
                ) : (
                  <span className="whitespace-nowrap text-xs text-gray-400">
                    {t("scenarioDialogue.labels.inherited")}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-2 px-2.5 py-2">
                <TenseSelects
                  tense={effTense}
                  voice={effVoice}
                  onTenseChange={overrideTense}
                  onVoiceChange={overrideVoice}
                />
                <label
                  className={`flex flex-col gap-1 flex-1 min-w-0 ${
                    compact ? "basis-full" : "basis-auto min-w-[140px]"
                  }`}
                >
                  <span className="text-xs text-gray-500">
                    {t("scenarioDialogue.rubricPresets.keywords")}
                  </span>
                  <input
                    type="text"
                    value={keywordDraft}
                    onChange={(e) => setKeywordDraft(e.target.value)}
                    onBlur={commitKeywords}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitKeywords();
                      }
                    }}
                    placeholder={t("scenarioDialogue.placeholders.keywords")}
                    className="w-full px-1.5 py-1 border border-gray-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </label>
              </div>

              {/* 生效中的條件 */}
              {(isTenseSet(effTense) ||
                effVoice ||
                row.keywords.length > 0) && (
                <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
                  {isTenseSet(effTense) && (
                    <Chip
                      label={t("scenarioDialogue.chips.tense", {
                        value: tenseLabel(effTense, t),
                      })}
                    />
                  )}
                  {effVoice && (
                    <Chip
                      label={t("scenarioDialogue.chips.voice", {
                        value: voiceLabel(effVoice, t),
                      })}
                    />
                  )}
                  {row.keywords.length > 0 && (
                    <Chip
                      label={t("scenarioDialogue.chips.keywords", {
                        value: row.keywords.join(", "),
                      })}
                      onRemove={() => {
                        setKeywordDraft("");
                        onChange({ keywords: [] });
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
