/**
 * 引導式對話的 state 與動作（Issue #1146 review 6，從 `ScenarioDialoguePanel.tsx` 抽出）。
 *
 * 管的是「對話裡回答的東西」：已答步驟、情境（文章＋情境圖）、訓練目標／文章難度、
 * 出題方向、答非所問的重問句，以及出題設定卡的每一項。題目清單（rows）、標題、存檔仍由
 * 面板持有 —— 這裡只透過 `onSuggestedTitle` 回報 AI 的標題建議。
 *
 * 流程本身是純函式（`setupFlow.ts`）；這個 hook 負責把老師的選擇套到 state 上，並打
 * 「AI 寫情境」與「上傳擷取」兩支 API。
 */
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";
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
  EMPTY_ANSWERS,
  answersFromSaved,
  modeChangeClearsScenario,
  reopenStep,
  type QuestionSource,
  type ScenarioMode,
  type SetupAnswers,
  type SetupStep,
} from "./setupFlow";
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

export interface UseScenarioSetupOptions {
  initialData?: ScenarioDialogueInitialState | null;
  programLevel?: string;
  /** 答非所問的重問句與 AI 標題建議用老師的介面語言 */
  uiLanguage: string;
  /** AI 回了標題建議（寫情境、擷取）。面板決定要不要填（只在標題空白時填） */
  onSuggestedTitle: (suggested?: string) => void;
}

export function useScenarioSetup({
  initialData,
  programLevel,
  uiLanguage,
  onSuggestedTitle,
}: UseScenarioSetupOptions) {
  const { t } = useTranslation();

  // ===== 對話的已答步驟 =====
  /**
   * 編輯既有內容時由已存資料還原 —— 老師在題目清單按「上一步」回到對話時，看得到
   * 當初怎麼答、可以從任一步改選。
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
  /** 生成情境內容與產題是兩件事，loading 各自獨立 */
  const [generatingArticle, setGeneratingArticle] = useState(false);
  /** 上傳圖片／PDF 擷取情境文章中 */
  const [extracting, setExtracting] = useState(false);

  // ===== 情境（對話中的「情境框」＋情境圖列）=====
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

  // ===== 出題設定卡（所有題目共用）=====
  /** 一次要 AI 產幾題（設定卡預設 5，範圍 3~10） */
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
    answers.scenarioMode === "none" ? direction.trim() : "";
  const hasScenarioMaterial =
    !!scenarioContent.trim() || scenarioImages.length > 0;
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
    const mode = answers.scenarioMode;
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
      questionSource: answers.questionSource ?? "",
      goal: mode === "ai" ? goal : "",
      articleLevel:
        mode === "ai" &&
        (CEFR_LEVELS as readonly string[]).includes(articleLevel)
          ? articleLevel
          : "",
      direction: mode === "none" ? direction : "",
    };
  };

  // ===== 對話的回答 =====

  /** 選這個「需要情境嗎？」會不會清掉已填的情境（＝要不要先跳確認，review 2） */
  const wouldClearScenario = (mode: ScenarioMode) =>
    modeChangeClearsScenario(lastModeRef.current, mode, hasScenarioMaterial);

  const chooseMode = (mode: ScenarioMode) => {
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

  const reopen = (step: SetupStep) => {
    if (step === "goal") setGoalReask("");
    setAnswers((prev) => reopenStep(step, prev));
  };

  const chooseSource = (source: QuestionSource) =>
    setAnswers((prev) => ({
      ...prev,
      questionSource: source,
      directionDone: false,
    }));

  const markScenarioDone = () =>
    setAnswers((prev) => ({ ...prev, scenarioDone: true }));

  const markDirectionDone = () => {
    setDirectionReask("");
    setAnswers((prev) => ({ ...prev, directionDone: true }));
  };

  /** 出題方向答非所問：回到「想問的方向」那一步顯示重問句 */
  const reaskDirection = (reask?: string) => {
    setDirectionReask(reask || t("scenarioDialogue.setup.reaskFallback"));
    setAnswers((prev) => reopenStep("direction", prev));
  };
  const clearDirectionReask = () => setDirectionReask("");

  /**
   * AI 寫情境（對話「請 AI 幫我寫」→ 訓練目標＋文章難度）。
   * 答非所問（訓練目標不可用）時後端不產內容、回重問句，留在這一步顯示。
   */
  const generateArticle = async () => {
    if (!goal.trim()) {
      toast.error(t("scenarioDialogue.messages.goalRequired"));
      return;
    }
    setGeneratingArticle(true);
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
      onSuggestedTitle(result.suggested_title);
      setAnswers((prev) => ({ ...prev, goalDone: true }));
    } catch (error) {
      console.error("Failed to generate scenario content:", error);
      toast.error(t(textAiErrorKey(error)));
    } finally {
      setGeneratingArticle(false);
    }
  };

  /**
   * 上傳圖片／PDF 擷取（對話「我有現成的」）。依序擷取：文字接到情境框後面（老師可能
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
          const text = (result.content ?? "").trim();
          const figures = result.figures ?? [];
          if (!text && figures.length === 0) {
            failedNames.push(file.name);
            continue;
          }
          succeeded += 1;
          if (text) parts.push(text);
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
      if (parts.length) {
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
    // 對話
    answers,
    goal,
    setGoal,
    articleLevel,
    setArticleLevel,
    direction,
    setDirection,
    goalReask,
    directionReask,
    generatingArticle,
    extracting,
    busy,
    chooseMode,
    wouldClearScenario,
    reopen,
    chooseSource,
    markScenarioDone,
    markDirectionDone,
    reaskDirection,
    clearDirectionReask,
    generateArticle,
    extractFiles,
    // 情境
    scenarioContent,
    setScenarioContent,
    scenarioImages,
    imageActions,
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
