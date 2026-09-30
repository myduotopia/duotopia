/**
 * 依 AI 回的 box_2d 在前端裁圖（Issue #1084 第 1 段）。
 *
 * 只處理圖片檔：PDF 前端無法點陣化（沒有 pdf.js），回 null 由呼叫端提示老師另外上傳素材圖。
 * 流程：載入圖片 → canvas drawImage 裁切 → PNG（超過上傳上限就改 JPEG）→ File。
 * 任何失敗（座標不合法、canvas 不可用、瀏覽器不支援）一律回 null，不丟例外。
 */

import { boxToPixelRect } from "./extractedGroup";
import { MAX_IMAGE_BYTES } from "./uploadImageFile";

type Drawable = ImageBitmap | HTMLImageElement;

async function loadDrawable(
  file: File,
): Promise<{
  source: Drawable;
  width: number;
  height: number;
  release: () => void;
}> {
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
  if (!box || !file.type.startsWith("image/")) return null;
  if (typeof document === "undefined") return null;
  let loaded: Awaited<ReturnType<typeof loadDrawable>> | null = null;
  try {
    loaded = await loadDrawable(file);
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
    const baseName = file.name.replace(/\.[^.]+$/, "") || "stimulus";
    return new File([blob], `${baseName}-stimulus.${ext}`, { type: blob.type });
  } catch (err) {
    console.error("Crop stimulus image failed:", err);
    return null;
  } finally {
    loaded?.release();
  }
}
