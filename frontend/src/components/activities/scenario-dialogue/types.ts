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
  /**
   * 題目翻譯（老師沒開翻譯時不顯示）。DB 每題只存一份，語言＝老師選的翻譯語言。
   */
  translation?: string;
  /**
   * 翻譯的語言，取自 `scenario_settings.translate_language`（"chinese"／"japanese"／
   * "korean"／自訂名稱）。只有與學生介面語言相同時才顯示翻譯鈕（見 translationLanguage.ts）。
   */
  translationLanguage?: string;
  keywords: string[];
  /** 作答提示（rubric_note，學生可見） */
  rubricNote?: string;
  images: ScenarioImage[];
  /** 參考答案 —— 只有老師預覽會帶，學生端一律不傳 */
  referenceAnswer?: string;
  /**
   * 學生已存的錄音（學生端 payload 的 recording_url，伺服器存的最後一次）。
   * 用在「已提交」唯讀紀錄（SubmittedTranscript，#1158 E6）與「接著上次進度」
   * （#1158 E-4：有錄音＝上次答過，按「開始對話」後以紀錄排在上方、從第一題沒答的開始）。
   * 本次作答的錄音由 useScenarioChat 自己管。
   */
  submittedAudioUrl?: string;
  /**
   * 上次離開前這題已用掉的正式作答次數（payload 的 ai_analysis_count，伺服器為準，#1158 E-4）。
   * 剩餘次數＝maxAttempts − 這個 − 本次作答次數，與後端一致，免得前端以為還有次數、後端回 429。
   */
  priorAttempts?: number;
  /** 上次離開前這題已用掉的求助次數（payload 的 help_count，#1158 E-4） */
  priorHelp?: number;
  /**
   * 老師已在批改頁把這題標成通過（payload 的 teacher_passed === true，#1158 修正 E4）：
   * 重新進入後以紀錄呈現、標「老師已通過」，不再問、不能再試。
   */
  teacherPassed?: boolean;
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
}

export type ReplyMode = "voice" | "text";

export interface ScenarioAnswer {
  kind: ReplyMode;
  audioUrl?: string;
  durationSec?: number;
  text?: string;
}

/**
 * AI 回應種類（#1158）：feedback＝正式回答的建議；phrase＝學生問某個字／片語怎麼說或字義；
 * model_answer＝學生說不會答，給一句完整範例。後兩者是求助：不顯示很棒／可以更好、
 * **不算作答次數**（見 useScenarioChat 的 usedAttempts；後端同樣把額度退回）。
 */
export type ScenarioFeedbackKind = "feedback" | "phrase" | "model_answer";

export interface ScenarioFeedback {
  /** 沒有＝feedback（舊回應、mock） */
  kind?: ScenarioFeedbackKind;
  /** 求助（phrase／model_answer）時不顯示 */
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

/** 朗讀選項 */
export interface SpeakOptions {
  /**
   * 朗讀實際出錯（不含被 cancel／打斷）或沒有英文語音時呼叫。題目自動朗讀用它在失敗時
   * 直接打開英文，免得「先聽後看」變成學生看不到也聽不到題目（#1158 E2）。
   */
  onError?: () => void;
}

/** AI 建議與朗讀以注入方式提供：sample 傳 mock，正式版之後接後端 */
export interface ScenarioChatAdapters {
  getFeedback: (
    item: ScenarioChatItem,
    answer: ScenarioAnswer,
    attemptIndex: number,
  ) => Promise<ScenarioFeedback>;
  /** 朗讀（回傳值不使用；sample 的 speakEnglish 會回傳「唸完」的 Promise） */
  speak: (text: string, opts?: SpeakOptions) => void | Promise<void>;
  /** 停止朗讀（卸載／重置時呼叫） */
  stopSpeech?: () => void;
  /**
   * 在使用者點擊當下「解鎖」朗讀（按「開始對話」時呼叫）。第 1 題要等「輸入中…」之後才唸，
   * 那時已不在點擊事件裡，iOS Safari 等瀏覽器會擋掉沒有使用者手勢的朗讀（#1158 E-2）。
   */
  primeSpeech?: () => void;
}

export interface ScenarioChatSettings {
  replyMode: ReplyMode;
  /** 題目文字預設隱藏（先聽後看） */
  textDefaultHidden: boolean;
  /** 老師翻譯開關；關 → 學生一律沒有翻譯鈕（英文仍可看） */
  showTranslation: boolean;
  isPreviewMode: boolean;
  maxAttempts: number;
}
