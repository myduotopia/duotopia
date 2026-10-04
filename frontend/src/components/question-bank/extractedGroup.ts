/**
 * 考卷擷取（reading_group 模式）→ 題組草稿（Issue #1084 / #1086）。
 *
 * 純函式，供 QuestionSheet 在 AI 擷取完成後把結果填進右側的 GroupCard：
 * - `boxToPixelRect`：AI 回的 box_2d（[ymin, xmin, ymax, xmax]，0–1000 正規化）→ 像素矩形，
 *   裁圖用（實際裁切在 cropImage.ts，上傳在 extractedImages.ts）
 * - `paragraphsToLayout`：散文段落（＋文章插圖）→ 單欄 layout，插圖依
 *   `after_paragraph` 自己一行（center、不設寬度，老師可再拖成並排）
 * - `groupDraftFromExtracted`：以既有（通常是空的）GroupDraft 為底，填入標題／排版／文字版／
 *   註解／小題；保留 key、公開設定、來源、年段等左欄已定的值；AI 沒給標題時保留既有標題
 *
 * kind=text：排版 = 段落區塊（＋插圖），文字版由排版推導（edited=false）
 * kind=image：排版 = 一張裁好的圖（沒圖就 null），文字版 = 圖內文字（edited=true，老師可修）
 *
 * 克漏字（base.question_type === "cloze"）：段落直接採用 AI 重編後的 `{{n}}`，
 * 小題 `blank_index` 取 `question.blank`；AI 漏給或對不上時改依閱讀順序補配
 * （`matchClozeBlanks`）。閱讀題組若意外拿到 `{{n}}` 一律轉回底線，避免後端 422。
 */

import type {
  MagicPasteGroupResult,
  MagicPasteMcItem,
} from "@/components/shared/MagicPasteInput";
import type { LayoutDoc } from "@/types/questionBank";

import { layoutBlankIndexes } from "./layoutInline";
import { singleImageDoc, toLayoutDoc } from "./layoutEditorModel";
import {
  draftsFromExtracted,
  sortClozeQuestions,
  type ExtractedQuestionImages,
  type GroupDraft,
  type QuestionDraft,
} from "./questionDraft";

/** 文章插圖：AI 回的座標已裁好上傳，url 為 null 代表裁不出來（PDF／失敗） */
export interface ExtractedFigure {
  after_paragraph: number;
  caption: string;
  url: string | null;
}

/** 閱讀題組（非克漏字）誤帶 `{{n}}` 時改回印刷空格的底線 */
const PLAIN_BLANK = "____";

/** 把 `{{n}}` 換成底線（閱讀題組用；克漏字保留 token） */
export function stripBlankTokens(text: string): string {
  return text.replace(/\{\{\d+\}\}/g, PLAIN_BLANK);
}

/** box_2d 的座標尺度（Gemini 慣用 0–1000） */
export const BOX_2D_SCALE = 1000;

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** [ymin, xmin, ymax, xmax]（0–1000）→ 像素矩形；不合法或面積為 0 回 null */
export function boxToPixelRect(
  box: number[] | null | undefined,
  imageWidth: number,
  imageHeight: number,
): PixelRect | null {
  if (!box || box.length !== 4 || imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }
  const [ymin, xmin, ymax, xmax] = box;
  if (![ymin, xmin, ymax, xmax].every((v) => Number.isFinite(v))) return null;
  const clamp = (v: number) => Math.min(BOX_2D_SCALE, Math.max(0, v));
  const x1 = Math.round((clamp(xmin) / BOX_2D_SCALE) * imageWidth);
  const x2 = Math.round((clamp(xmax) / BOX_2D_SCALE) * imageWidth);
  const y1 = Math.round((clamp(ymin) / BOX_2D_SCALE) * imageHeight);
  const y2 = Math.round((clamp(ymax) / BOX_2D_SCALE) * imageHeight);
  const width = x2 - x1;
  const height = y2 - y1;
  if (width < 1 || height < 1) return null;
  return { x: x1, y: y1, width, height };
}

/**
 * 散文段落（＋文章插圖）→ 單欄、一段一區塊的排版；完全沒內容回 null。
 *
 * 插圖依 `after_paragraph` 排在那一段之後（-1 = 第一段之前），同一欄直排，
 * 不嘗試自動並排（老師可在編輯器把圖拖到段落旁邊）。url 為 null 的插圖直接略過。
 */
export function paragraphsToLayout(
  paragraphs: string[],
  figures: ExtractedFigure[] = [],
): LayoutDoc | null {
  const texts = paragraphs.map((p) => p.trim()).filter((p) => p !== "");
  const placed = figures.filter((f) => f.url !== null);
  const imageBlocks = (after: number) =>
    placed
      .filter((f) => f.after_paragraph === after)
      .map((f) => ({
        type: "image" as const,
        url: f.url as string,
        align: "center" as const,
        ...(f.caption ? { caption: f.caption } : {}),
      }));
  const blocks = [
    // after_paragraph = -1：插在第一段之前
    ...imageBlocks(-1),
    ...texts.flatMap((text, i) => [
      { type: "paragraph" as const, text },
      ...imageBlocks(i),
    ]),
  ];
  if (blocks.length === 0) return null;
  return { version: 1, rows: [{ columns: [{ span: 1, blocks }] }] };
}

/** 擷取到的小題 → 題組小題（帶題組的 key／題型／公開／來源／年段／教材） */
export function extractedQuestionsToGroup(
  items: MagicPasteMcItem[],
  base: GroupDraft,
  images: ExtractedQuestionImages = {},
): GroupDraft["questions"] {
  return draftsFromExtracted(
    items,
    {
      exam_points: [],
      grade: base.grade,
      program_link: base.program_link,
    },
    images,
  ).map((d) => ({
    ...d,
    question_type: base.question_type,
    groupKey: base.key,
    visibility: base.visibility,
    sources: base.sources,
  }));
}

/**
 * 克漏字小題 ↔ 文章空格對應。
 *
 * 先用 AI 給的 `blank`；只要「每題都有、不重複、且剛好等於文章裡的空格集合」就採用。
 * 任一條不成立（AI 漏給一個、給了文章裡沒有的編號…）就整批改依閱讀順序補配：
 * 文章第 i 個空格 ↔ 第 i 題。小題比空格多時多出來的留 null，交既有驗證提示老師。
 */
export function matchClozeBlanks(
  questions: QuestionDraft[],
  items: MagicPasteMcItem[],
  layoutBlanks: number[],
): QuestionDraft[] {
  const given = items.map((it) => it.blank ?? null);
  const unique = new Set(given.filter((n): n is number => n !== null));
  const trustworthy =
    given.every((n) => n !== null) &&
    unique.size === given.length &&
    unique.size === layoutBlanks.length &&
    layoutBlanks.every((n) => unique.has(n));
  return sortClozeQuestions(
    questions.map((q, i) => ({
      ...q,
      blank_index: trustworthy ? given[i] : (layoutBlanks[i] ?? null),
    })),
  );
}

/** 已裁好並上傳的圖片 URL（由 `uploadExtractedGroupImages` 準備） */
export interface GroupExtractImages {
  /** kind=image 的整塊素材圖；裁不出來（PDF／失敗）為 null */
  stimulusUrl: string | null;
  /** kind=text 的文章插圖，與 `stimulus.figures` 等長 */
  figureUrls?: (string | null)[];
  /** 小題的題幹圖與選項圖 */
  questions?: ExtractedQuestionImages;
}

/** 擷取結果填進題組草稿。 */
export function groupDraftFromExtracted(
  result: MagicPasteGroupResult,
  base: GroupDraft,
  images: GroupExtractImages,
): GroupDraft {
  const imageUrl = images.stimulusUrl;
  const isCloze = base.question_type === "cloze";
  // 擷取到非空標題才覆蓋；否則保留老師已打的標題（重新擷取時不清掉）
  const title = result.title.trim() || base.title;
  const questions = extractedQuestionsToGroup(
    result.questions,
    base,
    images.questions ?? {},
  );
  const glossary = result.glossary
    .map((g) => ({ word: g.word.trim(), zh: g.zh.trim() }))
    .filter((g) => g.word !== "" && g.zh !== "");

  if (result.stimulus.kind === "image") {
    const text = result.stimulus.text.trim();
    return {
      ...base,
      title,
      layout: imageUrl
        ? toLayoutDoc(singleImageDoc(imageUrl, title || "stimulus"))
        : null,
      image_url: null,
      passage_text: text,
      passage_text_edited: text !== "",
      glossary,
      questions,
      serverError: null,
    };
  }

  // 克漏字保留 AI 重編後的 `{{n}}`；閱讀題組轉回底線（後端對 reading 含 {{n}} 會 422）
  const paragraphs = isCloze
    ? result.stimulus.paragraphs
    : result.stimulus.paragraphs.map(stripBlankTokens);
  const figures = (result.stimulus.figures ?? []).map((f, i) => ({
    after_paragraph: f.after_paragraph,
    caption: f.caption,
    url: images.figureUrls?.[i] ?? null,
  }));
  const layout = paragraphsToLayout(paragraphs, figures);
  // AI 沒切段落但有給整段文字：當老師版文字版，排版留空讓老師自己排
  const fallbackText = layout ? "" : result.stimulus.text.trim();
  return {
    ...base,
    title,
    layout,
    image_url: null,
    passage_text: fallbackText,
    passage_text_edited: fallbackText !== "",
    glossary,
    questions: isCloze
      ? matchClozeBlanks(
          questions,
          result.questions,
          layoutBlankIndexes(layout),
        )
      : questions,
    serverError: null,
  };
}
