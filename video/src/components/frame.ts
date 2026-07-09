// 截圖/錄影「裱框」幾何：縮到 90% 置中，四周留邊（沿用 EP1 定案）
import { Box } from "./types";

export const VW = 1920;
export const VH = 1080;
export const FRAME = 0.9;
export const OX = (VW * (1 - FRAME)) / 2;
export const OY = (VH * (1 - FRAME)) / 2;

// manifest 內座標是 1920×1080 原始 viewport 像素 → 換算到裱框後的畫面座標
export const toScreen = (b: Box): Box => ({
  x: OX + b.x * FRAME,
  y: OY + b.y * FRAME,
  w: b.w * FRAME,
  h: b.h * FRAME,
});
