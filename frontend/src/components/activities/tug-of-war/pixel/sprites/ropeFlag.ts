/**
 * ropeFlag.ts — 繩子 tile 與中央結＋旗（issue #920）
 *
 * 旗色以 F/f placeholder 表示，渲染時依領先方替換（紅/藍/金）。
 */

import { fromRows } from "../pixelUtils";

/** 繩子 tile（8×6，repeat-x 貫穿全寬）。 */
export const ROPE_TILE = fromRows([
  "........",
  "RRqRRRqR",
  "RRRRRRRR",
  "qRRqRRqR",
  "qqqqqqqq",
  "........",
]);

/** 中央繩結＋三角旗（12×11）。 */
export const FLAG = fromRows([
  "...qRRq.....",
  "..qRRRRq....",
  "..qRRRRq....",
  "...qRRq.....",
  ".oFFFFFFFFo.",
  ".oFFFFFFffo.",
  "..oFFFFFfo..",
  "..oFFFFFfo..",
  "...oFFFfo...",
  "....oFfo....",
  ".....oo.....",
]);
