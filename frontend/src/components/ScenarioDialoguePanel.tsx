/**
 * ScenarioDialoguePanel — 情境對話（口說練習）新增/編輯面板
 *
 * Issue #944 / #864。面板分成兩個步驟，**不跳頁**，只在同一塊區域切換顯示：
 *
 * - **Step 1 設定** — 左右兩張卡，用底色區分「會不會被儲存」：
 *   - 左（`bg-gray-50`）**產題方式**：兩個 tab —「AI 輔助編輯」（訓練目標／
 *     難度／教材描述／產題數）與「上傳圖片 / PDF」；再加 AI 自動翻譯與
 *     AI 生成語音（沿用 BatchTranslateSettings、BatchTTSSettings，兩者
 *     **預設都不勾**、語言也不預選，避免替老師做他沒做過的決定）。
 *     這一整張卡不會被儲存，只影響 AI 怎麼出題。
 *   - 右（`bg-blue-50`）**整份設定**：標題、情境說明（文字＋選填圖片＋語音）、
 *     作答指引、整體評分標準（時間×動貌×語態）。全部會被儲存、所有題目共用。
 *   - 出口兩顆：「產生題目並繼續」（產完直接翻到 Step 2）與
 *     「跳過，我想自己出題」（帶一張空白卡翻頁）。
 *
 * - **Step 2 題目清單** — 佔滿整個寬度：頂部摘要列（標題／整體設定摘要／
 *   回設定修改／再產題）、可拖曳排序的題目卡、題目計數、上一步。
 *   題目卡因為變寬改為橫向：左邊題目／翻譯／圖片 prompt／參考答案，
 *   右邊 260px 獨立放評分準則，不必再往下捲。
 *
 * 兩步共用同一份 state，只是切換顯示 —— 回 Step 1 改設定不會弄丟已產生的題目。
 * 步驟列本身即導覽，兩步隨時可來回。
 *
 * 評分標準採「預設 + 覆寫」：`row.tenseOverride/voiceOverride` 為 `null` 代表沿用
 * 整體，會跟著整體變動；老師動過單題就脫鉤（可用 ↺ 復原）。這讓「整份成套出題」
 * 與「各題獨立出題」兩種用法共用同一份 UI —— 差別只在有沒有去動整體那三個下拉。
 *
 * 儲存在兩步都能按，但擋關條件一致（標題必填、題數 MIN_ITEMS ~ MAX_ITEMS）；
 * 缺什麼就把老師帶回那一步，只跳 toast 卻停在別的畫面等於叫他自己找問題。
 *
 * 現階段為**前端設計實作**：不呼叫後端，AI 產題／PDF 辨識／圖片生成／TTS 皆為本地 stub，
 * save() 只回傳目前的資料並由呼叫端關閉面板。串接 API 為後續 issue。
 */
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  GripVertical,
  Image as ImageIcon,
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
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BatchTranslateSettings,
  type TranslationLanguageOption,
} from "@/components/shared/BatchTranslateSettings";
import {
  BatchTTSSettings,
  type TTSSettingsState,
} from "@/components/shared/BatchTTSSettings";
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

/** 情境對話一次最少 3 題、最多 10 題（#864） */
export const MIN_ITEMS = 3;
export const MAX_ITEMS = 10;

const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/**
 * 時態＝時間 × 動貌，共 12 種；被動是「語態」，與時態正交，因此獨立成第三個下拉
 * （若併入時態清單會膨脹成 24 項）。時間與動貌兩者都選才組成 chip，避免半套條件。
 */
const TENSE_TIMES = ["現在", "過去", "未來"] as const;
const TENSE_ASPECTS = ["簡單式", "進行式", "完成式", "完成進行式"] as const;
const VOICES = ["主動", "被動"] as const;

/** 時態＝時間＋動貌，兩者都選才成立（避免「過去」但沒說哪一種的半套條件） */
export interface TenseSetting {
  time: string;
  aspect: string;
}

const EMPTY_TENSE: TenseSetting = { time: "", aspect: "" };
const isTenseSet = (t: TenseSetting) => !!t.time && !!t.aspect;
const tenseLabel = (t: TenseSetting) =>
  isTenseSet(t) ? t.time + t.aspect : "";

/** 與 ReadingAssessmentPanel 相同的輔助語言清單 */
const TRANSLATION_LANGUAGES: TranslationLanguageOption[] = [
  { value: "chinese", label: "中文", code: "zh-TW" },
  { value: "japanese", label: "日本語", code: "ja" },
  { value: "korean", label: "한국어", code: "ko" },
  { value: "other", label: "Other", code: "" },
];

export interface ScenarioDialogueRow {
  id: string;
  /** 口說題目本文（老師可自行編輯） */
  question: string;
  /** 輔助語言翻譯，語言由左側統一設定 */
  translation: string;
  /**
   * 時態覆寫。`null` = 沿用「整份設定」的整體評分標準，會跟著整體變動；
   * 一旦老師動過就固定成本題自訂，之後改整體不再影響它（可用 ↺ 復原成沿用）。
   */
  tenseOverride: TenseSetting | null;
  /** 語態覆寫。語意同 tenseOverride */
  voiceOverride: string | null;
  /** 必用字詞 —— 逐題獨立，不繼承（每題要練的單字本來就不同） */
  keywords: string[];
  /**
   * 參考答案 —— 只給 AI 當評分對照，**學生端完全看不到**。
   *
   * 定位是「示範回答」而非唯一正解：口說同一題每個學生的內容本來就不同，
   * 送 AI 時比對的是**結構與語言特徵**（時態、句型、用字水準、資訊完整度），
   * 絕不可拿來做逐字比對，否則所有與範例不同的答案都會被誤判。
   * 依 #864 規格 3-3，學生答案需修正時，它也是「建議的答案」的依據。
   */
  referenceAnswer: string;
  /** 本題額外說明（選填）。與全份共用的作答指引一起給 AI 與學生看 */
  rubricNote: string;
  /** 情境圖片的生成 prompt（老師可改） */
  imagePrompt: string;
  /** 已生成的情境圖片；null = 尚未生成 */
  imageUrl: string | null;
  /** 題目語音；null = 尚未生成 */
  audioUrl: string | null;
}

export interface ScenarioDialoguePanelHandle {
  save: () => Promise<void>;
  isBusy: boolean;
}

export interface ScenarioDialoguePanelProps {
  /** 教材難度預設值（沿用課程 level） */
  programLevel?: string;
  onSave?: (data: {
    title: string;
    rows: ScenarioDialogueRow[];
    /** 情境背景文字；空字串代表這份不使用情境說明 */
    contextText: string;
    contextImageUrl: string | null;
    /** 全份共用的作答指引，AI 與學生都看得到 */
    globalRubric: string;
    /** 整體評分標準；單題 tenseOverride/voiceOverride 為 null 時沿用 */
    globalTense: TenseSetting;
    globalVoice: string;
    translateLanguage: string;
    ttsSettings: TTSSettingsState;
  }) => void | Promise<void>;
  onCancel?: () => void;
}

let rowSeq = 0;
const nextRowId = () => `sd-${Date.now()}-${rowSeq++}`;

const createRow = (
  overrides: Partial<ScenarioDialogueRow> = {},
): ScenarioDialogueRow => ({
  id: nextRowId(),
  question: "",
  translation: "",
  tenseOverride: null,
  voiceOverride: null,
  keywords: [],
  referenceAnswer: "",
  rubricNote: "",
  imagePrompt: "",
  imageUrl: null,
  audioUrl: null,
  ...overrides,
});

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

/** 前端 stub：實際串接後改為呼叫 AI 產題 API */
const SAMPLE_QUESTIONS: Array<
  Pick<
    ScenarioDialogueRow,
    "question" | "translation" | "keywords" | "referenceAnswer" | "imagePrompt"
  >
> = [
  {
    question: "What did you do last weekend?",
    translation: "你上週末做了什麼？",
    keywords: ["went", "visited"],
    referenceAnswer:
      "I went to the park with my family last Saturday. We played basketball and visited my grandma in the afternoon.",
    imagePrompt: "a family walking in a park on a sunny weekend",
  },
  {
    question: "Who did you go with, and why?",
    translation: "你和誰一起去？為什麼？",
    keywords: ["with", "because"],
    referenceAnswer:
      "I went with my little brother because he loves playing outside and my parents were busy that day.",
    imagePrompt: "two children walking together outdoors",
  },
  {
    question: "How did you get there?",
    translation: "你們怎麼過去的？",
    keywords: ["by bus", "on foot"],
    referenceAnswer:
      "We took the bus to the park and then walked there on foot. It took about twenty minutes.",
    imagePrompt: "a yellow school bus on a street",
  },
  {
    question: "What was the most fun part?",
    translation: "最好玩的部分是什麼？",
    keywords: [],
    referenceAnswer:
      "The most fun part was the basketball game. It was exciting and everyone was really happy.",
    imagePrompt: "kids laughing and playing at a playground",
  },
  {
    question: "Would you go there again? Why?",
    translation: "你還會再去嗎？為什麼？",
    keywords: ["would", "because"],
    referenceAnswer:
      "Yes, I would go there again because the park is quiet and I can play with my friends there.",
    imagePrompt: "",
  },
];

/** 時間／動貌／語態三個下拉 —— 整份設定與單題共用同一組 UI */
function TenseSelects({
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
    "px-1.5 py-1 border border-gray-300 rounded text-[11px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
  const notSpecified = t("scenarioDialogue.labels.notSpecified");

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-gray-500">
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
              {o}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-gray-500">
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
              {o}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-gray-500">
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
              {o}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** 生效中的條件標籤；`onRemove` 未給則不顯示移除鍵（繼承來的條件要去整體改） */
function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-100 px-2.5 py-0.5 text-[11px] font-semibold text-blue-800">
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="opacity-60 hover:opacity-100"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
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
  onDelete: () => void;
  onRegenerate: () => void;
  onGenerateImage: () => void;
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
  onGenerateImage,
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
        {/* 情境圖片：純預覽，不可點。生成的動作統一在 prompt 列右側 */}
        <div className="w-[104px] h-[74px] shrink-0 rounded-md border border-gray-200 bg-gray-100 overflow-hidden">
          {imageLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
            </div>
          ) : row.imageUrl ? (
            <img
              src={row.imageUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-1">
              <ImageIcon className="h-4 w-4 text-gray-400" />
              <span className="text-[10px] text-gray-400">
                {t("scenarioDialogue.labels.noImage")}
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px] gap-3 items-start">
          {/* 左欄：題目本文相關（題目／翻譯／圖片 prompt／參考答案） */}
          <div className="min-w-0 space-y-2">
            {/* 題目：AI 產生但可編輯 */}
            <div className="relative">
              <textarea
                value={row.question}
                onChange={(e) => onChange({ question: e.target.value })}
                placeholder={t("scenarioDialogue.placeholders.question")}
                ref={autoHeightRef}
                rows={1}
                className="w-full px-3 py-2 pr-20 border border-gray-300 rounded-md text-sm resize-y min-h-[38px] overflow-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <div className="absolute right-2 top-2 flex items-center space-x-1">
                {row.audioUrl && (
                  <button
                    type="button"
                    className="p-1 rounded text-green-600 hover:bg-green-100"
                    title={t("contentEditor.tooltips.play")}
                  >
                    <Play className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  className={`p-1 rounded ${
                    row.audioUrl
                      ? "text-blue-600 hover:bg-blue-100"
                      : "text-gray-600 bg-yellow-100 hover:bg-yellow-200"
                  }`}
                  title={t("scenarioDialogue.tooltips.generateAudio")}
                >
                  <Mic className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* 翻譯：placeholder 即為左側選定的輔助語言 */}
            <div className="relative">
              <textarea
                value={row.translation}
                onChange={(e) => onChange({ translation: e.target.value })}
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

            {/* 圖片 prompt + 唯一的生成按鈕（緊鄰左側預覽） */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={row.imagePrompt}
                onChange={(e) => onChange({ imagePrompt: e.target.value })}
                placeholder={t("scenarioDialogue.placeholders.imagePrompt")}
                className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded text-[11px] text-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={onGenerateImage}
                disabled={imageLoading}
                className={`shrink-0 h-[30px] px-3 rounded text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-50 ${
                  row.imageUrl
                    ? "border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {imageLoading ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t("scenarioDialogue.buttons.generatingImage")}
                  </>
                ) : (
                  <>
                    {row.imageUrl ? (
                      <RotateCw className="h-3 w-3" />
                    ) : (
                      <ImagePlus className="h-3 w-3" />
                    )}
                    {row.imageUrl
                      ? t("scenarioDialogue.buttons.regenerateImage")
                      : t("scenarioDialogue.buttons.generateImage")}
                  </>
                )}
              </button>
            </div>

            {/* 參考答案與補充說明：有內容時預設展開，避免看不見卻生效的設定 */}
            <div className="bg-white rounded-md border border-gray-200 px-2.5 py-2">
              <button
                type="button"
                onClick={() => setNoteOpen((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600 hover:text-blue-600"
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
                    <span className="text-[10px] font-semibold text-gray-500">
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
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-[11px] resize-y focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                    <p className="text-[10px] text-gray-400">
                      {t("scenarioDialogue.hints.referenceAnswer")}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-semibold text-gray-500">
                      {t("scenarioDialogue.labels.rubricNote")}
                    </span>
                    <textarea
                      value={row.rubricNote}
                      onChange={(e) => onChange({ rubricNote: e.target.value })}
                      rows={2}
                      placeholder={t(
                        "scenarioDialogue.placeholders.rubricNote",
                      )}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-[11px] resize-y focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 右欄：評分準則。清單頁佔滿寬度後獨立成一欄，不必再往下捲 */}
          <div className="min-w-0 bg-white rounded-md border border-gray-200 divide-y divide-gray-100">
            <div className="flex items-center justify-between gap-2 px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-gray-500" />
                <span className="text-[11px] font-semibold text-gray-600">
                  {t("scenarioDialogue.labels.rubric")}
                </span>
              </div>
              {/* 沿用/自訂狀態必須看得見，否則改了整體卻沒變的題目會像壞掉 */}
              {isOverridden ? (
                <button
                  type="button"
                  onClick={resetToGlobal}
                  className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:underline"
                  title={t("scenarioDialogue.tooltips.resetToGlobal")}
                >
                  <RotateCcw className="h-3 w-3" />
                  {t("scenarioDialogue.labels.overridden")}
                </button>
              ) : (
                <span className="text-[10px] text-gray-400">
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
                <span className="text-[10px] text-gray-500">
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
                  className="w-full px-1.5 py-1 border border-gray-300 rounded text-[11px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </label>
            </div>

            {/* 生效中的條件 */}
            {(isTenseSet(effTense) || effVoice || row.keywords.length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
                {isTenseSet(effTense) && (
                  <Chip label={`時態：${tenseLabel(effTense)}`} />
                )}
                {effVoice && <Chip label={`語態：${effVoice}`} />}
                {row.keywords.length > 0 && (
                  <Chip
                    label={`必用：${row.keywords.join(", ")}`}
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
  );
}

/** 步驟列上的一顆步驟。點下去就切換，兩步都隨時可回頭 */
function StepButton({
  index,
  label,
  sub,
  active,
  done,
  onClick,
}: {
  index: number;
  label: string;
  sub: string;
  active: boolean;
  done: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "step" : undefined}
      className={`flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors ${
        active
          ? "text-blue-600"
          : done
            ? "text-green-600 hover:text-green-700"
            : "text-gray-400 hover:text-gray-600"
      }`}
    >
      <span
        className={`h-6 w-6 shrink-0 grid place-items-center rounded-full border-[1.5px] border-current text-xs font-bold tabular-nums ${
          active ? "bg-blue-600 border-blue-600 text-white" : ""
        }`}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : index}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold whitespace-nowrap">
          {label}
        </span>
        <span className="block text-[11px] text-gray-400 whitespace-nowrap">
          {sub}
        </span>
      </span>
    </button>
  );
}

const ScenarioDialoguePanel = forwardRef<
  ScenarioDialoguePanelHandle,
  ScenarioDialoguePanelProps
>(({ programLevel, onSave, onCancel }, ref) => {
  const { t } = useTranslation();

  /**
   * 兩個步驟共用同一份 state，只是切換顯示 —— 回上一步不會弄丟已產生的題目。
   * 1 = 設定（產題方式 + 整份設定）、2 = 題目清單。
   */
  const [step, setStep] = useState<1 | 2>(1);

  const [title, setTitle] = useState("");
  // 一開啟就給一張空白卡，老師可以直接打字，不必先產題
  const [rows, setRows] = useState<ScenarioDialogueRow[]>(() => [createRow()]);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [imageLoadingId, setImageLoadingId] = useState<string | null>(null);

  // 左側 AI 輔助編輯
  const [goal, setGoal] = useState("");
  const [level, setLevel] = useState(programLevel || "A1");
  const [materialDesc, setMaterialDesc] = useState("");
  /** 一次要 AI 產幾題。上限跟著 MAX_ITEMS 走 */
  const [generateCount, setGenerateCount] = useState(5);
  /** 產題來源。受控是因為 Step 1 的產題按鈕收在footer，需要知道現在是哪一種來源 */
  const [sourceTab, setSourceTab] = useState<"ai" | "upload">("ai");
  const [isGenerating, setIsGenerating] = useState(false);

  // ===== 整份設定（Step 1 右半，所有題目共用）=====
  /** 情境背景：幾句話設定場景，不是閱讀文章。空的話學生端不會出現說明卡 */
  const [contextText, setContextText] = useState("");
  const [contextImagePrompt, setContextImagePrompt] = useState("");
  const [contextImageUrl, setContextImageUrl] = useState<string | null>(null);
  const [contextImageLoading, setContextImageLoading] = useState(false);
  /** 全份共用的作答指引 — 同時給 AI 評分與學生作答參考 */
  const [globalRubric, setGlobalRubric] = useState("");
  /** 整體評分標準，單題未覆寫時沿用 */
  const [globalTense, setGlobalTense] = useState<TenseSetting>(EMPTY_TENSE);
  const [globalVoice, setGlobalVoice] = useState("");

  // 左側 上傳圖片 / PDF
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI 自動翻譯 / AI 生成語音（共用元件）。與例句集一致：預設都不勾，語言也不預選
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [translateLang, setTranslateLang] = useState("");
  const [customLang, setCustomLang] = useState("");
  const [autoTTS, setAutoTTS] = useState(false);
  const [ttsSettings, setTTSSettings] = useState<TTSSettingsState>({
    accent: "Random",
    gender: "Random",
    speed: "Normal x1",
  });

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
  const overLimit = filledCount > MAX_ITEMS;
  const underLimit = filledCount < MIN_ITEMS;

  const sensors = useSensors(
    useSensor(PointerSensor),
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

  const patchRow = (id: string, patch: Partial<ScenarioDialogueRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addRow = () =>
    setRows((prev) =>
      prev.length >= MAX_ITEMS ? prev : [...prev, createRow()],
    );

  /**
   * 前端 stub：帶入示範題目，後續改為呼叫 AI 產題 API。
   *
   * `advance` 為 true 時產完直接翻到題目清單 —— 這是 Step 1 主要出口，
   * 老師按下去就該看到題目，不必再自己找下一步在哪。
   */
  const handleGenerate = (advance = false) => {
    setIsGenerating(true);
    setTimeout(() => {
      setRows((prev) => {
        // 尚未動過的空白卡直接被產出的題目取代，避免最前面卡著一張空的
        const kept = prev.filter((r) => !isBlankRow(r));
        const room = MAX_ITEMS - kept.length;
        return [
          ...kept,
          ...SAMPLE_QUESTIONS.slice(
            0,
            Math.max(0, Math.min(generateCount, room)),
          ).map((q) => createRow(q)),
        ];
      });
      setIsGenerating(false);
      if (advance) setStep(2);
    }, 600);
  };

  /** 跳過 AI 自己出題：至少留一張空白卡可以打字 */
  const handleSkipToList = () => {
    setRows((prev) => (prev.length === 0 ? [createRow()] : prev));
    setStep(2);
  };

  /** 前端 stub：實際串接後呼叫圖片生成 API 並扣點 */
  const handleGenerateImage = (id: string) => {
    setImageLoadingId(id);
    setTimeout(() => setImageLoadingId(null), 800);
  };

  const handleGenerateContextImage = () => {
    setContextImageLoading(true);
    setTimeout(() => {
      // 串接後改為 setContextImageUrl(回傳的圖片網址)；stub 階段不偽造圖片
      setContextImageUrl(null);
      setContextImageLoading(false);
    }, 800);
  };

  /** Step 2 摘要列用：讓老師不必翻回 Step 1 就知道整體設過什麼 */
  const settingsSummary = [
    contextText.trim() && t("scenarioDialogue.hints.hasContext"),
    isTenseSet(globalTense) && tenseLabel(globalTense),
    globalVoice,
  ]
    .filter(Boolean)
    .join(" · ");

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    setUploadedFiles((prev) => [...prev, ...Array.from(files)]);
  };

  /**
   * 兩個步驟都能按儲存，但擋關的條件一樣 —— 缺什麼就把老師帶到那一步，
   * 只跳 toast 卻停在別的畫面等於叫他自己去找問題在哪。
   */
  const handleSave = async () => {
    if (!title.trim()) {
      setStep(1);
      toast.error(t("contentEditor.messages.enterTitle"));
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
    await onSave?.({
      title,
      rows,
      contextText,
      contextImageUrl,
      globalRubric,
      globalTense,
      globalVoice,
      translateLanguage: translateLang,
      ttsSettings,
    });
  };

  useImperativeHandle(ref, () => ({
    isBusy: isGenerating,
    save: handleSave,
  }));

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 步驟列本身就是導覽：兩步共用同一份 state，切回去不會弄丟題目 */}
      <div className="flex-shrink-0 flex items-center pb-4">
        <StepButton
          index={1}
          label={t("scenarioDialogue.steps.settings")}
          sub={t("scenarioDialogue.steps.settingsSub")}
          active={step === 1}
          done={step === 2}
          onClick={() => setStep(1)}
        />
        <span
          className={`flex-1 h-[2px] mx-3 rounded ${
            step === 2 ? "bg-blue-200" : "bg-gray-300"
          }`}
        />
        <StepButton
          index={2}
          label={t("scenarioDialogue.steps.questions")}
          sub={t("scenarioDialogue.steps.questionsSub")}
          active={step === 2}
          done={false}
          onClick={() => setStep(2)}
        />
      </div>

      {/* ===== Step 1：設定 ===== */}
      {step === 1 && (
        <div className="flex-1 min-h-0">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,38%)_minmax(0,62%)] gap-4 items-start">
            {/* 產題方式：只影響 AI 怎麼出題，不會存進這份教材 */}
            <div className="border rounded-lg bg-gray-50 p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-gray-500 shrink-0" />
                <span className="text-sm font-semibold text-gray-800">
                  {t("scenarioDialogue.labels.generationSource")}
                </span>
                <span className="ml-auto text-[10px] font-semibold text-gray-500 bg-white border border-gray-200 rounded-full px-2 py-0.5">
                  {t("scenarioDialogue.hints.notSaved")}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1 mb-3">
                {t("scenarioDialogue.hints.generationSourceNote")}
              </p>

              <div className="space-y-3">
                <Tabs
                  value={sourceTab}
                  onValueChange={(v) => setSourceTab(v as "ai" | "upload")}
                >
                  <TabsList className="grid w-full grid-cols-2 bg-gray-100 p-1 rounded-lg">
                    <TabsTrigger
                      value="ai"
                      className="rounded-md px-1 text-xs whitespace-nowrap data-[state=active]:bg-blue-500 data-[state=active]:text-white"
                    >
                      {t("scenarioDialogue.tabs.aiAssist")}
                    </TabsTrigger>
                    <TabsTrigger
                      value="upload"
                      className="rounded-md px-1 text-xs whitespace-nowrap data-[state=active]:bg-blue-500 data-[state=active]:text-white"
                    >
                      {t("scenarioDialogue.tabs.upload")}
                    </TabsTrigger>
                  </TabsList>

                  {/* Tab 1：AI 輔助編輯 */}
                  <TabsContent value="ai" className="space-y-3 mt-3">
                    <div>
                      <label className="text-xs text-gray-600 mb-1 block">
                        {t("scenarioDialogue.labels.goal")}
                      </label>
                      <textarea
                        value={goal}
                        onChange={(e) => setGoal(e.target.value)}
                        rows={3}
                        placeholder={t("scenarioDialogue.placeholders.goal")}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm resize-y focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-gray-600 mb-1 block">
                        {t("scenarioDialogue.labels.level")}
                      </label>
                      <div className="flex flex-wrap gap-1">
                        {CEFR_LEVELS.map((lv) => (
                          <button
                            key={lv}
                            type="button"
                            onClick={() => setLevel(lv)}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                              level === lv
                                ? "bg-gradient-to-r from-cyan-400 to-teal-400 text-white shadow-sm"
                                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                            }`}
                          >
                            {lv}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-gray-600 mb-1 block">
                        {t("scenarioDialogue.labels.materialDesc")}
                      </label>
                      <textarea
                        value={materialDesc}
                        onChange={(e) => setMaterialDesc(e.target.value)}
                        rows={2}
                        placeholder={t(
                          "scenarioDialogue.placeholders.materialDesc",
                        )}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm resize-y focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label
                        className="text-xs text-gray-600 mb-1 block"
                        htmlFor="sd-generate-count"
                      >
                        {t("scenarioDialogue.labels.generateCount")}
                      </label>
                      <select
                        id="sd-generate-count"
                        value={generateCount}
                        onChange={(e) =>
                          setGenerateCount(Number(e.target.value))
                        }
                        className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      >
                        {[3, 5, 8, 10].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  </TabsContent>

                  {/* Tab 2：上傳圖片 / PDF */}
                  <TabsContent value="upload" className="space-y-3 mt-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleFiles(e.dataTransfer.files);
                      }}
                      className="w-full py-8 border-2 border-dashed border-gray-300 rounded-lg bg-white flex flex-col items-center justify-center gap-2 hover:border-blue-400 transition-colors"
                    >
                      <Upload className="h-6 w-6 text-gray-400" />
                      <span className="text-sm font-medium text-gray-600">
                        {t("scenarioDialogue.labels.uploadTitle")}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {t("scenarioDialogue.hints.uploadFormats")}
                      </span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      className="hidden"
                      onChange={(e) => handleFiles(e.target.files)}
                    />

                    {uploadedFiles.length > 0 && (
                      <ul className="space-y-1">
                        {uploadedFiles.map((f, i) => (
                          <li
                            key={`${f.name}-${i}`}
                            className="flex items-center justify-between gap-2 px-2 py-1.5 bg-white border border-gray-200 rounded text-xs text-gray-700"
                          >
                            <span className="truncate">{f.name}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setUploadedFiles((prev) =>
                                  prev.filter((_, j) => j !== i),
                                )
                              }
                              className="p-0.5 rounded hover:bg-gray-100"
                            >
                              <X className="h-3 w-3 text-gray-400" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TabsContent>
                </Tabs>

                {/* AI 自動翻譯 — 沿用共用元件 */}
                <BatchTranslateSettings
                  enabled={autoTranslate}
                  onEnabledChange={setAutoTranslate}
                  selectedLanguage={translateLang}
                  onLanguageChange={setTranslateLang}
                  languages={TRANSLATION_LANGUAGES}
                  customLanguage={customLang}
                  onCustomLanguageChange={setCustomLang}
                  variant="card"
                />

                {/* AI 生成語音 — 沿用共用元件 */}
                <BatchTTSSettings
                  settings={ttsSettings}
                  onChange={setTTSSettings}
                  enabled={autoTTS}
                  onEnabledChange={setAutoTTS}
                  variant="card"
                />
              </div>
            </div>

            {/* 整份設定：所有題目共用，會被儲存。標題屬於被儲存的內容，也歸在這裡 */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-blue-600 shrink-0" />
                <span className="text-sm font-semibold text-gray-800">
                  {t("scenarioDialogue.labels.sharedSettings")}
                </span>
                <span className="ml-auto text-[10px] font-semibold text-blue-700 bg-white border border-blue-200 rounded-full px-2 py-0.5">
                  {t("scenarioDialogue.hints.willBeSaved")}
                </span>
              </div>
              <p className="text-[11px] text-gray-600 mt-1 mb-3">
                {t("scenarioDialogue.hints.sharedSettingsNote")}
              </p>

              <div className="space-y-3">
                {/* 標題 */}
                <div className="space-y-1.5">
                  <label
                    className="text-xs font-semibold text-gray-700 block"
                    htmlFor="sd-title"
                  >
                    {t("scenarioDialogue.labels.title")}
                    <span className="text-red-500 ml-0.5">*</span>
                  </label>
                  <input
                    id="sd-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t("scenarioDialogue.placeholders.title")}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 情境說明：選填。空的話學生端不會出現說明卡 */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-700">
                      {t("scenarioDialogue.labels.context")}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {t("scenarioDialogue.hints.contextOptional")}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <div className="w-[104px] h-[74px] shrink-0 rounded-md border border-gray-200 bg-gray-100 overflow-hidden">
                      {contextImageLoading ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
                        </div>
                      ) : contextImageUrl ? (
                        <img
                          src={contextImageUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                          <ImageIcon className="h-4 w-4 text-gray-400" />
                          <span className="text-[10px] text-gray-400">
                            {t("scenarioDialogue.labels.noImage")}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="relative">
                        <textarea
                          value={contextText}
                          onChange={(e) => setContextText(e.target.value)}
                          rows={3}
                          placeholder={t(
                            "scenarioDialogue.placeholders.context",
                          )}
                          className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md bg-white text-sm resize-y focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          className="absolute right-2 top-2 p-1 rounded text-gray-600 bg-yellow-100 hover:bg-yellow-200"
                          title={t("scenarioDialogue.tooltips.generateAudio")}
                        >
                          <Volume2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={contextImagePrompt}
                          onChange={(e) =>
                            setContextImagePrompt(e.target.value)
                          }
                          placeholder={t(
                            "scenarioDialogue.placeholders.imagePrompt",
                          )}
                          className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded bg-white text-[11px] text-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={handleGenerateContextImage}
                          disabled={contextImageLoading}
                          className={`shrink-0 h-[30px] px-3 rounded text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-50 ${
                            contextImageUrl
                              ? "border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                              : "bg-blue-600 text-white hover:bg-blue-700"
                          }`}
                        >
                          {contextImageUrl ? (
                            <RotateCw className="h-3 w-3" />
                          ) : (
                            <ImagePlus className="h-3 w-3" />
                          )}
                          {contextImageUrl
                            ? t("scenarioDialogue.buttons.regenerateImage")
                            : t("scenarioDialogue.buttons.generateImage")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 作答指引：學生看得到 */}
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-gray-700">
                    {t("scenarioDialogue.labels.globalRubric")}
                  </span>
                  <textarea
                    value={globalRubric}
                    onChange={(e) => setGlobalRubric(e.target.value)}
                    rows={2}
                    placeholder={t(
                      "scenarioDialogue.placeholders.globalRubric",
                    )}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm resize-y focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  <p className="text-[10px] text-gray-500">
                    {t("scenarioDialogue.hints.visibleToStudents")}
                  </p>
                </div>

                {/* 整體評分標準：單題未覆寫時沿用。不含必用字詞（逐題獨立） */}
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-gray-700">
                    {t("scenarioDialogue.labels.globalTense")}
                  </span>
                  <div className="flex flex-wrap items-end gap-2">
                    <TenseSelects
                      tense={globalTense}
                      voice={globalVoice}
                      onTenseChange={(time, aspect) =>
                        setGlobalTense({ time, aspect })
                      }
                      onVoiceChange={setGlobalVoice}
                    />
                  </div>
                  <p className="text-[10px] text-gray-500">
                    {t("scenarioDialogue.hints.globalTense")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Step 1 的出口：產題後直接翻頁，或跳過 AI 自己打字 */}
          <div className="mt-4 pt-4 border-t border-gray-200 flex flex-wrap items-center gap-3">
            <span className="text-xs text-gray-500">
              {t("scenarioDialogue.hints.step1Foot")}
            </span>
            <span className="flex-1" />
            <Button variant="outline" onClick={handleSkipToList}>
              {t("scenarioDialogue.buttons.skipGeneration")}
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
            <Button
              onClick={() => handleGenerate(true)}
              disabled={
                isGenerating ||
                filledCount >= MAX_ITEMS ||
                (sourceTab === "upload" && uploadedFiles.length === 0)
              }
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  {t("scenarioDialogue.buttons.generating")}
                </>
              ) : (
                <>
                  <Sparkles className="mr-1 h-4 w-4" />
                  {sourceTab === "upload"
                    ? t("scenarioDialogue.buttons.generateFromFiles")
                    : t("scenarioDialogue.buttons.generateAndContinue")}
                </>
              )}
            </Button>
          </div>
          <p className="mt-2 text-right text-[11px] text-gray-400">
            {t("scenarioDialogue.hints.rateLimit")}
          </p>
        </div>
      )}

      {/* ===== Step 2：題目清單 ===== */}
      {step === 2 && (
        <div className="flex-1 min-w-0">
          {/* 摘要列：不必翻回 Step 1 也知道整體設定是什麼 */}
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
            <span className="text-sm font-semibold text-gray-800 truncate max-w-full">
              {title.trim() || t("scenarioDialogue.hints.untitled")}
            </span>
            {settingsSummary && (
              <span className="text-xs text-gray-600">{settingsSummary}</span>
            )}
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
            >
              <PencilLine className="h-3.5 w-3.5" />
              {t("scenarioDialogue.buttons.editSettings")}
            </button>
            <button
              type="button"
              onClick={() => handleGenerate(false)}
              disabled={isGenerating || filledCount >= MAX_ITEMS}
              className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {isGenerating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {t("scenarioDialogue.buttons.generateMore")}
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
                    key={row.id}
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
                    onDelete={() =>
                      setRows((prev) => prev.filter((r) => r.id !== row.id))
                    }
                    onRegenerate={() => {
                      setRegeneratingId(row.id);
                      setTimeout(() => setRegeneratingId(null), 800);
                    }}
                    onGenerateImage={() => handleGenerateImage(row.id)}
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
      )}
    </div>
  );
});

ScenarioDialoguePanel.displayName = "ScenarioDialoguePanel";

export default ScenarioDialoguePanel;
