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

// ── EP4 手機直式「入鏡框」幾何 ─────────────────────────────────────
// 學生端錄影 viewport 390×844，內容置中在 16:9，上下各留邊。
export const MW = 390;
export const MH = 844;
export const PHONE_H = 928; // 手機內容區高（畫布 1080 內，上下留 76px）
export const PHONE_W = Math.round((PHONE_H * MW) / MH); // 429
export const PHONE_X = Math.round((VW - PHONE_W) / 2); // 置中
export const PHONE_Y = Math.round((VH - PHONE_H) / 2);
export const PHONE_BEZEL = 14; // 邊框厚度
export const PHONE_RADIUS = 46; // 外框圓角

// manifest 內手機座標（390×844 viewport 像素）→ 手機內容區在畫布上的座標
export const toPhone = (b: Box): Box => ({
  x: PHONE_X + (b.x / MW) * PHONE_W,
  y: PHONE_Y + (b.y / MH) * PHONE_H,
  w: (b.w / MW) * PHONE_W,
  h: (b.h / MH) * PHONE_H,
});
