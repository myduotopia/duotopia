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
import {
  scenarioChatFromStudentActivity,
  scenarioChatFromTeacherContent,
} from "../fromApi";
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

  it("沒有情境圖時回空陣列", () => {
    expect(scenarioChatFromTeacherContent(detail).context.images).toEqual([]);
  });

  it("讀 scenario_settings.scenario_images 當情境圖，略過空值與非字串（#1158 E5）", () => {
    const withImages = {
      ...detail,
      scenario_settings: {
        ...detail.scenario_settings,
        scenario_images: [
          "https://example.com/s1.jpg",
          "",
          "https://example.com/s2.jpg",
          3,
        ],
      },
    } as unknown as typeof detail;
    expect(scenarioChatFromTeacherContent(withImages).context.images).toEqual([
      { src: "https://example.com/s1.jpg", alt: "Scenario image 1" },
      { src: "https://example.com/s2.jpg", alt: "Scenario image 2" },
    ]);
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
      { src: "https://example.com/q1.jpg", alt: "Question 1 image" },
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
  it("alt 不是只有一個數字（讀螢幕的人要聽得懂那是什麼圖）", () => {
    const { items } = scenarioChatFromTeacherContent(detail);
    const alt = items[0].images[0].alt ?? "";
    expect(alt).not.toMatch(/^\d+$/);
    expect(alt).toContain("1");
  });
});

describe("scenarioChatFromStudentActivity", () => {
  const activity = {
    title: "週末計畫",
    scenario_settings: {
      scenario_content: "你和朋友在討論這個週末要做什麼。",
      global_rubric: "請用完整句子回答。",
      translate_language: "chinese",
    },
    items: [
      {
        id: 9001,
        text: "What did you do last weekend?",
        translation: "你上週末做了什麼？",
        image_url: "https://example.com/q1.jpg",
        scenario_dialogue: { keywords: ["went"], rubric_note: "要用過去式" },
      },
      {
        id: 9002,
        text: "Who did you go with?",
        scenario_dialogue: { keywords: [], rubric_note: "" },
      },
    ],
  };

  it("學生端也讀情境圖（#1158 E5）", () => {
    const { context } = scenarioChatFromStudentActivity({
      ...activity,
      scenario_settings: {
        ...activity.scenario_settings,
        scenario_images: ["https://example.com/s1.jpg"],
      },
    });
    expect(context.images).toEqual([
      { src: "https://example.com/s1.jpg", alt: "Scenario image 1" },
    ]);
  });

  it("情境文章與作答指引進 context", () => {
    const { context } = scenarioChatFromStudentActivity(activity);
    expect(context.title).toBe("週末計畫");
    expect(context.content).toBe("你和朋友在討論這個週末要做什麼。");
    expect(context.rubric).toBe("請用完整句子回答。");
  });

  it("題目、翻譯、必用字詞、本題說明、題目圖片都帶過去", () => {
    const { items } = scenarioChatFromStudentActivity(activity);
    expect(items[0]).toMatchObject({
      id: 9001,
      text: "What did you do last weekend?",
      translation: "你上週末做了什麼？",
      translationLanguage: "chinese",
      keywords: ["went"],
      rubricNote: "要用過去式",
    });
    expect(items[0].images).toEqual([
      { src: "https://example.com/q1.jpg", alt: "Question 1 image" },
    ]);
    expect(items[1].images).toEqual([]);
  });

  /**
   * 學生端 payload 的 reference_answer / image_prompt 是後端的 public_item_view 就濾掉
   * 的，所以這一支連「要不要帶」都沒有選項。這條測試是防止哪天有人把它改成物件展開。
   */
  it("學生端沒有參考答案可帶（也不該從任何地方冒出來）", () => {
    const polluted = {
      ...activity,
      items: [
        {
          ...activity.items[0],
          scenario_dialogue: {
            ...activity.items[0].scenario_dialogue,
            reference_answer: "I went to a movie.",
            image_prompt: "a cinema",
          },
        },
      ],
    };
    const { items } = scenarioChatFromStudentActivity(polluted);
    expect(items[0].referenceAnswer).toBeUndefined();
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain("I went to a movie.");
    expect(serialized).not.toContain("a cinema");
  });

  it("空 items／缺設定都落成安全預設", () => {
    const { context, items } = scenarioChatFromStudentActivity({ items: null });
    expect(context).toMatchObject({ title: "", content: "", rubric: "" });
    expect(items).toEqual([]);
  });

  it("與老師端版本對同一份內容產生一致的題數", () => {
    const { items } = scenarioChatFromStudentActivity(activity);
    expect(items).toHaveLength(activity.items.length);
  });
});
