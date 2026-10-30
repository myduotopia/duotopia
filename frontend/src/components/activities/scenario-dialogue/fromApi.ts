/**
 * API 回應 → 對話式 UI 的資料形狀（Issue #1140 Stage 2）。
 *
 * `types.ts` 刻意讓元件「只吃這裡定義的資料形狀，不直接碰後端 schema」，並註明
 * 「下一階段套用到正式作答頁時再由 API 回應轉換」。這個檔案就是那層轉換。
 *
 * ## 兩個來源、一條界線
 *
 * 老師端（`GET /api/teachers/contents/{id}`）與學生端（作業 payload）回的形狀不同，
 * 差別就在那條資料界線上：
 *
 * | | 老師端 | 學生端 |
 * |---|---|---|
 * | `reference_answer` | 有（出題與 AI 評分用） | 後端 `public_item_view` 已濾掉 |
 * | `image_prompt` | 有 | 已濾掉 |
 * | 時態／語態 | override 原值 | 已解析成生效值 |
 *
 * 所以這裡**逐欄白名單**，不做物件展開：老師端的欄位只要原樣往下傳一次，參考答案就
 * 跟著進了學生畫面的資料裡 —— 即使今天沒有元件渲染它，哪天多渲染一個欄位就漏了。
 *
 * ## 情境圖（#1158 E5）
 *
 * `ScenarioChatContext.images` 讀 `scenario_settings.scenario_images`（網址陣列，最多 5 張，
 * #1146 起由老師上傳／擷取／AI 生成）。老師端拿到的是整份設定；學生端是後端
 * `public_settings_view` 濾過的版本，情境圖本來就給學生看，兩邊都有這個欄位。
 * 非字串、空字串一律略過；替代文字用固定格式（理由同題目圖片的 imageAlt）。
 */
import type { ScenarioContentDetail } from "@/lib/scenarioDialogue";
import type { ScenarioChatContext, ScenarioChatItem } from "./types";

export interface ScenarioChatData {
  context: ScenarioChatContext;
  items: ScenarioChatItem[];
}

export interface FromTeacherContentOptions {
  /**
   * 帶上參考答案。**只有老師預覽可以開** —— 那是老師自己寫的示範回答，給學生看就是
   * 請他照抄（後端的 `public_item_view` 也是在同一條界線上濾掉它）。
   */
  withReferenceAnswer?: boolean;
}

/**
 * 每題最多幾次 AI 建議。
 *
 * 伺服器才是真相（`services/analysis_quota.MAX_AI_ANALYSIS_ATTEMPTS`，與批改頁的
 * Azure 分析同一個 `ai_analysis_count` 欄位）；這裡是畫面要先知道才畫得出「再試一次」
 * 的本地預設。Stage 1 的端點回應會帶 `max_attempts`，拿到之後以它為準。
 */
export const SCENARIO_MAX_ATTEMPTS = 3;

export interface ChatSettingsInput {
  /** 老師派發時的「顯示題目翻譯」開關 */
  showTranslation: boolean;
  isPreviewMode: boolean;
}

/**
 * 對話式 UI 的 settings。**預覽與學生作答共用這一份** —— 兩邊各寫一份就會漂移，
 * 而預覽的全部意義就是「老師看到的＝學生看到的」。
 *
 * 兩個欄位目前**沒有對應的派發設定**，在這裡決定並寫明理由：
 *
 * * `replyMode: "voice"` —— 情境對話的定位就是開口錄音作答（`practiceMode.ts` 的
 *   註解與 `scoreCategory: speaking` 都是這個語意）。文字作答是設計稿的變體，要開放
 *   得先有一個派發設定。
 * * `textDefaultHidden` —— 「先聽後看」（#1133 設計）：題目出現時自動唸、文字先藏起來，
 *   學生按「英」才看。題目語音是**瀏覽器朗讀題目文字**（speakEnglish，不依賴老師有沒有上傳
 *   音檔），所以只要瀏覽器能朗讀就預設隱藏；不能朗讀（沒有 speechSynthesis）才一律顯示，
 *   免得學生沒有東西可依據（#1158 E-2：實測沒聽到語音、直接看到文字，就是這裡原本寫死 false）。
 */
/** 瀏覽器能不能朗讀題目（見 scenarioChatSettings 的 textDefaultHidden） */
export function canSpeakQuestions(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function scenarioChatSettings({
  showTranslation,
  isPreviewMode,
}: ChatSettingsInput) {
  return {
    replyMode: "voice" as const,
    textDefaultHidden: canSpeakQuestions(),
    showTranslation,
    isPreviewMode,
    maxAttempts: SCENARIO_MAX_ATTEMPTS,
  };
}

/**
 * 題目圖片的替代文字。
 *
 * 這一層是純函式、拿不到 i18n 的 `t`（只有元件有），所以先用固定格式，至少不要讓
 * 讀螢幕的人只聽到一個數字。要完整在地化得把 `t` 傳進來。
 */
function imageAlt(questionNumber: number): string {
  return `Question ${questionNumber} image`;
}

/** 情境圖網址陣列 → 對話式 UI 的圖片（見檔頭「情境圖」） */
function scenarioImages(raw: unknown): ScenarioChatContext["images"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(text)
    .filter(Boolean)
    .map((src, i) => ({ src, alt: `Scenario image ${i + 1}` }));
}

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** 計數欄位：非負整數才算，其他（null、負數、字串）一律 0 */
const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;

/**
 * 老師端 content detail → 對話式 UI 的 context／items。
 *
 * 用在派發預覽（老師看學生會看到什麼）與教材預覽。學生正式作答走的是學生端 payload，
 * 形狀不同，之後另外一個函式。
 */
export function scenarioChatFromTeacherContent(
  detail: ScenarioContentDetail,
  options: FromTeacherContentOptions = {},
): ScenarioChatData {
  const settings = detail.scenario_settings || {};
  const translationLanguage = text(settings.translate_language);

  const context: ScenarioChatContext = {
    title: text(detail.title),
    content: text(settings.scenario_content),
    images: scenarioImages(settings.scenario_images),
    rubric: text(settings.global_rubric),
    level: text(settings.question_level),
  };

  const items: ScenarioChatItem[] = (detail.items ?? []).map((item, index) => {
    const block = item.scenario_dialogue || {};
    const rubricNote = text(block.rubric_note);
    const imageUrl = text(item.image_url);
    const reference = text(block.reference_answer);

    return {
      // id 要穩定且唯一：元件拿它當 React key，也用它對照「哪一題在重答」。
      // 沒存過的題目沒有 id（舊資料／還沒存檔），用索引補一個不會撞到數字 id 的值。
      id: item.id ?? `idx-${index}`,
      text: text(item.text),
      translation: text(item.translation) || undefined,
      translationLanguage: translationLanguage || undefined,
      keywords: [...(block.keywords ?? [])],
      rubricNote: rubricNote || undefined,
      // alt 不要只給一個數字 —— 讀螢幕的人只會聽到「1」（PR #1142 review）
      images: imageUrl ? [{ src: imageUrl, alt: imageAlt(index + 1) }] : [],
      ...(options.withReferenceAnswer && reference
        ? { referenceAnswer: reference }
        : {}),
    };
  });

  return { context, items };
}

/** 學生端作業 payload 裡本題型用得到的部分（`StudentActivityPageContent` 的 Activity）。 */
export interface ScenarioStudentActivity {
  title?: string | null;
  scenario_settings?: {
    scenario_content?: string | null;
    global_rubric?: string | null;
    translate_language?: string | null;
    scenario_images?: string[] | null;
  } | null;
  items?: Array<{
    id?: number;
    text?: string | null;
    translation?: string | null;
    image_url?: string | null;
    /** 學生自己已存的錄音（已提交唯讀紀錄、接著上次進度用，#1158 E6／E-4） */
    recording_url?: string | null;
    /** 這題已用掉的正式作答次數（伺服器計數，#1158 E-4） */
    ai_analysis_count?: number | null;
    /** 這題已用掉的求助次數（伺服器計數，#1158 E-4） */
    help_count?: number | null;
    scenario_dialogue?: {
      keywords?: string[];
      rubric_note?: string;
    } | null;
  }> | null;
}

/**
 * 學生端作業 payload → 對話式 UI 的 context／items。
 *
 * 與 :func:`scenarioChatFromTeacherContent` 是一對，差別只在資料界線：這一側的
 * `reference_answer` / `image_prompt` **後端就已經濾掉了**（`public_item_view`），
 * 所以這裡連「要不要帶」都不用選 —— 沒得帶。
 *
 * 逐欄白名單的理由同另一支：payload 之後若多了欄位，不會因為一次物件展開就跟著
 * 流進畫面資料裡。
 */
export function scenarioChatFromStudentActivity(
  activity: ScenarioStudentActivity,
): ScenarioChatData {
  const settings = activity.scenario_settings || {};
  const translationLanguage = text(settings.translate_language);

  const context: ScenarioChatContext = {
    title: text(activity.title),
    content: text(settings.scenario_content),
    images: scenarioImages(settings.scenario_images),
    rubric: text(settings.global_rubric),
  };

  const items: ScenarioChatItem[] = (activity.items ?? []).map(
    (item, index) => {
      const block = item.scenario_dialogue || {};
      const rubricNote = text(block.rubric_note);
      const imageUrl = text(item.image_url);
      return {
        id: item.id ?? `idx-${index}`,
        text: text(item.text),
        translation: text(item.translation) || undefined,
        translationLanguage: translationLanguage || undefined,
        keywords: [...(block.keywords ?? [])],
        rubricNote: rubricNote || undefined,
        images: imageUrl ? [{ src: imageUrl, alt: imageAlt(index + 1) }] : [],
        ...(text(item.recording_url)
          ? { submittedAudioUrl: text(item.recording_url) }
          : {}),
        // 伺服器計數（#1158 E-4）：重新進入後的剩餘次數以它為準
        ...(count(item.ai_analysis_count)
          ? { priorAttempts: count(item.ai_analysis_count) }
          : {}),
        ...(count(item.help_count)
          ? { priorHelp: count(item.help_count) }
          : {}),
      };
    },
  );

  return { context, items };
}
