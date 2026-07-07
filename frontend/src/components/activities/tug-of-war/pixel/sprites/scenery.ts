/**
 * scenery.ts — 拔河場景像素素材（issue #920）
 *
 * 雲、草地 tile、草叢、勝利線標桿、直向提示手機。天空用 CSS 漸層不做 sprite。
 */

import type { PixelMatrix } from "../palette";
import { blank, fromRows, px } from "../pixelUtils";

/** 雲（兩款）。 */
export const CLOUD1 = fromRows([
  "....wwwww.......",
  "..wwwwwwwww.....",
  ".wwwwwwwwwwwww..",
  "wwwwwwwwwwwwwww.",
  "wwwwwwwwwwwwwwww",
  ".WWwwwwwwwwwWWW.",
]);
export const CLOUD2 = fromRows([
  "......wwwwww........",
  "...wwwwwwwwwww......",
  ".wwwwwwwwwwwwwwww...",
  "wwwwwwwwwwwwwwwwwww.",
  "wwwwwwwwwwwwwwwwwwww",
  ".WWWwwwwwwwwwwwWWW..",
]);

/** 草叢裝飾。 */
export const BUSH = fromRows([
  "...GG.....",
  ".GGGGGG...",
  "GGLGGGGG..",
  "GGGGGLGGG.",
  "DGGGGGGGD.",
]);

/** 勝利線標桿（10×46）：高過角色頭頂的木桿 + 隊色三角旗（T/t placeholder）。 */
export function makePole(): PixelMatrix[] {
  const m = blank(10, 46);
  for (let y = 2; y < 46; y++) {
    px(m, 3, y, "b");
    px(m, 4, y, "q");
  }
  px(m, 3, 1, "o");
  px(m, 4, 1, "o");
  for (let r = 0; r < 4; r++) for (let x = 5; x < 10 - r; x++) px(m, x, 2 + r, "T");
  px(m, 5, 6, "t");
  return [m];
}

/** 草地 tile（16×12，repeat-x 鋪滿）。 */
export function makeGrass(): PixelMatrix[] {
  const m = blank(16, 12);
  for (let y = 2; y < 12; y++) for (let x = 0; x < 16; x++) px(m, x, y, "G");
  for (let x = 0; x < 16; x++) if (x % 2 === 0) px(m, x, 1, "L");
  [[1, 3], [6, 4], [11, 3], [14, 5], [3, 7], [9, 8], [13, 9], [5, 10]].forEach(([x, y]) => px(m, x, y, "D"));
  [[4, 3], [10, 5], [2, 6], [8, 7], [15, 8], [12, 10]].forEach(([x, y]) => px(m, x, y, "L"));
  return [m];
}

/** 直向提示手機（20×32）。 */
export function makePhone(): PixelMatrix[] {
  const m = blank(20, 32);
  for (let y = 2; y < 30; y++)
    for (let x = 4; x < 16; x++) {
      const edge = y === 2 || y === 29 || x === 4 || x === 15;
      px(m, x, y, edge ? "w" : "c");
    }
  for (let x = 8; x < 12; x++) px(m, x, 27, "w");
  return [m];
}
