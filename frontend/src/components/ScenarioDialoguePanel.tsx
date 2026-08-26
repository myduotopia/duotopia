/**
 * ScenarioDialoguePanel — 情境對話（口說練習）新增/編輯面板
 *
 * Issue #944 / #864。面板分成兩個步驟，**不跳頁**，只在同一塊區域切換顯示。
 * 沒有步驟列 —— 老師實測時不會發現它可以點，導航一律靠底部按鈕。
 *
 * - **Step 1 設定** — 單欄由上而下，內容限寬 `max-w-3xl`：
 *   1. **標題**（必填，擋儲存）
 *   2. **情境內容** —— 三種產生方式匯流到同一個文字框：直接輸入、
 *      AI 輔助生成（訓練目標 + 文章難度）、上傳圖片 / PDF 擷取。
 *      產出之後都還能手改，所以文字框放在 tab 外面共用。
 *   3. 出題設定：題目難度、一次產生幾題、整體評分標準
 *   4. AI 自動翻譯／AI 生成語音，兩者**預設都不勾**、語言也不預選
 *   5. 作答指引（選填）
 *
 *   出口按鈕看清單有沒有題目而變：**沒題目**是「跳過，我想自己出題」＋
 *   「產生題目並繼續」；**已有題目**主按鈕換成「查看題目清單」，產題退成次要。
 *
 * - **Step 2 題目清單** — 左右兩欄：
 *   - 左欄 280px（sticky）是 Step 1 設定的**唯讀對照**：標題、情境內容、
 *     作答指引、整體評分標準，外加「回設定修改」。
 *   - 右欄是可拖曳排序的題目卡、新增題目、題數計數、上一步。
 *     單題設定一路往下讀：題目／翻譯／參考答案／評分準則。
 *
 * 兩步共用同一份 state，只是切換顯示 —— 回 Step 1 改設定不會弄丟已產生的題目。
 *
 * **兩種「必填」不一樣，別混在一起**：
 * - `title` 是內容本身的必要欄位 → 擋**儲存**（`handleSave`）
 * - `scenarioContent` 是 AI 出題的素材 → 只擋**產題**（`handleGenerate`）。
 *   老師只給標題、自己在 Step 2 打題目，是完全合法的路徑，照樣存得起來。
 *   產題按鈕維持可按，缺素材時跳提示並把游標帶到情境內容，而不是變灰不解釋。
 *
 * 評分標準採「預設 + 覆寫」：`row.tenseOverride/voiceOverride` 為 `null` 代表沿用
 * 整體，會跟著整體變動；老師動過單題就脫鉤（可用 ↺ 復原）。這讓「整份成套出題」
 * 與「各題獨立出題」兩種用法共用同一份 UI —— 差別只在有沒有去動整體那三個下拉。
 *
 * 情境圖片是**單題**的事：整份沒有圖片欄位。每題的空圖框同時給「上傳圖片」與
 * 「AI 生成」兩個入口，一個位置把兩條路都擺明，老師不必先決定用哪一種。
 *
 * 難度有兩個且互相獨立：**文章難度**決定 AI 生成的情境文章寫多難，**題目難度**
 * 決定出題出多難 —— 簡單文章出難題目是合理的教法，共用一個值反而綁死。
 *
 * 現階段為**前端設計實作**：不呼叫後端，AI 產題／情境生成／PDF 辨識／圖片生成／
 * TTS 皆為本地 stub，save() 通過擋關後只把資料交給呼叫端。
 *
 * 呼叫端（TeacherTemplatePrograms）此刻**刻意不關閉面板**，只跳一句「尚未串接後端
 * 儲存」。因為真的關掉等於暗示存好了，而實際上什麼都沒存 —— 老師填的東西會直接
 * 消失。等 API 接上再改成「存成功 → 關閉 + 成功提示」。
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
  ArrowRight,
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
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useSidebar } from "@/contexts/SidebarContext";
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
 *
 * 存的是**穩定代碼**、顯示才走 i18n —— 老師切換介面語言不該改變存進資料庫、
 * 送去給 AI 評分的值，否則英文介面存 "past"、中文介面存 "過去"，後端得同時
 * 認兩套。代碼與 `scenarioDialogue.tenseTimes.*` 等 i18n key 一一對應。
 */
const TENSE_TIMES = ["present", "past", "future"] as const;
const TENSE_ASPECTS = [
  "simple",
  "progressive",
  "perfect",
  "perfectProgressive",
] as const;
const VOICES = ["active", "passive"] as const;

/** 時態＝時間＋動貌，兩者都選才成立（避免「過去」但沒說哪一種的半套條件） */
export interface TenseSetting {
  /** TENSE_TIMES 之一，或空字串代表不指定 */
  time: string;
  /** TENSE_ASPECTS 之一，或空字串代表不指定 */
  aspect: string;
}

/** 只取字面翻譯用；型別放寬成字串以免每個呼叫點都要轉型 i18next 的 TFunction */
type Translate = (key: string, options?: Record<string, unknown>) => string;

const EMPTY_TENSE: TenseSetting = { time: "", aspect: "" };
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

/**
 * 情境內容的三種產生方式，全部匯流到同一份 `scenarioContent`：
 * 老師自己打、AI 依訓練目標與文章難度生成、或從上傳的圖片／PDF 擷取。
 * 產出之後都還能手改，所以文字框放在 tab 外面共用。
 */
type ScenarioSource = "manual" | "ai" | "upload";

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
  /**
   * 情境圖片的生成 prompt。
   *
   * @deprecated 候選 —— UI 已經不顯示也不讓老師編輯（圖片改成「勾選自動生成」
   * 或手動上傳二擇一）。欄位暫時保留是因為串接後端後，AI 產題預期會連 prompt
   * 一起回傳給圖片生成用；等後端定案，若確認前端不需要持有它就整個移除，
   * 連同 `isBlankRow` 裡的判斷一起清掉。
   */
  imagePrompt: string;
  /** 已生成的情境圖片；null = 尚未生成 */
  imageUrl: string | null;
  /** 題目語音；null = 尚未生成 */
  audioUrl: string | null;
  /**
   * 內容被整批換掉的次數（目前只有「重新生成這一題」會加）。
   *
   * SortableRow 有兩個從 props 取一次初值的本地狀態：關鍵字草稿與「參考答案」
   * 展開與否。重新生成沿用同一個 row id，React 不會重新掛載，這兩個本地狀態
   * 就會停在舊值 —— 關鍵字輸入框顯示舊字，老師只要 focus 再 blur，onBlur 的
   * commitKeywords 就用舊草稿把新關鍵字蓋回去，而且沒有任何提示。
   *
   * 所以 render 時把 key 設成 `id:revision`：id 保持穩定給拖曳排序用，
   * revision 一變就重新掛載，本地狀態自然跟著重新取一次初值。
   */
  revision: number;
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
    /**
     * 情境內容。空字串是合法的 —— 老師可以只給標題並自己在題目清單打題目，
     * 只有要用 AI 產題時才一定要有（見 handleGenerate）。
     */
    scenarioContent: string;
    /** 題目難度（CEFR）。與生成情境文章用的「文章難度」各自獨立 */
    questionLevel: string;
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
  revision: 0,
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

/** 前端 stub：實際串接後改為 AI 生成／PDF 辨識回傳的情境文章 */
const SAMPLE_SCENARIO = `It is Monday morning at school. You and your classmate are talking about the weekend before class starts.

Your classmate went to the park with their family on Saturday. They played basketball and visited their grandmother in the afternoon. On Sunday they stayed home because it rained all day.

Now it is your turn to talk about what you did.`;

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
              {t(`scenarioDialogue.tenseTimes.${o}`)}
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
              {t(`scenarioDialogue.tenseAspects.${o}`)}
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
              {t(`scenarioDialogue.voices.${o}`)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** 生效中的條件標籤；`onRemove` 未給則不顯示移除鍵（繼承來的條件要去整體改） */
function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-100 px-2.5 py-0.5 text-[11px] font-semibold text-blue-800">
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
              className="px-1.5 py-0.5 rounded bg-white/90 text-[10px] font-semibold text-gray-700 hover:bg-white"
            >
              {t("scenarioDialogue.buttons.replaceImage")}
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="px-1.5 py-0.5 rounded bg-white/90 text-[10px] font-semibold text-red-600 hover:bg-white"
            >
              {t("scenarioDialogue.buttons.removeImage")}
            </button>
          </div>
        </>
      ) : (
        /* 兩個入口並列：自己傳，或讓 AI 生。框只有 104px，所以用文字列而非圖示 */
        <div className="w-full h-full flex flex-col items-stretch justify-center gap-1 p-1.5">
          <button
            type="button"
            onClick={pick}
            className="flex items-center justify-center gap-1 rounded border border-gray-300 bg-white py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50"
          >
            <ImagePlus className="h-3 w-3" />
            {t("scenarioDialogue.buttons.uploadImage")}
          </button>
          <button
            type="button"
            onClick={onGenerate}
            className="flex items-center justify-center gap-1 rounded bg-blue-600 py-1 text-[10px] font-semibold text-white hover:bg-blue-700"
          >
            <Sparkles className="h-3 w-3" />
            {t("scenarioDialogue.buttons.generateImage")}
          </button>
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
  onDelete: () => void;
  onRegenerate: () => void;
  onPickImage: (file: File) => void;
  onRemoveImage: () => void;
  onGenerateImage: () => void;
  /** 尚未串接後端的動作（語音生成／播放）按下去的提示 */
  onNotWired: () => void;
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
  onNotWired,
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
                    onClick={onNotWired}
                    className="p-1 rounded text-green-600 hover:bg-green-100"
                    title={t("contentEditor.tooltips.play")}
                  >
                    <Play className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onNotWired}
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

            {/* 評分準則：接在題目下方，單題設定一路往下讀 */}
            <div className="bg-white rounded-md border border-gray-200 divide-y divide-gray-100">
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
  /** 逐題 AI 生圖是一題一題觸發的，所以要記住是哪一題在跑 */
  const [imageLoadingId, setImageLoadingId] = useState<string | null>(null);

  // 情境內容的三種產生方式共用的輸入
  /** 訓練目標：AI 生成情境文章時的 prompt */
  const [goal, setGoal] = useState("");
  /** 文章難度：只影響 AI 生成出來的情境文章寫多難 */
  const [articleLevel, setArticleLevel] = useState(programLevel || "A1");
  /** 一次要 AI 產幾題。上限跟著 MAX_ITEMS 走 */
  const [generateCount, setGenerateCount] = useState(5);
  /** 題目難度：出題出多難，與「文章難度」各自獨立 —— 簡單文章也可以出難題目 */
  const [questionLevel, setQuestionLevel] = useState(programLevel || "A1");
  /** 情境內容的產生方式。受控是因為產題按鈕收在 footer，需要知道現在是哪一種 */
  const [sourceTab, setSourceTab] = useState<ScenarioSource>("manual");
  const [isGenerating, setIsGenerating] = useState(false);
  /** 生成情境內容與產題是兩件事，loading 各自獨立 */
  const [isGeneratingScenario, setIsGeneratingScenario] = useState(false);

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
    setEditorBusy(isGenerating || isGeneratingScenario);
    return () => setEditorBusy(false);
  }, [isGenerating, isGeneratingScenario, setEditorBusy]);

  // ===== 整份設定（所有題目共用）=====
  /**
   * 情境內容 —— 三種產生方式（直接輸入／AI 輔助生成／上傳圖片 PDF）共同的產物。
   * 空的時候仍然可以儲存（老師自己在 Step 2 打題目），但不能用 AI 產題。
   */
  const [scenarioContent, setScenarioContent] = useState("");
  /** 全份共用的作答指引 — 同時給 AI 評分與學生作答參考 */
  const [globalRubric, setGlobalRubric] = useState("");
  /** 整體評分標準，單題未覆寫時沿用 */
  const [globalTense, setGlobalTense] = useState<TenseSetting>(EMPTY_TENSE);
  const [globalVoice, setGlobalVoice] = useState("");

  // 左側 上傳圖片 / PDF
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 產題缺情境內容時，除了提示還要把游標帶過去 */
  const scenarioRef = useRef<HTMLTextAreaElement>(null);

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

  /**
   * 已經有題目了，Step 1 的主要動作就從「產題」變成「回去看題目」——
   * 老師常常直接按下方的大按鈕，不會發現上方步驟列可以點。
   */
  const hasQuestions = filledCount > 0;

  // 情境內容沒填不在這裡擋 —— 按下去要看到「請先輸入情境內容」的提示，
  // 而不是一顆沒說明理由的灰色按鈕
  const generateDisabled =
    isGenerating || isGeneratingScenario || filledCount >= MAX_ITEMS;
  /** 產題與生成情境內容互相擋，避免兩個 stub 同時跑 */
  const scenarioBusy = isGenerating || isGeneratingScenario;

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
    // 情境內容是 AI 出題的素材，沒有素材就沒東西可出。
    // 這條只擋產題，不擋儲存 —— 老師自己在 Step 2 打題目時不需要情境內容。
    if (!scenarioContent.trim()) {
      toast.error(t("scenarioDialogue.messages.scenarioRequired"));
      scenarioRef.current?.focus();
      return;
    }
    setIsGenerating(true);
    setTimeout(() => {
      setRows((prev) => {
        // 尚未動過的空白卡直接被產出的題目取代，避免最前面卡著一張空的
        const kept = prev.filter((r) => !isBlankRow(r));
        const room = MAX_ITEMS - kept.length;
        // 避開已經出現過的題目，與 regenerateRow 同一套規則 —— 否則按第二次
        // 「再產一批題目」會原封不動再貼一次同樣的示範題
        const used = new Set(
          kept.map((r) => r.question.trim()).filter(Boolean),
        );
        const fresh = SAMPLE_QUESTIONS.filter((q) => !used.has(q.question));
        return [
          ...kept,
          ...fresh
            .slice(0, Math.max(0, Math.min(generateCount, room)))
            .map((q) => createRow(q)),
        ];
      });
      setIsGenerating(false);
      if (advance) setStep(2);
    }, 600);
  };

  /**
   * 單題重新生成。stub 也要真的換掉題目 —— tooltip 寫的是「會避開已出現過的
   * 題目」，如果只轉個 spinner 就結束，之後接真 API 的人會以為這裡本來就沒事做。
   * 換上一則還沒被用到的示範題，把「避開重複」這件事實際做出來。
   */
  const regenerateRow = (id: string) => {
    setRegeneratingId(id);
    setTimeout(() => {
      setRows((prev) => {
        const used = new Set(
          prev.map((r) => r.question.trim()).filter(Boolean),
        );
        const fresh = SAMPLE_QUESTIONS.find((q) => !used.has(q.question));
        // 示範題用光了就維持原樣，總比換成重複的好
        if (!fresh) return prev;
        return prev.map((r) =>
          r.id === id ? { ...r, ...fresh, revision: r.revision + 1 } : r,
        );
      });
      setRegeneratingId(null);
    }, 800);
  };

  /**
   * 產生情境內容（AI 生成 / 從檔案擷取）。前端 stub：串接後把回傳的文章填進
   * scenarioContent。三種來源共用同一個目的地，所以這裡只有一個處理函式。
   */
  const handleGenerateScenario = () => {
    setIsGeneratingScenario(true);
    setTimeout(() => {
      setScenarioContent(SAMPLE_SCENARIO);
      setIsGeneratingScenario(false);
    }, 700);
  };

  /** 跳過 AI 自己出題：至少留一張空白卡可以打字 */
  const handleSkipToList = () => {
    setRows((prev) => (prev.length === 0 ? [createRow()] : prev));
    setStep(2);
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
  const generateRowImage = (id: string) => {
    setImageLoadingId(id);
    setTimeout(() => setImageLoadingId(null), 800);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    setUploadedFiles((prev) => [...prev, ...Array.from(files)]);
  };

  /**
   * 語音生成與播放還沒有後端可打。按鈕維持可點並回一句提示，而不是靜靜地
   * 沒反應 —— 沒反應的按鈕會被當成壞掉，老師會一直重按。
   */
  const notWired = () =>
    toast.info(t("scenarioDialogue.messages.frontendOnly"));

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
      scenarioContent,
      questionLevel,
      globalRubric,
      globalTense,
      globalVoice,
      translateLanguage: translateLang,
      ttsSettings,
    });
  };

  useImperativeHandle(ref, () => ({
    // 兩種生成都要算 busy —— 只看 isGenerating 的話，老師在情境內容還在
    // 生成時就能按儲存，存進去的是那一刻的舊值。真 API 更慢，更容易中招。
    isBusy: isGenerating || isGeneratingScenario,
    save: handleSave,
  }));

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ===== Step 1：設定 ===== */}
      {step === 1 && (
        <div className="flex-1 min-h-0">
          {/* 面板很寬，設定欄位限寬才不會一行文字橫跨整個畫面 */}
          <div className="max-w-3xl space-y-4">
            {/* 標題：新增／編輯內容一定要有，沒填不能儲存 */}
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

            {/*
              情境內容：三種產生方式共用一個文字框。這裡刻意不標紅星 ——
              沒填仍然可以儲存（自己出題），只有 AI 產題才一定要有。
            */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-700">
                  {t("scenarioDialogue.labels.scenarioContent")}
                </span>
                <span className="text-[10px] text-gray-400">
                  {t("scenarioDialogue.hints.scenarioRequiredForAi")}
                </span>
              </div>

              {/*
                工具區（灰底）與產出區（白底）包在同一張卡裡。先前三者平鋪，
                最後那個 textarea 看起來就像「第 N 個欄位」，但它才是真正
                被儲存的東西 —— 上面的 tab 只是把內容填進去的工具。
              */}
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 border-b border-gray-200 p-3 space-y-3">
                  <Tabs
                    value={sourceTab}
                    onValueChange={(v) => setSourceTab(v as ScenarioSource)}
                  >
                    <TabsList className="grid w-full grid-cols-3 bg-gray-100 p-1 rounded-lg">
                      {(
                        [
                          ["manual", "sourceManual"],
                          ["ai", "sourceAi"],
                          ["upload", "sourceUpload"],
                        ] as const
                      ).map(([value, key]) => (
                        <TabsTrigger
                          key={value}
                          value={value}
                          className="rounded-md px-1 text-xs whitespace-nowrap data-[state=active]:bg-blue-500 data-[state=active]:text-white"
                        >
                          {t(`scenarioDialogue.tabs.${key}`)}
                        </TabsTrigger>
                      ))}
                    </TabsList>

                    {/* 直接輸入：沒有額外控制項，下面的文字框就是全部 */}
                    <TabsContent value="manual" className="mt-2">
                      <p className="text-[11px] text-gray-500">
                        {t("scenarioDialogue.hints.sourceManual")}
                      </p>
                    </TabsContent>

                    {/* AI 輔助生成：訓練目標 + 文章難度 */}
                    <TabsContent value="ai" className="space-y-3 mt-3">
                      <div>
                        <label className="text-xs text-gray-600 mb-1 block">
                          {t("scenarioDialogue.labels.goal")}
                        </label>
                        <textarea
                          value={goal}
                          onChange={(e) => setGoal(e.target.value)}
                          rows={2}
                          placeholder={t("scenarioDialogue.placeholders.goal")}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm resize-y focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-gray-600 mb-1 block">
                          {t("scenarioDialogue.labels.articleLevel")}
                        </label>
                        <div className="flex flex-wrap gap-1">
                          {CEFR_LEVELS.map((lv) => (
                            <button
                              key={lv}
                              type="button"
                              onClick={() => setArticleLevel(lv)}
                              className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                                articleLevel === lv
                                  ? "bg-gradient-to-r from-cyan-400 to-teal-400 text-white shadow-sm"
                                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                              }`}
                            >
                              {lv}
                            </button>
                          ))}
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleGenerateScenario}
                        disabled={scenarioBusy}
                      >
                        {isGeneratingScenario ? (
                          <>
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            {t("scenarioDialogue.buttons.generating")}
                          </>
                        ) : (
                          <>
                            <Sparkles className="mr-1 h-4 w-4" />
                            {t("scenarioDialogue.buttons.generateScenario")}
                          </>
                        )}
                      </Button>
                    </TabsContent>

                    {/* 上傳圖片 / PDF：辨識後填進同一個文字框 */}
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

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleGenerateScenario}
                        disabled={scenarioBusy || uploadedFiles.length === 0}
                      >
                        {isGeneratingScenario ? (
                          <>
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            {t("scenarioDialogue.buttons.generating")}
                          </>
                        ) : (
                          <>
                            <Sparkles className="mr-1 h-4 w-4" />
                            {t("scenarioDialogue.buttons.extractScenario")}
                          </>
                        )}
                      </Button>
                    </TabsContent>
                  </Tabs>
                </div>

                {/* 三種方式的共同產物，產生後仍可手改 —— 這一格才是會被儲存的內容 */}
                <div className="p-3 space-y-1.5 bg-white">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-gray-700">
                      {t("scenarioDialogue.labels.scenarioText")}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {t("scenarioDialogue.hints.scenarioText")}
                    </span>
                  </div>
                  <textarea
                    ref={scenarioRef}
                    value={scenarioContent}
                    onChange={(e) => setScenarioContent(e.target.value)}
                    rows={5}
                    placeholder={t(
                      "scenarioDialogue.placeholders.scenarioContent",
                    )}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm resize-y focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/*
              分隔線本身不會告訴人兩邊是什麼。把線和區塊標題綁在一起，
              往下是哪一組設定就一眼可見。
            */}
            <div className="pt-5 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900">
                {t("scenarioDialogue.labels.sectionGenerate")}
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {t("scenarioDialogue.hints.sectionGenerate")}
              </p>
            </div>

            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
              <div>
                <span className="text-xs font-semibold text-gray-700 mb-1 block">
                  {t("scenarioDialogue.labels.questionLevel")}
                </span>
                <div className="flex flex-wrap gap-1">
                  {CEFR_LEVELS.map((lv) => (
                    <button
                      key={lv}
                      type="button"
                      onClick={() => setQuestionLevel(lv)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                        questionLevel === lv
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
                <label
                  className="text-xs font-semibold text-gray-700 mb-1 block"
                  htmlFor="sd-generate-count"
                >
                  {t("scenarioDialogue.labels.generateCount")}
                </label>
                <select
                  id="sd-generate-count"
                  value={generateCount}
                  onChange={(e) => setGenerateCount(Number(e.target.value))}
                  className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  {[3, 5, 8, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 整體評分標準：也決定每題的預設時態／語態 */}
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

            {/* 產題時要一併做的事，兩個都預設不勾 */}
            <div className="space-y-2">
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

              <BatchTTSSettings
                settings={ttsSettings}
                onChange={setTTSSettings}
                enabled={autoTTS}
                onEnabledChange={setAutoTTS}
                variant="card"
              />
            </div>

            <div className="pt-5 border-t border-gray-200 space-y-1.5">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-gray-900">
                  {t("scenarioDialogue.labels.globalRubric")}
                </h3>
                <span className="text-[10px] text-gray-400">
                  {t("scenarioDialogue.hints.optional")}
                </span>
              </div>
              {/* 說明放在輸入框上方 —— 先知道這段字給誰看，才知道怎麼寫 */}
              <p className="text-[11px] text-gray-500">
                {t("scenarioDialogue.hints.visibleToStudents")}
              </p>
              <textarea
                value={globalRubric}
                onChange={(e) => setGlobalRubric(e.target.value)}
                rows={2}
                placeholder={t("scenarioDialogue.placeholders.globalRubric")}
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm resize-y focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Step 1 的出口。已有題目時「查看題目清單」才是主要動作 */}
          <div className="mt-4 pt-4 border-t border-gray-200 flex flex-wrap items-center gap-3">
            <span className="text-xs text-gray-500">
              {t("scenarioDialogue.hints.step1Foot")}
            </span>
            <span className="flex-1" />
            {hasQuestions ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => handleGenerate(false)}
                  disabled={generateDisabled}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      {t("scenarioDialogue.buttons.generating")}
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-1 h-4 w-4" />
                      {t("scenarioDialogue.buttons.generateAnother")}
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => setStep(2)}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {t("scenarioDialogue.buttons.viewQuestions")}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={handleSkipToList}>
                  {t("scenarioDialogue.buttons.skipGeneration")}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
                <Button
                  onClick={() => handleGenerate(true)}
                  disabled={generateDisabled}
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
                      {t("scenarioDialogue.buttons.generateAndContinue")}
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
          <p className="mt-2 text-right text-[11px] text-gray-400">
            {t("scenarioDialogue.hints.rateLimit")}
          </p>
        </div>
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
            <p className="text-[11px] text-gray-600">
              {t("scenarioDialogue.hints.referenceNote")}
            </p>

            <div className="rounded-md border border-blue-100 bg-white p-2.5 space-y-3">
              <div>
                <span className="block text-[10px] font-semibold text-gray-500">
                  {t("scenarioDialogue.labels.title")}
                </span>
                <span className="block text-sm font-semibold text-gray-800 break-words">
                  {title.trim() || t("scenarioDialogue.hints.untitled")}
                </span>
              </div>

              <div className="space-y-1">
                <span className="block text-[10px] font-semibold text-gray-500">
                  {t("scenarioDialogue.labels.scenarioContent")}
                </span>
                {scenarioContent.trim() ? (
                  <p className="text-xs text-gray-700 whitespace-pre-wrap break-words">
                    {scenarioContent}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400">
                    {t("scenarioDialogue.hints.noContextYet")}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <span className="block text-[10px] font-semibold text-gray-500">
                  {t("scenarioDialogue.labels.globalRubric")}
                </span>
                {globalRubric.trim() ? (
                  <p className="text-xs text-gray-700 whitespace-pre-wrap break-words">
                    {globalRubric}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400">
                    {t("scenarioDialogue.hints.noRubricYet")}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <span className="block text-[10px] font-semibold text-gray-500">
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
                  <p className="text-xs text-gray-400">
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

          {/* 右欄：題目清單 */}
          <div className="min-w-0">
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
                      onNotWired={notWired}
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
    </div>
  );
});

ScenarioDialoguePanel.displayName = "ScenarioDialoguePanel";

export default ScenarioDialoguePanel;
