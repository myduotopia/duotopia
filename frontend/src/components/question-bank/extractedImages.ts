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

import { cropImageFileMany } from "./cropImage";
import { uploadImageFile } from "./uploadImageFile";

/** 擷取結果裡能裁圖的檔案類型（PDF 不行） */
export function canCropFrom(file: File): boolean {
  return file.type.startsWith("image/");
}

/**
 * 依 boxes 裁圖並上傳，回傳與 boxes 等長的 url 陣列。
 * null 的位置代表「沒座標／裁不出來／上傳失敗」，呼叫端照樣往下走（老師可自己換圖）。
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
  for (const f of cropped) {
    urls.push(f ? await uploadImageFile(f, t) : null);
  }
  return urls;
}
