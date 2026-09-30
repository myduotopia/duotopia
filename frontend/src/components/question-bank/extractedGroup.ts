/**
 * 考卷擷取（reading_group 模式）→ 題組草稿（Issue #1084 第 1 段）。
 *
 * 純函式，供 QuestionSheet 在 AI 擷取完成後把結果填進右側的 GroupCard：
 * - `boxToPixelRect`：AI 回的 box_2d（[ymin, xmin, ymax, xmax]，0–1000 正規化）→ 像素矩形，
 *   裁圖用（實際裁切在 cropImage.ts）
 * - `paragraphsToLayout`：散文段落 → 單欄多段落的 layout
 * - `groupDraftFromExtracted`：以既有（通常是空的）GroupDraft 為底，填入標題／排版／文字版／
 *   註解／小題；保留 key、公開設定、來源、年段等左欄已定的值
 *
 * kind=text：排版 = 段落區塊，文字版由排版推導（edited=false）
 * kind=image：排版 = 一張裁好的圖（沒圖就 null），文字版 = 圖內文字（edited=true，老師可修）
 */

import type {
  MagicPasteGroupResult,
  MagicPasteMcItem,
} from "@/components/shared/MagicPasteInput";
import type { LayoutDoc } from "@/types/questionBank";

import { singleImageDoc, toLayoutDoc } from "./layoutEditorModel";
import { draftsFromExtracted, type GroupDraft } from "./questionDraft";

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

/** 散文段落 → 單欄、一段一區塊的排版；沒有段落回 null */
export function paragraphsToLayout(paragraphs: string[]): LayoutDoc | null {
  const texts = paragraphs.map((p) => p.trim()).filter((p) => p !== "");
  if (texts.length === 0) return null;
  return {
    version: 1,
    rows: [
      {
        columns: [
          {
            span: 1,
            blocks: texts.map((text) => ({ type: "paragraph" as const, text })),
          },
        ],
      },
    ],
  };
}

/** 擷取到的小題 → 題組小題（帶題組的 key／題型／公開／來源／年段／教材） */
export function extractedQuestionsToGroup(
  items: MagicPasteMcItem[],
  base: GroupDraft,
): GroupDraft["questions"] {
  return draftsFromExtracted(items, {
    exam_points: [],
    grade: base.grade,
    program_link: base.program_link,
  }).map((d) => ({
    ...d,
    question_type: base.question_type,
    groupKey: base.key,
    visibility: base.visibility,
    sources: base.sources,
  }));
}

/**
 * 擷取結果填進題組草稿。
 * @param imageUrl kind=image 時已裁好並上傳的圖片 URL；裁不出來（PDF／失敗）給 null
 */
export function groupDraftFromExtracted(
  result: MagicPasteGroupResult,
  base: GroupDraft,
  imageUrl: string | null,
): GroupDraft {
  const title = result.title.trim();
  const questions = extractedQuestionsToGroup(result.questions, base);
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

  const layout = paragraphsToLayout(result.stimulus.paragraphs);
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
    questions,
    serverError: null,
  };
}
