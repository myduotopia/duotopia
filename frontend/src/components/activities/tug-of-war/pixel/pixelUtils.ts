/**
 * pixelUtils.ts — 像素矩陣建構工具（issue #920）
 *
 * 提供 blank / fromRows / stamp / px / line，供 sprites/* 以程式化方式組裝角色與場景。
 */

import type { PixelMatrix } from "./palette";

/** 建立全透明矩陣。 */
export function blank(w: number, h: number): PixelMatrix {
  return Array.from({ length: h }, () => Array(w).fill("."));
}

/** 字串列 → 矩陣（自動補齊/截斷寬度，防手滑造成鋸齒）。 */
export function fromRows(rows: string[]): PixelMatrix {
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => (r + ".".repeat(w)).slice(0, w).split(""));
}

/** 單點著色（越界忽略）。 */
export function px(m: PixelMatrix, x: number, y: number, ch: string): void {
  if (m[y] && m[y][x] !== undefined) m[y][x] = ch;
}

/** 把 part 蓋印到 m 的 (ox, oy)；"." 視為透明不覆蓋。 */
export function stamp(
  m: PixelMatrix,
  part: PixelMatrix,
  ox: number,
  oy: number,
): PixelMatrix {
  for (let y = 0; y < part.length; y++) {
    for (let x = 0; x < part[y].length; x++) {
      const ch = part[y][x];
      if (ch === ".") continue;
      const ty = oy + y;
      const tx = ox + x;
      if (ty >= 0 && ty < m.length && tx >= 0 && tx < m[0].length) m[ty][tx] = ch;
    }
  }
  return m;
}

/** 粗略 Bresenham 直線（thick = 垂直加粗像素數），畫手臂用。 */
export function line(
  m: PixelMatrix,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ch: string,
  thick = 1,
): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps);
    const y = Math.round(y0 + ((y1 - y0) * i) / steps);
    for (let t = 0; t < thick; t++) px(m, x, y + t, ch);
  }
}
