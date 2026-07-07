/**
 * palette.ts — 拔河像素風調色盤與型別（issue #920）
 *
 * 取自 Resurrect 64 的固定子集。角色只畫一套 matrix，隊色以 placeholder key
 * （T/t）在渲染時替換；旗色以 F/f 替換 → 免畫兩套。B 隊再用 scaleX(-1) 鏡像。
 */

/** 一幀像素矩陣：每格是一個 palette key，"." = 透明。 */
export type PixelMatrix = string[][];

/** 產好的 spritesheet（各幀水平排列）。 */
export interface SpriteSheet {
  /** dataURI（PNG）。jsdom 等無 canvas 環境回空字串。 */
  url: string;
  /** 單幀寬（像素）。 */
  fw: number;
  /** 單幀高（像素）。 */
  fh: number;
  /** 幀數。 */
  n: number;
}

/** palette key → 色碼。T/t（隊色）與 F/f（旗色）為渲染時替換的 placeholder。 */
export const PAL: Record<string, string> = {
  o: "#2e222f", // 描邊 / 深色
  h: "#3e3546", // 頭髮
  s: "#fdcbb0", // 膚色
  d: "#fca790", // 膚色暗 / 腮紅 / 拳頭
  w: "#ffffff", // 白
  u: "#625565", // 短褲
  y: "#f9c22b", // 金
  g: "#f79617", // 金暗
  R: "#cd683d", // 繩
  q: "#9e4539", // 繩暗 / 木頭暗
  b: "#ab947a", // 木頭亮
  B: "#966c6c", // 木頭中
  G: "#1ebc73", // 草
  L: "#91db69", // 草亮
  D: "#239063", // 草暗
  W: "#c7dcd0", // 雲影
  c: "#8fd3ff", // 淚滴 / 天藍
  // placeholder（渲染時由 overrides 覆蓋）
  T: "#f0f",
  t: "#f0f",
  F: "#f0f",
  f: "#f0f",
};

/** 隊色（渲染角色時套用；neutral 用於平手旗）。 */
export const TEAM_COLORS: Record<
  "a" | "b" | "neutral",
  { T: string; t: string }
> = {
  a: { T: "#e83b3b", t: "#ae2334" },
  b: { T: "#4d9be6", t: "#4d65b4" },
  neutral: { T: "#f9c22b", t: "#f79617" },
};
