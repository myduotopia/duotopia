/**
 * 情境對話派發預覽的資料對映測試。
 *
 * 這裡只驗**純對映**（老師端 content detail → 學生端 Activity），不渲染整個學生頁：
 * 預覽的畫面本身就是學生端元件（見 docs/design/preview-architecture.md），畫面長怎樣
 * 已經由學生端自己的測試負責；會在這一層出錯的是「餵進去的資料形狀」。
 *
 * 其中最要緊的一條是**參考答案不可外洩**：老師端端點會回 reference_answer 與
 * image_prompt（出題與 AI 評分用），學生端的 public_item_view 會濾掉它們。預覽共用
 * 學生元件，所以餵資料的這一步必須做同一件事，否則哪天學生端多渲染一個欄位就漏了。
 */
import { describe, it, expect } from "vitest";
import { buildScenarioPreviewActivity } from "../ScenarioDialoguePreview";
import type { ScenarioContentDetail } from "@/lib/scenarioDialogue";

const detail: ScenarioContentDetail = {
  id: 501,
  title: "週末計畫",
  scenario_settings: {
    scenario_content: "你和朋友在討論這個週末要做什麼。",
    global_rubric: "請用完整句子回答。",
    translate_language: "chinese",
    question_level: "A2",
    global_voice: "active",
  },
  items: [
    {
      id: 9001,
      text: "What did you do last weekend?",
      translation: "你上週末做了什麼？",
      audio_url: "https://example.com/q1.mp3",
      scenario_dialogue: {
        keywords: ["went", "movie"],
        rubric_note: "要用過去式",
        reference_answer: "I went to a movie with my cousin.",
        image_prompt: "two teenagers at a cinema",
        tense_override: null,
        voice_override: null,
      },
    },
    {
      id: 9002,
      text: "Who did you go with?",
      translation: "你和誰一起去？",
      scenario_dialogue: {
        keywords: [],
        rubric_note: "",
        reference_answer: "My cousin.",
        image_prompt: "",
        tense_override: null,
        voice_override: null,
      },
    },
  ],
};

describe("buildScenarioPreviewActivity — 老師端 content detail → 學生端 Activity", () => {
  it("題目本文、翻譯、音檔照原樣帶給學生元件", () => {
    const activity = buildScenarioPreviewActivity(detail);
    expect(activity.items).toHaveLength(2);
    expect(activity.items?.[0]).toMatchObject({
      id: 9001,
      text: "What did you do last weekend?",
      translation: "你上週末做了什麼？",
      audio_url: "https://example.com/q1.mp3",
    });
    expect(activity.items?.[1]?.text).toBe("Who did you go with?");
  });

  it("情境內容與作答指引帶進 scenario_settings（學生畫面置頂常駐那塊）", () => {
    const activity = buildScenarioPreviewActivity(detail);
    expect(activity.scenario_settings).toEqual({
      scenario_content: "你和朋友在討論這個週末要做什麼。",
      global_rubric: "請用完整句子回答。",
      translate_language: "chinese",
    });
  });

  it("逐題必用字詞帶進 scenario_dialogue.keywords", () => {
    const activity = buildScenarioPreviewActivity(detail);
    expect(activity.items?.[0]?.scenario_dialogue?.keywords).toEqual([
      "went",
      "movie",
    ]);
    expect(activity.items?.[1]?.scenario_dialogue?.keywords).toEqual([]);
  });

  it("參考答案與生圖 prompt 絕對不進預覽資料（與後端 public_item_view 同一條界線）", () => {
    const activity = buildScenarioPreviewActivity(detail);
    const serialized = JSON.stringify(activity);
    expect(serialized).not.toContain("reference_answer");
    expect(serialized).not.toContain("image_prompt");
    expect(serialized).not.toContain("I went to a movie with my cousin.");
    expect(serialized).not.toContain("two teenagers at a cinema");
    expect(serialized).not.toContain("My cousin.");
  });

  it("keywords 是複製而非共用參照（預覽改不到老師正在編的資料）", () => {
    const activity = buildScenarioPreviewActivity(detail);
    const keywords = activity.items?.[0]?.scenario_dialogue?.keywords;
    expect(keywords).not.toBe(detail.items?.[0]?.scenario_dialogue?.keywords);
  });

  it("type 標成 SCENARIO_DIALOGUE，標題沿用教材標題", () => {
    const activity = buildScenarioPreviewActivity(detail);
    expect(activity.type).toBe("SCENARIO_DIALOGUE");
    expect(activity.title).toBe("週末計畫");
  });

  it("缺 scenario_settings / scenario_dialogue 的舊資料落成空字串與空陣列，不丟錯", () => {
    const bare: ScenarioContentDetail = {
      id: 1,
      title: null,
      items: [{ id: 2, text: "Hi?" }],
    };
    const activity = buildScenarioPreviewActivity(bare);
    expect(activity.scenario_settings).toEqual({
      scenario_content: "",
      global_rubric: "",
      translate_language: "",
    });
    expect(activity.items?.[0]?.scenario_dialogue?.keywords).toEqual([]);
    expect(activity.title).toBe("");
  });

  it("items 為 null 時回空陣列（呼叫端據此顯示「沒有題目可預覽」）", () => {
    expect(
      buildScenarioPreviewActivity({ id: 1, title: "x", items: null }).items,
    ).toEqual([]);
  });

  /**
   * 學生端後端不會過濾空題目（get_sentence_fields 對情境對話原樣回傳），預覽也不能
   * 自己濾掉 —— 濾掉的話老師在預覽看到 3 題、學生實際拿到 4 題。
   */
  it("空題目不自己濾掉：預覽的題數要跟學生實際拿到的一致", () => {
    const withBlank: ScenarioContentDetail = {
      id: 1,
      title: "x",
      items: [{ id: 1, text: "A?" }, { id: 2, text: "" }, { id: 3 }],
    };
    expect(buildScenarioPreviewActivity(withBlank).items).toHaveLength(3);
  });
});
