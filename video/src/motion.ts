// 全系列動態語言唯一真相源（Motion Personality: Playful，大位移收斂）
// 原則：進場 ease-out / 退場 ease-in；微互動才彈跳；同場景同時動的元素 ≤ 1/3
import { Easing } from "remotion";

export const motion = {
  // ── Duration palette（frames @30fps）──
  quick: 5, // ~166ms 微互動（badge、icon、ripple）
  standard: 9, // ~300ms 卡片/字幕/chip 進場
  slow: 15, // ~500ms 大型版面、字卡分隔線
  transition: 12, // ~400ms 場景轉場（同分鏡腳本 0.4s ease-out）

  // ── Spring 配置 ──
  // Playful 彈性進場（約 12% overshoot）：小元素專用
  pop: { damping: 12, stiffness: 170, mass: 0.9 },
  // 無彈跳、快速收斂：字卡/字幕/大面積移動（沿用既有 damping:200 手感）
  gentle: { damping: 200 },

  // ── Bezier（interpolate 用）──
  enter: Easing.bezier(0.05, 0.7, 0.1, 1), // MD3 emphasized：進場
  exit: Easing.bezier(0.3, 0, 1, 1), // MD3 accelerate：退場
  move: Easing.bezier(0.65, 0, 0.35, 1), // ease-in-out：畫面內移動（攝影機 pan/zoom）——兩端都緩，不會彈出去

  // ── 統一進場方向：由下而上 + fade ──
  enterOffset: 24, // px

  // ── 聲音 ──
  bgmVolume: 0.09, // 背景音樂墊底（約 -20dB）
  sfxVolume: 0.5,
};
