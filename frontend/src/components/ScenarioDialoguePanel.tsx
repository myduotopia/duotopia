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
 *   對話的 state 與動作（已答步驟、情境、出題設定卡、AI 寫情境、上傳擷取）在
 *   `useScenarioSetup`；面板只留題目清單、標題、產題與存檔（#1146 review 6）。
 *
 * - 題目卡（`SortableRow`）與左欄對照（`ScenarioReferenceAside`）各自一個檔案，
 *   都在 `components/scenario-dialogue-editor/`。
 *
 * - **題目清單**（Step 2）—— 左右兩欄：
 *   - 左欄 280px（sticky）是對話結果的**唯讀對照**：情境內容、情境圖、作答指引、整體
 *     評分標準，外加「回對話修改」。
 *   - 右欄最上面是**標題**（AI 寫情境或出題時建議，老師可改），其下是可拖曳排序的
 *     題目卡、新增題目、題數計數。題數滿 10 題時新增鍵與每張卡的
 *     複製鍵都停用並說明上限（`hints.maxReached`）。
 *   - 「上一步：回到對話」（與手機的取消）在固定於 sheet 底端的操作列。
 *
 * - **版面**（修正第 4 輪）：兩個畫面都是「捲動區＋固定在 sheet 底端的操作列」
 *   （`ScenarioSheetLayout`），操作列位置一致、不隨內容捲動；對話內容從上往下排。
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
import { ArrowLeft, Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { useSidebar } from "@/contexts/SidebarContext";
import { Button } from "@/components/ui/button";
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
import { apiClient } from "@/lib/api";
import { getVoiceAndRate } from "@/utils/ttsVoiceResolver";
import {
  createScenarioRow as createRow,
  nextRowId,
  type ScenarioDialogueInitialState,
  type ScenarioDialogueRow,
  type ScenarioSaveInput,
} from "@/lib/scenarioDialogue";
import {
  MAX_ITEMS,
  MIN_ITEMS,
} from "@/components/scenario-dialogue-editor/constants";
import { QuestionSettingsCard } from "@/components/scenario-dialogue-editor/QuestionSettingsCard";
import { ScenarioSetupChat } from "@/components/scenario-dialogue-editor/ScenarioSetupChat";
import { ScenarioReferenceAside } from "@/components/scenario-dialogue-editor/ScenarioReferenceAside";
import {
  ScenarioActionBar,
  ScenarioScrollArea,
} from "@/components/scenario-dialogue-editor/ScenarioSheetLayout";
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

  // ===== 引導式對話（#1146）：已答步驟、情境、出題設定卡 —— 見 useScenarioSetup =====
  const setup = useScenarioSetup({
    initialData,
    programLevel,
    uiLanguage,
    onSuggestedTitle: applySuggestedTitle,
  });
  const { imageActions } = setup;
  const [isGenerating, setIsGenerating] = useState(false);
  /** 缺標題存檔時，留在題目清單並把游標帶到標題欄 */
  const titleRef = useRef<HTMLInputElement>(null);
  /** 對話（寫情境、擷取、情境圖）、產題、存檔任一進行中 */
  const busy = isGenerating || setup.busy || isSaving;

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

  /** 已經有題目了：對話裡多一顆「查看題目清單」，設定卡的主按鈕改成「再產一批」 */
  const hasQuestions = filledCount > 0;

  // 素材沒填不在這裡擋 —— 按下去要看到「請先提供情境或出題方向」的提示，
  // 而不是一顆沒說明理由的灰色按鈕
  const generateDisabled =
    isGenerating || setup.generatingArticle || filledCount >= MAX_ITEMS;

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
   * 方向」那一步，顯示重問句。
   *
   * `advance` 為 true 時產完直接翻到題目清單。
   */
  const handleGenerate = async (advance = false) => {
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
        count: Math.min(setup.generateCount, room),
        existing_questions: kept.map((r) => r.question.trim()).filter(Boolean),
      });

      if (result.usable === false) {
        setup.reaskDirection(result.reask);
        setStep(1);
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
      if (setup.autoTTS) void autoGenerateAudio(created);
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

  /** 進題目清單：至少留一張空白卡可以打字 */
  const goToList = () => {
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
   * 逐題 AI 生圖（Issue #1024；#1158 起改成先開「AI 生圖」對話框）。
   *
   * 對話框預填該題的 `imagePrompt`（產題時 AI 一併擬好的描述）；老師沒產過題、自己打的
   * 題目沒有這個值，就退回題目本文。這裡收到的是老師確認過的描述。
   *
   * 失敗時把原本的錯誤往上丟，由對話框依狀態碼顯示原因（402／409／422／其他），
   * 老師不用重打描述。
   */
  const generateRowImage = async (id: string, description: string) => {
    // #1044: 旗標關閉時這裡也擋一次 —— 「只靠 UI 藏起來」是會漏的：哪天多一個入口
    // 忘了查旗標，就會真的打生圖。白名單的教訓同 #1030（review R3 第 1 點）。
    if (!FEATURE_FLAGS.SCENARIO_IMAGE_GENERATION) return;
    if (!rows.some((r) => r.id === id)) return;

    setImageLoadingId(id);
    try {
      const { image_url } = await apiClient.generateScenarioImage({
        kind: "question",
        description,
      });
      // 換掉舊圖前先釋放 blob（手動上傳的預覽是 blob:），否則會一路累積不釋放
      setRowImage(id, image_url);
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
    await onSave?.({ title, rows, ...setup.saveFields() });
  };

  useImperativeHandle(ref, () => ({
    // 兩種生成都要算 busy —— 只看 isGenerating 的話，老師在情境內容還在
    // 生成時就能按儲存，存進去的是那一刻的舊值。真 API 更慢，更容易中招。
    // 存檔中同樣要擋，避免重複送出（#1013）。
    isBusy: busy,
    save: handleSave,
  }));

  return (
    /*
      版面（#1146 修正第 4 輪）：面板撐滿 sheet 的剩餘高度，兩個畫面都是
      「捲動區（ScenarioScrollArea）＋固定在底端的操作列（ScenarioActionBar）」，
      操作列是捲動區的 flex 兄弟，捲動區高度本來就扣掉了它，最後的內容不會被蓋住。
      右側工具列留白、手機鍵盤的欄位捲動都在 ScenarioSheetLayout。
      外框（ScenarioDialogueEditorSheet）不再捲動、也不加內距，交給這裡。
    */
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ===== 引導式對話（#1146，取代舊的 Step 1 設定頁）===== */}
      {step === 1 && (
        <ScenarioSetupChat
          answers={setup.answers}
          onReopen={setup.reopen}
          onChooseMode={setup.chooseMode}
          wouldClearScenario={setup.wouldClearScenario}
          onChooseSource={(source) => {
            setup.chooseSource(source);
            if (source === "manual") goToList();
          }}
          onScenarioDone={setup.markScenarioDone}
          onDirectionDone={setup.markDirectionDone}
          scenarioContent={setup.scenarioContent}
          onScenarioContentChange={setup.setScenarioContent}
          goal={setup.goal}
          onGoalChange={setup.setGoal}
          articleLevel={setup.articleLevel}
          onArticleLevelChange={setup.setArticleLevel}
          direction={setup.direction}
          onDirectionChange={setup.setDirection}
          goalReask={setup.goalReask}
          directionReask={setup.directionReask}
          imageActions={imageActions}
          generatingArticle={setup.generatingArticle}
          extracting={setup.extracting}
          onGenerateArticle={() => void setup.generateArticle()}
          onExtractFiles={(files) => void setup.extractFiles(files)}
          hasQuestions={hasQuestions}
          onViewList={goToList}
          settingsCard={
            <QuestionSettingsCard
              questionLevel={setup.questionLevel}
              onQuestionLevelChange={setup.setQuestionLevel}
              count={setup.generateCount}
              onCountChange={setup.setGenerateCount}
              globalTense={setup.globalTense}
              onGlobalTenseChange={setup.setGlobalTense}
              globalVoice={setup.globalVoice}
              onGlobalVoiceChange={setup.setGlobalVoice}
              autoTranslate={setup.autoTranslate}
              onAutoTranslateChange={setup.setAutoTranslate}
              translateLang={setup.translateLang}
              onTranslateLangChange={setup.setTranslateLang}
              customLang={setup.customLang}
              onCustomLangChange={setup.setCustomLang}
              autoTTS={setup.autoTTS}
              onAutoTTSChange={setup.setAutoTTS}
              ttsSettings={setup.ttsSettings}
              onTTSSettingsChange={setup.setTTSSettings}
              globalRubric={setup.globalRubric}
              onGlobalRubricChange={setup.setGlobalRubric}
            />
          }
          generating={isGenerating}
          generateBlockedReason={
            filledCount >= MAX_ITEMS
              ? t("scenarioDialogue.hints.maxReached", { max: MAX_ITEMS })
              : null
          }
          onGenerate={() => void handleGenerate(true)}
        />
      )}

      {/* ===== Step 2：題目清單 ===== */}
      {step === 2 && (
        <>
          <ScenarioScrollArea>
            <div className="min-w-0 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
              {/* 左欄：對話結果的唯讀對照，讓老師邊看情境與作答指引邊確認題目 */}
              <ScenarioReferenceAside
                scenarioContent={setup.scenarioContent}
                imageActions={imageActions}
                globalRubric={setup.globalRubric}
                globalTense={setup.globalTense}
                globalVoice={setup.globalVoice}
                onEditSettings={() => setStep(1)}
              />

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
                          langLabel={setup.langLabel}
                          hasLanguage={setup.hasLanguage}
                          globalTense={setup.globalTense}
                          globalVoice={setup.globalVoice}
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
                          duplicateBlockedReason={
                            rows.length >= MAX_ITEMS
                              ? t("scenarioDialogue.hints.maxReached", {
                                  max: MAX_ITEMS,
                                })
                              : null
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
              </div>
            </div>
          </ScenarioScrollArea>

          {/* 固定在 sheet 最底端的操作列，位置與引導式對話一致（第 4 輪） */}
          <ScenarioActionBar
            left={
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("scenarioDialogue.buttons.backToSettings")}
              </Button>
            }
            right={
              onCancel && (
                <Button
                  variant="outline"
                  className="md:hidden"
                  onClick={onCancel}
                >
                  {t("contentEditor.buttons.cancel")}
                </Button>
              )
            }
          />
        </>
      )}

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
