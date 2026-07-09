/**
 * character.ts — 拔河角色像素 sprite（issue #920）
 *
 * 24×32 chibi 大頭小孩，側面朝右（B 隊用 scaleX(-1) 鏡像）。5 種姿勢：
 * idle / pull / victory / defeat / dizzy，隊色以 T/t placeholder 於渲染時替換。
 * 部件（頭/身/臂/腿）以 stamp 組裝，再整合成各姿勢的幀陣列。
 */

import type { PixelMatrix } from "../palette";
import { blank, fromRows, stamp, px, line } from "../pixelUtils";

export const CHAR_W = 24;
export const CHAR_H = 32;

/** 各姿勢動畫定義：幀陣列 + 循環時長（ms）。 */
export interface CharAnim {
  frames: PixelMatrix[];
  dur: number;
}

// ---- 側面頭（18×15）：後腦在左、臉朝右 ----
const HEAD_SIDE = fromRows([
  ".....oooooooo.....",
  "...oohhhhhhhhoo...",
  "..ohhhhhhhhhhhho..",
  ".ohhhhhhhhhhhhhho.",
  "oTTTTTTTTTTTTTTTTo",
  "oTTTTTTTTTTTTTTTTo",
  "ohhsssssssssssssso",
  "ohhssssswosssswoso",
  "ohhsssssoossssooso",
  "ohhsssssoossssooso",
  "ohhsddsssssssssddo",
  "ohhssssssssoosssso",
  ".ohssssssssssssso.",
  "..osssssssssssso..",
  "...ooooosssoooo...",
]);

// ---- 正面頭（18×15）：勝利 / 落敗用 ----
const HEAD_FRONT = fromRows([
  ".....oooooooo.....",
  "...oohhhhhhhhoo...",
  "..ohhhhhhhhhhhho..",
  ".ohhhhhhhhhhhhhho.",
  "oTTTTTTTTTTTTTTTTo",
  "oTTTTTTTTTTTTTTTTo",
  "ohssssssssssssssho",
  "ohsswosssssswossho",
  "ohssoossssssoossho",
  "ohssoossssssoossho",
  "ohddssssoossssddho",
  "ohssssssddssssssho",
  ".ohssssssssssssho.",
  "..osssssssssssso..",
  "...ooooosssoooo...",
]);

function cloneMatrix(m: PixelMatrix): PixelMatrix {
  return m.map((r) => r.slice());
}

// 眼睛/嘴巴替換（相對頭部座標）
function eyesEffort(head: PixelMatrix): PixelMatrix {
  const m = cloneMatrix(head);
  for (const y of [7, 8, 9]) for (const x of [8, 9, 14, 15]) px(m, x, y, "s");
  [
    [8, 8],
    [9, 8],
    [14, 8],
    [15, 8],
  ].forEach(([x, y]) => px(m, x, y, "o"));
  [
    [10, 11],
    [11, 11],
    [12, 11],
    [13, 11],
  ].forEach(([x, y]) => px(m, x, y, "o")); // 咬牙
  return m;
}
function eyesX(head: PixelMatrix): PixelMatrix {
  const m = cloneMatrix(head);
  for (const y of [7, 8, 9]) for (const x of [8, 9, 14, 15]) px(m, x, y, "s");
  [
    [7, 7],
    [9, 7],
    [8, 8],
    [7, 9],
    [9, 9],
  ].forEach(([x, y]) => px(m, x, y, "o"));
  [
    [13, 7],
    [15, 7],
    [14, 8],
    [13, 9],
    [15, 9],
  ].forEach(([x, y]) => px(m, x, y, "o"));
  return m;
}
function eyesHappy(head: PixelMatrix): PixelMatrix {
  const m = cloneMatrix(head);
  for (const y of [7, 8, 9]) for (const x of [4, 5, 12, 13]) px(m, x, y, "s");
  [
    [3, 8],
    [4, 7],
    [5, 8],
    [11, 8],
    [12, 7],
    [13, 8],
  ].forEach(([x, y]) => px(m, x, y, "o"));
  return m;
}
function eyesSad(head: PixelMatrix): PixelMatrix {
  const m = cloneMatrix(head);
  for (const y of [7, 8, 9]) for (const x of [4, 5, 12, 13]) px(m, x, y, "s");
  [
    [3, 8],
    [4, 8],
    [5, 8],
    [11, 8],
    [12, 8],
    [13, 8],
  ].forEach(([x, y]) => px(m, x, y, "o"));
  px(m, 8, 10, "s");
  px(m, 9, 10, "s");
  px(m, 8, 11, "o");
  px(m, 9, 11, "o"); // 難過嘴
  return m;
}

// ---- 身體 / 腿部件 ----
const TORSO = fromRows([
  "oTTTTTTTTo",
  "oTTTTTTTTo",
  "oTTTTTTTTo",
  "oTTTTTTTTo",
  "oTTTTTTTTo",
  "oTTTTtttto",
  "oTTTTtttto",
]);
const LEGS_STAND = fromRows([
  "ouuuuuuuuo",
  "ouuuuuuuuo",
  "..ss..ss..",
  "..ss..ss..",
  "..ss..ss..",
  ".oooo.oooo",
  ".oooo.oooo",
]);
const LEGS_BRACE = fromRows([
  "ouuuuuuuuo..",
  "ouuuuuuuuo..",
  ".ss.....ss..",
  ".ss......ss.",
  "ss........ss",
  "ooo......ooo",
  "ooo......ooo",
]);
const LEGS_CROUCH = fromRows([
  "ouuuuuuuuo",
  "ouuuuuuuuo",
  ".oooo.oooo",
  ".oooo.oooo",
]);
const STAR = fromRows([".y.", "yyy", ".y."]);

// ---- 手臂（直接畫進畫布）----
function armsHold(m: PixelMatrix): void {
  line(m, 14, 20, 17, 20, "s", 2);
  line(m, 18, 20, 21, 20, "d", 2);
}
function armsStretch(m: PixelMatrix): void {
  line(m, 11, 19, 17, 20, "s", 2);
  line(m, 18, 20, 21, 20, "d", 2);
}
function armsPullIn(m: PixelMatrix): void {
  line(m, 12, 21, 13, 19, "s", 2);
  line(m, 14, 19, 15, 19, "s", 2);
  line(m, 16, 19, 19, 19, "d", 2);
}
function armsUp(m: PixelMatrix, oy: number): void {
  line(m, 4, oy, 2, oy - 4, "s", 2);
  line(m, 15, oy, 17, oy - 4, "s", 2);
  px(m, 1, oy - 6, "d");
  px(m, 2, oy - 6, "d");
  px(m, 1, oy - 5, "d");
  px(m, 2, oy - 5, "d");
  px(m, 17, oy - 6, "d");
  px(m, 18, oy - 6, "d");
  px(m, 17, oy - 5, "d");
  px(m, 18, oy - 5, "d");
}
function armsDroop(m: PixelMatrix, oy: number): void {
  line(m, 4, oy, 2, oy + 4, "s", 2);
  line(m, 15, oy, 17, oy + 4, "s", 2);
  px(m, 2, oy + 5, "d");
  px(m, 3, oy + 5, "d");
  px(m, 16, oy + 5, "d");
  px(m, 17, oy + 5, "d");
}

// ---- 姿勢幀組裝 ----
function frameIdle(breath: number): PixelMatrix {
  const m = blank(CHAR_W, CHAR_H);
  stamp(m, TORSO, 5, 17);
  stamp(m, LEGS_STAND, 5, 24);
  armsHold(m);
  stamp(m, HEAD_SIDE, 2, 2 + breath);
  return m;
}
function framePull(step: number): PixelMatrix {
  const m = blank(CHAR_W, CHAR_H);
  if (step === 0) {
    stamp(m, TORSO, 4, 17);
    stamp(m, LEGS_BRACE, 4, 24);
    armsStretch(m);
    stamp(m, HEAD_SIDE, 1, 2);
  } else if (step === 1) {
    stamp(m, TORSO, 3, 18);
    stamp(m, LEGS_BRACE, 4, 24);
    line(m, 10, 19, 17, 20, "s", 2);
    line(m, 18, 20, 21, 20, "d", 2);
    stamp(m, eyesEffort(HEAD_SIDE), 0, 4);
  } else {
    stamp(m, TORSO, 5, 17);
    stamp(m, LEGS_BRACE, 5, 24);
    armsPullIn(m);
    stamp(m, eyesEffort(HEAD_SIDE), 2, 2);
  }
  return m;
}
function frameVictory(step: number): PixelMatrix {
  const m = blank(CHAR_W, CHAR_H);
  const happy = eyesHappy(HEAD_FRONT);
  if (step === 0) {
    stamp(m, TORSO, 5, 21);
    stamp(m, LEGS_CROUCH, 5, 26);
    armsUp(m, 22);
    stamp(m, happy, 2, 8);
  } else if (step === 1) {
    stamp(m, TORSO, 5, 15);
    stamp(m, LEGS_STAND, 5, 22);
    armsUp(m, 16);
    stamp(m, happy, 2, 1);
  } else if (step === 2) {
    stamp(m, TORSO, 5, 14);
    stamp(m, LEGS_CROUCH, 5, 20);
    armsUp(m, 15);
    stamp(m, happy, 2, 0);
  } else {
    stamp(m, TORSO, 5, 19);
    stamp(m, LEGS_CROUCH, 5, 25);
    armsUp(m, 20);
    stamp(m, happy, 2, 5);
  }
  return m;
}
function frameDefeat(step: number): PixelMatrix {
  const m = blank(CHAR_W, CHAR_H);
  stamp(m, TORSO, 5, 20);
  stamp(
    m,
    fromRows([
      "ouuuuuuuuo",
      "ouuuuuuuuo",
      "oss....sso",
      "sss....sss",
      "ooo....ooo",
    ]),
    5,
    25,
  );
  armsDroop(m, 21 + step);
  stamp(m, eyesSad(HEAD_FRONT), 2, 8 + step);
  px(m, 6, 19 + step * 2, "c"); // 淚滴
  px(m, 15, 20 + step * 2, "c");
  return m;
}
function frameDizzy(step: number): PixelMatrix {
  const m = blank(CHAR_W, CHAR_H);
  stamp(m, TORSO, 5, 17);
  stamp(m, LEGS_STAND, 5, 24);
  armsHold(m);
  stamp(m, eyesX(HEAD_SIDE), 2, 2 + step);
  stamp(m, STAR, step ? 14 : 4, step ? 1 : 0);
  return m;
}

export type CharPose = "idle" | "pull" | "victory" | "defeat" | "dizzy";

/** 各姿勢的幀與節奏（節奏參照 motion-design skill：pull 有蓄力 anticipation、victory 彈跳歡呼）。 */
export const CHAR_ANIMS: Record<CharPose, CharAnim> = {
  idle: { frames: [frameIdle(0), frameIdle(1)], dur: 800 },
  pull: { frames: [framePull(0), framePull(1), framePull(2)], dur: 450 },
  victory: {
    frames: [
      frameVictory(0),
      frameVictory(1),
      frameVictory(2),
      frameVictory(3),
    ],
    dur: 640,
  },
  defeat: { frames: [frameDefeat(0), frameDefeat(1)], dur: 1200 },
  dizzy: { frames: [frameDizzy(0), frameDizzy(1)], dur: 500 },
};
