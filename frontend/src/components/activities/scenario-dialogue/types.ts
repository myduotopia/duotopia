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
  /** 作答要求（global_rubric）—— 開始前以藍色提示卡顯示 */
  rubric?: string;
  level?: string;
  /**
   * AI 開場複述：按「開始對話」後 AI 第一則訊息（英文一句＋中文摘要），之後才問第 1 題。
   * sample 用 mock 文字；正式版由後端 AI 濃縮作答要求（下一階段）。
   */
  opening?: {
    text: string;
    translation?: string;
  };
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

/** 題目文字的英／中狀態；用在「目前顯示中」與「是否點開過」兩份紀錄 */
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
  /** 朗讀；回傳 Promise 時代表「唸完」（開場複述唸完才出第 1 題） */
  speak: (text: string) => void | Promise<void>;
  /** 停止朗讀（卸載／重置時呼叫） */
  stopSpeech?: () => void;
}

export interface ScenarioChatSettings {
  replyMode: ReplyMode;
  /** 題目文字預設隱藏（先聽後看） */
  textDefaultHidden: boolean;
  showTranslation: boolean;
  isPreviewMode: boolean;
  maxAttempts: number;
}
