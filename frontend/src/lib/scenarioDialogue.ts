/**
 * scenarioDialogue — 情境對話面板 state 與後端 payload 的對映層（Issue #1013）。
 *
 * 對應後端 `backend/utils/scenario_dialogue.py`（那裡是儲存語意的唯一判定處），
 * 這裡只做「面板 camelCase ↔ API snake_case」的搬運，不做任何值的推導。
 *
 * ## 為什麼獨立成一個模組
 *
 * 面板（`ScenarioDialoguePanel`）負責畫面、呼叫端（`TeacherTemplatePrograms`）負責
 * 打 API，兩邊都需要同一份對映；寫在任一邊都會讓另一邊複製一份，而這份對映有兩個
 * 一旦寫歪就很難察覺的規則（見下），複製等於埋兩顆同樣的雷。
 *
 * ## 規則一：`null` 不可被壓平
 *
 * `tenseOverride` / `voiceOverride` 有三種狀態，畫面上後兩種看起來都是空的，行為卻不同：
 *
 * | 值 | 意思 | 老師之後改整體評分標準 |
 * |---|---|---|
 * | `null` | 沿用整體 | **本題跟著變** |
 * | `{ time: "", aspect: "" }` / `""` | 本題已脫鉤，明確不指定 | 本題不受影響 |
 * | `{ time: "past", aspect: "simple" }` / `"passive"` | 本題自訂 | 本題不受影響 |
 *
 * 所以這裡一律用 `== null` 判斷，**禁止**用 `||` / `if (!x)` 把 `null` 與空值折疊
 * 成同一個值 —— 折疊後畫面完全看不出差別，要等 AI 用錯時態評分才會發現。
 *
 * ## 規則二：`referenceAnswer` 只走老師端
 *
 * 參考答案只給 AI 當語言特徵對照，學生端看不到。本模組服務的是老師端（出題／編輯），
 * 所以會帶上它；學生端的序列化在後端 `public_item_view`，不要在前端另做一套。
 */

/** 時態＝時間 × 動貌，兩者都選才成立（避免「過去」但沒說哪一種的半套條件） */
export interface TenseSetting {
  /** `present` / `past` / `future`，或空字串代表不指定 */
  time: string;
  /** `simple` / `progressive` / `perfect` / `perfectProgressive`，或空字串 */
  aspect: string;
}

/** 時態／語態都沒指定時的值。整份設定沒有上層可沿用，缺值時落在這裡而不是 `null` */
export const EMPTY_TENSE: TenseSetting = { time: "", aspect: "" };

/** 面板的一列題目（`ScenarioDialoguePanel` 的 state 單位） */
export interface ScenarioDialogueRow {
  /** 前端用的列 key（拖曳排序），與資料庫無關 */
  id: string;
  /**
   * 這一列在資料庫的 `content_items.id`；新題為 `null`。
   *
   * **編輯既有內容時一定要帶回後端**：後端是 id-based 原地更新（#861），payload 沒帶
   * id 就會把整批題目刪掉重建，學生作答（practice_answers / student_item_progress）
   * 綁的是舊 id，會隨 FK CASCADE 一起消失、批改分數歸零。
   */
  contentItemId: number | null;
  /** 口說題目本文（老師可自行編輯） */
  question: string;
  /** 輔助語言翻譯，語言由整份設定統一決定 */
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
   * UI 不顯示也不讓老師編輯（圖片改成「AI 生成」或手動上傳二擇一），但**要存**：
   * #1013 定案讓後端保留這個欄位，因為 AI 產題預期會連 prompt 一起回傳給後續
   * 重新生圖用，前端只是搬運，不解讀內容。
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
   *
   * 純前端狀態，不進 API payload。
   */
  revision: number;
}

export interface ScenarioTTSSettings {
  accent: string;
  gender: string;
  speed: string;
}

/**
 * 引導式對話的回答（#1146）。存進 `scenario_settings`，題目清單按「上一步」回到對話、
 * 或編輯既有內容時，才還原得出已答步驟。舊資料沒有這幾項 → 一律空值。
 */
export interface ScenarioSetupRecord {
  /** 需要情境嗎？`none` / `existing` / `ai`，空字串 = 舊資料 */
  scenarioMode: string;
  /** 題目怎麼來？`manual` / `ai`，空字串 = 舊資料 */
  questionSource: string;
  /** AI 寫情境的訓練目標 */
  goal: string;
  /** AI 寫情境的文章難度（CEFR） */
  articleLevel: string;
  /** 無情境 AI 出題的「想問的方向」 */
  direction: string;
}

/** 面板 `onSave` 交出來的整份資料 */
export interface ScenarioSaveInput extends ScenarioSetupRecord {
  title: string;
  rows: ScenarioDialogueRow[];
  scenarioContent: string;
  /** 情境圖網址（最多 5 張，學生看得到，#1146） */
  scenarioImages: string[];
  questionLevel: string;
  globalRubric: string;
  globalTense: TenseSetting;
  globalVoice: string;
  translateLanguage: string;
  ttsSettings: ScenarioTTSSettings;
}

/** 寫進 `contents.scenario_settings` 的整份設定 */
export interface ScenarioSettingsPayload {
  scenario_content: string;
  question_level: string;
  global_rubric: string;
  global_tense: TenseSetting;
  global_voice: string;
  translate_language: string;
  tts_settings: ScenarioTTSSettings | null;
  // ---- #1146 引導式對話與情境圖 ----
  scenario_images: string[];
  scenario_mode: string;
  question_source: string;
  goal: string;
  article_level: string;
  direction: string;
}

/** 寫進 `content_items.item_metadata["scenario_dialogue"]` 的逐題區塊 */
export interface ScenarioItemBlock {
  tense_override: TenseSetting | null;
  voice_override: string | null;
  keywords: string[];
  reference_answer: string;
  rubric_note: string;
  image_prompt: string;
}

/** 送給 create / update content 的單題 payload */
export interface ScenarioItemPayload {
  /** 既有題目才有；新題不帶（後端據此決定原地更新或新增，#861） */
  id?: number;
  text: string;
  translation: string;
  image_url: string | null;
  audio_url: string | null;
  scenario_dialogue: ScenarioItemBlock;
}

export interface ScenarioSavePayload {
  scenario_settings: ScenarioSettingsPayload;
  items: ScenarioItemPayload[];
}

/** `GET /api/teachers/contents/{id}` 之中本題型用得到的部分 */
export interface ScenarioContentDetail {
  id?: number;
  title?: string | null;
  scenario_settings?: Partial<ScenarioSettingsPayload> | null;
  items?: Array<{
    id?: number;
    text?: string | null;
    translation?: string | null;
    image_url?: string | null;
    audio_url?: string | null;
    scenario_dialogue?: Partial<ScenarioItemBlock> | null;
  }> | null;
}

/** 編輯模式回填面板用的初始 state */
export interface ScenarioDialogueInitialState extends ScenarioSetupRecord {
  title: string;
  scenarioContent: string;
  scenarioImages: string[];
  questionLevel: string;
  globalRubric: string;
  globalTense: TenseSetting;
  globalVoice: string;
  translateLanguage: string;
  /** `null` = 這份內容沒存過 TTS 設定 → 呼叫端沿用自己的預設值 */
  ttsSettings: ScenarioTTSSettings | null;
  rows: ScenarioDialogueRow[];
}

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

let rowSeq = 0;
/** 拖曳排序要穩定的 key，時間戳加序號足以避免同一毫秒內連續建列撞號 */
export const nextRowId = () => `sd-${Date.now()}-${rowSeq++}`;

/** 建一列空白題目。面板一開就給一張空卡，老師可以直接打字不必先產題 */
export const createScenarioRow = (
  overrides: Partial<ScenarioDialogueRow> = {},
): ScenarioDialogueRow => ({
  id: nextRowId(),
  contentItemId: null,
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

/**
 * 面板翻譯語言下拉的選項值，與 `ScenarioDialoguePanel` 的 `TRANSLATION_LANGUAGES`
 * 一一對應（改一邊要改另一邊）。`other` 代表「語言名字在旁邊那個自訂欄位裡」。
 */
export const TRANSLATION_LANGUAGE_VALUES = [
  "chinese",
  "japanese",
  "korean",
  "other",
] as const;

/**
 * 面板的（下拉選擇 + 自訂欄位）→ 存進 `scenario_settings.translate_language` 的單一值。
 *
 * 選「其他」時存的是老師真的打的語言名字，**不是**字面的 `"other"` —— 存 `"other"`
 * 等於把語言丟掉：重開編輯還原不出來，送去翻譯的一方也不知道要翻成什麼，而且全程
 * 沒有任何錯誤訊息（PR #1016 review）。選了「其他」卻沒打字則退回 `"other"`，
 * 至少把「老師選過其他」這件事留住。
 */
export function toStoredTranslateLanguage(
  selected: string,
  custom: string,
): string {
  if (selected !== "other") return text(selected);
  return text(custom).trim() || "other";
}

/** 上面那個的反向：存下來的單一值 → 面板的（下拉選擇 + 自訂欄位）。 */
export function fromStoredTranslateLanguage(stored: string): {
  selected: string;
  custom: string;
} {
  const value = text(stored);
  if (!value) return { selected: "", custom: "" };
  // 認得的選項值原樣還原；其餘一律視為自訂語言
  return (TRANSLATION_LANGUAGE_VALUES as readonly string[]).includes(value)
    ? { selected: value, custom: "" }
    : { selected: "other", custom: value };
}

/** 時態正規化。`null`／`undefined` 一律保持 `null`（＝沿用整體），不可填成空物件 */
const toTensePayload = (tense: TenseSetting | null | undefined) =>
  tense == null ? null : { time: text(tense.time), aspect: text(tense.aspect) };

/**
 * 面板 state → API payload。
 *
 * 沒打題目的列會被略過（面板預設就有一張空白卡），題數上下限由面板與後端各擋一次，
 * 這裡不重複判斷 —— 對映層只負責換形狀。
 */
export function toScenarioSavePayload(
  input: ScenarioSaveInput,
): ScenarioSavePayload {
  const scenario_settings: ScenarioSettingsPayload = {
    // 情境內容空字串是合法值（老師只給標題、自己出題），不要當成缺值
    scenario_content: text(input.scenarioContent),
    question_level: text(input.questionLevel),
    global_rubric: text(input.globalRubric),
    global_tense: toTensePayload(input.globalTense) ?? { ...EMPTY_TENSE },
    global_voice: text(input.globalVoice),
    translate_language: text(input.translateLanguage),
    tts_settings: input.ttsSettings
      ? {
          accent: text(input.ttsSettings.accent),
          gender: text(input.ttsSettings.gender),
          speed: text(input.ttsSettings.speed),
        }
      : null,
    scenario_images: (input.scenarioImages || [])
      .map((u) => text(u).trim())
      .filter(Boolean),
    scenario_mode: text(input.scenarioMode),
    question_source: text(input.questionSource),
    goal: text(input.goal),
    article_level: text(input.articleLevel),
    direction: text(input.direction),
  };

  const items = (input.rows || [])
    .filter((row) => text(row.question).trim())
    .map((row) => ({
      // 既有題目帶上 DB id，後端才會原地更新而不是刪掉重建（#861）
      ...(row.contentItemId == null ? {} : { id: row.contentItemId }),
      // 題目本文／翻譯／圖片／音檔沿用既有欄位，不塞進 scenario_dialogue
      text: text(row.question).trim(),
      translation: text(row.translation).trim(),
      image_url: row.imageUrl ?? null,
      audio_url: row.audioUrl ?? null,
      scenario_dialogue: {
        // 兩個 override 一律保留 null／值的差別，這裡不可以用 `||` 折疊
        tense_override: toTensePayload(row.tenseOverride),
        voice_override:
          row.voiceOverride == null ? null : text(row.voiceOverride),
        keywords: (row.keywords || [])
          .map((k) => text(k).trim())
          .filter(Boolean),
        reference_answer: text(row.referenceAnswer),
        rubric_note: text(row.rubricNote),
        image_prompt: text(row.imagePrompt),
      },
    }));

  return { scenario_settings, items };
}

/**
 * API 回傳 → 面板初始 state（編輯模式）。
 *
 * 舊資料（或非本題型轉過來的內容）可能完全沒有 `scenario_settings` /
 * `scenario_dialogue`，一律落成安全預設而不是丟錯 —— 面板打不開的話老師連改都沒得改。
 * 沒存過覆寫的題目視為「沿用整體」（`null`），與面板新建列的預設一致。
 */
export function fromScenarioContentDetail(
  detail: ScenarioContentDetail,
): ScenarioDialogueInitialState {
  const settings = detail.scenario_settings || {};
  const rawTense = settings.global_tense;
  const tts = settings.tts_settings;

  return {
    title: text(detail.title),
    scenarioContent: text(settings.scenario_content),
    scenarioImages: Array.isArray(settings.scenario_images)
      ? settings.scenario_images.map(text).filter(Boolean)
      : [],
    scenarioMode: text(settings.scenario_mode),
    questionSource: text(settings.question_source),
    goal: text(settings.goal),
    articleLevel: text(settings.article_level),
    direction: text(settings.direction),
    questionLevel: text(settings.question_level),
    globalRubric: text(settings.global_rubric),
    globalTense: rawTense
      ? { time: text(rawTense.time), aspect: text(rawTense.aspect) }
      : { ...EMPTY_TENSE },
    globalVoice: text(settings.global_voice),
    translateLanguage: text(settings.translate_language),
    ttsSettings: tts
      ? {
          accent: text(tts.accent),
          gender: text(tts.gender),
          speed: text(tts.speed),
        }
      : null,
    rows: (detail.items || []).map((item) => {
      const block = item.scenario_dialogue || {};
      return createScenarioRow({
        contentItemId: typeof item.id === "number" ? item.id : null,
        question: text(item.text),
        translation: text(item.translation),
        // undefined（沒存過）與 null（沿用整體）都落成 null；只有物件才是脫鉤，
        // 且脫鉤後的空物件 { time: "", aspect: "" } 要原樣保留，不可再折回 null
        tenseOverride: block.tense_override
          ? {
              time: text(block.tense_override.time),
              aspect: text(block.tense_override.aspect),
            }
          : null,
        voiceOverride: block.voice_override ?? null,
        keywords: Array.isArray(block.keywords) ? block.keywords.map(text) : [],
        referenceAnswer: text(block.reference_answer),
        rubricNote: text(block.rubric_note),
        imagePrompt: text(block.image_prompt),
        imageUrl: item.image_url ?? null,
        audioUrl: item.audio_url ?? null,
      });
    }),
  };
}
