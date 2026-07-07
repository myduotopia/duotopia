/**
 * renderSprite.ts — 像素矩陣 → spritesheet dataURI（issue #920）
 *
 * 把同一動作的多幀水平拼進一張 canvas，輸出 PNG dataURI。之後動畫全交給
 * CSS steps()，零 JS 動畫迴圈。以 (cacheKey + overrides) 做 module-level 快取，
 * 同一 sprite（含隊色變體）只算一次。
 *
 * 安全性：jsdom / 無 canvas 環境下 getContext 會失敗，回傳空 url 讓元件不崩潰。
 */

import type { CSSProperties } from "react";
import { PAL, type PixelMatrix, type SpriteSheet } from "./palette";

const sheetCache = new Map<string, SpriteSheet>();

/**
 * 產生 spritesheet。
 * @param frames  各幀矩陣（需同尺寸）
 * @param overrides  palette key 覆寫（隊色 T/t、旗色 F/f）
 * @param cacheKey  快取鍵（空字串 = 不快取）
 */
export function makeSheet(
  frames: PixelMatrix[],
  overrides: Record<string, string> = {},
  cacheKey = "",
): SpriteSheet {
  const ck = cacheKey
    ? cacheKey + "|" + Object.keys(overrides).map((k) => overrides[k]).join(",")
    : "";
  if (ck && sheetCache.has(ck)) return sheetCache.get(ck) as SpriteSheet;

  const fw = frames[0][0].length;
  const fh = frames[0].length;
  const n = frames.length;

  let url = "";
  try {
    const cv = document.createElement("canvas");
    cv.width = fw * n;
    cv.height = fh;
    const ctx = cv.getContext("2d");
    if (ctx) {
      for (let i = 0; i < n; i++) {
        const f = frames[i];
        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < fw; x++) {
            const chr = f[y][x];
            if (chr === ".") continue;
            ctx.fillStyle = overrides[chr] || PAL[chr] || "#f0f";
            ctx.fillRect(i * fw + x, y, 1, 1);
          }
        }
      }
      url = cv.toDataURL();
    }
  } catch {
    // 無 canvas 環境（jsdom 測試）→ 留空 url，元件仍可 render 佔位
    url = "";
  }

  const out: SpriteSheet = { url, fw, fh, n };
  if (ck) sheetCache.set(ck, out);
  return out;
}

/** CSS 動畫用的共用 keyframe 名稱（PixelTugStage 的 <style> 定義）。 */
export const PLAY_KEYFRAME = "tow-play-x";

/**
 * 產生 sprite 的 inline 樣式：背景圖 + 尺寸 + steps() 逐格動畫。
 * 多幀時掛上 --tow-endx 供 keyframe 位移。
 */
export function spriteStyle(
  sheet: SpriteSheet,
  scale: number,
  durMs = 0,
): CSSProperties {
  const w = sheet.fw * scale;
  const h = sheet.fh * scale;
  const style: CSSProperties = {
    width: w,
    height: h,
    backgroundImage: sheet.url ? `url(${sheet.url})` : undefined,
    backgroundSize: `${sheet.fw * sheet.n * scale}px ${h}px`,
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
  };
  if (sheet.n > 1 && durMs > 0) {
    style.animation = `${PLAY_KEYFRAME} ${durMs}ms steps(${sheet.n}) infinite`;
    (style as Record<string, string | number>)["--tow-endx"] = `${-sheet.fw * sheet.n * scale}px`;
  }
  return style;
}
