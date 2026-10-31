/**
 * scenarioDialogue 對映層測試（Issue #1013）
 *
 * 這一層唯一的職責是把面板 state 與後端 payload 對起來，所以測試盯的也是對映本身：
 * 最重要的是 `null`（沿用整體）與 `""`／空物件（本題明確不指定）**不可被壓平成同一個
 * 值** —— 一旦壓平，老師之後改整體評分標準，原本該跟著變的題目就不會變了，而且畫面上
 * 看不出差別，等到 AI 評分才會用錯時態。
 */
import { describe, it, expect } from "vitest";
import {
  toScenarioSavePayload,
  fromScenarioContentDetail,
  toStoredTranslateLanguage,
  fromStoredTranslateLanguage,
  type ScenarioSaveInput,
} from "../scenarioDialogue";

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  id: "row-1",
  contentItemId: null,
  question: "What did you do last weekend?",
  translation: "你上週末做了什麼？",
  tenseOverride: null,
  voiceOverride: null,
  keywords: ["park", "basketball"],
  referenceAnswer: "I went to the park with my family.",
  rubricNote: "要說出地點",
  imagePrompt: "a park on a sunny day",
  imageUrl: null,
  audioUrl: null,
  revision: 0,
  ...overrides,
});

const makeInput = (overrides: Partial<ScenarioSaveInput> = {}) =>
  ({
    title: "Weekend Talk",
    rows: [makeRow()],
    scenarioContent: "It is Monday morning at school.",
    questionLevel: "B1",
    globalRubric: "請用完整句子回答",
    globalTense: { time: "past", aspect: "simple" },
    globalVoice: "active",
    translateLanguage: "chinese",
    ttsSettings: { accent: "US", gender: "Female", speed: "Normal x1" },
    ...overrides,
  }) as ScenarioSaveInput;

describe("toScenarioSavePayload — 整份設定", () => {
  it("把面板 state 轉成後端的 snake_case 設定", () => {
    const { scenario_settings } = toScenarioSavePayload(makeInput());

    expect(scenario_settings).toEqual({
      scenario_content: "It is Monday morning at school.",
      question_level: "B1",
      global_rubric: "請用完整句子回答",
      global_tense: { time: "past", aspect: "simple" },
      global_voice: "active",
      translate_language: "chinese",
      tts_settings: { accent: "US", gender: "Female", speed: "Normal x1" },
      // #1146：舊呼叫端沒帶對話紀錄與情境圖 → 一律送空值，不送 undefined
      scenario_images: [],
      scenario_mode: "",
      question_source: "",
      goal: "",
      article_level: "",
      direction: "",
    });
  });

  it("#1146 對話紀錄與情境圖原樣送出，空白網址略過", () => {
    const { scenario_settings } = toScenarioSavePayload(
      makeInput({
        scenarioImages: ["https://cdn/a.png", " ", "https://cdn/b.png"],
        scenarioMode: "ai",
        questionSource: "ai",
        goal: "交通工具與問路",
        articleLevel: "A2",
        direction: "",
      }),
    );
    expect(scenario_settings.scenario_images).toEqual([
      "https://cdn/a.png",
      "https://cdn/b.png",
    ]);
    expect(scenario_settings.scenario_mode).toBe("ai");
    expect(scenario_settings.question_source).toBe("ai");
    expect(scenario_settings.goal).toBe("交通工具與問路");
    expect(scenario_settings.article_level).toBe("A2");
  });

  it("#1146 回填：已存的對話紀錄與情境圖還原，舊資料落成空值", () => {
    const state = fromScenarioContentDetail({
      id: 1,
      scenario_settings: {
        scenario_images: ["https://cdn/a.png"],
        scenario_mode: "none",
        question_source: "ai",
        direction: "週末做什麼",
      },
    });
    expect(state.scenarioImages).toEqual(["https://cdn/a.png"]);
    expect(state.scenarioMode).toBe("none");
    expect(state.questionSource).toBe("ai");
    expect(state.direction).toBe("週末做什麼");

    const old = fromScenarioContentDetail({ id: 2, scenario_settings: {} });
    expect(old.scenarioImages).toEqual([]);
    expect(old.scenarioMode).toBe("");
    expect(old.goal).toBe("");
  });

  it("情境內容留空仍然存得起來（老師自己出題是合法路徑）", () => {
    const { scenario_settings } = toScenarioSavePayload(
      makeInput({ scenarioContent: "" }),
    );
    expect(scenario_settings.scenario_content).toBe("");
  });

  it("整體評分標準沒選時送空字串，不送 null（整份沒有上層可沿用）", () => {
    const { scenario_settings } = toScenarioSavePayload(
      makeInput({ globalTense: { time: "", aspect: "" }, globalVoice: "" }),
    );
    expect(scenario_settings.global_tense).toEqual({ time: "", aspect: "" });
    expect(scenario_settings.global_voice).toBe("");
  });
});

describe("toScenarioSavePayload — 逐題 null 語意（不可壓平）", () => {
  it("tenseOverride/voiceOverride 為 null 時原樣送出 null（沿用整體）", () => {
    const { items } = toScenarioSavePayload(makeInput());

    expect(items[0].scenario_dialogue.tense_override).toBeNull();
    expect(items[0].scenario_dialogue.voice_override).toBeNull();
  });

  it("本題明確不指定（空值）與沿用整體（null）是兩種不同的送出結果", () => {
    const { items } = toScenarioSavePayload(
      makeInput({
        rows: [
          makeRow({
            id: "a",
            tenseOverride: { time: "", aspect: "" },
            voiceOverride: "",
          }),
          makeRow({ id: "b", tenseOverride: null, voiceOverride: null }),
        ],
      }),
    );

    // 脫鉤但不指定 —— 之後改整體不該影響這一題
    expect(items[0].scenario_dialogue.tense_override).toEqual({
      time: "",
      aspect: "",
    });
    expect(items[0].scenario_dialogue.voice_override).toBe("");
    // 沿用整體
    expect(items[1].scenario_dialogue.tense_override).toBeNull();
    expect(items[1].scenario_dialogue.voice_override).toBeNull();
  });

  it("有覆寫時照原值送出", () => {
    const { items } = toScenarioSavePayload(
      makeInput({
        rows: [
          makeRow({
            tenseOverride: { time: "future", aspect: "perfect" },
            voiceOverride: "passive",
          }),
        ],
      }),
    );
    expect(items[0].scenario_dialogue.tense_override).toEqual({
      time: "future",
      aspect: "perfect",
    });
    expect(items[0].scenario_dialogue.voice_override).toBe("passive");
  });
});

describe("toScenarioSavePayload — 逐題欄位", () => {
  it("題目本文／翻譯／圖片／音檔走既有欄位，不塞進 scenario_dialogue", () => {
    const { items } = toScenarioSavePayload(
      makeInput({
        rows: [
          makeRow({
            imageUrl: "https://cdn/img.png",
            audioUrl: "https://cdn/a.mp3",
          }),
        ],
      }),
    );

    expect(items[0].text).toBe("What did you do last weekend?");
    expect(items[0].translation).toBe("你上週末做了什麼？");
    expect(items[0].image_url).toBe("https://cdn/img.png");
    expect(items[0].audio_url).toBe("https://cdn/a.mp3");
    expect(items[0].scenario_dialogue).not.toHaveProperty("text");
  });

  it("參考答案／評分備註／必用字詞／圖片 prompt 放在 scenario_dialogue 底下", () => {
    const { items } = toScenarioSavePayload(makeInput());

    expect(items[0].scenario_dialogue).toMatchObject({
      keywords: ["park", "basketball"],
      reference_answer: "I went to the park with my family.",
      rubric_note: "要說出地點",
      image_prompt: "a park on a sunny day",
    });
  });

  it("略過沒打題目的空白列（面板一開就給一張空卡）", () => {
    const { items } = toScenarioSavePayload(
      makeInput({
        rows: [
          makeRow({ id: "a" }),
          makeRow({ id: "blank", question: "   " }),
          makeRow({ id: "b", question: "And on Sunday?" }),
        ],
      }),
    );

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.text)).toEqual([
      "What did you do last weekend?",
      "And on Sunday?",
    ]);
  });

  it("題目本文與翻譯去頭尾空白", () => {
    const { items } = toScenarioSavePayload(
      makeInput({
        rows: [makeRow({ question: "  Hi there?  ", translation: " 嗨 " })],
      }),
    );
    expect(items[0].text).toBe("Hi there?");
    expect(items[0].translation).toBe("嗨");
  });
});

describe("toScenarioSavePayload — 既有題目的 DB id（#861）", () => {
  it("既有題目帶上 id，後端才會原地更新而不是刪掉重建", () => {
    const { items } = toScenarioSavePayload(
      makeInput({ rows: [makeRow({ contentItemId: 42 })] }),
    );
    expect(items[0].id).toBe(42);
  });

  it("新題不帶 id（帶了 null 會被後端當成不合法的既有 id）", () => {
    const { items } = toScenarioSavePayload(
      makeInput({ rows: [makeRow({ contentItemId: null })] }),
    );
    expect(items[0]).not.toHaveProperty("id");
  });

  it("既有題目與新題混在一起時各自正確", () => {
    const { items } = toScenarioSavePayload(
      makeInput({
        rows: [
          makeRow({ id: "a", contentItemId: 7, question: "old" }),
          makeRow({ id: "b", contentItemId: null, question: "new" }),
        ],
      }),
    );
    expect(items[0].id).toBe(7);
    expect(items[1]).not.toHaveProperty("id");
  });
});

describe("fromScenarioContentDetail — 編輯模式回填", () => {
  const detail = {
    id: 7,
    title: "Weekend Talk",
    scenario_settings: {
      scenario_content: "It is Monday morning at school.",
      question_level: "B1",
      global_rubric: "請用完整句子回答",
      global_tense: { time: "past", aspect: "simple" },
      global_voice: "active",
      translate_language: "chinese",
      tts_settings: { accent: "US", gender: "Female", speed: "Normal x1" },
    },
    items: [
      {
        id: 11,
        text: "What did you do last weekend?",
        translation: "你上週末做了什麼？",
        image_url: "https://cdn/img.png",
        audio_url: null,
        scenario_dialogue: {
          tense_override: null,
          voice_override: null,
          keywords: ["park"],
          reference_answer: "I went to the park.",
          rubric_note: "要說出地點",
          image_prompt: "a park",
        },
      },
      {
        id: 12,
        text: "And on Sunday?",
        translation: "那星期天呢？",
        image_url: null,
        audio_url: null,
        scenario_dialogue: {
          tense_override: { time: "", aspect: "" },
          voice_override: "",
          keywords: [],
          reference_answer: "",
          rubric_note: "",
          image_prompt: "",
        },
      },
    ],
  };

  it("回填整份設定", () => {
    const state = fromScenarioContentDetail(detail);

    expect(state.title).toBe("Weekend Talk");
    expect(state.scenarioContent).toBe("It is Monday morning at school.");
    expect(state.questionLevel).toBe("B1");
    expect(state.globalRubric).toBe("請用完整句子回答");
    expect(state.globalTense).toEqual({ time: "past", aspect: "simple" });
    expect(state.globalVoice).toBe("active");
    expect(state.translateLanguage).toBe("chinese");
    expect(state.ttsSettings).toEqual({
      accent: "US",
      gender: "Female",
      speed: "Normal x1",
    });
  });

  it("回填時保留 null 與空值的差別", () => {
    const state = fromScenarioContentDetail(detail);

    expect(state.rows[0].tenseOverride).toBeNull();
    expect(state.rows[0].voiceOverride).toBeNull();
    expect(state.rows[1].tenseOverride).toEqual({ time: "", aspect: "" });
    expect(state.rows[1].voiceOverride).toBe("");
  });

  it("回填時記住 content_items.id，存回去才不會刪掉重建（#861）", () => {
    const state = fromScenarioContentDetail(detail);
    expect(state.rows.map((r) => r.contentItemId)).toEqual([11, 12]);

    // 直接存回去，兩題都應該帶著原本的 id
    const { items } = toScenarioSavePayload({
      ...makeInput(),
      rows: state.rows,
    });
    expect(items.map((i) => i.id)).toEqual([11, 12]);
  });

  it("每一列都有穩定的 id，供拖曳排序使用", () => {
    const state = fromScenarioContentDetail(detail);

    const ids = state.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => !!id)).toBe(true);
  });

  it("舊資料沒有 scenario_settings / scenario_dialogue 時給安全預設，不炸掉", () => {
    const state = fromScenarioContentDetail({
      id: 8,
      title: "Legacy",
      scenario_settings: null,
      items: [{ id: 1, text: "Hi?", translation: null }],
    });

    expect(state.scenarioContent).toBe("");
    expect(state.globalTense).toEqual({ time: "", aspect: "" });
    expect(state.globalVoice).toBe("");
    expect(state.ttsSettings).toBeNull();
    expect(state.rows[0]).toMatchObject({
      question: "Hi?",
      translation: "",
      keywords: [],
      referenceAnswer: "",
      // 沒存過的舊資料視為「沿用整體」
      tenseOverride: null,
      voiceOverride: null,
    });
  });

  it("完全沒有 items 時回傳空陣列（呼叫端自行補空白列）", () => {
    const state = fromScenarioContentDetail({ id: 9, title: "Empty" });
    expect(state.rows).toEqual([]);
  });
});

describe("存檔 → 回填 round trip", () => {
  it("兩個 override 的三種狀態（null／空／有值）都不被壓平", () => {
    const input = makeInput({
      rows: [
        makeRow({ id: "a", tenseOverride: null, voiceOverride: null }),
        makeRow({
          id: "b",
          tenseOverride: { time: "", aspect: "" },
          voiceOverride: "",
        }),
        makeRow({
          id: "c",
          tenseOverride: { time: "future", aspect: "perfect" },
          voiceOverride: "passive",
        }),
      ],
    });

    const saved = toScenarioSavePayload(input);
    // 後端把 items 原樣存下再吐回來（欄位名一致），這裡直接餵回去
    const state = fromScenarioContentDetail({
      id: 1,
      title: input.title,
      scenario_settings: saved.scenario_settings,
      items: saved.items.map((item, idx) => ({
        id: idx + 1,
        text: item.text,
        translation: item.translation,
        image_url: item.image_url,
        audio_url: item.audio_url,
        scenario_dialogue: item.scenario_dialogue,
      })),
    });

    expect(state.rows.map((r) => r.tenseOverride)).toEqual([
      null,
      { time: "", aspect: "" },
      { time: "future", aspect: "perfect" },
    ]);
    expect(state.rows.map((r) => r.voiceOverride)).toEqual([
      null,
      "",
      "passive",
    ]);
    expect(state.globalTense).toEqual(input.globalTense);
    expect(state.scenarioContent).toBe(input.scenarioContent);
  });
});

/**
 * 「其他」語言（PR #1016 review round 3）
 *
 * 老師選「其他」時，真正的語言名字在另一個 state（customLang）裡。只送 "other"
 * 的話，存進去的是一個沒有意義的字串，重開編輯也還原不出來 —— 而且沒有任何錯誤。
 */
describe("翻譯語言的「其他」不可遺失", () => {
  it("選內建語言時原樣送出", () => {
    expect(toStoredTranslateLanguage("chinese", "")).toBe("chinese");
    expect(toStoredTranslateLanguage("japanese", "西班牙文")).toBe("japanese");
  });

  it("選「其他」時送出老師打的語言名字，而不是字面的 other", () => {
    expect(toStoredTranslateLanguage("other", "  西班牙文 ")).toBe("西班牙文");
  });

  it("選了「其他」卻沒打字時退回 other，至少保留這個選擇", () => {
    expect(toStoredTranslateLanguage("other", "   ")).toBe("other");
  });

  it("沒選語言時是空字串（＝沒有要翻譯）", () => {
    expect(toStoredTranslateLanguage("", "")).toBe("");
  });

  it("回填：內建語言原樣還原，自訂語言還原成 other + 自訂欄位", () => {
    expect(fromStoredTranslateLanguage("korean")).toEqual({
      selected: "korean",
      custom: "",
    });
    expect(fromStoredTranslateLanguage("西班牙文")).toEqual({
      selected: "other",
      custom: "西班牙文",
    });
    expect(fromStoredTranslateLanguage("other")).toEqual({
      selected: "other",
      custom: "",
    });
    expect(fromStoredTranslateLanguage("")).toEqual({
      selected: "",
      custom: "",
    });
  });

  it("存檔 → 回填 round trip 拿得回同一個自訂語言", () => {
    const stored = toStoredTranslateLanguage("other", "西班牙文");
    expect(fromStoredTranslateLanguage(stored)).toEqual({
      selected: "other",
      custom: "西班牙文",
    });
  });
});
