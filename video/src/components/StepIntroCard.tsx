import React from "react";
import { AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { motion } from "../motion";
import { SceneT } from "./types";

// 集頭「本集 N 個步驟」總覽卡：數字圓標 ①②③ + 標籤，stagger 進場
export const StepIntroCard: React.FC<{ scene: SceneT }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const steps = scene.steps ?? [];
  const headT = spring({ frame, fps, config: motion.gentle });
  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(130% 130% at 50% 20%, #eef3fc 0%, #dde6f6 55%, #cdd9ee 100%)",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: theme.font,
      }}
    >
      <div style={{ color: theme.ink, fontSize: 54, fontWeight: 800, letterSpacing: 4, opacity: headT, transform: `translateY(${interpolate(headT, [0, 1], [motion.enterOffset, 0])}px)` }}>
        {scene.title ?? `本集 ${steps.length} 個步驟`}
      </div>
      <div style={{ display: "flex", gap: 44, marginTop: 72 }}>
        {steps.map((label, i) => {
          // stagger：每項延遲 3f（100ms），總預算 < 400ms
          const t = spring({ frame: frame - fps * 0.35 - i * 3, fps, config: motion.pop });
          return (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 22,
                background: "white",
                borderRadius: 24,
                padding: "44px 52px",
                minWidth: 320,
                boxShadow: "0 24px 60px rgba(30,58,138,0.18)",
                opacity: t,
                transform: `translateY(${interpolate(t, [0, 1], [motion.enterOffset * 1.5, 0])}px) scale(${interpolate(t, [0, 1], [0.92, 1])})`,
              }}
            >
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: "50%",
                  background: `linear-gradient(135deg, ${theme.brandLight}, ${theme.brand})`,
                  color: "white",
                  fontSize: 40,
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 10px 24px rgba(37,99,235,0.35)",
                }}
              >
                {i + 1}
              </div>
              <div style={{ color: theme.ink, fontSize: 38, fontWeight: 700 }}>{label}</div>
            </div>
          );
        })}
      </div>
      <Audio src={staticFile(scene.audio)} />
    </AbsoluteFill>
  );
};
