import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { motion } from "../motion";

// 步驟完成慶祝：綠色 checkmark 描線 pop + 放射粒子（場景最後 1 秒觸發）
const PARTICLES = 10;

export const SuccessBurst: React.FC<{ cx?: number; cy?: number }> = ({ cx = 960, cy = 500 }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const start = durationInFrames - fps; // 最後 1 秒
  const local = frame - start;
  if (local < 0) return null;
  const pop = spring({ frame: local, fps, config: motion.pop });
  const draw = spring({ frame: local - 2, fps, config: motion.gentle });
  const fade = interpolate(local, [fps * 0.7, fps * 0.95], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: cx, top: cy, pointerEvents: "none", opacity: fade }}>
      {/* 粒子放射（ambient 層） */}
      {Array.from({ length: PARTICLES }, (_, i) => {
        const angle = (i / PARTICLES) * Math.PI * 2;
        const dist = interpolate(pop, [0, 1], [10, 120 + (i % 3) * 26]);
        const size = 10 + (i % 3) * 5;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: Math.cos(angle) * dist - size / 2,
              top: Math.sin(angle) * dist - size / 2,
              width: size,
              height: size,
              borderRadius: i % 2 ? "50%" : 3,
              background: i % 3 === 0 ? theme.accent : i % 3 === 1 ? theme.green : theme.brandLight,
              opacity: interpolate(pop, [0.5, 1], [1, 0.2]),
              transform: `rotate(${angle}rad)`,
            }}
          />
        );
      })}
      {/* checkmark 圓標（primary 層） */}
      <div
        style={{
          position: "absolute",
          left: -56,
          top: -56,
          width: 112,
          height: 112,
          borderRadius: "50%",
          background: theme.green,
          boxShadow: "0 16px 44px rgba(34,197,94,0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${pop})`,
        }}
      >
        <svg width="60" height="60" viewBox="0 0 60 60">
          <path
            d="M14 32 L26 44 L47 18"
            stroke="white"
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            strokeDasharray={60}
            strokeDashoffset={interpolate(draw, [0, 1], [60, 0])}
          />
        </svg>
      </div>
    </div>
  );
};
