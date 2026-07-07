/**
 * sign.ts — 音檔懸掛看板（issue #920）
 *
 * 吊在場景天空中央、旗子正上方的像素木牌，承載共用音檔重播鈕。
 * 兩幀：靜止 / 播放中（音波亮起）。有音檔的題型（聽音檔×2、克漏字同題）顯示。
 */

import type { PixelMatrix } from "../palette";
import { blank, px, line } from "../pixelUtils";

/** 音檔看板（44×30）。@param playing 是否顯示音波。 */
export function makeSign(playing: boolean): PixelMatrix {
  const m = blank(44, 30);
  // 吊繩
  line(m, 8, 0, 8, 5, "q");
  line(m, 35, 0, 35, 5, "q");
  // 木板
  for (let y = 6; y < 27; y++)
    for (let x = 2; x < 42; x++) {
      const edge = y === 6 || y === 26 || x === 2 || x === 41;
      px(m, x, y, edge ? "o" : y >= 23 ? "B" : "b");
    }
  // 木紋
  [9, 15].forEach((gy) => {
    for (let x = 5; x < 39; x += 7) {
      px(m, x, gy, "B");
      px(m, x + 1, gy, "B");
    }
  });
  // 釘子
  [[4, 8], [39, 8], [4, 24], [39, 24]].forEach(([x, y]) => px(m, x, y, "u"));
  // 喇叭 icon
  for (let y = 13; y < 19; y++) for (let x = 13; x < 17; x++) px(m, x, y, "o");
  line(m, 17, 12, 20, 9, "o");
  line(m, 17, 13, 20, 11, "o");
  for (let y = 9; y < 23; y++)
    if (y > 8 && y < 23) {
      px(m, 20, y, "o");
      px(m, 21, y, "o");
    }
  line(m, 17, 18, 20, 21, "o");
  line(m, 17, 19, 20, 22, "o");
  // 音波
  if (playing) {
    [
      [25, 13], [25, 14], [25, 17], [25, 18],
      [28, 11], [28, 12], [28, 15], [28, 16], [28, 19], [28, 20],
      [31, 9], [31, 10], [31, 13], [31, 14], [31, 17], [31, 18], [31, 21], [31, 22],
    ].forEach(([x, y]) => px(m, x, y, "y"));
  } else {
    [[25, 14], [25, 17], [28, 12], [28, 15], [28, 19]].forEach(([x, y]) => px(m, x, y, "B"));
  }
  return m;
}
