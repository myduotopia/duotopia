/**
 * ScenarioDialoguePanel — 情境對話（口說練習）新增/編輯面板
 *
 * Issue #944 / #864 / #1146 / #1158。#1158 C commit 4 起改成**同頁版面**（共用的
 * `components/shared/guided-chat/GuidedChatLayout`）：左邊對話、右邊題目，不再切換畫面，
 * 也沒有「上一步／下一步」「查看題目清單」「回到對話」和底部操作列。儲存和 ✕ 在 sheet
 * 標題列（`ScenarioDialogueEditorSheet`）。
 *
 * - **版面依面板寬度**（ResizeObserver，不看 viewport）：寬（≥ 925px）左右並列；窄時頂端
 *   Tabs 切換「對話／題目（N）」，兩邊狀態都保留。從對話產生題目後自動切到「題目」分頁；
 *   「編輯情境內容」、缺標題／題數不足存檔時也切過去。
 *
 * - **左欄：引導式對話**（`ScenarioSetupChat`）—— 已選項目列、連續的對話紀錄、底部對話框。
 *   流程是「步驟設定」（`scenarioSteps.ts`）接上通用引擎（`guided-chat/flowEngine.ts`）；
 *   對話的 state 與動作（答案、對話紀錄、情境、出題設定卡、AI 寫情境、上傳擷取）在
 *   `useScenarioSetup`，面板只留題目清單、標題、產題與存檔。
 *
 * - **右欄：題目**，由上到下：標題（AI 建議的規則照舊）→ 情境區（情境確認後才出現，
 *   `ScenarioReferenceAside` 改寫，預設展開、可收合、「編輯」原地修改、AI 文章可重寫）→
 *   題目卡（`SortableRow`，窄版排法 `compact` 依右欄實際寬度決定）→「＋ 新增題目」→ 題數計數。
 *   沒有題目時顯示「題目會出現在這裡」。題數滿 10 題時新增鍵與每張卡的複製鍵都停用並說明上限。
 *   清單上方的「再產一批」拿掉了（之後由對話框請 AI 再出題，C 段第 5 段）；每題的「重新產生」保留。
 *
 * - **題數上限**：出題設定卡的題數選項上限＝剩餘名額（10 − 已有非空白題數），預設
 *   min(5, 剩餘)；剩餘 0 時「開始產生」停用，旁邊寫「已滿 10 題」。
 *
 * - **對話框打字（compose，C 段第 5 段，`handleCompose`）**：「自己打題目」那一步，以及題目
 *   已產生、沒有進行中的步驟時，老師在對話框打的字交給 AI 判斷是「自己打的題目」
 *   （`add_questions`）還是「請 AI 再出題」（`generate`）。
 *   - 超過 `MAX_COMPOSE_TEXT_CHARS`（8000 字，和後端同值）不呼叫 AI，回「內容太長，請分次
 *     輸入」；後端回 422 也對到這句。
 *   - 處理中：對話框與已選項目列停用（引擎的 pending）。
 *   - 全部無關：重問（後端不計次）。部分無關：提示「已略過 N 段…」。輸出被截斷：提示
 *     「部分題目沒讀到，請分次輸入」。
 *   - 加題一律加在後面，清單裡的空白題先被填入（`mergeComposed`）；寫入時用最新的 rows
 *     重算剩餘名額。自己打的題目超過剩餘名額時先跳 `ConfirmDialog`「只會加入前 N 題」，
 *     確認才寫入（對話框清空）；取消不寫入，對話裡只加一句「沒有加入題目」，老師的原文留在
 *     對話框（和失敗時一致）。`add_questions` 不產翻譯和語音；`generate` 照出題設定處理
 *     翻譯與語音（只替實際加入的題目）。老師要的題數大於剩餘名額時回「只剩 N 個空位，
 *     先出 N 題」。
 *   - 加入後：對話加一句「已加入 N 題」，窄版切到「題目」分頁；「自己打題目」那一步答完。
 *   - **修改既有內容（修正 C6）**：AI 也會判斷出「修改題目」（`revise_questions`，例如
 *     「把問題改為過去式」「把第 2 題改成…」）或「修改情境」（`revise_scenario`，例如
 *     「情境改成在學校」）。送出時既有題目帶題號（右欄畫面上的第幾題）與完整欄位
 *     （`composeExisting`）。回來後先跳 `ConfirmDialog`（「會改寫 N 題，原本的內容會被
 *     取代」／「會改寫情境文章」），確認才改：題目依列 id 原地替換（`reviseRow`，題目圖
 *     不動；題目文字變了的題重產語音、翻譯依開關）；情境只換文章、右欄即時更新、情境圖
 *     不動。紀錄寫「已改寫 N 題」／「已改寫情境文章」。取消不改，紀錄寫「沒有修改…」，
 *     原文放回對話框。
 *   - 已滿 10 題**不在前端擋**（可能是修改）；後端判斷出是加題／出題時回 `refusal`
 *     「full」。沒有題目卻要改題目、沒有情境卻要改情境、題號不存在，同樣由後端回
 *     `refusal`，對話裡說明（「目前還沒有題目可以修改」等），不計次。
 *   - 失敗（402 額度、409 已滿、422 太長、其他）：對話裡說明，對話框留著原文、恢復可用。
 *   題目刪光後（AI 出題來源）流程仍在「題目已產生」，老師可以直接在對話框請 AI 出題。
 *
 * 編輯既有內容時，答案由已存資料還原（`scenarioAnswersFromSaved`），對話紀錄由
 * `summaryLog` 拼出摘要。
 *
 * **兩種「必填」不一樣，別混在一起**：
 * - `title` 是內容本身的必要欄位 → 擋**儲存**（`handleSave`），缺的時候切到題目那一側
 *   並把游標帶到標題欄
 * - 情境（文字或圖）／出題方向是 AI 出題的素材 → 只擋**產題**（`handleGenerate`）。
 *   老師完全不用 AI（自己貼情境＋自己出題）是合法路徑，標題留空由他自己填。
 *
 * **標題由 AI 先給**（#1146）：AI 寫情境、上傳擷取或出題時回 `suggested_title`，只在標題是空的時
 * 候自動填 —— 等於「用第一次的建議、之後不覆蓋老師改過的」。
 *
 * 評分標準採「預設 + 覆寫」：`row.tenseOverride/voiceOverride` 為 `null` 代表沿用
 * 整體，會跟著整體變動；老師動過單題就脫鉤（可用 ↺ 復原）。
 *
 * 題目圖片是**單題**的事（`row.imageUrl`，每題 1 張）；情境圖是整份的事
 * （`scenario_settings.scenario_images`），兩者無關。兩者都能用 AI 生圖（#1158），共用
 * `AiImageGenerateDialog`；題目圖的對話框由這裡持有（`imageDialogRowId`）。
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
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { useSidebar } from "@/contexts/SidebarContext";
import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";
import { TTSSettingsDialog } from "@/components/shared/TTSSettingsDialog";
import { AiImageGenerateDialog } from "@/components/scenario-dialogue-editor/AiImageGenerateDialog";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  apiClient,
  ApiError,
  type ScenarioComposeExistingQuestion,
  type ScenarioComposeRevision,
} from "@/lib/api";
import { ConfirmDialog } from "@/components/organization/ConfirmDialog";
import { getVoiceAndRate } from "@/utils/ttsVoiceResolver";
import {
  createScenarioRow as createRow,
  nextRowId,
  type ScenarioDialogueInitialState,
  type ScenarioDialogueRow,
  type ScenarioSaveInput,
} from "@/lib/scenarioDialogue";
import {
  MAX_COMPOSE_TEXT_CHARS,
  MAX_ITEMS,
  MIN_ITEMS,
} from "@/components/scenario-dialogue-editor/constants";
import {
  GuidedChatLayout,
  type GuidedChatTab,
} from "@/components/shared/guided-chat/GuidedChatLayout";
import {
  QuestionSettingsCard,
  effectiveCount,
} from "@/components/scenario-dialogue-editor/QuestionSettingsCard";
import { ScenarioSetupChat } from "@/components/scenario-dialogue-editor/ScenarioSetupChat";
import { ScenarioReferenceAside } from "@/components/scenario-dialogue-editor/ScenarioReferenceAside";
import { ScenarioScrollArea } from "@/components/scenario-dialogue-editor/ScenarioSheetLayout";
import { SortableRow } from "@/components/scenario-dialogue-editor/ScenarioQuestionRow";
import {
  textAiErrorKey,
  useScenarioSetup,
} from "@/components/scenario-dialogue-editor/useScenarioSetup";

/** 情境對話一次最少 3 題、最多 10 題（#864）。常數本體搬到 scenario-dialogue-editor/constants（#1146） */
export { MIN_ITEMS, MAX_ITEMS };

/**
 * 資料型別與空白列的建構子放在 `@/lib/scenarioDialogue` —— 呼叫端要用同一份型別把
 * 面板資料換成 API payload（見該檔的 null 語意說明），型別留在元件裡會讓 lib 反過來
 * 依賴元件。這裡原樣 re-export，既有的 `from "@/components/ScenarioDialoguePanel"`
 * 匯入不受影響。
 */
export type { TenseSetting, ScenarioDialogueRow } from "@/lib/scenarioDialogue";

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

/**
 * 題目卡改用窄版排法的門檻：右欄內容寬度（不含右欄的工具列留白）。捲動區左右各有
 * 24px 內距，所以卡片本身寬不到約 552px（＝原本 viewport sm 640px 時卡片的寬度）就用窄版。
 */
const COMPACT_SIDE_WIDTH = 600;

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

/**
 * 把 AI 產的題目併進清單（「開始產生」用）：拿掉空白列，保留既有題目，接上沒重複的新題，
 * 不超過剩餘名額。回傳新清單與實際加入的那幾題。
 *
 * 後端已經避開送出去的既有題目，但老師等待期間新打的那些它不知道，所以這裡再去重一次。
 */
const mergeGenerated = (
  prev: ScenarioDialogueRow[],
  created: ScenarioDialogueRow[],
) => {
  const kept = prev.filter((r) => !isBlankRow(r));
  const room = Math.max(0, MAX_ITEMS - kept.length);
  const used = new Set(kept.map((r) => r.question.trim()).filter(Boolean));
  const added = created
    .filter((r) => !used.has(r.question.trim()))
    .slice(0, room);
  return { rows: [...kept, ...added], added };
};

/**
 * 把對話框（compose）產出的題目併進清單：**一律加在後面**，清單裡的空白題先被填入
 * （原位置換成新題），其餘接在最後；不超過剩餘名額（10 − 非空白題數）。
 * `dedupe`：AI 出題（`generate`）時避開清單上已有的題目；老師自己打的照收。
 */
const mergeComposed = (
  prev: ScenarioDialogueRow[],
  created: ScenarioDialogueRow[],
  dedupe: boolean,
) => {
  const kept = prev.filter((r) => !isBlankRow(r));
  const room = Math.max(0, MAX_ITEMS - kept.length);
  const used = new Set(kept.map((r) => r.question.trim()).filter(Boolean));
  const added = (
    dedupe ? created.filter((r) => !used.has(r.question.trim())) : created
  ).slice(0, room);
  const queue = [...added];
  const filled = prev.map((r) =>
    isBlankRow(r) && queue.length ? (queue.shift() as ScenarioDialogueRow) : r,
  );
  return { rows: [...filled, ...queue], added };
};

/** compose 的錯誤 → 對話裡那一句（已滿、內容太長、額度用完、其他失敗） */
const composeErrorKey = (error: unknown) => {
  if (error instanceof ApiError && error.status === 409) {
    return "scenarioDialogue.compose.full";
  }
  // 唯一會被後端擋的輸入是字數（前端已先擋，這裡是保險）
  if (error instanceof ApiError && error.status === 422) {
    return "scenarioDialogue.compose.tooLong";
  }
  return textAiErrorKey(error);
};

/** 等老師確認「只會加入前 N 題」的那一批（或直接寫入的那一批） */
interface ComposedBatch {
  typed: string;
  atManual: boolean;
  created: ScenarioDialogueRow[];
  replies: { role: "bot" | "note"; text: string }[];
}

/**
 * compose 送出的既有題目（修正 C6）：非空白題，題號＝右欄畫面上的第幾題（含空白題的位置），
 * 欄位截到後端收的上限（題目／翻譯 1000、字詞 10 個各 60、參考答案 2000、圖片描述 1000），
 * 免得老師某一欄特別長整個請求被 422 擋掉。
 */
const composeExisting = (rows: ScenarioDialogueRow[]) =>
  rows.flatMap<{
    rowId: string;
    number: number;
    payload: ScenarioComposeExistingQuestion;
  }>((r, i) =>
    isBlankRow(r) || !r.question.trim()
      ? []
      : [
          {
            rowId: r.id,
            number: i + 1,
            payload: {
              number: i + 1,
              question: r.question.trim().slice(0, 1000),
              translation: r.translation.trim().slice(0, 1000),
              keywords: r.keywords.slice(0, 10).map((k) => k.slice(0, 60)),
              reference_answer: r.referenceAnswer.trim().slice(0, 2000),
              image_prompt: r.imagePrompt.trim().slice(0, 1000),
            },
          },
        ],
  );

/**
 * 套用一筆 AI 改寫（修正 C6）：題目、翻譯、必用字詞、參考答案、圖片描述換成新的；題目圖、
 * 單題評分標準、補充說明、題號位置不動。題目文字變了，舊語音就對不上（清掉，由呼叫端重產）。
 * 翻譯：開關開著用 AI 的翻譯（AI 回空的且題目沒變時留原本的，修正 C6b）；關著時題目沒變
 * 就留原本的，變了就清空（舊翻譯已對不上）。
 */
const reviseRow = (
  row: ScenarioDialogueRow,
  r: ScenarioComposeRevision,
  autoTranslate: boolean,
): ScenarioDialogueRow => {
  const changed = r.question.trim() !== row.question.trim();
  return {
    ...row,
    question: r.question,
    translation:
      autoTranslate && r.translation.trim()
        ? r.translation
        : changed
          ? ""
          : row.translation,
    keywords: r.keywords,
    referenceAnswer: r.reference_answer,
    imagePrompt: r.image_prompt || row.imagePrompt,
    audioUrl: changed ? null : row.audioUrl,
  };
};

/** 等老師確認的修改（修正 C6）：改寫題目或改寫情境文章 */
interface PendingRevise {
  kind: "questions" | "scenario";
  typed: string;
  atManual: boolean;
  replies: { role: "bot" | "note"; text: string }[];
  /** kind=questions：列 id → 改寫內容（送出時依題號對到的列） */
  revisions: Map<string, ScenarioComposeRevision>;
  /** kind=scenario：改寫後的情境文章 */
  scenarioContent: string;
  /** AI 的標題建議：確認後才套用，取消不套用（修正 C6b） */
  suggestedTitle?: string;
}

const ScenarioDialoguePanel = forwardRef<
  ScenarioDialoguePanelHandle,
  ScenarioDialoguePanelProps
>(({ programLevel, initialData, isSaving = false, onSave }, ref) => {
  const { t, i18n } = useTranslation();
  /** 答非所問的重問句與 AI 標題建議用老師的介面語言 */
  const uiLanguage = i18n?.language?.startsWith("en") ? "en" : "zh-TW";

  /**
   * `initialData` 一律只當**初值**（lazy initializer），不放進 useEffect 反覆套用：
   * 套用式的寫法只要呼叫端 re-render 就可能把老師打到一半的東西洗掉。要換一份內容
   * 請由呼叫端用 `key` 重新掛載面板（見 TeacherTemplatePrograms），語意清楚得多。
   */

  /**
   * 窄版（< 925px）時顯示哪一個分頁。寬版兩欄並列，這個值仍保留，切回窄版回到原本那一頁。
   * 編輯既有內容時先落在「題目」—— 老師點進來多半是要改題目。
   */
  const [tab, setTab] = useState<GuidedChatTab>(
    initialData?.rows?.length ? "side" : "chat",
  );

  const [title, setTitle] = useState(initialData?.title ?? "");
  // 新建時沒有題目：右欄顯示「題目會出現在這裡」，老師可按「＋ 新增題目」自己打
  const [rows, setRows] = useState<ScenarioDialogueRow[]>(
    () => initialData?.rows ?? [],
  );
  /** 最新一次 render 的 rows，給 await 之後的非同步流程判斷用（#1158 修正 B1） */
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
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
  /** 開著「AI 生圖」對話框的那一題（#1158） */
  const [imageDialogRowId, setImageDialogRowId] = useState<string | null>(null);
  /** 目前正在播的題目語音；換一題要先停掉舊的，不然會疊音 */
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /**
   * AI 標題建議（#1146）：只在標題是空的時候填 ——
   * 等於「用第一次的建議，之後不覆蓋老師改過的」。寫情境、擷取、出題三條路共用。
   */
  const applySuggestedTitle = useCallback((suggested?: string) => {
    const value = (suggested || "").trim();
    if (value) setTitle((prev) => (prev.trim() ? prev : value));
  }, []);

  const [isGenerating, setIsGenerating] = useState(false);
  /** 對話框打的字交給 compose 中 */
  const [composing, setComposing] = useState(false);
  /** 自己打的題目超過剩餘名額，等老師確認「只會加入前 N 題」 */
  const [pendingAdd, setPendingAdd] = useState<ComposedBatch | null>(null);
  /** 確認框按「加入」時也會觸發關閉；用 ref 分辨是確認還是取消 */
  const pendingAddRef = useRef<ComposedBatch | null>(null);
  /**
   * 等確認框結果的 `handleCompose`：確認＝true（對話框清空），取消＝false（對話框留著
   * 老師的原文，和失敗時一致）
   */
  const pendingAddResolveRef = useRef<((handled: boolean) => void) | null>(
    null,
  );
  /** AI 要改寫題目或情境，等老師確認（修正 C6；確認框結果的處理同 pendingAdd） */
  const [pendingRevise, setPendingRevise] = useState<PendingRevise | null>(
    null,
  );
  const pendingReviseRef = useRef<PendingRevise | null>(null);
  const pendingReviseResolveRef = useRef<((handled: boolean) => void) | null>(
    null,
  );
  /** 非空白題數（流程的「右欄有沒有題目」、剩餘名額都看這個） */
  const keptCount = rows.filter((r) => !isBlankRow(r)).length;
  /** 剩餘名額：AI 出題的題數選項上限 */
  const remaining = Math.max(0, MAX_ITEMS - keptCount);

  // ===== 引導式對話：答案、對話紀錄、情境、出題設定卡 —— 見 useScenarioSetup =====
  const setup = useScenarioSetup({
    initialData,
    programLevel,
    uiLanguage,
    onSuggestedTitle: applySuggestedTitle,
    hasQuestions: keptCount > 0,
    generatingQuestions: isGenerating,
    composing,
  });
  const { imageActions } = setup;
  /** 缺標題存檔時，切到題目那一側並把游標帶到標題欄 */
  const titleRef = useRef<HTMLInputElement>(null);
  /** 右欄情境區：「編輯情境內容」捲過來並打開編輯 */
  const contextRef = useRef<HTMLElement>(null);
  const [editingScenario, setEditingScenario] = useState(false);
  /** 對話（寫情境、擷取、情境圖）、產題、存檔任一進行中 */
  const busy = isGenerating || composing || setup.busy || isSaving;

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
    setEditorBusy(busy);
    return () => setEditorBusy(false);
  }, [busy, setEditorBusy]);

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

  /** 只算真的有輸入題目的列 — 預設那張空白卡不計入 */
  const filledCount = rows.filter((r) => r.question.trim()).length;
  /**
   * 目前 addRow、複製、產題三條路都已經卡在 MAX_ITEMS，所以這個條件實際上不會
   * 成立。刻意留著當最後一道守衛：日後多一條新增題目的路徑（貼上、匯入、
   * 後端回填）忘了設上限時，至少擋在儲存前而不是靜靜地存進超量資料。
   */
  const overLimit = filledCount > MAX_ITEMS;
  const underLimit = filledCount < MIN_ITEMS;

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
          setup.ttsSettings.accent,
          setup.ttsSettings.gender,
          setup.ttsSettings.speed,
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
   * 方向」那一步，顯示重問句（窄版切回「對話」分頁）。
   *
   * 題數＝設定卡的題數，但不超過剩餘名額（＝min(5, 剩餘) 的預設）。產完：第一次產題時
   * 出題設定卡在對話裡變成一句摘要（`markGenerated`），窄版自動切到「題目」分頁。
   */
  const handleGenerate = async () => {
    if (!setup.hasMaterial()) {
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
        ...setup.questionRequestBase(),
        count: effectiveCount(setup.generateCount, room),
        existing_questions: kept.map((r) => r.question.trim()).filter(Boolean),
      });

      if (result.usable === false) {
        setup.reaskDirection(result.reask);
        setTab("chat");
        return;
      }
      setup.clearDirectionReask();
      applySuggestedTitle(result.suggested_title);

      const created = result.questions.map((q) =>
        createRow({
          question: q.question,
          translation: setup.autoTranslate ? q.translation : "",
          keywords: q.keywords,
          referenceAnswer: q.reference_answer,
          imagePrompt: q.image_prompt,
        }),
      );

      // 一定要用最新的 rows 重算：AI 呼叫要等好幾秒，這段期間老師還是可以改題目、刪題、
      // 加題、拖曳排序。用 await 之前算好的 kept 直接覆蓋，會把他等待期間做的事整個吃掉
      // （PR #1023 review）。實際加入哪幾題也由同一份計算決定（修正 C4）：摘要的題數、
      // 自動語音都只算真的放進清單的那幾題。
      const { added } = mergeGenerated(rowsRef.current, created);
      setRows((prev) => mergeGenerated(prev, created).rows);
      setup.markGenerated(added.length);
      setTab("side");
      if (setup.autoTTS) void autoGenerateAudio(added);
    } catch (error) {
      console.error("Failed to generate scenario questions:", error);
      toast.error(t(textAiErrorKey(error)));
    } finally {
      setIsGenerating(false);
    }
  };
  /**
   * 把 compose 的題目寫進清單並記紀錄（直接寫入，或老師確認「只會加入前 N 題」之後）。
   * 實際加入哪幾題用最新的 rows 算（等待或確認期間老師可能又改了清單）。
   */
  const commitComposed = (
    batch: ComposedBatch,
    opts: { dedupe: boolean; audio: boolean },
  ) => {
    const { added } = mergeComposed(
      rowsRef.current,
      batch.created,
      opts.dedupe,
    );
    setRows((prev) => mergeComposed(prev, batch.created, opts.dedupe).rows);
    setup.recordCompose({
      typed: batch.typed,
      atManual: batch.atManual,
      replies: [
        ...batch.replies,
        {
          role: "note",
          text: added.length
            ? t("scenarioDialogue.compose.added", { count: added.length })
            : t("scenarioDialogue.compose.noneAdded"),
        },
      ],
      added: added.length > 0,
    });
    if (added.length) setTab("side");
    if (opts.audio && added.length) void autoGenerateAudio(added);
  };

  /**
   * compose 沒辦法照做的原因（修正 C6）→ 對話裡那一句；一般答非所問（沒有代碼）回空字串，
   * 由呼叫端改用後端的重問句。`count` 是送出時的非空白題數（題號不存在時說「目前共 N 題」）。
   */
  const refusalText = (refusal: string | undefined, count: number) => {
    switch (refusal) {
      case "full":
        return t("scenarioDialogue.compose.full", { max: MAX_ITEMS });
      case "no_questions":
        return t("scenarioDialogue.compose.noQuestionsToRevise");
      case "no_scenario":
        return t("scenarioDialogue.compose.noScenarioToRevise");
      case "revise_out_of_range":
        return t("scenarioDialogue.compose.reviseOutOfRange", { count });
      default:
        return "";
    }
  };

  /**
   * 對話框打字（compose，C 段第 5 段）。回傳 true ＝已處理（對話框清空），false ＝沒處理
   * （已滿、失敗），對話框留著原文讓老師重送。規則見檔頭。
   */
  const handleCompose = async (typed: string): Promise<boolean> => {
    // 送出這一刻在不在「自己打題目」那一步（await 之後的 setup.current 可能是舊的）
    const atManual = setup.current?.id === "manualInput";
    const kept = rowsRef.current.filter((r) => !isBlankRow(r));
    const room = MAX_ITEMS - kept.length;
    // 已滿 10 題不在這裡擋（修正 C6）：老師可能是要修改既有題目或情境，前端分不出來；
    // 判斷出是加題／出題時後端回 refusal "full"（不計次）
    if (typed.trim().length > MAX_COMPOSE_TEXT_CHARS) {
      setup.replyCompose(atManual, t("scenarioDialogue.compose.tooLong"));
      return false;
    }
    const existing = composeExisting(rowsRef.current);

    setComposing(true);
    try {
      const result = await apiClient.composeScenarioQuestions({
        ...setup.questionRequestBase(),
        text: typed,
        existing_questions: existing.map((e) => e.payload),
      });

      if (!result.usable) {
        setup.replyCompose(
          atManual,
          refusalText(result.refusal, existing.length) ||
            result.reask ||
            t("scenarioDialogue.setup.reaskFallback"),
          typed,
        );
        setTab("chat");
        return true;
      }
      // 修改既有題目／情境（修正 C6）：先跳確認框，確認才改；取消時原文放回對話框。
      // 標題建議也等確認才套用（修正 C6b），所以 applySuggestedTitle 放在這段之後
      if (
        result.intent === "revise_questions" ||
        result.intent === "revise_scenario"
      ) {
        const replies: PendingRevise["replies"] = [];
        if ((result.skipped_count ?? 0) > 0) {
          replies.push({
            role: "bot",
            text: t("scenarioDialogue.compose.skipped", {
              count: result.skipped_count,
            }),
          });
        }
        if (result.intent === "revise_questions" && result.output_truncated) {
          replies.push({
            role: "bot",
            text: t("scenarioDialogue.compose.reviseTruncated"),
          });
        }
        // 題號 → 列：用送出當下的清單對（等待期間老師拖曳排序也不會改錯題）
        const idByNumber = new Map(existing.map((e) => [e.number, e.rowId]));
        const revisions = new Map<string, ScenarioComposeRevision>();
        for (const r of result.revisions ?? []) {
          const id = idByNumber.get(r.index);
          if (id && !revisions.has(id)) revisions.set(id, r);
        }
        const pending: PendingRevise = {
          kind: result.intent === "revise_questions" ? "questions" : "scenario",
          typed,
          atManual,
          replies,
          revisions,
          scenarioContent: result.scenario_content ?? "",
          suggestedTitle: result.suggested_title,
        };
        if (
          (pending.kind === "questions" && revisions.size === 0) ||
          (pending.kind === "scenario" && !pending.scenarioContent.trim())
        ) {
          // 後端已經擋過；這裡是保險（例如回來時那幾題已被刪掉）
          setup.replyCompose(
            atManual,
            t(
              pending.kind === "questions"
                ? "scenarioDialogue.compose.noQuestionsToRevise"
                : "scenarioDialogue.compose.noScenarioToRevise",
            ),
            typed,
          );
          return true;
        }
        setComposing(false);
        return new Promise<boolean>((resolve) => {
          pendingReviseResolveRef.current = resolve;
          pendingReviseRef.current = pending;
          setPendingRevise(pending);
        });
      }

      applySuggestedTitle(result.suggested_title);
      const isAdd = result.intent === "add_questions";
      const replies: ComposedBatch["replies"] = [];
      const requested = result.requested_count ?? 0;
      if (!isAdd && requested > room) {
        replies.push({
          role: "bot",
          text: t("scenarioDialogue.compose.requestedOverRoom", {
            count: room,
          }),
        });
      }
      if ((result.skipped_count ?? 0) > 0) {
        replies.push({
          role: "bot",
          text: t("scenarioDialogue.compose.skipped", {
            count: result.skipped_count,
          }),
        });
      }
      // 輸出被截斷時 truncated_count 只算救回的題數，不能只靠它提示
      if (result.output_truncated) {
        replies.push({
          role: "bot",
          text: t("scenarioDialogue.compose.outputTruncated"),
        });
      }

      const created = result.questions.map((q) =>
        createRow({
          question: q.question,
          // 自己打的題目不產翻譯；AI 出題照翻譯開關
          translation: !isAdd && setup.autoTranslate ? q.translation : "",
          keywords: q.keywords,
          referenceAnswer: q.reference_answer,
          imagePrompt: q.image_prompt,
        }),
      );
      const batch: ComposedBatch = { typed, atManual, created, replies };

      if (isAdd) {
        const latestRoom = Math.max(
          0,
          MAX_ITEMS - rowsRef.current.filter((r) => !isBlankRow(r)).length,
        );
        if (created.length > latestRoom) {
          // 超過剩餘名額：先問「只會加入前 N 題」，確認才寫入；等老師按了才決定對話框要不要清空
          setComposing(false);
          return new Promise<boolean>((resolve) => {
            pendingAddResolveRef.current = resolve;
            pendingAddRef.current = batch;
            setPendingAdd(batch);
          });
        }
        commitComposed(batch, { dedupe: false, audio: false });
      } else {
        commitComposed(batch, { dedupe: true, audio: setup.autoTTS });
      }
      return true;
    } catch (error) {
      console.error("Failed to compose scenario questions:", error);
      setup.replyCompose(
        atManual,
        t(composeErrorKey(error), { max: MAX_ITEMS }),
      );
      return false;
    } finally {
      setComposing(false);
    }
  };

  /**
   * 「只會加入前 N 題」確認框：確認＝寫入、對話框清空；取消（含關閉）＝不寫入，紀錄只加一句
   * 「沒有加入題目」（不記老師那句），老師的原文留在對話框 —— 和失敗時一致，改一改可以重送。
   */
  const takePendingAdd = () => {
    const batch = pendingAddRef.current;
    const resolve = pendingAddResolveRef.current;
    pendingAddRef.current = null;
    pendingAddResolveRef.current = null;
    setPendingAdd(null);
    return { batch, resolve };
  };
  const confirmPendingAdd = () => {
    const { batch, resolve } = takePendingAdd();
    if (batch) commitComposed(batch, { dedupe: false, audio: false });
    resolve?.(true);
  };
  const cancelPendingAdd = () => {
    const { batch, resolve } = takePendingAdd();
    if (batch) {
      setup.recordCompose({
        typed: null,
        atManual: batch.atManual,
        replies: [
          { role: "note", text: t("scenarioDialogue.compose.noneAdded") },
        ],
        added: false,
      });
    }
    resolve?.(false);
  };

  /**
   * 改寫確認框（修正 C6）。確認＝改寫、對話框清空；取消（含關閉）＝不改，紀錄只加一句
   * 「沒有修改…」，老師的原文留在對話框（同「只會加入前 N 題」取消的作法）。
   *
   * 改寫題目：用最新的 rows（functional setRows）依列 id 原地替換，題號位置、題目圖不動；
   * 等待確認期間被刪掉的題目就跳過。題目文字變了的題，原本有語音或「AI 生成語音」開著時
   * 重新產生語音（只對這幾題）；翻譯依翻譯開關（見 `reviseRow`）。
   * 改寫情境：只換情境文章，右欄情境區即時更新；情境圖不動。紀錄多一句提示題目和情境圖
   * 沒有跟著改（修正 C6b）。AI 的標題建議在確認時才套用，取消不套用。
   */
  const takePendingRevise = () => {
    const pending = pendingReviseRef.current;
    const resolve = pendingReviseResolveRef.current;
    pendingReviseRef.current = null;
    pendingReviseResolveRef.current = null;
    setPendingRevise(null);
    return { pending, resolve };
  };
  const confirmPendingRevise = () => {
    const { pending, resolve } = takePendingRevise();
    if (!pending) {
      resolve?.(false);
      return;
    }
    let note: string;
    const after: PendingRevise["replies"] = [];
    applySuggestedTitle(pending.suggestedTitle);
    if (pending.kind === "questions") {
      const autoTranslate = setup.autoTranslate;
      const before = rowsRef.current;
      const revised = before
        .filter((r) => pending.revisions.has(r.id))
        .map((r) => ({
          old: r,
          next: reviseRow(
            r,
            pending.revisions.get(r.id) as ScenarioComposeRevision,
            autoTranslate,
          ),
        }));
      setRows((prev) =>
        prev.map((r) => {
          const rev = pending.revisions.get(r.id);
          return rev ? reviseRow(r, rev, autoTranslate) : r;
        }),
      );
      note = t("scenarioDialogue.compose.revisedQuestions", {
        count: revised.length,
      });
      const audioTargets = revised
        .filter(
          ({ old, next }) =>
            next.question.trim() !== old.question.trim() &&
            (!!old.audioUrl || setup.autoTTS),
        )
        .map(({ next }) => next);
      if (revised.length) setTab("side");
      if (audioTargets.length) void autoGenerateAudio(audioTargets);
    } else {
      setup.setScenarioContent(pending.scenarioContent);
      note = t("scenarioDialogue.compose.revisedScenario");
      after.push({
        role: "bot",
        text: t("scenarioDialogue.compose.revisedScenarioHint"),
      });
      setTab("side");
    }
    setup.recordCompose({
      typed: pending.typed,
      atManual: pending.atManual,
      replies: [...pending.replies, { role: "note", text: note }, ...after],
      added: false,
    });
    resolve?.(true);
  };
  const cancelPendingRevise = () => {
    const { pending, resolve } = takePendingRevise();
    if (pending) {
      setup.recordCompose({
        typed: null,
        atManual: pending.atManual,
        replies: [
          {
            role: "note",
            text: t(
              pending.kind === "questions"
                ? "scenarioDialogue.compose.reviseQuestionsCancelled"
                : "scenarioDialogue.compose.reviseScenarioCancelled",
            ),
          },
        ],
        added: false,
      });
    }
    resolve?.(false);
  };

  /**
   * 單題重新生成（Issue #1021 起改為真的呼叫後端）。
   *
   * 只要 1 題 —— #864 的「一份 3~10 題」是存檔時的規則，不是單次生成的規則，所以
   * 後端的產題端點下限是 1。清單上其他題目一併送出當作「不要重複這些」。
   */
  const regenerateRow = async (id: string) => {
    if (!setup.hasMaterial()) {
      toast.error(t("scenarioDialogue.setup.materialRequired"));
      return;
    }
    setRegeneratingId(id);
    try {
      const result = await apiClient.generateScenarioQuestions({
        ...setup.questionRequestBase(),
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
                translation: setup.autoTranslate ? fresh.translation : "",
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
   * 逐題 AI 生圖（Issue #1024；#1158 起改成先開「AI 生圖」對話框）。
   *
   * 對話框預填該題的 `imagePrompt`（產題時 AI 一併擬好的描述）；老師沒產過題、自己打的
   * 題目沒有這個值，就退回題目本文。這裡收到的是老師確認過的描述。
   *
   * 失敗時把原本的錯誤往上丟，由對話框依狀態碼顯示原因（402／409／422／其他），
   * 老師不用重打描述。
   *
   * 保險（#1158 修正 B1）：生成中對話框關不掉，老師照理沒辦法同時換圖；但寫入前仍用
   * functional setRows 比對該列「目前」的圖 —— 若和開始生成時不同（老師已換了別張），
   * 就不覆蓋，改提示老師 AI 圖沒有放上去；該列已被刪除也直接略過。
   */
  const generateRowImage = async (id: string, description: string) => {
    // #1044: 旗標關閉時這裡也擋一次 —— 「只靠 UI 藏起來」是會漏的：哪天多一個入口
    // 忘了查旗標，就會真的打生圖。白名單的教訓同 #1030（review R3 第 1 點）。
    if (!FEATURE_FLAGS.SCENARIO_IMAGE_GENERATION) return;
    const startRow = rows.find((r) => r.id === id);
    if (!startRow) return;
    const imageBefore = startRow.imageUrl ?? null;

    setImageLoadingId(id);
    try {
      const { image_url } = await apiClient.generateScenarioImage({
        kind: "question",
        description,
      });
      // 用最新的 rows 判斷（這段 closure 的 rows 是開始生成時的舊值）
      const latest = rowsRef.current;
      const current = latest.find((r) => r.id === id);
      if (!current) return;
      if ((current.imageUrl ?? null) !== imageBefore) {
        toast.info(t("scenarioDialogue.imageGen.imageReplacedDuringGenerate"));
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === id && (r.imageUrl ?? null) === imageBefore
            ? { ...r, imageUrl: image_url }
            : r,
        ),
      );
      // 換掉舊圖後釋放 blob（手動上傳的預覽是 blob:），否則會一路累積不釋放；
      // 複製過的題目會共用同一個網址，別列還在用就不釋放
      if (
        imageBefore &&
        imageBefore !== image_url &&
        !latest.some((r) => r.id !== id && r.imageUrl === imageBefore)
      ) {
        releasePreviewUrl(imageBefore);
      }
    } finally {
      setImageLoadingId(null);
    }
  };

  const imageDialogRow =
    imageDialogRowId !== null
      ? (rows.find((r) => r.id === imageDialogRowId) ?? null)
      : null;

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
   * 擋關時把老師帶到問題所在：缺什麼就切到題目那一側（窄版切到「題目」分頁），
   * 只跳 toast 卻停在別的分頁等於叫他自己去找問題在哪。
   *
   * 缺標題（#1146）：游標帶到標題欄。
   */
  const handleSave = async () => {
    if (!title.trim()) {
      setTab("side");
      toast.error(t("contentEditor.messages.enterTitle"));
      // 等分頁切過去再聚焦（窄版時標題欄這一刻還藏著）
      window.setTimeout(() => titleRef.current?.focus(), 0);
      return;
    }
    if (underLimit) {
      setTab("side");
      toast.error(
        t("contentEditor.messages.addAtLeastNItems", { limit: MIN_ITEMS }),
      );
      return;
    }
    if (overLimit) {
      setTab("side");
      toast.error(t("scenarioDialogue.hints.maxReached", { max: MAX_ITEMS }));
      return;
    }
    await onSave?.({ title, rows, ...setup.saveFields() });
  };

  useImperativeHandle(ref, () => ({
    // 兩種生成都要算 busy —— 只看 isGenerating 的話，老師在情境內容還在
    // 生成時就能按儲存，存進去的是那一刻的舊值。真 API 更慢，更容易中招。
    // 存檔中同樣要擋，避免重複送出（#1013）。
    isBusy: busy,
    save: handleSave,
  }));

  /** 「編輯情境內容」（情境標籤小框）：切到題目那一側、打開情境區編輯並捲過去 */
  const editScenario = () => {
    setEditingScenario(true);
    setTab("side");
    // 等窄版分頁切過去（情境區這一刻可能還藏著）再捲
    window.setTimeout(
      () => contextRef.current?.scrollIntoView?.({ block: "start" }),
      0,
    );
  };

  /** 出題設定卡的欄位（對話裡的出題設定卡、「設定」標籤小框共用） */
  const settingsFields = {
    questionLevel: setup.questionLevel,
    onQuestionLevelChange: setup.setQuestionLevel,
    count: setup.generateCount,
    onCountChange: setup.setGenerateCount,
    globalTense: setup.globalTense,
    onGlobalTenseChange: setup.setGlobalTense,
    globalVoice: setup.globalVoice,
    onGlobalVoiceChange: setup.setGlobalVoice,
    autoTranslate: setup.autoTranslate,
    onAutoTranslateChange: setup.setAutoTranslate,
    translateLang: setup.translateLang,
    onTranslateLangChange: setup.setTranslateLang,
    customLang: setup.customLang,
    onCustomLangChange: setup.setCustomLang,
    autoTTS: setup.autoTTS,
    onAutoTTSChange: setup.setAutoTTS,
    ttsSettings: setup.ttsSettings,
    onTTSSettingsChange: setup.setTTSSettings,
    globalRubric: setup.globalRubric,
    onGlobalRubricChange: setup.setGlobalRubric,
  };

  /** 情境確認過（固定在右欄）才顯示情境區 */
  const contextMode =
    (setup.answers.mode === "existing" || setup.answers.mode === "ai") &&
    setup.answers.scenario === true
      ? setup.answers.mode
      : null;

  // 情境區消失（改成「不需要情境」或情境被清掉）時，編輯狀態一併收掉 —— 不然之後情境
  // 再出現時會直接開在編輯模式（修正 C4）
  useEffect(() => {
    if (contextMode === null) setEditingScenario(false);
  }, [contextMode]);

  const maxReached = t("scenarioDialogue.hints.maxReached", { max: MAX_ITEMS });

  return (
    /*
      版面（#1158 C commit 4）：同頁外框 GuidedChatLayout 撐滿 sheet 的剩餘高度。
      左欄＝ScenarioSetupChat（已選項目列＋對話捲動區＋底部對話框），右欄＝題目捲動區。
      右側工具列留白由外框加，捲動區自己不再留（ScenarioSheetLayout）。
      外框（ScenarioDialogueEditorSheet）不捲動、也不加內距，交給這裡。
    */
    <div className="flex min-h-0 flex-1 flex-col">
      <GuidedChatLayout
        tab={tab}
        onTabChange={setTab}
        sideCount={keptCount}
        chat={
          <ScenarioSetupChat
            setup={setup}
            remaining={remaining}
            generating={isGenerating}
            onGenerate={() => void handleGenerate()}
            onEditScenario={editScenario}
            onComposeSubmit={handleCompose}
            settingsCard={
              <QuestionSettingsCard {...settingsFields} maxCount={remaining} />
            }
            settingsPopover={
              <QuestionSettingsCard {...settingsFields} showCount={false} />
            }
          />
        }
        side={({ sideWidth }) => (
          <ScenarioScrollArea testId="scenario-question-list">
            {/*
              標題（#1146）：AI 寫情境或出題時已先填好建議，老師在這裡改。
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

            {/* 情境區：情境確認後固定在題目上方，可收合、原地編輯 */}
            {contextMode && (
              <div className="mb-3">
                <ScenarioReferenceAside
                  ref={contextRef}
                  mode={contextMode}
                  scenarioContent={setup.scenarioContent}
                  onScenarioContentChange={setup.setScenarioContent}
                  imageActions={imageActions}
                  goal={setup.goal}
                  onGoalChange={setup.setGoal}
                  articleLevel={setup.articleLevel}
                  onArticleLevelChange={setup.setArticleLevel}
                  onRewrite={() =>
                    void setup.generateArticle(setup.goal, "rewrite")
                  }
                  rewriting={setup.generatingArticle}
                  busy={setup.busy}
                  editing={editingScenario}
                  onEditingChange={setEditingScenario}
                />
              </div>
            )}

            {rows.length === 0 ? (
              <p
                data-testid="scenario-questions-empty"
                className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400"
              >
                {t("scenarioDialogue.hints.questionsEmpty")}
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={rows.map((r) => r.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-3">
                    {rows.map((row, index) => (
                      <SortableRow
                        key={`${row.id}:${row.revision}`}
                        row={row}
                        index={index}
                        // 依右欄實際寬度（不看 viewport）：卡片寬不到約 552px 就用窄版排法
                        compact={
                          sideWidth !== null && sideWidth < COMPACT_SIDE_WIDTH
                        }
                        langLabel={setup.langLabel}
                        hasLanguage={setup.hasLanguage}
                        globalTense={setup.globalTense}
                        globalVoice={setup.globalVoice}
                        // 沒有題目時有空狀態，最後一題也可以刪
                        canDelete
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
                        duplicateBlockedReason={
                          rows.length >= MAX_ITEMS ? maxReached : null
                        }
                        onDelete={() => deleteRow(row.id)}
                        onRegenerate={() => regenerateRow(row.id)}
                        onPickImage={(file) => pickRowImage(row.id, file)}
                        onRemoveImage={() => removeRowImage(row.id)}
                        onGenerateImage={() => setImageDialogRowId(row.id)}
                        onGenerateAudio={() => setAudioDialogRowId(row.id)}
                        onPlayAudio={() => playRowAudio(row.id)}
                        audioLoading={audioLoadingId === row.id}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            <button
              type="button"
              onClick={addRow}
              disabled={rows.length >= MAX_ITEMS}
              className="mt-3 w-full py-2 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 flex items-center justify-center gap-2 text-gray-600 hover:text-blue-600 disabled:opacity-50 disabled:hover:border-gray-300 disabled:hover:text-gray-600"
            >
              <Plus className="h-5 w-5" />
              {rows.length >= MAX_ITEMS
                ? maxReached
                : t("scenarioDialogue.buttons.addQuestion")}
            </button>

            {/* 題目計數：對著題目看才有意義，所以跟著清單走 */}
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
          </ScenarioScrollArea>
        )}
      />

      {/* 單題 AI 生圖（#1158）：描述預填 imagePrompt，沒有就用題目本文 */}
      <AiImageGenerateDialog
        open={imageDialogRow !== null}
        onOpenChange={(open) => {
          if (!open) setImageDialogRowId(null);
        }}
        kind="question"
        initialDescription={
          imageDialogRow
            ? (imageDialogRow.imagePrompt || imageDialogRow.question).trim()
            : ""
        }
        onGenerate={(description) => {
          const id = imageDialogRowId;
          return id ? generateRowImage(id, description) : Promise.resolve();
        }}
      />

      {/* 自己打的題目超過剩餘名額：先確認「只會加入前 N 題」（C 段第 5 段） */}
      <ConfirmDialog
        open={pendingAdd !== null}
        onOpenChange={(open) => {
          if (!open) cancelPendingAdd();
        }}
        title={t("scenarioDialogue.compose.overLimitTitle")}
        description={t("scenarioDialogue.compose.overLimitDescription", {
          count: remaining,
          max: MAX_ITEMS,
        })}
        confirmText={t("scenarioDialogue.compose.overLimitConfirm")}
        cancelText={t("contentEditor.buttons.cancel")}
        onConfirm={confirmPendingAdd}
      />

      {/* AI 要改寫既有題目或情境文章：先確認，確認才替換（修正 C6） */}
      <ConfirmDialog
        open={pendingRevise !== null}
        onOpenChange={(open) => {
          if (!open) cancelPendingRevise();
        }}
        title={t(
          pendingRevise?.kind === "scenario"
            ? "scenarioDialogue.compose.reviseScenarioTitle"
            : "scenarioDialogue.compose.reviseQuestionsTitle",
        )}
        description={
          pendingRevise?.kind === "scenario"
            ? t("scenarioDialogue.compose.reviseScenarioDescription")
            : t("scenarioDialogue.compose.reviseQuestionsDescription", {
                count: pendingRevise?.revisions.size ?? 0,
              })
        }
        confirmText={t("scenarioDialogue.compose.reviseConfirm")}
        cancelText={t("contentEditor.buttons.cancel")}
        onConfirm={confirmPendingRevise}
      />

      {/* 單題語音設定（Issue #1051） */}
      <TTSSettingsDialog
        open={audioDialogRowId !== null}
        onOpenChange={(open) => {
          if (!open) setAudioDialogRowId(null);
        }}
        initialSettings={
          (audioDialogRowId !== null && rowTTSSettings[audioDialogRowId]) ||
          setup.ttsSettings
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
