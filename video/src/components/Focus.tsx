import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { motion } from "../motion";
import { Box } from "./types";

// highlight 圈選（柔和呼吸光暈，EP1 定案款）。
// delayFrames：幾 frame 後進場；offFrames：幾 frame 後退場（0.3s 淡出）——
// 點擊後畫面會變，框必須消失，不能殘留到下一個視圖上
export const HighlightBox: React.FC<{ box: Box; delayFrames?: number; offFrames?: number }> = ({
  box,
  delayFrames = 0,
  offFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const appear = spring({ frame: frame - delayFrames, fps, config: motion.gentle });
  const gone = offFrames === undefined
    ? 1
    : interpolate(frame, [offFrames, offFrames + 9], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const glow = 0.5 + 0.5 * Math.sin((frame / fps) * Math.PI * 2 * 0.7);
  const pad = 8;
  return (
    <div
      style={{
        position: "absolute",
        left: box.x - pad,
        top: box.y - pad,
        width: box.w + pad * 2,
        height: box.h + pad * 2,
        border: `4px solid ${theme.accent}`,
        borderRadius: 12,
        boxShadow: `0 0 ${10 + glow * 14}px 2px ${theme.accent}88, 0 0 0 6px ${theme.accent}22`,
        opacity: appear * gone,
        transform: `scale(${interpolate(appear, [0, 1], [0.9, 1])})`,
        transformOrigin: "center",
      }}
    />
  );
};

// 聚光燈：focus 區外整體壓暗，眼睛不用找就知道看哪裡（offFrames 同 HighlightBox）
export const SpotlightOverlay: React.FC<{ box: Box; delayFrames?: number; offFrames?: number }> = ({
  box,
  delayFrames = 0,
  offFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const appear = spring({ frame: frame - delayFrames, fps, config: motion.gentle });
  const gone = offFrames === undefined
    ? 1
    : interpolate(frame, [offFrames, offFrames + 9], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pad = 14;
  return (
    <div
      style={{
        position: "absolute",
        left: box.x - pad,
        top: box.y - pad,
        width: box.w + pad * 2,
        height: box.h + pad * 2,
        borderRadius: 14,
        // 挖洞法：本體透明，用超大 spread 陰影把四周壓暗
        boxShadow: `0 0 0 9999px rgba(15,23,42,${0.45 * appear * gone})`,
        pointerEvents: "none",
      }}
    />
  );
};
