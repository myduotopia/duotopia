/**
 * 情境圖（Issue #1146）：擷取後自動裁切、上傳、手動重裁的邏輯層。
 *
 * 一份情境最多 MAX_SCENARIO_IMAGES 張（後端 `utils/scenario_dialogue.py` 同值），學生
 * 作答時看得到；題目圖仍是每題 1 張（`row.imageUrl`），兩者無關。
 *
 * 來源三種：
 * 1. 上傳**圖片**擷取 → 後端回 figures 的 box_2d → 從原圖裁切
 * 2. 上傳 **PDF** 擷取 → 前端用 pdf.js 把有圖的那幾頁畫成頁面圖（`lib/pdfToImages`）→
 *    從頁面圖裁切
 * 3. 老師自己另外上傳（不經擷取）→ 整張就是一張情境圖
 * 4. AI 生圖（#1158）→ 後端生好、存好直接回網址，沒有原圖（不能重裁）
 *
 * 裁切用的原圖（`source.file`）留在前端記憶體，老師才能「調整裁切範圍」重裁；
 * 存檔後重開編輯就沒有原圖了（只有網址），那時不能重裁、只能刪掉重傳。
 */
import type { TFunction } from "i18next";

import {
  cropImageFile,
  cropImageFileMany,
} from "@/components/question-bank/cropImage";
import {
  MAX_IMAGE_BYTES,
  VALID_IMAGE_TYPES,
  uploadImageFile,
} from "@/components/question-bank/uploadImageFile";
import { isPdfFile, pdfToImages } from "@/lib/pdfToImages";

export const MAX_SCENARIO_IMAGES = 5;

/** 整張圖的框（[ymin, xmin, ymax, xmax]，0–1000） */
export const FULL_BOX = [0, 0, 1000, 1000];

export interface ScenarioImageSource {
  /** 裁切用的原圖（圖片檔本身，或 PDF 那一頁的頁面圖） */
  file: File;
  /** 目前裁切範圍 */
  box: number[];
}

export interface ScenarioImage {
  /** 前端用的 key */
  id: string;
  /** 已上傳的網址（存進 scenario_settings.scenario_images） */
  url: string;
  /** 可重裁時才有；存檔後重開的圖、AI 生的圖為 null */
  source: ScenarioImageSource | null;
  /** AI 生的圖（#1158）：沒有原圖可裁，不顯示「調整裁切」 */
  generated?: boolean;
}

/** 擷取端點回傳的一張圖 */
export interface ExtractedFigure {
  page: number;
  box_2d: number[];
}

let seq = 0;
export const nextImageId = () => `si-${Date.now()}-${seq++}`;

/** 已存的網址 → 面板 state（沒有原圖，不能重裁） */
export const imagesFromUrls = (urls: string[] | null | undefined) =>
  (urls || [])
    .filter((u) => typeof u === "string" && u.trim())
    .map<ScenarioImage>((url) => ({ id: nextImageId(), url, source: null }));

/**
 * 依擷取結果裁出圖檔（還沒上傳）。
 *
 * 回傳順序照 figures；裁不出來的（HEIC 之類瀏覽器解不開、座標不合法）略過。
 * PDF 只畫有圖的那幾頁，不整份畫。
 */
export async function cropFigures(
  file: File,
  figures: ExtractedFigure[],
): Promise<{ file: File; source: ScenarioImageSource }[]> {
  if (figures.length === 0) return [];
  const out: { file: File; source: ScenarioImageSource }[] = [];

  if (isPdfFile(file)) {
    const pages = await pdfToImages(file, {
      pages: figures.map((f) => f.page),
    });
    const byPage = new Map(pages.map((p) => [p.page, p.file]));
    for (const figure of figures) {
      const pageFile = byPage.get(figure.page);
      if (!pageFile) continue;
      const cropped = await cropImageFile(pageFile, figure.box_2d);
      if (cropped) {
        out.push({
          file: cropped,
          source: { file: pageFile, box: figure.box_2d },
        });
      }
    }
    return out;
  }

  const crops = await cropImageFileMany(
    file,
    figures.map((f) => f.box_2d),
    "scenario",
  );
  crops.forEach((cropped, i) => {
    if (cropped) {
      out.push({ file: cropped, source: { file, box: figures[i].box_2d } });
    }
  });
  return out;
}

/**
 * 上傳一批裁好的圖，回傳成功的那些（失敗的略過，由呼叫端統一提示）。
 * `room` 是還剩幾格（最多 5 張），超過的不上傳。
 */
export async function uploadCrops(
  crops: { file: File; source: ScenarioImageSource | null }[],
  room: number,
  t: TFunction,
): Promise<{ images: ScenarioImage[]; failed: number; skipped: number }> {
  const take = crops.slice(0, Math.max(0, room));
  const skipped = crops.length - take.length;
  const images: ScenarioImage[] = [];
  let failed = 0;
  for (const crop of take) {
    const url = await uploadImageFile(crop.file, t, { silent: true });
    if (url) {
      images.push({ id: nextImageId(), url, source: crop.source });
    } else {
      failed += 1;
    }
  }
  return { images, failed, skipped };
}

/** 老師自己另外上傳的圖：先擋大小與格式（沿用題目圖的 2MB 規則），再上傳 */
export function validateManualImage(file: File): string | null {
  if (file.size > MAX_IMAGE_BYTES) return "vocabularySet.image.tooLarge";
  if (!VALID_IMAGE_TYPES.includes(file.type)) {
    return "vocabularySet.image.invalidType";
  }
  return null;
}

/** 依新的框重裁並上傳；失敗回 null */
export async function recropImage(
  image: ScenarioImage,
  box: number[],
  t: TFunction,
): Promise<ScenarioImage | null> {
  if (!image.source) return null;
  const cropped = await cropImageFile(image.source.file, box);
  if (!cropped) return null;
  const url = await uploadImageFile(cropped, t, { silent: true });
  if (!url) return null;
  return { ...image, url, source: { file: image.source.file, box } };
}

/**
 * 顯示座標（相對於畫面上那張圖，0–1）→ box_2d（0–1000，[ymin, xmin, ymax, xmax]）。
 * 拖拉方向任意（由右下往左上拉也可以），太小（< 2%）的框視為無效。
 */
export function rectToBox(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number[] | null {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x1 = clamp(Math.min(a.x, b.x));
  const x2 = clamp(Math.max(a.x, b.x));
  const y1 = clamp(Math.min(a.y, b.y));
  const y2 = clamp(Math.max(a.y, b.y));
  if (x2 - x1 < 0.02 || y2 - y1 < 0.02) return null;
  return [
    Math.round(y1 * 1000),
    Math.round(x1 * 1000),
    Math.round(y2 * 1000),
    Math.round(x2 * 1000),
  ];
}
