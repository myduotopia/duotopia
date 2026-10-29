/**
 * 情境圖邏輯層（Issue #1146）—— 只測純函式：拖拉座標換算、已存網址還原、檔案驗證。
 * 裁切與上傳牽涉 canvas / pdf.js / API，交給 per-issue 環境實測。
 */
import { describe, expect, it } from "vitest";
import {
  imagesFromUrls,
  rectToBox,
  validateManualImage,
} from "../scenarioImages";

describe("rectToBox", () => {
  it("顯示座標 0–1 換成 box_2d 0–1000（[ymin, xmin, ymax, xmax]）", () => {
    expect(rectToBox({ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.6 })).toEqual([
      200, 100, 600, 500,
    ]);
  });

  it("由右下往左上拉也得到同一個框", () => {
    expect(rectToBox({ x: 0.5, y: 0.6 }, { x: 0.1, y: 0.2 })).toEqual([
      200, 100, 600, 500,
    ]);
  });

  it("拉到圖外會被夾回圖內", () => {
    expect(rectToBox({ x: -0.5, y: -0.5 }, { x: 2, y: 2 })).toEqual([
      0, 0, 1000, 1000,
    ]);
  });

  it("太小的框（手抖點一下）不算", () => {
    expect(rectToBox({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.6 })).toBeNull();
  });
});

describe("imagesFromUrls", () => {
  it("已存的網址還原成情境圖，沒有原圖可重裁", () => {
    const images = imagesFromUrls([
      "https://cdn/a.png",
      "",
      "https://cdn/b.png",
    ]);
    expect(images.map((i) => i.url)).toEqual([
      "https://cdn/a.png",
      "https://cdn/b.png",
    ]);
    expect(images.every((i) => i.source === null)).toBe(true);
    // key 要唯一，否則清單刪錯張
    expect(new Set(images.map((i) => i.id)).size).toBe(2);
  });

  it("舊資料沒有情境圖 → 空陣列", () => {
    expect(imagesFromUrls(undefined)).toEqual([]);
    expect(imagesFromUrls(null)).toEqual([]);
  });
});

describe("validateManualImage", () => {
  const file = (size: number, type: string) =>
    new File([new Uint8Array(size)], "a", { type });

  it("沿用題目圖的 2MB 上限", () => {
    expect(validateManualImage(file(3 * 1024 * 1024, "image/png"))).toBe(
      "vocabularySet.image.tooLarge",
    );
  });

  it("只收圖片格式", () => {
    expect(validateManualImage(file(10, "application/pdf"))).toBe(
      "vocabularySet.image.invalidType",
    );
    expect(validateManualImage(file(10, "image/jpeg"))).toBeNull();
  });
});
