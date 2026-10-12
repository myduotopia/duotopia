/**
 * 擷取結果裡的圖片座標 → 裁切 + 上傳（Issue #1084 / #1086）。
 *
 * 一份考卷可能同時有文章插圖、題幹圖與圖片選項，全部由 AI 回 box_2d，前端自己裁。
 * 本檔只做「一批 box → 一批 url」，單題（`QuestionSheet`）與題組（`useExtractedGroup`）共用：
 * - 原圖只解碼一次（`cropImageFileMany`）
 * - 上傳是循序的（避免一次打十幾個請求），任何一張失敗回 null 不中斷其他張
 * - PDF 無法在前端點陣化 → 全部 null，由呼叫端提示老師手動補圖
 */

import type { TFunction } from "i18next";
import { toast } from "sonner";

import type {
  MagicPasteGroupResult,
  MagicPasteMcItem,
} from "@/components/shared/MagicPasteInput";

import { cropImageFileMany } from "./cropImage";
import type { GroupExtractImages } from "./extractedGroup";
import type { ExtractedQuestionImages } from "./questionDraft";
import { uploadImageFile } from "./uploadImageFile";

export type { GroupExtractImages };

/** 擷取結果裡能裁圖的檔案類型（PDF 不行） */
export function canCropFrom(file: File): boolean {
  return file.type.startsWith("image/");
}

/**
 * 依 boxes 裁圖並上傳，回傳與 boxes 等長的 url 陣列。
 * null 的位置代表「沒座標／裁不出來／上傳失敗」，呼叫端照樣往下走（老師可自己換圖）。
 *
 * 一次可能裁十幾張（四個圖片選項 × 多題），所以每張上傳都走 `silent`，
 * 整批結束後只 toast 一次摘要，不讓老師被連續彈窗洗臉。
 */
export async function uploadCroppedBoxes(
  file: File,
  boxes: (number[] | null | undefined)[],
  t: TFunction,
  nameSuffix = "crop",
): Promise<(string | null)[]> {
  if (boxes.length === 0) return [];
  const cropped = await cropImageFileMany(file, boxes, nameSuffix);
  const urls: (string | null)[] = [];
  let failed = 0;
  for (const f of cropped) {
    if (!f) {
      urls.push(null);
      continue;
    }
    const url = await uploadImageFile(f, t, { silent: true });
    if (url === null) failed += 1;
    urls.push(url);
  }
  if (failed > 0) {
    toast.error(
      t("contentEditor.magicPaste.croppedImageUploadFailed", { count: failed }),
    );
  }
  return urls;
}

/** 小題題幹圖 + 選項圖的座標攤平成一條（給 cropImageFileMany 一次解碼） */
function questionBoxes(items: MagicPasteMcItem[]): (number[] | null)[] {
  const boxes: (number[] | null)[] = [];
  for (const it of items) {
    boxes.push(it.stem_box_2d ?? null);
    for (let i = 0; i < it.options.length; i += 1) {
      boxes.push(it.option_boxes?.[i] ?? null);
    }
  }
  return boxes;
}

/** 把攤平的 url 依 `questionBoxes` 的順序切回每小題 */
function splitQuestionUrls(
  items: MagicPasteMcItem[],
  urls: (string | null)[],
): ExtractedQuestionImages {
  const stemUrls: (string | null)[] = [];
  const optionUrls: (string | null)[][] = [];
  let i = 0;
  for (const it of items) {
    stemUrls.push(urls[i] ?? null);
    i += 1;
    const own: (string | null)[] = [];
    for (let o = 0; o < it.options.length; o += 1) {
      own.push(urls[i] ?? null);
      i += 1;
    }
    optionUrls.push(own);
  }
  return { stemUrls, optionUrls };
}

function emptyQuestionImages(
  items: MagicPasteMcItem[],
): ExtractedQuestionImages {
  return {
    stemUrls: items.map(() => null),
    optionUrls: items.map((it) => it.options.map(() => null)),
  };
}

/**
 * 單題擷取（multiple_choice）的題幹圖與選項圖：一次解碼、循序上傳。
 * PDF 不能在前端裁圖 → 全部 null 並提示老師手動補圖。
 */
export async function uploadExtractedQuestionImages(
  items: MagicPasteMcItem[],
  file: File,
  t: TFunction,
): Promise<ExtractedQuestionImages> {
  const boxes = questionBoxes(items);
  if (boxes.every((b) => !b)) return emptyQuestionImages(items);
  if (!canCropFrom(file)) {
    toast.info(t("contentEditor.magicPaste.groupImageNeedsUpload"));
    return emptyQuestionImages(items);
  }
  return splitQuestionUrls(items, await uploadCroppedBoxes(file, boxes, t));
}

/**
 * 題組擷取（reading_group，含克漏字）的所有圖：整塊素材圖、文章插圖、小題圖。
 * 全部的 box 一起交給 `cropImageFileMany`，原圖只解碼一次。
 */
export async function uploadExtractedGroupImages(
  result: MagicPasteGroupResult,
  file: File,
  t: TFunction,
): Promise<GroupExtractImages> {
  const figures = result.stimulus.figures ?? [];
  const isImageStimulus = result.stimulus.kind === "image";
  const qBoxes = questionBoxes(result.questions);
  const boxes: (number[] | null)[] = [
    isImageStimulus ? (result.stimulus.box_2d ?? null) : null,
    ...figures.map((f) => f.box_2d),
    ...qBoxes,
  ];

  const nothingToCrop = boxes.every((b) => !b) && !isImageStimulus;
  if (nothingToCrop || !canCropFrom(file)) {
    // PDF：文字與空格照常，圖片一律略過並提示（純文字題組不用提示）
    if (!nothingToCrop) {
      toast.info(t("contentEditor.magicPaste.groupImageNeedsUpload"));
    }
    return {
      stimulusUrl: null,
      figureUrls: figures.map(() => null),
      questions: emptyQuestionImages(result.questions),
    };
  }

  const urls = await uploadCroppedBoxes(file, boxes, t);
  let stimulusUrl = urls[0] ?? null;
  if (isImageStimulus && stimulusUrl === null) {
    // 座標裁不出來：整張原圖當素材，老師可以自己換
    toast.info(t("contentEditor.magicPaste.groupImageFallbackWhole"));
    stimulusUrl = await uploadImageFile(file, t);
  }
  const figureUrls = urls.slice(1, 1 + figures.length);
  return {
    stimulusUrl,
    figureUrls,
    questions: splitQuestionUrls(
      result.questions,
      urls.slice(1 + figures.length),
    ),
  };
}
