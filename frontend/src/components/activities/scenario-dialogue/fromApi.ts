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
 * ## 情境配圖沒有資料來源
 *
 * `ScenarioChatContext.images` 目前一律空陣列。`scenario_settings` 只存
 * scenario_content / question_level / global_rubric / global_tense / global_voice /
 * translate_language / tts_settings —— **沒有情境圖片欄位**。設計稿那幾張情境圖是
 * `public/samples/` 的 mock。要有情境配圖得先加欄位，不在這裡硬湊。
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
 * 兩個欄位目前**沒有對應的派發設定**，先在這裡定死並寫明理由：
 *
 * * `replyMode: "voice"` —— 情境對話的定位就是開口錄音作答（`practiceMode.ts` 的
 *   註解與 `scoreCategory: speaking` 都是這個語意）。文字作答是設計稿的變體，要開放
 *   得先有一個派發設定。
 * * `textDefaultHidden: false` —— 設計稿的「先聽後看」預設隱藏題目文字，但那要有題目
 *   語音才成立（沒有語音又把文字藏起來，學生就沒有東西可依據）。題目語音是選配的，
 *   所以這裡先一律顯示；要做「先聽後看」同樣需要一個派發設定。
 */
export function scenarioChatSettings({
  showTranslation,
  isPreviewMode,
}: ChatSettingsInput) {
  return {
    replyMode: "voice" as const,
    textDefaultHidden: false,
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

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

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
    // 見檔頭：後端還沒有情境配圖欄位
    images: [],
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
