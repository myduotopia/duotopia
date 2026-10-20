/**
 * 情境對話「訊息對話式」作答 UI 的共用型別（#1133）。
 *
 * 元件只吃這裡定義的資料形狀，不直接碰後端 schema：sample 頁用 mock 組出來，
 * 下一階段套用到正式作答頁時再由 API 回應轉換。
 *
 * 學生端資料界線（照 backend/utils/scenario_dialogue.py `public_item_view`）：
 * `reference_answer`、`image_prompt` 不給學生。`referenceAnswer` 只在老師預覽時才帶。
 */

export interface ScenarioImage {
  src: string;
  alt?: string;
}

/** 一題（AI 提問） */
export interface ScenarioChatItem {
  id: string | number;
  /** 題目英文 */
  text: string;
  /** 題目中文翻譯（老師沒開翻譯時不顯示） */
  translation?: string;
  keywords: string[];
  /** 作答提示（rubric_note，學生可見） */
  rubricNote?: string;
  images: ScenarioImage[];
  /** 參考答案 —— 只有老師預覽會帶，學生端一律不傳 */
  referenceAnswer?: string;
}

/** 情境（題組文章＋圖）；content 與 images 皆空時不顯示情境卡 */
export interface ScenarioChatContext {
  /** 標題列文字：A/B 為作業標題；C 為 scenario_content 那一句 */
  title: string;
  /** 題組文章（情境 C 為空） */
  content?: string;
  images: ScenarioImage[];
  /** 作答要求（global_rubric） */
  rubric?: string;
  level?: string;
}

export type ReplyMode = "voice" | "text";

export interface ScenarioAnswer {
  kind: ReplyMode;
  audioUrl?: string;
  durationSec?: number;
  text?: string;
}

export interface ScenarioFeedback {
  verdict: "improve" | "great";
  comment: string;
  /** 建議說法（文字＋可朗讀） */
  suggestion?: string;
  /** AI 分數 —— 只在老師預覽顯示，學生畫面一律不顯示 */
  score?: number;
}

export interface ScenarioAttempt {
  answer: ScenarioAnswer;
  feedback?: ScenarioFeedback;
}

export interface TextRevealState {
  en: boolean;
  zh: boolean;
}

/** AI 建議與朗讀以注入方式提供：sample 傳 mock，正式版之後接後端 */
export interface ScenarioChatAdapters {
  getFeedback: (
    item: ScenarioChatItem,
    answer: ScenarioAnswer,
    attemptIndex: number,
  ) => Promise<ScenarioFeedback>;
  speak: (text: string) => void;
}

export interface ScenarioChatSettings {
  replyMode: ReplyMode;
  /** 題目文字預設隱藏（先聽後看） */
  textDefaultHidden: boolean;
  showTranslation: boolean;
  isPreviewMode: boolean;
  maxAttempts: number;
}
