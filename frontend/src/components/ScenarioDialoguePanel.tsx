/**
 * ScenarioDialoguePanel — 情境對話（口說練習）新增/編輯面板
 *
 * Issue #944 / #864 / #1146。面板分成兩個畫面，**不跳頁**，只在同一塊區域切換顯示：
 *
 * - **引導式對話**（#1146 取代舊的 Step 1 設定頁）—— `ScenarioSetupChat`。
 *   一次問一件事、選項是按鈕：「需要情境嗎？」（不需要／我有現成的／請 AI 幫我寫）→
 *   「題目怎麼來？」（我自己輸入／請 AI 出題）→（沒有情境時）想問的方向 → 出題設定卡
 *   （`QuestionSettingsCard`）→ 開始產生 → 題目清單。流程本身是純函式（`setupFlow.ts`）。
 *   情境圖（最多 5 張，學生看得到）在情境那一步管理：擷取自動裁切、補傳、刪除、重裁。
 *
 * - **題目清單**（Step 2）—— 左右兩欄：
 *   - 左欄 280px（sticky）是對話結果的**唯讀對照**：情境內容、情境圖、作答指引、整體
 *     評分標準，外加「回對話修改」。
 *   - 右欄最上面是**標題**（AI 寫情境或出題時建議，老師可改），其下是可拖曳排序的
 *     題目卡、新增題目、題數計數、上一步（回對話）。
 *
 * 兩個畫面共用同一份 state，只是切換顯示 —— 回對話改設定不會弄丟已產生的題目。
 * 編輯既有內容時直接落在題目清單；按「上一步」回到對話時，已答步驟由已存資料還原
 * （`answersFromSaved`）。
 *
 * **兩種「必填」不一樣，別混在一起**：
 * - `title` 是內容本身的必要欄位 → 擋**儲存**（`handleSave`），缺的時候留在題目清單
 *   並把游標帶到標題欄（#1146 起不再跳回設定頁）
 * - 情境（文字或圖）／出題方向是 AI 出題的素材 → 只擋**產題**（`handleGenerate`）。
 *   老師完全不用 AI（自己貼情境＋自己出題）是合法路徑，標題留空由他自己填。
 *
 * **標題由 AI 先給**（#1146）：AI 寫情境或出題時回 `suggested_title`，只在標題是空的時
 * 候自動填 —— 等於「用第一次的建議、之後不覆蓋老師改過的」。
 *
 * 評分標準採「預設 + 覆寫」：`row.tenseOverride/voiceOverride` 為 `null` 代表沿用
 * 整體，會跟著整體變動；老師動過單題就脫鉤（可用 ↺ 復原）。
 *
 * 題目圖片是**單題**的事（`row.imageUrl`，每題 1 張）；情境圖是整份的事
 * （`scenario_settings.scenario_images`），兩者無關。
 *
 * **儲存已串接後端（#1013）**：`save()` 通過擋關後把整份資料交給呼叫端的 `onSave`，
 * 由呼叫端換成 API payload（`@/lib/scenarioDialogue` 的 `toScenarioSavePayload`）並
 * 打 API —— 面板本身不認得 lesson / program / content id。存檔失敗時 `onSave` 會丟出
 * 例外，面板不關也不清空，老師打的東西不會因為一次網路錯誤消失。
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  GripVertical,
  ImagePlus,
  Loader2,
  Mic,
  PencilLine,
  Play,
  Plus,
  RotateCw,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { useSidebar } from "@/contexts/SidebarContext";
import { Button } from "@/components/ui/button";
import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";
import { TTSSettingsDialog } from "@/components/shared/TTSSettingsDialog";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { apiClient, ApiError } from "@/lib/api";
import { getVoiceAndRate } from "@/utils/ttsVoiceResolver";
import {
  EMPTY_TENSE,
  createScenarioRow as createRow,
  fromStoredTranslateLanguage,
  nextRowId,
  toStoredTranslateLanguage,
  type ScenarioDialogueInitialState,
  type ScenarioDialogueRow,
  type ScenarioSaveInput,
  type TenseSetting,
} from "@/lib/scenarioDialogue";
import {
  CEFR_LEVELS,
  DEFAULT_GENERATE_COUNT,
  MAX_ITEMS,
  MIN_ITEMS,
  TRANSLATION_LANGUAGES,
} from "@/components/scenario-dialogue-editor/constants";
import { TenseSelects } from "@/components/scenario-dialogue-editor/TenseSelects";
import { QuestionSettingsCard } from "@/components/scenario-dialogue-editor/QuestionSettingsCard";
import { ScenarioSetupChat } from "@/components/scenario-dialogue-editor/ScenarioSetupChat";
import { ScenarioImageStrip } from "@/components/scenario-dialogue-editor/ScenarioImageStrip";
import { useScenarioImages } from "@/components/scenario-dialogue-editor/useScenarioImages";
import {
  imagesFromUrls,
  type ScenarioImage,
} from "@/components/scenario-dialogue-editor/scenarioImages";
import {
  EMPTY_ANSWERS,
  answersFromSaved,
  reopenStep,
  type QuestionSource,
  type ScenarioMode,
  type SetupAnswers,
  type SetupStep,
} from "@/components/scenario-dialogue-editor/setupFlow";

/** 情境對話一次最少 3 題、最多 10 題（#864）。常數本體搬到 scenario-dialogue-editor/constants（#1146） */
export { MIN_ITEMS, MAX_ITEMS };

/**
 * 資料型別與空白列的建構子放在 `@/lib/scenarioDialogue` —— 呼叫端要用同一份型別把
 * 面板資料換成 API payload（見該檔的 null 語意說明），型別留在元件裡會讓 lib 反過來
 * 依賴元件。這裡原樣 re-export，既有的 `from "@/components/ScenarioDialoguePanel"`
 * 匯入不受影響。
 */
export type { TenseSetting, ScenarioDialogueRow } from "@/lib/scenarioDialogue";

/** 只取字面翻譯用；型別放寬成字串以免每個呼叫點都要轉型 i18next 的 TFunction */
type Translate = (key: string, options?: Record<string, unknown>) => string;
const isTenseSet = (tense: TenseSetting) => !!tense.time && !!tense.aspect;

const voiceLabel = (voice: string, t: Translate) =>
  voice ? t(`scenarioDialogue.voices.${voice}`) : "";

/**
 * 中文是「過去簡單式」直接相接，英文要「Past Simple」中間有空格，
 * 所以連接方式本身也交給 i18n（`tenseCombo`）決定。
 */
const tenseLabel = (tense: TenseSetting, t: Translate) =>
  isTenseSet(tense)
    ? t("scenarioDialogue.tenseCombo", {
        time: t(`scenarioDialogue.tenseTimes.${tense.time}`),
        aspect: t(`scenarioDialogue.tenseAspects.${tense.aspect}`),
      })
    : "";

export interface ScenarioDialoguePanelHandle {
  save: () => Promise<void>;
  isBusy: boolean;
}

export interface ScenarioDialoguePanelProps {
  /** 教材難度預設值（沿用課程 level） */
  programLevel?: string;
  /**
   * 編輯模式的既有內容（`fromScenarioContentDetail` 的產物）。
   *
   * `undefined` = 新增模式（面板給一張空白卡）；有值時整份 state 以它為初值。
   * 只在第一次拿到時套用一次 —— 之後老師的每一次編輯都是本地 state，若跟著
   * prop 反覆重設，呼叫端任何一次 re-render 都會把老師打到一半的東西洗掉。
   */
  initialData?: ScenarioDialogueInitialState | null;
  /** 儲存中（呼叫端正在打 API）。面板據此把儲存與生成類按鈕鎖住 */
  isSaving?: boolean;
  /**
   * 交出整份資料給呼叫端存檔。呼叫端負責換成 API payload（`toScenarioSavePayload`）、
   * 打 API 與成功後關閉面板 —— 面板本身不認得 lesson / program / content id。
   *
   * 丟出例外代表存檔失敗；面板不會關，也不清空 state（老師打的東西不能因為
   * 一次網路錯誤就消失）。
   */
  onSave?: (data: ScenarioSaveInput) => void | Promise<void>;
  onCancel?: () => void;
}

/** 完全沒被動過的空白列 — 產題時可以直接取代掉，不留一張空卡在最前面 */
const isBlankRow = (r: ScenarioDialogueRow) =>
  !r.question.trim() &&
  !r.translation.trim() &&
  !r.referenceAnswer.trim() &&
  !r.rubricNote.trim() &&
  !r.imagePrompt.trim() &&
  !r.tenseOverride &&
  !r.voiceOverride &&
  r.keywords.length === 0 &&
  !r.imageUrl;

/** 生效中的條件標籤；`onRemove` 未給則不顯示移除鍵（繼承來的條件要去整體改） */
function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
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
 * 老師不必先決定「這張要 AI 產還是自己傳」：勾了「AI 生成情境圖片」就在產題時
 * 自動填進來，任何時候都可以點縮圖換成自己的圖。因此這裡不提供生成按鈕，
 * 只負責顯示、上傳、替換、移除。
 */
function ScenarioImageSlot({
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
  // #1044: 生圖暫時關閉。上傳／替換／移除完全不受影響，既有圖片照常顯示。
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
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
          {/* 有圖時才出現的替換／移除，平常不擋住圖 */}
          <div className="absolute inset-0 hidden group-hover:flex group-focus-within:flex items-center justify-center gap-1 bg-black/50">
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
         *   即將推出 48（停用狀態不放圖示）
         *   Coming soon 約 74px
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
          {imageGenerationEnabled ? (
            <button
              type="button"
              onClick={onGenerate}
              className="flex items-center justify-center gap-1 rounded bg-blue-600 py-1 text-xs font-semibold text-white whitespace-nowrap hover:bg-blue-700"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              {t("scenarioDialogue.buttons.generateImage")}
            </button>
          ) : (
            /*
             * #1044: 生圖先關著，照專案既有的停用慣例做（ui-style-guide §3 規則 3 與
             * BulkActionBar 的 disabledReason / disabledBadge）：**原因要看得見**，
             * 不是點了才知道。
             *
             * 所以按鈕文字直接換成「即將推出」，title 補完整說明。原因既然不藏在
             * click 後面，就沒有 #1033 那個問題（那次的坑是「唯一的說明被原生
             * disabled 吃掉」），可以用原生 disabled。
             *
             * 停用狀態不放圖示：框只有 104px 寬，"Coming soon" 加上圖示會擠到換行。
             */
            <button
              type="button"
              disabled
              title={t("scenarioDialogue.messages.imageGenerationComingSoon")}
              className="rounded border border-gray-200 bg-gray-100 py-1 text-xs font-semibold text-gray-400 whitespace-nowrap opacity-70 cursor-not-allowed"
            >
              {t("scenarioDialogue.buttons.comingSoon")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 文字 AI 的失敗提示（Issue #1025）。
 *
 * 402（本月額度用完）要與一般失敗分開講：老師可能已經填好半份設定，
 * 給他一句「稍後再試」等於叫他白等 —— 這個月不會再成功。所以明講額度用完、
 * 下個月自動重置、現在可以改用手動輸入（面板上填過的東西都還在）。
 *
 * 三個呼叫點（產題、重產單題、生成情境文章／擷取）共用這一份。
 */
function textAiErrorKey(error: unknown): string {
  // 用 status 判斷，**不要比對 message 字串**：ApiError 的 message 是後端 detail 裡的
  // 那句中文，不含 "402" 也不含錯誤碼（見 api.ts 的 ApiError constructor）。比字串的話
  // 這個分支永遠不會進去，額度提示等於死碼 —— 本機 review 抓到的就是這個。
  if (error instanceof ApiError && error.status === 402) {
    return "scenarioDialogue.messages.textQuotaExceeded";
  }
  return "scenarioDialogue.messages.generateFailed";
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
}

function SortableRow({
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
  onDelete,
  onRegenerate,
  onPickImage,
  onRemoveImage,
  onGenerateImage,
  onGenerateAudio,
  onPlayAudio,
  audioLoading,
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
            className="p-1 rounded hover:bg-gray-200"
            title={t("contentEditor.tooltips.copy")}
          >
            <Copy className="h-4 w-4 text-gray-600" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={!canDelete}
            className="p-1 rounded hover:bg-gray-200 disabled:hover:bg-transparent"
            title={t("contentEditor.tooltips.delete")}
          >
            <Trash2
              className={`h-4 w-4 ${canDelete ? "text-gray-600" : "text-gray-300"}`}
            />
          </button>
        </div>
      </div>

      <div className="flex gap-3">
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
                  title={t("scenarioDialogue.tooltips.generateAudio")}
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
              <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                <div className="flex items-center gap-1.5">
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
                    className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                    title={t("scenarioDialogue.tooltips.resetToGlobal")}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {t("scenarioDialogue.labels.overridden")}
                  </button>
                ) : (
                  <span className="text-xs text-gray-400">
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
                <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
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

const ScenarioDialoguePanel = forwardRef<
  ScenarioDialoguePanelHandle,
  ScenarioDialoguePanelProps
>(({ programLevel, initialData, isSaving = false, onSave, onCancel }, ref) => {
  const { t, i18n } = useTranslation();
  /** 答非所問的重問句與 AI 標題建議用老師的介面語言 */
  const uiLanguage = i18n?.language?.startsWith("en") ? "en" : "zh-TW";

  /**
   * `initialData` 一律只當**初值**（lazy initializer），不放進 useEffect 反覆套用：
   * 套用式的寫法只要呼叫端 re-render 就可能把老師打到一半的東西洗掉。要換一份內容
   * 請由呼叫端用 `key` 重新掛載面板（見 TeacherTemplatePrograms），語意清楚得多。
   */

  /**
   * 兩個畫面共用同一份 state，只是切換顯示 —— 回上一步不會弄丟已產生的題目。
   * 1 = 引導式對話（#1146）、2 = 題目清單。
   *
   * 編輯既有內容時直接落在題目清單 —— 老師點進來多半是要改題目，停在設定頁
   * 會讓他以為題目沒被讀進來。
   */
  const [step, setStep] = useState<1 | 2>(initialData?.rows?.length ? 2 : 1);

  const [title, setTitle] = useState(initialData?.title ?? "");
  // 一開啟就給一張空白卡，老師可以直接打字，不必先產題
  const [rows, setRows] = useState<ScenarioDialogueRow[]>(() =>
    initialData?.rows?.length ? initialData.rows : [createRow()],
  );
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  /** 逐題 TTS 同理（#1021） */
  const [audioLoadingId, setAudioLoadingId] = useState<string | null>(null);
  /** Issue #1051：正在設定語音的題目 id（設定視窗開啟中） */
  const [audioDialogRowId, setAudioDialogRowId] = useState<string | null>(null);
  /** 每題上次選的語音設定（含 Random）；沒設定過的題目沿用面板設定 */
  const [rowTTSSettings, setRowTTSSettings] = useState<
    Record<string, TTSSettingsState>
  >({});
  /** 逐題 AI 生圖是一題一題觸發的，要記住是哪一題在跑（#1024） */
  const [imageLoadingId, setImageLoadingId] = useState<string | null>(null);
  /** 目前正在播的題目語音；換一題要先停掉舊的，不然會疊音 */
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ===== 引導式對話（#1146）=====
  /**
   * 對話的已答步驟（流程見 setupFlow.ts）。編輯既有內容時由已存資料還原 —— 老師在
   * 題目清單按「上一步」回到對話時，看得到當初怎麼答、可以從任一步改選。
   */
  const [answers, setAnswers] = useState<SetupAnswers>(() =>
    initialData?.rows?.length
      ? answersFromSaved({
          scenarioMode: initialData.scenarioMode ?? "",
          questionSource: initialData.questionSource ?? "",
          hasScenario:
            !!(initialData.scenarioContent ?? "").trim() ||
            (initialData.scenarioImages ?? []).length > 0,
        })
      : EMPTY_ANSWERS,
  );
  /** 上一次選的「需要情境嗎？」：重開後選回同一個，就保留已填的情境 */
  const lastModeRef = useRef<ScenarioMode | null>(answers.scenarioMode);
  /** 訓練目標：AI 生成情境文章時的 prompt */
  const [goal, setGoal] = useState(initialData?.goal ?? "");
  /** 文章難度：只影響 AI 生成出來的情境文章寫多難 */
  const [articleLevel, setArticleLevel] = useState(
    initialData?.articleLevel || programLevel || "A1",
  );
  /** 無情境時「想問的方向」—— 取代情境當 AI 出題依據 */
  const [direction, setDirection] = useState(initialData?.direction ?? "");
  /** 答非所問時 AI 回的重問句（同一次呼叫判斷，不額外打 AI） */
  const [goalReask, setGoalReask] = useState("");
  const [directionReask, setDirectionReask] = useState("");
  /** 一次要 AI 產幾題（設定卡預設 5，範圍 3~10） */
  const [generateCount, setGenerateCount] = useState(DEFAULT_GENERATE_COUNT);
  /** 題目難度：出題出多難，與「文章難度」各自獨立 —— 簡單文章也可以出難題目 */
  const [questionLevel, setQuestionLevel] = useState(
    initialData?.questionLevel || programLevel || "A1",
  );
  const [isGenerating, setIsGenerating] = useState(false);
  /** 生成情境內容與產題是兩件事，loading 各自獨立 */
  const [isGeneratingScenario, setIsGeneratingScenario] = useState(false);
  /** 上傳圖片／PDF 擷取情境文章中 */
  const [isExtracting, setIsExtracting] = useState(false);
  /** 情境圖（最多 5 張，學生看得到）。已存的只有網址、沒有原圖可重裁 */
  const [scenarioImages, setScenarioImages] = useState<ScenarioImage[]>(() =>
    imagesFromUrls(initialData?.scenarioImages),
  );
  const imageActions = useScenarioImages(scenarioImages, setScenarioImages);
  /** 缺標題存檔時，留在題目清單並把游標帶到標題欄 */
  const titleRef = useRef<HTMLInputElement>(null);

  /**
   * 把 busy 狀態同步到 SidebarContext。
   *
   * RefSaveButton 的 disabled 讀的是 context 的 editorBusy，不是 panelRef 的
   * isBusy（#651：直接讀 ref 會拿到 stale 值）。不同步的話，生成期間儲存鍵
   * 看起來可以按，按下去卻被 handleClick 裡的 isBusy 無聲吞掉；面板右上的 X
   * 也是靠 editorBusy 擋，同樣會失效。與 ReadingAssessmentPanel、
   * VocabularySetPanel 用同一套寫法。
   */
  const { setEditorBusy } = useSidebar();
  useEffect(() => {
    // #1013: 存檔中也算 busy —— 否則老師在 API 還沒回來時能再按一次儲存，
    // 新增模式會因此建出兩份內容。
    setEditorBusy(
      isGenerating ||
        isGeneratingScenario ||
        isExtracting ||
        imageActions.busy ||
        isSaving,
    );
    return () => setEditorBusy(false);
  }, [
    isGenerating,
    isGeneratingScenario,
    isExtracting,
    imageActions.busy,
    isSaving,
    setEditorBusy,
  ]);

  // ===== 整份設定（所有題目共用）=====
  /**
   * 情境內容 —— 貼上、上傳擷取、AI 寫三種來源共同的產物（#1146 對話中的「情境框」）。
   * 空的時候仍然可以儲存；AI 出題時改用情境圖或出題方向當素材。
   */
  const [scenarioContent, setScenarioContent] = useState(
    initialData?.scenarioContent ?? "",
  );
  /** 全份共用的作答指引 — 同時給 AI 評分與學生作答參考 */
  const [globalRubric, setGlobalRubric] = useState(
    initialData?.globalRubric ?? "",
  );
  /** 整體評分標準，單題未覆寫時沿用 */
  const [globalTense, setGlobalTense] = useState<TenseSetting>(
    initialData?.globalTense ?? EMPTY_TENSE,
  );
  const [globalVoice, setGlobalVoice] = useState(
    initialData?.globalVoice ?? "",
  );

  // AI 自動翻譯 / AI 生成語音（共用元件）。與例句集一致：預設都不勾，語言也不預選
  // 編輯既有內容時，存過語言／語音設定就代表當初有勾，勾選狀態跟著回來。
  // 語言存的是單一值，「其他」的自訂名字要拆回旁邊那個欄位（見 lib 的說明）。
  const initialTranslate = fromStoredTranslateLanguage(
    initialData?.translateLanguage ?? "",
  );
  const [autoTranslate, setAutoTranslate] = useState(
    !!initialData?.translateLanguage,
  );
  const [translateLang, setTranslateLang] = useState(initialTranslate.selected);
  const [customLang, setCustomLang] = useState(initialTranslate.custom);
  const [autoTTS, setAutoTTS] = useState(!!initialData?.ttsSettings);
  const [ttsSettings, setTTSSettings] = useState<TTSSettingsState>(
    initialData?.ttsSettings ?? {
      accent: "Random",
      gender: "Random",
      speed: "Normal x1",
    },
  );

  /**
   * 手動上傳的預覽網址是 `blob:`，換掉或移除時必須 revoke，否則老師在編輯階段
   * 反覆換圖會一路累積不釋放。這裡記下所有我們建立的 URL，卸載時一次清乾淨。
   */
  const objectUrlsRef = useRef<Set<string>>(new Set());

  const createPreviewUrl = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.add(url);
    return url;
  }, []);

  const releasePreviewUrl = useCallback((url: string | null) => {
    if (url && objectUrlsRef.current.delete(url)) URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  /** 老師還沒選語言前，翻譯欄不該替他假設成中文（對齊例句集的行為） */
  const hasLanguage = !!translateLang;

  const langLabel = useMemo(() => {
    if (translateLang === "other")
      return customLang || t("contentEditor.labels.otherLanguage");
    return (
      TRANSLATION_LANGUAGES.find((l) => l.value === translateLang)?.label ||
      t("contentEditor.labels.selectLanguage")
    );
  }, [translateLang, customLang, t]);

  /** 只算真的有輸入題目的列 — 預設那張空白卡不計入 */
  const filledCount = rows.filter((r) => r.question.trim()).length;
  /**
   * 目前 addRow、複製、產題三條路都已經卡在 MAX_ITEMS，所以這個條件實際上不會
   * 成立。刻意留著當最後一道守衛：日後多一條新增題目的路徑（貼上、匯入、
   * 後端回填）忘了設上限時，至少擋在儲存前而不是靜靜地存進超量資料。
   */
  const overLimit = filledCount > MAX_ITEMS;
  const underLimit = filledCount < MIN_ITEMS;

  /** 已經有題目了：對話裡多一顆「查看題目清單」，設定卡的主按鈕改成「再產一批」 */
  const hasQuestions = filledCount > 0;

  // 素材沒填不在這裡擋 —— 按下去要看到「請先提供情境或出題方向」的提示，
  // 而不是一顆沒說明理由的灰色按鈕
  const generateDisabled =
    isGenerating || isGeneratingScenario || filledCount >= MAX_ITEMS;

  const sensors = useSensors(
    // 與 ReadingAssessmentPanel 一致：要移動 8px 才算拖曳，
    // 否則在把手上手抖一下就會把題目順序換掉
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRows((prev) => {
      const from = prev.findIndex((r) => r.id === active.id);
      const to = prev.findIndex((r) => r.id === over.id);
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
    });
  };

  /**
   * 更新一列。
   *
   * 題目本文一變，既有的題目語音就對不上了 —— 它是那句話的 TTS 產物，不是附屬素材。
   * 留著的話播放鍵還在（`SortableRow` 只看 `audioUrl` 有沒有值），老師按下去聽到的
   * 是舊句子，而且這個 `audio_url` 會跟著存進 content item 一路播給學生聽（#1023
   * review）。所以在這裡集中清掉，任何改到題目的路徑都涵蓋得到。
   *
   * **圖片刻意不清**：圖是老師自己上傳的（AI 生圖尚未開放，見 #1024），不是從題目
   * 文字機械產生的。為了改一個錯字就把他挑的圖刪掉，比偶爾對不上更糟。
   */
  const patchRow = (id: string, patch: Partial<ScenarioDialogueRow>) =>
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        if (
          patch.question !== undefined &&
          patch.question.trim() !== r.question.trim()
        ) {
          next.audioUrl = null;
        }
        return next;
      }),
    );

  const addRow = () =>
    setRows((prev) =>
      prev.length >= MAX_ITEMS ? prev : [...prev, createRow()],
    );

  /**
   * AI 標題建議（#1146）：只在標題是空的時候填 ——
   * 等於「用第一次的建議，之後不覆蓋老師改過的」。
   */
  const applySuggestedTitle = (suggested?: string) => {
    const value = (suggested || "").trim();
    if (value) setTitle((prev) => (prev.trim() ? prev : value));
  };

  /** 沒有情境（不需要情境）時才帶出題方向；有情境就以情境為準 */
  const currentDirection = () =>
    answers.scenarioMode === "none" ? direction.trim() : "";
  const hasMaterial = () =>
    !!scenarioContent.trim() ||
    scenarioImages.length > 0 ||
    !!currentDirection();

  /**
   * 產題請求裡與「這份情境對話」有關的共通部分（素材＋出題設定卡）。
   *
   * 翻譯開關（設定卡）關著時不送語言 —— 產出的題目也不填翻譯，開關才有意義。
   */
  const questionRequestBase = () => ({
    scenario_content: scenarioContent,
    direction: currentDirection(),
    scenario_images: scenarioImages.map((img) => img.url),
    ui_language: uiLanguage,
    question_level: questionLevel,
    // 送穩定代碼，不是畫面上的中文標籤
    global_tense: globalTense,
    global_voice: globalVoice,
    global_rubric: globalRubric,
    translate_language: autoTranslate
      ? toStoredTranslateLanguage(translateLang, customLang)
      : "",
  });

  /**
   * 設定卡的「AI 生成語音」開著時，新產生的題目逐題產生語音（同單題語音的作法）。
   * 老師等待期間改了題目文字就不填（那段語音已經對不上）。
   */
  const autoGenerateAudio = async (targets: ScenarioDialogueRow[]) => {
    let failed = 0;
    for (const row of targets) {
      const question = row.question.trim();
      if (!question) continue;
      setAudioLoadingId(row.id);
      try {
        const { voice, rate } = getVoiceAndRate(
          ttsSettings.accent,
          ttsSettings.gender,
          ttsSettings.speed,
        );
        const result = await apiClient.generateTTS(
          question,
          voice,
          rate,
          "+0%",
        );
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id && r.question.trim() === question
              ? { ...r, audioUrl: result.audio_url }
              : r,
          ),
        );
      } catch (error) {
        console.error("Failed to auto-generate question audio:", error);
        failed += 1;
      } finally {
        setAudioLoadingId(null);
      }
    }
    if (failed > 0) toast.error(t("scenarioDialogue.messages.audioFailed"));
  };

  /**
   * AI 產題（Issue #1021 起真的呼叫後端；#1146 起支援無情境＋出題方向、情境圖）。
   *
   * 出題設定卡的每一項都會送過去或生效：題目難度、題數、整體時態語態、作答指引、
   * 翻譯（開關＋語言）、語音（開關＋設定）。清單上已有的題目也一併送出，讓「再產一批」
   * 不會給重複的。
   *
   * 答非所問（出題方向不可用）：後端同一次呼叫就判斷出來、不產題 → 回到對話的「想問的
   * 方向」那一步，顯示重問句。
   *
   * `advance` 為 true 時產完直接翻到題目清單。
   */
  const handleGenerate = async (advance = false) => {
    if (!hasMaterial()) {
      toast.error(t("scenarioDialogue.setup.materialRequired"));
      return;
    }

    const kept = rows.filter((r) => !isBlankRow(r));
    const room = MAX_ITEMS - kept.length;
    if (room <= 0) {
      toast.error(t("scenarioDialogue.hints.maxReached", { max: MAX_ITEMS }));
      return;
    }

    setIsGenerating(true);
    try {
      const result = await apiClient.generateScenarioQuestions({
        ...questionRequestBase(),
        count: Math.min(generateCount, room),
        existing_questions: kept.map((r) => r.question.trim()).filter(Boolean),
      });

      if (result.usable === false) {
        setDirectionReask(
          result.reask || t("scenarioDialogue.setup.reaskFallback"),
        );
        setAnswers((prev) => reopenStep("direction", prev));
        setStep(1);
        return;
      }
      setDirectionReask("");
      applySuggestedTitle(result.suggested_title);

      const created = result.questions.map((q) =>
        createRow({
          question: q.question,
          translation: autoTranslate ? q.translation : "",
          keywords: q.keywords,
          referenceAnswer: q.reference_answer,
          imagePrompt: q.image_prompt,
        }),
      );

      // 一定要用 functional form 重新取一次最新的 rows：AI 呼叫要等好幾秒，這段期間
      // 老師還是可以改題目、刪題、加題、拖曳排序。用 await 之前算好的 kept 直接覆蓋，
      // 會把他等待期間做的事整個吃掉（PR #1023 review）。
      setRows((prev) => {
        const latestKept = prev.filter((r) => !isBlankRow(r));
        // 空間也要用最新的算 —— 等待期間可能又加了題目
        const latestRoom = Math.max(0, MAX_ITEMS - latestKept.length);
        const used = new Set(
          latestKept.map((r) => r.question.trim()).filter(Boolean),
        );
        // 後端已經避開送出去的既有題目，但老師等待期間新打的那些它不知道
        const fresh = created.filter((r) => !used.has(r.question.trim()));
        return [...latestKept, ...fresh.slice(0, latestRoom)];
      });
      if (advance) setStep(2);
      if (autoTTS) void autoGenerateAudio(created);
    } catch (error) {
      console.error("Failed to generate scenario questions:", error);
      toast.error(t(textAiErrorKey(error)));
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * 單題重新生成（Issue #1021 起改為真的呼叫後端）。
   *
   * 只要 1 題 —— #864 的「一份 3~10 題」是存檔時的規則，不是單次生成的規則，所以
   * 後端的產題端點下限是 1。清單上其他題目一併送出當作「不要重複這些」。
   */
  const regenerateRow = async (id: string) => {
    if (!hasMaterial()) {
      toast.error(t("scenarioDialogue.setup.materialRequired"));
      return;
    }
    setRegeneratingId(id);
    try {
      const result = await apiClient.generateScenarioQuestions({
        ...questionRequestBase(),
        count: 1,
        existing_questions: rows.map((r) => r.question.trim()).filter(Boolean),
      });
      if (result.usable === false) {
        // 在題目清單上不回對話（老師只想換一題）；把重問句直接告訴他
        toast.error(result.reask || t("scenarioDialogue.setup.reaskFallback"));
        return;
      }
      const fresh = result.questions[0];
      if (!fresh) {
        toast.error(t("scenarioDialogue.messages.generateFailed"));
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                question: fresh.question,
                translation: autoTranslate ? fresh.translation : "",
                keywords: fresh.keywords,
                referenceAnswer: fresh.reference_answer,
                imagePrompt: fresh.image_prompt,
                // 整題換掉，舊語音更不可能對得上（同 patchRow 的理由）
                audioUrl: null,
                // 換內容要讓 SortableRow 重新掛載，否則關鍵字草稿會停在舊值
                revision: r.revision + 1,
              }
            : r,
        ),
      );
    } catch (error) {
      console.error("Failed to regenerate scenario question:", error);
      toast.error(t(textAiErrorKey(error)));
    } finally {
      setRegeneratingId(null);
    }
  };

  /**
   * AI 寫情境（對話「請 AI 幫我寫」→ 訓練目標＋文章難度）。
   *
   * 答非所問（訓練目標不可用）時後端不產內容、回重問句，留在這一步顯示。
   */
  const handleGenerateArticle = async () => {
    if (!goal.trim()) {
      toast.error(t("scenarioDialogue.messages.goalRequired"));
      return;
    }
    setIsGeneratingScenario(true);
    setGoalReask("");
    try {
      const result = await apiClient.generateScenarioArticle({
        goal,
        level: articleLevel,
        ui_language: uiLanguage,
      });
      if (result.usable === false) {
        setGoalReask(result.reask || t("scenarioDialogue.setup.reaskFallback"));
        return;
      }
      setScenarioContent(result.content);
      applySuggestedTitle(result.suggested_title);
      setAnswers((prev) => ({ ...prev, goalDone: true }));
    } catch (error) {
      console.error("Failed to generate scenario content:", error);
      toast.error(t(textAiErrorKey(error)));
    } finally {
      setIsGeneratingScenario(false);
    }
  };

  /**
   * 上傳圖片／PDF 擷取（對話「我有現成的」）。一次一個檔，依序擷取：文字接到情境框
   * 後面（老師可能先貼了一段），檔內有意義的圖自動裁成情境圖（最多 5 張）。
   */
  const handleExtractFiles = async (files: File[]) => {
    setIsExtracting(true);
    try {
      const parts: string[] = [];
      let figureCount = 0;
      for (const file of files) {
        const { content, figures } =
          await apiClient.extractScenarioArticle(file);
        if (content.trim()) parts.push(content.trim());
        if (figures?.length) {
          figureCount += figures.length;
          await imageActions.addExtracted(file, figures);
        }
      }
      if (parts.length === 0 && figureCount === 0) {
        toast.error(t("scenarioDialogue.messages.generateFailed"));
        return;
      }
      if (parts.length) {
        const extracted = parts.join("\n\n");
        setScenarioContent((prev) =>
          prev.trim() ? `${prev.trim()}\n\n${extracted}` : extracted,
        );
      }
    } catch (error) {
      console.error("Failed to extract scenario content:", error);
      toast.error(t(textAiErrorKey(error)));
    } finally {
      setIsExtracting(false);
    }
  };

  /** 進題目清單：至少留一張空白卡可以打字 */
  const goToList = () => {
    setRows((prev) => (prev.length === 0 ? [createRow()] : prev));
    setStep(2);
  };

  // ---- 對話的回答（#1146）----

  const handleChooseMode = (mode: ScenarioMode) => {
    const sameMode = lastModeRef.current === mode;
    if (lastModeRef.current !== null && !sameMode) {
      // 換了情境來源：舊的情境文章、情境圖、訓練目標都不再適用
      setScenarioContent("");
      setScenarioImages([]);
      setGoal("");
      setGoalReask("");
    }
    lastModeRef.current = mode;
    setAnswers({
      ...EMPTY_ANSWERS,
      scenarioMode: mode,
      // 選回同一個「AI 寫」且情境還在 → 不必重寫，直接看情境框（要重寫可以改選訓練目標）
      goalDone: mode === "ai" && sameMode && !!scenarioContent.trim(),
    });
  };

  const handleReopen = (step: SetupStep) => {
    if (step === "goal") setGoalReask("");
    setAnswers((prev) => reopenStep(step, prev));
  };

  const handleChooseSource = (source: QuestionSource) => {
    setAnswers((prev) => ({
      ...prev,
      questionSource: source,
      directionDone: false,
    }));
    if (source === "manual") goToList();
  };

  /**
   * 換圖／移除時**不能無條件 revoke** —— 複製題目會把 imageUrl 一起帶走，
   * 同一個 blob 網址因此可能同時掛在多列上。若照舊釋放，另一列的 `<img>`
   * 會指到已作廢的 blob 而變成破圖。
   *
   * 這裡改成先確認沒有別人還在用才釋放。用掃描而非計數器，是因為列可以被
   * 複製、刪除、拖曳排序，計數器很容易跟真實狀態脫節；列數上限只有 10，
   * 掃一次的成本可以忽略。
   */
  const releaseIfUnused = (url: string | null, exceptRowId?: string) => {
    if (!url) return;
    const stillUsed = rows.some(
      (r) => r.id !== exceptRowId && r.imageUrl === url,
    );
    if (!stillUsed) releasePreviewUrl(url);
  };

  /** 逐題情境圖片：手動上傳／替換／移除 */
  const setRowImage = (id: string, next: string | null) => {
    const current = rows.find((r) => r.id === id)?.imageUrl ?? null;
    if (current !== next) releaseIfUnused(current, id);
    patchRow(id, { imageUrl: next });
  };

  const pickRowImage = (id: string, file: File) =>
    setRowImage(id, createPreviewUrl(file));
  const removeRowImage = (id: string) => setRowImage(id, null);

  /**
   * 刪除整列時也要把它的圖釋放掉 —— 先前只有換圖／移除圖走 releaseIfUnused，
   * 整列被刪的話那張 blob 就一路留到面板卸載才清。同樣要確認沒有別列共用
   * （複製過的題目會共享同一個網址）。
   */
  const deleteRow = (id: string) => {
    const current = rows.find((r) => r.id === id)?.imageUrl ?? null;
    releaseIfUnused(current, id);
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  /**
   * 逐題 AI 生圖。前端 stub：只跑 loading，串接後把回傳的圖片網址填進 imageUrl。
   * 圖片改成單題的事之後，整份不再有「一次生成全部」的勾選。
   */
  /**
   * 逐題 AI 生圖（Issue #1024 起改為真的呼叫 Imagen）。
   *
   * 生圖描述用的是產題時 AI 一併回傳、存在該列的 `imagePrompt`；老師沒產過題、
   * 自己打的題目沒有這個值，就退回題目本文當描述 —— 總比按下去什麼都不做好。
   *
   * 三種失敗要分開講，因為老師的下一步完全不同：
   * - 402 額度用完 → 改用手動上傳
   * - 422 被安全過濾擋下 → 換個描述（Imagen 對兒童影像有嚴格限制，後端已經先把
   *   兒童相關描述改寫成場景，仍可能被擋）
   * - 其他 → 稍後再試
   */
  const generateRowImage = async (id: string) => {
    // #1044: 旗標關閉時這裡也擋一次。目前唯一的呼叫端是圖片欄位的按鈕，而那顆按鈕
    // 已經是停用狀態，所以這一行現在不會被走到 —— 但「只靠 UI 藏起來」是會漏的：
    // 哪天多一個入口（批次生圖之類）忘了查旗標，就會真的打 Imagen。
    // 白名單的教訓同 #1030：預設要安全，開放是明確的動作（review R3 第 1 點）。
    if (!FEATURE_FLAGS.SCENARIO_IMAGE_GENERATION) return;

    const row = rows.find((r) => r.id === id);
    if (!row) return;

    const prompt = (row.imagePrompt || row.question).trim();
    if (!prompt) {
      toast.error(t("scenarioDialogue.messages.imagePromptRequired"));
      return;
    }

    setImageLoadingId(id);
    try {
      const { image_url } = await apiClient.generateScenarioImage(prompt);
      // 換掉舊圖前先釋放 blob（手動上傳的預覽是 blob:），否則會一路累積不釋放
      releaseIfUnused(row.imageUrl, id);
      patchRow(id, { imageUrl: image_url });
    } catch (error) {
      console.error("Failed to generate question image:", error);
      // 同 textAiErrorKey：改用 status，不比對 message 字串。
      // 這段是 #1024 就有的同一個錯法（ApiError.message 是後端那句中文，不含狀態碼），
      // 順手一起修 —— 留著等於知道壞了還放過。
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 402) {
        toast.error(t("scenarioDialogue.messages.imageQuotaExceeded"));
      } else if (status === 422) {
        toast.error(t("scenarioDialogue.messages.imageBlocked"));
      } else {
        toast.error(t("scenarioDialogue.messages.imageFailed"));
      }
    } finally {
      setImageLoadingId(null);
    }
  };

  /**
   * 逐題題目語音（Issue #1021 起改為真的呼叫 TTS）。
   *
   * Issue #1051 起先開設定視窗，用老師這次選定的口音／性別／語速算出 voice 與 rate，
   * 與單字集、例句集走同一支 `getVoiceAndRate`，避免同一份設定在不同面板產出不同聲音。
   * 選定值記在 rowTTSSettings，下次打開同一題就帶上次的設定。
   */
  const generateRowAudio = async (id: string, settings: TTSSettingsState) => {
    const row = rows.find((r) => r.id === id);
    if (!row || !row.question.trim()) return;

    setRowTTSSettings((prev) => ({ ...prev, [id]: settings }));
    setAudioLoadingId(id);
    try {
      const { voice, rate } = getVoiceAndRate(
        settings.accent,
        settings.gender,
        settings.speed,
      );
      const result = await apiClient.generateTTS(
        row.question.trim(),
        voice,
        rate,
        "+0%",
      );
      setRows((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, audioUrl: result.audio_url } : r,
        ),
      );
    } catch (error) {
      console.error("Failed to generate question audio:", error);
      toast.error(t("scenarioDialogue.messages.audioFailed"));
    } finally {
      setAudioLoadingId(null);
    }
  };

  /** 播放已產生的題目語音。同時只留一個在播，避免老師連點兩題變成疊音 */
  const playRowAudio = (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row?.audioUrl) return;
    audioRef.current?.pause();
    const audio = new Audio(row.audioUrl);
    audioRef.current = audio;
    void audio.play().catch((error) => {
      console.error("Failed to play question audio:", error);
      toast.error(t("scenarioDialogue.messages.audioFailed"));
    });
  };

  /**
   * 兩個畫面都能按儲存，但擋關的條件一樣 —— 缺什麼就把老師帶到那裡，
   * 只跳 toast 卻停在別的畫面等於叫他自己去找問題在哪。
   *
   * 缺標題（#1146）：留在題目清單、游標帶到標題欄 —— 標題已經搬到清單頁，不再跳回設定。
   */
  const handleSave = async () => {
    if (!title.trim()) {
      setStep(2);
      toast.error(t("contentEditor.messages.enterTitle"));
      // 等清單頁畫出來再聚焦（從對話按儲存時，標題欄這一刻還不存在）
      window.setTimeout(() => titleRef.current?.focus(), 0);
      return;
    }
    if (underLimit) {
      setStep(2);
      toast.error(
        t("contentEditor.messages.addAtLeastNItems", { limit: MIN_ITEMS }),
      );
      return;
    }
    if (overLimit) {
      setStep(2);
      toast.error(t("scenarioDialogue.hints.maxReached", { max: MAX_ITEMS }));
      return;
    }
    const mode = answers.scenarioMode;
    await onSave?.({
      title,
      rows,
      scenarioContent,
      scenarioImages: scenarioImages.map((img) => img.url),
      questionLevel,
      globalRubric,
      globalTense,
      globalVoice,
      // 選「其他」時送老師打的語言名字，不是字面的 "other"（會整個丟掉）
      translateLanguage: toStoredTranslateLanguage(translateLang, customLang),
      ttsSettings,
      // 對話紀錄：只存與當初選擇相符的那幾項，換了選項留下的舊值不帶走
      scenarioMode: mode ?? "",
      questionSource: answers.questionSource ?? "",
      goal: mode === "ai" ? goal : "",
      articleLevel:
        mode === "ai" &&
        (CEFR_LEVELS as readonly string[]).includes(articleLevel)
          ? articleLevel
          : "",
      direction: mode === "none" ? direction : "",
    });
  };

  useImperativeHandle(ref, () => ({
    // 兩種生成都要算 busy —— 只看 isGenerating 的話，老師在情境內容還在
    // 生成時就能按儲存，存進去的是那一刻的舊值。真 API 更慢，更容易中招。
    // 存檔中同樣要擋，避免重複送出（#1013）。
    isBusy:
      isGenerating ||
      isGeneratingScenario ||
      isExtracting ||
      imageActions.busy ||
      isSaving,
    save: handleSave,
  }));

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ===== 引導式對話（#1146，取代舊的 Step 1 設定頁）===== */}
      {step === 1 && (
        <ScenarioSetupChat
          answers={answers}
          onReopen={handleReopen}
          onChooseMode={handleChooseMode}
          onChooseSource={handleChooseSource}
          onScenarioDone={() =>
            setAnswers((prev) => ({ ...prev, scenarioDone: true }))
          }
          onDirectionDone={() => {
            setDirectionReask("");
            setAnswers((prev) => ({ ...prev, directionDone: true }));
          }}
          scenarioContent={scenarioContent}
          onScenarioContentChange={setScenarioContent}
          goal={goal}
          onGoalChange={setGoal}
          articleLevel={articleLevel}
          onArticleLevelChange={setArticleLevel}
          direction={direction}
          onDirectionChange={setDirection}
          goalReask={goalReask}
          directionReask={directionReask}
          imageActions={imageActions}
          generatingArticle={isGeneratingScenario}
          extracting={isExtracting}
          onGenerateArticle={handleGenerateArticle}
          onExtractFiles={(files) => void handleExtractFiles(files)}
          hasQuestions={hasQuestions}
          onViewList={goToList}
          settingsCard={
            <QuestionSettingsCard
              questionLevel={questionLevel}
              onQuestionLevelChange={setQuestionLevel}
              count={generateCount}
              onCountChange={setGenerateCount}
              globalTense={globalTense}
              onGlobalTenseChange={setGlobalTense}
              globalVoice={globalVoice}
              onGlobalVoiceChange={setGlobalVoice}
              autoTranslate={autoTranslate}
              onAutoTranslateChange={setAutoTranslate}
              translateLang={translateLang}
              onTranslateLangChange={setTranslateLang}
              customLang={customLang}
              onCustomLangChange={setCustomLang}
              autoTTS={autoTTS}
              onAutoTTSChange={setAutoTTS}
              ttsSettings={ttsSettings}
              onTTSSettingsChange={setTTSSettings}
              globalRubric={globalRubric}
              onGlobalRubricChange={setGlobalRubric}
              generating={isGenerating}
              fullReason={
                filledCount >= MAX_ITEMS
                  ? t("scenarioDialogue.hints.maxReached", { max: MAX_ITEMS })
                  : null
              }
              hasQuestions={hasQuestions}
              onGenerate={() => void handleGenerate(true)}
              onViewList={goToList}
            />
          }
        />
      )}

      {/* ===== Step 2：題目清單 ===== */}
      {step === 2 && (
        <div className="flex-1 min-w-0 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
          {/* 左欄：Step 1 設定的唯讀對照，讓老師邊看情境與作答指引邊確認題目 */}
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
              onClick={() => setStep(1)}
            >
              <PencilLine className="mr-1 h-3.5 w-3.5" />
              {t("scenarioDialogue.buttons.editSettings")}
            </Button>
          </aside>

          {/* 右欄：標題＋題目清單 */}
          <div className="min-w-0">
            {/*
              標題（#1146 從設定頁搬來）：AI 寫情境或出題時已先填好建議，老師在這裡改。
              缺標題存檔時游標會被帶到這裡。
            */}
            <div className="mb-3 space-y-1.5">
              <label
                className="text-xs font-semibold text-gray-700 block"
                htmlFor="sd-title"
              >
                {t("scenarioDialogue.labels.title")}
                <span className="text-red-500 ml-0.5">*</span>
              </label>
              <input
                id="sd-title"
                ref={titleRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("scenarioDialogue.placeholders.title")}
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => handleGenerate(false)}
                disabled={generateDisabled}
                className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {isGenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {t("scenarioDialogue.buttons.generateAnother")}
              </button>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={rows.map((r) => r.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3 pr-1">
                  {rows.map((row, index) => (
                    <SortableRow
                      key={`${row.id}:${row.revision}`}
                      row={row}
                      index={index}
                      langLabel={langLabel}
                      hasLanguage={hasLanguage}
                      globalTense={globalTense}
                      globalVoice={globalVoice}
                      canDelete={rows.length > 1}
                      regenerating={regeneratingId === row.id}
                      imageLoading={imageLoadingId === row.id}
                      onChange={(patch) => patchRow(row.id, patch)}
                      onDuplicate={() =>
                        setRows((prev) =>
                          prev.length >= MAX_ITEMS
                            ? prev
                            : [
                                ...prev.slice(0, index + 1),
                                createRow({ ...row, id: nextRowId() }),
                                ...prev.slice(index + 1),
                              ],
                        )
                      }
                      onDelete={() => deleteRow(row.id)}
                      onRegenerate={() => regenerateRow(row.id)}
                      onPickImage={(file) => pickRowImage(row.id, file)}
                      onRemoveImage={() => removeRowImage(row.id)}
                      onGenerateImage={() => generateRowImage(row.id)}
                      onGenerateAudio={() => setAudioDialogRowId(row.id)}
                      onPlayAudio={() => playRowAudio(row.id)}
                      audioLoading={audioLoadingId === row.id}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <button
              type="button"
              onClick={addRow}
              disabled={rows.length >= MAX_ITEMS}
              className="mt-3 w-full py-2 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 flex items-center justify-center gap-2 text-gray-600 hover:text-blue-600 disabled:opacity-50 disabled:hover:border-gray-300 disabled:hover:text-gray-600"
            >
              <Plus className="h-5 w-5" />
              {rows.length >= MAX_ITEMS
                ? t("scenarioDialogue.hints.maxReached", { max: MAX_ITEMS })
                : t("scenarioDialogue.buttons.addQuestion")}
            </button>

            {/* 題目計數：對著題目看才有意義，所以跟著清單走而不是留在設定頁 */}
            <div
              className={`mt-3 text-xs tabular-nums ${
                overLimit || underLimit
                  ? "text-red-500 font-medium"
                  : "text-gray-500"
              }`}
            >
              {filledCount} {t("contentEditor.messages.items")}
              {` / ${MAX_ITEMS}`}
              {` (${t("scenarioDialogue.hints.itemRange", {
                min: MIN_ITEMS,
                max: MAX_ITEMS,
              })})`}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200 flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("scenarioDialogue.buttons.backToSettings")}
              </Button>
              {onCancel && (
                <Button
                  variant="outline"
                  className="md:hidden"
                  onClick={onCancel}
                >
                  {t("contentEditor.buttons.cancel")}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 單題語音設定（Issue #1051） */}
      <TTSSettingsDialog
        open={audioDialogRowId !== null}
        onOpenChange={(open) => {
          if (!open) setAudioDialogRowId(null);
        }}
        initialSettings={
          (audioDialogRowId !== null && rowTTSSettings[audioDialogRowId]) ||
          ttsSettings
        }
        onConfirm={(settings) => {
          const id = audioDialogRowId;
          setAudioDialogRowId(null);
          if (id !== null) void generateRowAudio(id, settings);
        }}
      />
    </div>
  );
});

ScenarioDialoguePanel.displayName = "ScenarioDialoguePanel";

export default ScenarioDialoguePanel;
