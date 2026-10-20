/**
 * 情境對話 sample 頁的 mock 資料與 mock AI（#1133）。
 *
 * 內容取自 staging 學生李小美被派的兩份情境對話作業（唯讀快照，執行期不連 DB）：
 * - #648「上課口說練習」（assignment 274）：長篇題組文章、5 題、B1 → 示範情境 A／B
 * - #650「談談暑假的旅行經驗」（assignment 276）：情境只有一句、5 題、A2、每題有作答提示 → 情境 C
 *
 * 圖片為一次性產生的黑白線稿，放在 public/samples/scenario-dialogue/（650 第 5 題刻意無圖）。
 * 資料界線：`image_prompt` 不收進來；`reference_answer` 只在老師預覽才放進題目，
 * 學生模式下只有 mock AI（模擬後端）拿得到，用來產生「建議說法」。
 */

import type {
  ScenarioChatAdapters,
  ScenarioChatContext,
  ScenarioChatItem,
  ScenarioFeedback,
} from "@/components/activities/scenario-dialogue/types";

export type MaterialId = 648 | 650;
export type ScenarioKind = "A" | "B" | "C";
export type QuestionImageMode = "none" | "one" | "many" | "mixed";

interface RawItem {
  text: string;
  translation: string;
  keywords: string[];
  rubricNote: string;
  referenceAnswer: string;
  /** 圖檔名（不含副檔名）；無圖為 null */
  image: string | null;
}

interface RawMaterial {
  id: MaterialId;
  title: string;
  level: string;
  rubric: string;
  scenarioContent: string;
  contextImages: string[];
  items: RawItem[];
}

const IMG_BASE = "/samples/scenario-dialogue/";
const img = (name: string) => `${IMG_BASE}${name}.jpg`;

export const MATERIALS: Record<MaterialId, RawMaterial> = {
  648: {
    id: 648,
    title: "上課口說練習",
    level: "B1",
    rubric: "請用完整句子回答",
    scenarioContent:
      "Every afternoon, the bell rings at four o'clock, and Ethan quickly packs his schoolbag. While some of his classmates go straight home, Ethan has a busy schedule of extracurricular activities almost every day.\n\nOn Mondays and Thursdays, he rushes to the community sports center for table tennis training. He enjoys playing fast-paced matches with his coach and teammates, which helps him stay active after sitting in class all day.\n\nOn other weekdays, Ethan focuses on music and academics. He attends an English club on Tuesdays to practice speaking, and on Wednesdays, he plays the violin at a local music studio. These activities keep him busy but happy before he finally goes home for dinner.",
    contextImages: ["648-ctx1", "648-ctx2", "648-ctx3"],
    items: [
      {
        text: "What does Ethan do immediately after the school bell rings at four o'clock, and how does his afternoon differ from some of his classmates?",
        translation:
          "當四點鐘聲響起時，伊森立刻做什麼？他的下午行程和一些同學有何不同？",
        keywords: ["packs", "schoolbag", "extracurricular"],
        rubricNote: "",
        referenceAnswer:
          "When the bell rings at four o'clock, Ethan quickly packs his schoolbag. While some of his classmates go straight home, Ethan has a busy schedule of extracurricular activities almost every day.",
        image: "648-q1",
      },
      {
        text: "Which sports activity does Ethan do on Mondays and Thursdays, and where does this activity take place?",
        translation: "伊森在週一和週四進行什麼體育活動？這個活動在哪裡進行？",
        keywords: ["table tennis", "sports center"],
        rubricNote: "",
        referenceAnswer:
          "On Mondays and Thursdays, Ethan trains in table tennis. This activity takes place at the community sports center.",
        image: "648-q2",
      },
      {
        text: "Why does Ethan enjoy playing table tennis after a long day of school?",
        translation: "為什麼伊森喜歡在上了整天課之後打桌球？",
        keywords: ["fast-paced", "active", "sitting"],
        rubricNote: "",
        referenceAnswer:
          "He enjoys playing fast-paced matches because it helps him stay active after sitting in class all day.",
        image: "648-q3",
      },
      {
        text: "What does Ethan do on Tuesdays and Wednesdays to focus on music and academics?",
        translation: "伊森在週二和週三做些什麼來專注於音樂和學業？",
        keywords: ["English club", "violin"],
        rubricNote: "",
        referenceAnswer:
          "On Tuesdays, Ethan attends an English club to practice speaking. On Wednesdays, he plays the violin at a local music studio.",
        image: "648-q4",
      },
      {
        text: "How does Ethan feel about his busy weekday schedule, and what does he do at the end of these activities?",
        translation:
          "伊森對他忙碌的平日行程有何感受？在這些活動結束後他會做什麼？",
        keywords: ["busy but happy", "dinner"],
        rubricNote: "",
        referenceAnswer:
          "Ethan feels busy but happy with his schedule. After all his activities are finished, he finally goes home to have dinner.",
        image: "648-q5",
      },
    ],
  },
  650: {
    id: 650,
    title: "談談暑假的旅行經驗",
    level: "A2",
    rubric:
      "學生學習以過去式描述暑假期間旅遊地點的天氣、季節，並用授予動詞談談自己的過去經驗。",
    scenarioContent: "談談暑假期間旅遊經驗",
    contextImages: [],
    items: [
      {
        text: "How was your trip in summer vacation?",
        translation: "你的暑假旅行如何?",
        keywords: [],
        rubricNote:
          "善用以下動詞來描述你對此旅行的感受。\nbuilding，充實的；relaxing，悠閒的；extensive，內容的；tight，緊湊的；flexible，有彈性的\n請勿使用good, great, nice, bad等較攏統的形容詞。",
        referenceAnswer: "It was flexible.",
        image: "650-q1",
      },
      {
        text: "Where did you go? Who did you go with?",
        translation: "你去哪裡旅行? 跟誰一起去?",
        keywords: ["went"],
        rubricNote: "善用句型: I wen to (地點) with (同行者).",
        referenceAnswer: "I went to Okinawa with my family.",
        image: "650-q2",
      },
      {
        text: "What spot impressed you the most? How was there?",
        translation: "哪個地方給你留下了最深刻的印象？ 景色如何?",
        keywords: [],
        rubricNote:
          "此問句針對旅遊地點的景色如何做描述，而非談論對整趟旅程的看法，也許你感覺自己不喜歡整趟旅程，但景色的部分確認你感覺經驗；請善用以下形容詞描述景色。\nbreathtaking 極美的、scenic 景色優美的、isolated 偏僻的、unappealing 不吸引人的、sweeping 一望無際的；\n善用句型:\n(景點) impressed me a lot. \n(景色，如: The sea) was (形容詞)",
        referenceAnswer:
          "Okinawa World impressed me a lot. The cave was breathtaking.",
        image: "650-q3",
      },
      {
        text: "How was the weather there?",
        translation: "那裡天氣如何?",
        keywords: [],
        rubricNote:
          "請善用以下形容詞描述旅遊時當地的天氣和季節，或更多其他能描述天氣的形容詞。\nsunny 陽光普照的、clear 晴朗無雲的、rainy 下雨的、stormy 惡劣的、windy and cloudy 有風多雲的",
        referenceAnswer: "It was windy and cloudy.",
        image: "650-q4",
      },
      {
        text: "What did you buy to your friends?",
        translation: "你買了什麼東西給朋友?",
        keywords: ["bought"],
        rubricNote:
          "如果你沒有購買任何東西給朋友，請假設已經購買了某項物品給朋友。\n善用句型: \nI bought my friends (某物). 或 I bought (某物) to my friends.",
        referenceAnswer:
          "I bought pineapple candy and Okinawa salt cake to my students and friends.",
        image: null,
      },
    ],
  },
};

/** 「多張」示範：同一題拿兩張既有圖組合（本題＋下一張有圖的題目），不另外生圖 */
function pairImages(items: RawItem[], i: number): string[] {
  const own = items[i].image;
  if (!own) return [];
  for (let k = 1; k < items.length; k++) {
    const other = items[(i + k) % items.length].image;
    if (other && other !== own) return [own, other];
  }
  return [own];
}

function questionImages(
  m: RawMaterial,
  i: number,
  mode: QuestionImageMode,
): string[] {
  const own = m.items[i].image;
  if (mode === "none") return [];
  if (mode === "one") return own ? [own] : [];
  if (mode === "many") return pairImages(m.items, i);
  // mixed：#648 Q1 無圖、Q2 1 張、Q3 2 張、Q4–5 各 1 張；#650 照資料
  if (m.id === 648) {
    if (i === 0) return [];
    if (i === 2) return pairImages(m.items, i);
  }
  return own ? [own] : [];
}

export interface SampleOptions {
  material: MaterialId;
  kind: ScenarioKind;
  contextImageCount: 1 | 3;
  imageMode: QuestionImageMode;
  isPreview: boolean;
}

export function buildSample(opts: SampleOptions): {
  context: ScenarioChatContext;
  items: ScenarioChatItem[];
} {
  const m = MATERIALS[opts.material];
  const kind: ScenarioKind = opts.material === 650 ? "C" : opts.kind;

  const context: ScenarioChatContext =
    kind === "C"
      ? {
          title: m.scenarioContent,
          images: [],
          rubric: m.rubric,
          level: m.level,
        }
      : {
          title: m.title,
          content: m.scenarioContent,
          images:
            kind === "A"
              ? m.contextImages
                  .slice(0, opts.contextImageCount)
                  .map((name, k) => ({
                    src: img(name),
                    alt: `情境圖 ${k + 1}`,
                  }))
              : [],
          rubric: m.rubric,
          level: m.level,
        };

  const items: ScenarioChatItem[] = m.items.map((it, i) => ({
    id: `${m.id}-${i}`,
    text: it.text,
    translation: it.translation,
    keywords: it.keywords,
    rubricNote: it.rubricNote || undefined,
    images: questionImages(m, i, opts.imageMode).map((name, k) => ({
      src: img(name),
      alt: `第 ${i + 1} 題圖片 ${k + 1}`,
    })),
    // 參考答案只給老師預覽
    ...(opts.isPreview ? { referenceAnswer: it.referenceAnswer } : {}),
  }));

  return { context, items };
}

/** 固定可重現的 mock 分數：第 1 次 60–70、第 2 次起 85–95 */
function mockScore(itemId: string, attemptIndex: number) {
  const seed = [...itemId].reduce((s, c) => s + c.charCodeAt(0), 0);
  const spread = (seed * 7 + attemptIndex * 3) % 11;
  return attemptIndex === 0 ? 60 + spread : 85 + spread;
}

export function speakEnglish(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

/** mock AI：模擬後端（拿得到參考答案），第 1 次「可以更好」＋建議說法，之後「很棒」 */
export function createMockAdapters(material: MaterialId): ScenarioChatAdapters {
  const m = MATERIALS[material];
  return {
    speak: speakEnglish,
    getFeedback: (item, _answer, attemptIndex) =>
      new Promise<ScenarioFeedback>((resolve) => {
        const idx = Number(String(item.id).split("-")[1]);
        const ref = m.items[idx]?.referenceAnswer;
        const score = mockScore(String(item.id), attemptIndex);
        setTimeout(() => {
          resolve(
            attemptIndex === 0
              ? {
                  verdict: "improve",
                  comment:
                    "意思有傳達到！試著說成完整的句子，並用上題目的關鍵字，會更清楚。",
                  suggestion: ref,
                  score,
                }
              : {
                  verdict: "great",
                  comment: "很棒！句子完整、用字也更精準了。",
                  score,
                },
          );
        }, 1200);
      }),
  };
}
