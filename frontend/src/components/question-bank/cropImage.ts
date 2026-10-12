/**
 * 依 AI 回的 box_2d 在前端裁圖（Issue #1084）。
 *
 * 只處理圖片檔：PDF 前端無法點陣化（沒有 pdf.js），回 null 由呼叫端提示老師另外上傳素材圖。
 * 流程：載入圖片 → canvas drawImage 裁切 → PNG（超過上傳上限就改 JPEG）→ File。
 * 任何失敗（座標不合法、canvas 不可用、瀏覽器不支援）一律回 null，不丟例外。
 *
 * 一份考卷可能要裁十幾張（文章插圖＋每小題題幹圖＋四個圖片選項），所以
 * `cropImageFileMany` **只解碼原圖一次**，再對每個 box 各畫一次 canvas；
 * `cropImageFile` 是它的單框版包裝。檔名帶序號，避免多張同名。
 */

import { boxToPixelRect } from "./extractedGroup";
import { MAX_IMAGE_BYTES } from "./uploadImageFile";

type Drawable = ImageBitmap | HTMLImageElement;

interface LoadedDrawable {
  source: Drawable;
  width: number;
  height: number;
  release: () => void;
}

async function loadDrawable(file: File): Promise<LoadedDrawable> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close?.(),
    };
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** 裁出素材區域；裁不了回 null */
export async function cropImageFile(
  file: File,
  box: number[] | null | undefined,
): Promise<File | null> {
  const [cropped] = await cropImageFileMany(file, [box], "stimulus");
  return cropped ?? null;
}

/**
 * 一次裁多框：只解碼原圖一次。
 * 回傳與 `boxes` 等長的陣列，裁不出來的位置為 null（不中斷同批的其他框）。
 * 非圖片檔（PDF）、沒有可用的 canvas、或整批都沒座標 → 全部 null。
 */
export async function cropImageFileMany(
  file: File,
  boxes: (number[] | null | undefined)[],
  nameSuffix = "crop",
): Promise<(File | null)[]> {
  if (boxes.length === 0) return [];
  const blank: (File | null)[] = boxes.map(() => null);
  if (!file.type.startsWith("image/")) return blank;
  if (typeof document === "undefined") return blank;
  if (boxes.every((b) => !b)) return blank;
  let loaded: LoadedDrawable;
  try {
    loaded = await loadDrawable(file);
  } catch (err) {
    console.error("Crop image: load failed:", err);
    return blank;
  }
  try {
    const baseName = file.name.replace(/\.[^.]+$/, "") || "stimulus";
    const out: (File | null)[] = [];
    for (let i = 0; i < boxes.length; i += 1) {
      out.push(
        await cropOne(loaded, boxes[i], `${baseName}-${nameSuffix}${i + 1}`),
      );
    }
    return out;
  } finally {
    loaded.release();
  }
}

/** 單框裁切；座標不合法或畫不出來回 null（不影響同批的其他框） */
async function cropOne(
  loaded: LoadedDrawable,
  box: number[] | null | undefined,
  baseName: string,
): Promise<File | null> {
  if (!box) return null;
  try {
    const rect = boxToPixelRect(box, loaded.width, loaded.height);
    if (!rect) return null;
    const canvas = document.createElement("canvas");
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(
      loaded.source,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height,
    );
    let blob = await canvasToBlob(canvas, "image/png");
    let ext = "png";
    if (blob && blob.size > MAX_IMAGE_BYTES) {
      blob = await canvasToBlob(canvas, "image/jpeg", 0.85);
      ext = "jpg";
    }
    if (!blob) return null;
    return new File([blob], `${baseName}.${ext}`, { type: blob.type });
  } catch (err) {
    console.error("Crop image failed:", err);
    return null;
  }
}
