/**
 * 引導式對話的 state 與動作（Issue #1146 review 6，從 `ScenarioDialoguePanel.tsx` 抽出；
 * #1158 C commit 4 改接通用流程引擎）。
 *
 * 管的是「對話裡回答的東西」：答案（`ScenarioAnswers`，`Record<stepId, value>`）、對話紀錄
 * （log）、情境（文章＋情境圖）、訓練目標／文章難度、出題方向、答非所問的重問句，以及出題
 * 設定卡的每一項。題目清單（rows）、標題、存檔仍由面板持有 —— 面板把「右欄有沒有題目」
 * 「是不是正在產題」傳進來（流程的 context 要用），AI 的標題建議透過 `onSuggestedTitle` 回報。
 *
 * 流程本身（有哪些步驟、什麼時候出現、答了沒、改答案要清掉什麼、要不要先確認）在
 * `scenarioSteps.ts`（步驟設定）＋`components/shared/guided-chat/flowEngine.ts`（通用引擎）；
 * 這個 hook 負責把老師的選擇套到 state 上、寫對話紀錄，並打「AI 寫情境」與「上傳擷取」兩支 API。
 *
 * ## 對話紀錄（log）
 * 對話裡已經過去的泡泡另存一份 log，不從答案即時推導：
 * - 在對話裡第一次回答某一步：往下加「問句＋老師的回答」（`answerInChat` 等）。
 * - 在已選項目列改答案：前面的紀錄不動，只往下加一句「已把○○改成：…」（`changeFromChip`）。
 * - 卡片步驟（情境卡、出題設定卡）確認後，卡片本身不留在對話裡，只留一句摘要（舊卡片唯讀）。
 * - 編輯既有內容：由已存資料還原答案（`scenarioAnswersFromSaved`），再用 `summaryLog` 拼出摘要。
 * - 對話框交給 compose（#1158 C 段第 5 段）：結果回來才寫紀錄（`recordCompose`）——「自己打
 *   題目」那一步連問句一起記，題目已產生後只記老師的話；接著是機器人的回覆（略過幾段、只剩
 *   幾個空位、已加入幾題…）。全部無關時重問句放在「自己打題目」問句的位置（`manualReask`，
 *   同訓練目標的作法）；題目已產生後則往下加一個機器人泡泡。
 * 目前這一步的問句與輸入 UI 不在 log 裡，由 `ScenarioSetupChat` 依 `activeStep` 畫在最後。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";
import {
  activeStep,
  appendChange,
  appendLog,
  applyAnswer,
  clearAnswers,
  composerState,
  confirmForChange,
  findStep,
  summaryLog,
  text,
  type ChangeCheck,
  type FlowLogEntry,
  type TextRef,
} from "@/components/shared/guided-chat/flowEngine";
import { apiClient, ApiError } from "@/lib/api";
import {
  EMPTY_TENSE,
  fromStoredTranslateLanguage,
  toStoredTranslateLanguage,
  type ScenarioDialogueInitialState,
  type TenseSetting,
} from "@/lib/scenarioDialogue";
import {
  CEFR_LEVELS,
  DEFAULT_GENERATE_COUNT,
  TRANSLATION_LANGUAGES,
} from "./constants";
import { imagesFromUrls, type ScenarioImage } from "./scenarioImages";
import {
  SCENARIO_FLOW,
  scenarioAnswersFromSaved,
  type QuestionSource,
  type ScenarioAnswers,
  type ScenarioFlowContext,
  type ScenarioMode,
  type ScenarioStepId,
} from "./scenarioSteps";
import { useScenarioImages } from "./useScenarioImages";

/**
 * 文字 AI 的失敗提示（Issue #1025）。
 *
 * 402（本月額度用完）要與一般失敗分開講：老師可能已經填好半份設定，
 * 給他一句「稍後再試」等於叫他白等 —— 這個月不會再成功。所以明講額度用完、
 * 下個月自動重置、現在可以改用手動輸入（面板上填過的東西都還在）。
 *
 * 用 status 判斷，**不要比對 message 字串**：ApiError 的 message 是後端 detail 裡的
 * 那句中文，不含 "402" 也不含錯誤碼（見 api.ts 的 ApiError constructor）。
 */
export function textAiErrorKey(error: unknown): string {
  if (error instanceof ApiError && error.status === 402) {
    return "scenarioDialogue.messages.textQuotaExceeded";
  }
  return "scenarioDialogue.messages.generateFailed";
}

const DEFAULT_TTS: TTSSettingsState = {
  accent: "Random",
  gender: "Random",
  speed: "Normal x1",
};

const P = "scenarioDialogue.setup";

export interface UseScenarioSetupOptions {
  initialData?: ScenarioDialogueInitialState | null;
  programLevel?: string;
  /** 答非所問的重問句與 AI 標題建議用老師的介面語言 */
  uiLanguage: string;
  /** AI 回了標題建議（寫情境、擷取）。面板決定要不要填（只在標題空白時填） */
  onSuggestedTitle: (suggested?: string) => void;
  /** 右欄有任一非空白題（「來源」標籤與能不能改來源看這個） */
  hasQuestions: boolean;
  /** 面板正在產題（出題設定卡顯示產生中、對話框停用） */
  generatingQuestions: boolean;
  /** 面板正在把對話框的字交給 compose（對話框、已選項目列停用） */
  composing?: boolean;
}

export function useScenarioSetup({
  initialData,
  programLevel,
  uiLanguage,
  onSuggestedTitle,
  hasQuestions,
  generatingQuestions,
  composing = false,
}: UseScenarioSetupOptions) {
  const { t } = useTranslation();

  // ===== 情境（對話中的情境卡、右欄情境區）=====
  /**
   * 情境內容 —— 貼上、上傳擷取、AI 寫三種來源共同的產物。空的時候仍然可以儲存；
   * AI 出題時改用情境圖或出題方向當素材。
   */
  const [scenarioContent, setScenarioContent] = useState(
    initialData?.scenarioContent ?? "",
  );
  /** 情境圖（最多 5 張，學生看得到）。已存的只有網址、沒有原圖可重裁 */
  const [scenarioImages, setScenarioImages] = useState<ScenarioImage[]>(() =>
    imagesFromUrls(initialData?.scenarioImages),
  );
  const imageActions = useScenarioImages(scenarioImages, setScenarioImages);

  /** 訓練目標：AI 生成情境文章時的 prompt（右欄情境區編輯時也改這個） */
  const [goal, setGoal] = useState(initialData?.goal ?? "");
  /** 文章難度：只影響 AI 生成出來的情境文章寫多難 */
  const [articleLevel, setArticleLevel] = useState(
    initialData?.articleLevel || programLevel || "A1",
  );
  /** 無情境時「想問的方向」—— 取代情境當 AI 出題依據 */
  const [direction, setDirection] = useState(initialData?.direction ?? "");
  /** 答非所問時 AI 回的重問句（同一次呼叫判斷，不額外打 AI）；顯示在那一步的問句位置 */
  const [goalReask, setGoalReask] = useState("");
  const [directionReask, setDirectionReask] = useState("");
  /** 「自己打題目」那一步 compose 判斷全部無關（或失敗）時，顯示在問句位置的那一句 */
  const [manualReask, setManualReask] = useState("");
  /** 生成情境內容與產題是兩件事，loading 各自獨立 */
  const [generatingArticle, setGeneratingArticle] = useState(false);
  /** 上傳圖片／PDF 擷取情境文章中 */
  const [extracting, setExtracting] = useState(false);

  const hasScenarioMaterial =
    !!scenarioContent.trim() || scenarioImages.length > 0;

  // ===== 答案與對話紀錄 =====
  /**
   * 編輯既有內容時由已存資料還原；新建時從 `{}` 開始（不要對空白新內容呼叫
   * `scenarioAnswersFromSaved`，見那支的說明）。
   */
  const [answers, setAnswers] = useState<ScenarioAnswers>(() =>
    initialData?.rows?.length
      ? scenarioAnswersFromSaved({
          scenarioMode: initialData.scenarioMode ?? "",
          questionSource: initialData.questionSource ?? "",
          goal: initialData.goal ?? "",
          direction: initialData.direction ?? "",
          hasScenario:
            !!(initialData.scenarioContent ?? "").trim() ||
            (initialData.scenarioImages ?? []).length > 0,
          hasQuestions: initialData.rows.some((r) => !!r.question.trim()),
        })
      : {},
  );
  // ===== 流程 context（答案以外、會影響流程的外部事實）=====
  const baseCtx: ScenarioFlowContext = {
    hasQuestions,
    hasScenarioMaterial,
    scenarioChars: scenarioContent.trim().length,
    imageCount: scenarioImages.length,
    articleLevel,
    pending: null,
    failed: null,
  };
  /**
   * compose 進行中掛在哪一步：「自己打題目」那一步就是 `manualInput`，題目已產生後是 `done`
   * （引擎據此讓對話框停用、灰字換成產生中）。
   */
  const composingAt = (): ScenarioFlowContext["pending"] =>
    activeStep(SCENARIO_FLOW, answers, baseCtx)?.id === "manualInput"
      ? "manualInput"
      : "done";
  const pending: ScenarioFlowContext["pending"] = generatingArticle
    ? "goal"
    : extracting
      ? "scenario"
      : generatingQuestions
        ? "settings"
        : composing
          ? composingAt()
          : null;
  const ctx: ScenarioFlowContext = { ...baseCtx, pending };

  const [log, setLog] = useState<FlowLogEntry[]>(() =>
    initialData?.rows?.length ? summaryLog(SCENARIO_FLOW, answers, ctx) : [],
  );
  /** 最新一次 render 的答案，給 await 之後的非同步流程判斷用（擷取回來時再看情境方式） */
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const current = activeStep(SCENARIO_FLOW, answers, ctx);
  const composer = composerState(SCENARIO_FLOW, answers, ctx);

  /** 這一步的問句（寫進紀錄用；跟畫面上目前那一步的問句同一句） */
  const questionOf = (stepId: ScenarioStepId, a = answers): TextRef =>
    findStep(SCENARIO_FLOW, stepId).question(a, ctx);

  /** 往紀錄加「問句＋老師的回答」 */
  const logAnswer = (
    stepId: ScenarioStepId,
    answer: TextRef | string,
    a = answers,
  ) =>
    setLog((prev) =>
      appendLog(
        appendLog(prev, { role: "bot", stepId, text: questionOf(stepId, a) }),
        { role: "teacher", stepId, text: answer },
      ),
    );

  /** 某一步被清掉時，連帶清掉它在面板上的資料（情境文章、情境圖、訓練目標、出題方向） */
  const clearStepData = (cleared: readonly ScenarioStepId[]) => {
    if (cleared.includes("direction")) {
      setDirection("");
      setDirectionReask("");
    }
    if (cleared.includes("goal")) {
      setGoal("");
      setGoalReask("");
    }
    if (cleared.includes("scenario")) {
      setScenarioContent("");
      setScenarioImages([]);
    }
  };

  /** 標籤上顯示的值（改完寫進「已把○○改成：…」用） */
  const chipValueText = (
    stepId: ScenarioStepId,
    value: unknown,
  ): TextRef | string => {
    if (stepId === "mode") return text(`${P}.chipValues.mode.${value}`);
    if (stepId === "source") return text(`${P}.chipValues.source.${value}`);
    return typeof value === "string" ? value : "";
  };

  // ----- 在對話裡回答（第一次）-----

  /** 選項步驟（需要情境嗎？、題目怎麼來？）在對話裡第一次選 */
  const answerChoice = (
    stepId: "mode" | "source",
    value: ScenarioMode | QuestionSource,
  ) => {
    const r = applyAnswer(SCENARIO_FLOW, answers, ctx, stepId, value);
    if (r.blocked) return;
    clearStepData(r.cleared);
    setAnswers(r.answers);
    logAnswer(
      stepId,
      text(`${P}.${stepId === "mode" ? "modes" : "sources"}.${value}`),
    );
  };

  /**
   * 選項步驟時老師在對話框打字：不呼叫 AI，只回同一句「請點選上面的選項」（規格第 3 點）。
   */
  const replyChooseOption = (typed: string) =>
    setLog((prev) =>
      appendLog(appendLog(prev, { role: "teacher", text: typed }), {
        role: "bot",
        text: SCENARIO_FLOW.choicePlaceholder,
      }),
    );

  /** 情境卡按「用這篇情境」：對話只留一句「已確認情境」，情境改固定顯示在右欄 */
  const confirmScenario = () => {
    const r = applyAnswer(SCENARIO_FLOW, answers, ctx, "scenario", true);
    setAnswers(r.answers);
    logAnswer(
      "scenario",
      text(`${P}.answers.scenario`, {
        chars: ctx.scenarioChars,
        images: ctx.imageCount,
      }),
    );
  };

  /** 出題方向：在對話框送出 */
  const submitDirection = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setDirection(trimmed);
    setDirectionReask("");
    const r = applyAnswer(SCENARIO_FLOW, answers, ctx, "direction", trimmed);
    setAnswers(r.answers);
    logAnswer("direction", trimmed);
  };

  /**
   * 出題方向答非所問（產題時同一次 AI 呼叫判斷）：清掉方向這一步的答案，回到那一步，
   * 重問句放在問句的位置。
   */
  const reaskDirection = (reask?: string) => {
    setDirectionReask(reask || t(`${P}.reaskFallback`));
    setAnswers((prev) => clearAnswers(prev, ["direction"]));
  };
  const clearDirectionReask = () => setDirectionReask("");

  /** 第一次產題成功：出題設定卡變成一句摘要，「設定」標籤出現 */
  const markGenerated = (count: number) => {
    if (answers.settings === true) return;
    const r = applyAnswer(SCENARIO_FLOW, answers, ctx, "settings", true);
    setAnswers(r.answers);
    setLog((prev) =>
      appendLog(
        appendLog(prev, {
          role: "bot",
          stepId: "settings",
          text: questionOf("settings"),
        }),
        {
          role: "note",
          stepId: "settings",
          text: text(`${P}.generatedNote`, { count }),
        },
      ),
    );
  };

  // ----- 對話框交給 compose（#1158 C 段第 5 段）-----

  /**
   * 寫 compose 的對話紀錄。`typed` 有值＝記下老師這句（`atManual`：在「自己打題目」那一步，
   * 連問句一起記）；`replies` 是之後的機器人回覆與結果摘要。`added` ＝這次真的加了題目：
   * 「自己打題目」那一步因此答完，進入「題目已產生」。
   *
   * `atManual` 由呼叫端在**送出時**判斷（await 之後的 `current` 可能是舊的）。
   */
  const recordCompose = ({
    typed,
    atManual,
    replies,
    added,
  }: {
    typed: string | null;
    atManual: boolean;
    replies: { role: "bot" | "note"; text: TextRef | string }[];
    added: boolean;
  }) => {
    setLog((prev) => {
      let next: FlowLogEntry[] = [...prev];
      if (typed !== null) {
        if (atManual) {
          next = appendLog(next, {
            role: "bot",
            stepId: "manualInput",
            text: questionOf("manualInput"),
          });
        }
        next = appendLog(next, {
          role: "teacher",
          stepId: atManual ? "manualInput" : undefined,
          text: typed,
        });
      }
      for (const reply of replies) next = appendLog(next, reply);
      return next;
    });
    setManualReask("");
    if (added && atManual) {
      setAnswers(
        (prev) =>
          applyAnswer(SCENARIO_FLOW, prev, ctx, "manualInput", true).answers,
      );
    }
  };

  /**
   * compose 沒有加題、要老師重來的一句話（全部無關的重問、已滿 10 題、額度用完、失敗）。
   * 「自己打題目」那一步：放在問句的位置；題目已產生後：往下加一個機器人泡泡。
   * `typed` 有值時先記下老師這句（重問時要；失敗時對話框保留原文，不記）。
   */
  const replyCompose = (
    atManual: boolean,
    message: string,
    typed: string | null = null,
  ) => {
    if (atManual) {
      if (typed !== null) {
        recordCompose({ typed, atManual, replies: [], added: false });
      }
      setManualReask(message);
      return;
    }
    recordCompose({
      typed,
      atManual,
      replies: [{ role: "bot", text: message }],
      added: false,
    });
  };

  // ----- 在已選項目列改答案 -----

  /** 改之前要不要先確認（或現在不能改） */
  const checkChange = (stepId: ScenarioStepId, value: unknown): ChangeCheck =>
    confirmForChange(SCENARIO_FLOW, answers, ctx, stepId, value);

  /**
   * 套用標籤小框裡的修改（確認框由呼叫端先問過）。前面的紀錄不動，只往下加一句
   * 「已把○○改成：…」。回傳 false ＝這一步現在不能改（`editable` 為否）。
   */
  const changeFromChip = (stepId: ScenarioStepId, value: unknown): boolean => {
    const r = applyAnswer(SCENARIO_FLOW, answers, ctx, stepId, value);
    if (r.blocked) return false;
    if (!r.changed) return true;
    clearStepData(r.cleared);
    if (stepId === "direction" && typeof value === "string") {
      setDirection(value);
      setDirectionReask("");
    }
    setAnswers(r.answers);
    const chip = findStep(SCENARIO_FLOW, stepId).chip;
    if (chip) {
      setLog((prev) =>
        appendChange(prev, stepId, chip.label, chipValueText(stepId, value)),
      );
    }
    return true;
  };

  /**
   * 「設定」小框按「確定」：設定是即時生效的欄位，這裡只在紀錄加一句「已更新出題設定」
   * （不用「已把設定改成：…」—— 設定沒有單一的值可以寫）。
   */
  const logSettingsChanged = () =>
    setLog((prev) =>
      appendLog(prev, {
        role: "note",
        stepId: "settings",
        text: text(`${P}.settingsUpdatedNote`),
      }),
    );

  // ===== 出題設定卡（所有題目共用）=====
  /** 一次要 AI 產幾題（預設 5；實際上限＝剩餘名額，由設定卡與面板夾住） */
  const [generateCount, setGenerateCount] = useState(DEFAULT_GENERATE_COUNT);
  /** 題目難度：出題出多難，與「文章難度」各自獨立 —— 簡單文章也可以出難題目 */
  const [questionLevel, setQuestionLevel] = useState(
    initialData?.questionLevel || programLevel || "A1",
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
  // AI 自動翻譯 / AI 生成語音。與例句集一致：預設都不勾，語言也不預選。
  // 編輯既有內容時，存過語言／語音設定就代表當初有勾，勾選狀態跟著回來。
  // 語言存的是單一值，「其他」的自訂名字要拆回旁邊那個欄位（見 lib 的說明）。
  const [initialTranslate] = useState(() =>
    fromStoredTranslateLanguage(initialData?.translateLanguage ?? ""),
  );
  const [autoTranslate, setAutoTranslate] = useState(
    !!initialData?.translateLanguage,
  );
  const [translateLang, setTranslateLang] = useState(initialTranslate.selected);
  const [customLang, setCustomLang] = useState(initialTranslate.custom);
  const [autoTTS, setAutoTTS] = useState(!!initialData?.ttsSettings);
  const [ttsSettings, setTTSSettings] = useState<TTSSettingsState>(
    initialData?.ttsSettings ?? DEFAULT_TTS,
  );

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

  const busy = generatingArticle || extracting || imageActions.busy;

  // ===== 衍生值 =====
  /** 沒有情境（不需要情境）時才帶出題方向；有情境就以情境為準 */
  const currentDirection = () =>
    answers.mode === "none" ? direction.trim() : "";
  const hasMaterial = () => hasScenarioMaterial || !!currentDirection();

  /**
   * 產題請求裡與「這份情境對話」有關的共通部分（素材＋出題設定卡）。
   * 翻譯開關關著時不送語言 —— 產出的題目也不填翻譯，開關才有意義。
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

  /** 存檔用的對話紀錄與設定：只存與當初選擇相符的那幾項，換了選項留下的舊值不帶走 */
  const saveFields = () => {
    const mode = answers.mode;
    return {
      scenarioContent,
      scenarioImages: scenarioImages.map((img) => img.url),
      questionLevel,
      globalRubric,
      globalTense,
      globalVoice,
      // 選「其他」時送老師打的語言名字，不是字面的 "other"（會整個丟掉）
      translateLanguage: toStoredTranslateLanguage(translateLang, customLang),
      ttsSettings,
      scenarioMode: mode ?? "",
      questionSource: answers.source ?? "",
      goal: mode === "ai" ? goal : "",
      articleLevel:
        mode === "ai" &&
        (CEFR_LEVELS as readonly string[]).includes(articleLevel)
          ? articleLevel
          : "",
      direction: mode === "none" ? direction : "",
    };
  };

  // ===== AI 寫情境 =====

  /**
   * AI 寫情境。兩個入口：
   * - `chat`：對話裡「訓練目標」那一步，老師在對話框送出訓練目標。答非所問時後端不產內容、
   *   回重問句，紀錄留下老師的話，重問句顯示在那一步的問句位置。
   * - `rewrite`：右欄情境區按「重寫」（確認過「會重寫情境文章」）。答非所問時用 toast 告訴他。
   *
   * 回傳 true ＝這段話已經處理掉（成功或答非所問），對話框可以清空；false ＝失敗，留著讓他重送。
   */
  const generateArticle = async (
    goalText: string,
    via: "chat" | "rewrite",
  ): Promise<boolean> => {
    const trimmed = goalText.trim();
    if (!trimmed) {
      toast.error(t("scenarioDialogue.messages.goalRequired"));
      return false;
    }
    setGeneratingArticle(true);
    if (via === "chat") setGoalReask("");
    try {
      const result = await apiClient.generateScenarioArticle({
        goal: trimmed,
        level: articleLevel,
        ui_language: uiLanguage,
      });
      if (result.usable === false) {
        const reask = result.reask || t(`${P}.reaskFallback`);
        if (via === "chat") {
          logAnswer("goal", trimmed);
          setGoalReask(reask);
        } else {
          toast.error(reask);
        }
        return true;
      }
      setScenarioContent(result.content);
      setGoal(trimmed);
      onSuggestedTitle(result.suggested_title);
      if (via === "chat") {
        setGoalReask("");
        const r = applyAnswer(SCENARIO_FLOW, answers, ctx, "goal", trimmed);
        setAnswers(r.answers);
        logAnswer(
          "goal",
          text(`${P}.answers.goal`, { goal: trimmed, level: articleLevel }),
        );
      } else {
        setAnswers((prev) => ({ ...prev, goal: trimmed }));
      }
      return true;
    } catch (error) {
      console.error("Failed to generate scenario content:", error);
      toast.error(t(textAiErrorKey(error)));
      return false;
    } finally {
      setGeneratingArticle(false);
    }
  };

  /**
   * 上傳圖片／PDF 擷取（對話「有既有的教材」）。依序擷取：文字接到情境框後面（老師可能
   * 先貼了一段），檔內有意義的圖自動裁成情境圖（最多 5 張），標題建議只在標題空白時填。
   *
   * **每個檔各自成敗**（review 1）：中間一個檔失敗，其他檔擷取到的文字照樣寫進情境框，
   * 最後統一提示哪幾個檔失敗 —— 一次傳 3 份講義、第 3 份失敗就整批丟掉，前兩份的
   * AI 次數也白花了。
   *
   * 額度用完（402）就停，不再送剩下的檔（review 2：後面每個檔都會撞同一個 402），沒送的
   * 檔一起列進失敗清單。一個檔都沒成功時改用「全部失敗」那句提示 —— 「其他檔案的內容已
   * 放進情境框」在這時不成立。
   */
  const extractFiles = async (files: File[]) => {
    /**
     * 保險（修正 C4）：擷取中已選項目列整列停用，照理改不了情境方式；萬一擷取回來時已經
     * 不是「既有教材」，結果（文字、情境圖、標題建議）一律丟掉，不寫進已換掉的情境。
     */
    const stillExisting = () => answersRef.current.mode === "existing";
    setExtracting(true);
    const parts: string[] = [];
    const failedNames: string[] = [];
    let succeeded = 0;
    let quotaExceeded = false;
    let truncated = false;
    try {
      for (const [index, file] of files.entries()) {
        if (quotaExceeded) {
          failedNames.push(...files.slice(index).map((f) => f.name));
          break;
        }
        try {
          const result = await apiClient.extractScenarioArticle(
            file,
            uiLanguage,
          );
          if (!stillExisting()) return;
          const extractedText = (result.content ?? "").trim();
          const figures = result.figures ?? [];
          if (!extractedText && figures.length === 0) {
            failedNames.push(file.name);
            continue;
          }
          succeeded += 1;
          if (extractedText) parts.push(extractedText);
          if (result.truncated) truncated = true;
          onSuggestedTitle(result.suggested_title);
          if (figures.length) await imageActions.addExtracted(file, figures);
        } catch (error) {
          console.error(
            `Failed to extract scenario content (${file.name}):`,
            error,
          );
          failedNames.push(file.name);
          if (error instanceof ApiError && error.status === 402) {
            quotaExceeded = true;
          }
        }
      }
      if (parts.length && stillExisting()) {
        const extracted = parts.join("\n\n");
        setScenarioContent((prev) =>
          prev.trim() ? `${prev.trim()}\n\n${extracted}` : extracted,
        );
      }
    } finally {
      setExtracting(false);
    }
    if (quotaExceeded) {
      toast.error(t("scenarioDialogue.messages.textQuotaExceeded"));
    }
    if (failedNames.length) {
      toast.error(
        t(
          succeeded > 0
            ? "scenarioDialogue.messages.extractFailedFiles"
            : "scenarioDialogue.messages.extractAllFailed",
          { files: failedNames.join(", ") },
        ),
      );
    }
    if (truncated) toast.info(t("scenarioDialogue.messages.extractTruncated"));
  };

  return {
    // 流程
    answers,
    ctx,
    current,
    composer,
    log,
    answerChoice,
    replyChooseOption,
    confirmScenario,
    submitDirection,
    reaskDirection,
    clearDirectionReask,
    markGenerated,
    recordCompose,
    replyCompose,
    manualReask,
    checkChange,
    changeFromChip,
    logSettingsChanged,
    // 對話的欄位
    goal,
    setGoal,
    articleLevel,
    setArticleLevel,
    direction,
    goalReask,
    directionReask,
    generatingArticle,
    extracting,
    busy,
    generateArticle,
    extractFiles,
    // 情境
    scenarioContent,
    setScenarioContent,
    scenarioImages,
    imageActions,
    hasScenarioMaterial,
    hasMaterial,
    // 出題設定卡
    generateCount,
    setGenerateCount,
    questionLevel,
    setQuestionLevel,
    globalRubric,
    setGlobalRubric,
    globalTense,
    setGlobalTense,
    globalVoice,
    setGlobalVoice,
    autoTranslate,
    setAutoTranslate,
    translateLang,
    setTranslateLang,
    customLang,
    setCustomLang,
    autoTTS,
    setAutoTTS,
    ttsSettings,
    setTTSSettings,
    hasLanguage,
    langLabel,
    // 給面板組請求與存檔
    questionRequestBase,
    saveFields,
  };
}

export type ScenarioSetupState = ReturnType<typeof useScenarioSetup>;
