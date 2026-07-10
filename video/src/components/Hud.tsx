import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { motion } from "../motion";
import { StepInfo } from "./types";

// 左上角「你現在在哪一頁」常駐 chip；換頁（changed）時才做進場動畫
export const LocationChip: React.FC<{ page: string; changed: boolean }> = ({ page, changed }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = changed ? spring({ frame, fps, config: motion.gentle }) : 1;
  return (
    <div
      style={{
        position: "absolute",
        top: 26,
        left: 32,
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "rgba(17,24,39,0.82)",
        color: "white",
        fontSize: 28,
        fontWeight: 700,
        letterSpacing: 1,
        padding: "12px 26px 12px 20px",
        borderRadius: 999,
        boxShadow: "0 10px 30px rgba(15,23,42,0.35)",
        border: "1px solid rgba(255,255,255,0.1)",
        fontFamily: theme.font,
        opacity: t,
        transform: `translateY(${interpolate(t, [0, 1], [-motion.enterOffset, 0])}px)`,
      }}
    >
      <span style={{ fontSize: 24 }}>📍</span>
      <span>{page}</span>
    </div>
  );
};

// 右上角步驟徽章「步驟 2/3 · 建立班級」；stepDone 時打勾轉綠
export const StepBadge: React.FC<{ step: StepInfo; changed: boolean; done?: boolean }> = ({ step, changed, done }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = changed ? spring({ frame, fps, config: motion.pop }) : 1;
  // 完成打勾：場景最後 1 秒觸發
  const doneStart = durationInFrames - fps;
  const doneT = done ? spring({ frame: frame - doneStart, fps, config: motion.pop }) : 0;
  const isDone = done && frame >= doneStart;
  return (
    <div
      style={{
        position: "absolute",
        top: 26,
        right: 32,
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: isDone ? "rgba(22,101,52,0.92)" : "rgba(17,24,39,0.82)",
        color: "white",
        fontSize: 28,
        fontWeight: 700,
        letterSpacing: 1,
        padding: "12px 26px",
        borderRadius: 999,
        boxShadow: "0 10px 30px rgba(15,23,42,0.35)",
        border: "1px solid rgba(255,255,255,0.1)",
        fontFamily: theme.font,
        opacity: t,
        transform: `translateY(${interpolate(t, [0, 1], [-motion.enterOffset, 0])}px) scale(${isDone ? interpolate(doneT, [0, 1], [1, 1.06]) : 1})`,
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: isDone ? theme.green : `linear-gradient(135deg, ${theme.brandLight}, ${theme.brand})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          fontWeight: 800,
          transform: isDone ? `scale(${interpolate(doneT, [0, 1], [0.6, 1])})` : undefined,
        }}
      >
        {isDone ? "✓" : step.index}
      </span>
      <span>
        {step.prefix ?? "步驟"} {step.index}/{step.total} · {step.label}
      </span>
    </div>
  );
};
