/**
 * API 回應 → 對話式 UI 的資料形狀（Issue #1140 Stage 2）。
 *
 * `types.ts` 的設計就是「元件只吃自訂型別，不直接碰後端 schema」，並註明下一階段
 * 由 API 回應轉換。這個檔案就是那層轉換，而這支測試守的是它最容易出錯的地方：
 *
 * 1. **參考答案只給老師**。老師端的 content detail 會回 `reference_answer` 與
 *    `image_prompt`（出題與 AI 評分用）；學生那一側一個都不能有。
 * 2. **題數不自己增減**。預覽看到 3 題、學生實際拿到 4 題是最難追的那種 bug。
 */
import { describe, it, expect } from "vitest";
import { scenarioChatFromTeacherContent } from "../fromApi";
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
      image_url: "https://example.com/q1.jpg",
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

describe("scenarioChatFromTeacherContent", () => {
  it("情境文章、作答指引、難度進 context", () => {
    const { context } = scenarioChatFromTeacherContent(detail);
    expect(context.title).toBe("週末計畫");
    expect(context.content).toBe("你和朋友在討論這個週末要做什麼。");
    expect(context.rubric).toBe("請用完整句子回答。");
    expect(context.level).toBe("A2");
  });

  /**
   * 情境文章的配圖**目前沒有資料欄位**（`scenario_settings` 只有 scenario_content /
   * question_level / global_rubric / global_tense / global_voice / translate_language /
   * tts_settings）。設計稿那幾張情境圖是 `public/samples/` 的 mock。
   * 這裡回空陣列而不是硬湊 —— 要有情境配圖得先加欄位。
   */
  it("情境配圖回空陣列（後端還沒有這個欄位）", () => {
    expect(scenarioChatFromTeacherContent(detail).context.images).toEqual([]);
  });

  it("題目本文、翻譯、翻譯語言、必用字詞、本題說明都帶過去", () => {
    const { items } = scenarioChatFromTeacherContent(detail);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      text: "What did you do last weekend?",
      translation: "你上週末做了什麼？",
      translationLanguage: "chinese",
      keywords: ["went", "movie"],
      rubricNote: "要用過去式",
    });
  });

  it("題目圖片有就帶一張，沒有就空陣列", () => {
    const { items } = scenarioChatFromTeacherContent(detail);
    expect(items[0].images).toEqual([
      { src: "https://example.com/q1.jpg", alt: expect.any(String) },
    ]);
    expect(items[1].images).toEqual([]);
  });

  it("預設不帶參考答案", () => {
    const { items } = scenarioChatFromTeacherContent(detail);
    expect(items[0].referenceAnswer).toBeUndefined();
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain("I went to a movie with my cousin.");
    expect(serialized).not.toContain("reference_answer");
  });

  it("老師預覽才帶參考答案（withReferenceAnswer）", () => {
    const { items } = scenarioChatFromTeacherContent(detail, {
      withReferenceAnswer: true,
    });
    expect(items[0].referenceAnswer).toBe("I went to a movie with my cousin.");
  });

  it("生圖 prompt 一律不帶（連老師預覽也不需要）", () => {
    for (const opts of [{}, { withReferenceAnswer: true }]) {
      const { items } = scenarioChatFromTeacherContent(detail, opts);
      const serialized = JSON.stringify(items);
      expect(serialized).not.toContain("image_prompt");
      expect(serialized).not.toContain("two teenagers at a cinema");
    }
  });

  it("每題有穩定且唯一的 id（元件用它當 React key 與重答對照）", () => {
    const { items } = scenarioChatFromTeacherContent(detail);
    expect(items[0].id).toBe(9001);
    expect(items[1].id).toBe(9002);
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });

  it("沒有 id 的題目也拿得到唯一 id（舊資料或還沒存檔）", () => {
    const { items } = scenarioChatFromTeacherContent({
      id: 1,
      title: "x",
      items: [{ text: "A?" }, { text: "B?" }],
    });
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });

  it("keywords 是複製而非共用參照", () => {
    const { items } = scenarioChatFromTeacherContent(detail);
    expect(items[0].keywords).not.toBe(
      detail.items?.[0]?.scenario_dialogue?.keywords,
    );
  });

  it("空題目不自己濾掉 —— 題數要與學生實際拿到的一致", () => {
    const { items } = scenarioChatFromTeacherContent({
      id: 1,
      title: "x",
      items: [{ id: 1, text: "A?" }, { id: 2, text: "" }, { id: 3 }],
    });
    expect(items).toHaveLength(3);
  });

  it("缺 scenario_settings 的舊資料落成安全預設，不丟錯", () => {
    const { context, items } = scenarioChatFromTeacherContent({
      id: 1,
      title: null,
      items: [{ id: 2, text: "Hi?" }],
    });
    expect(context.title).toBe("");
    expect(context.content).toBe("");
    expect(context.rubric).toBe("");
    expect(items[0].keywords).toEqual([]);
    expect(items[0].rubricNote).toBeUndefined();
  });

  it("items 為 null 時回空陣列（呼叫端據此顯示「沒有題目」）", () => {
    expect(
      scenarioChatFromTeacherContent({ id: 1, title: "x", items: null }).items,
    ).toEqual([]);
  });
});
