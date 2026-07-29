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
  const times = scene.stepTimes;
  const headT = spring({ frame, fps, config: motion.gentle });
  // 逐項晃動：旁白唸到該工具時（stepTimes[i] 秒）卡片做一段衰減擺動＋輕微放大
  const wobble = (i: number): { rot: number; sc: number } => {
    if (!times || times[i] == null) return { rot: 0, sc: 1 };
    const local = (frame - times[i] * fps) / fps; // 距離被唸到的秒數
    if (local < 0 || local > 0.9) return { rot: 0, sc: 1 };
    const decay = Math.exp(-local * 3);
    return {
      rot: Math.sin(local * Math.PI * 2 * 2.2) * 13 * decay, // ±13°、~2.2Hz、衰減
      sc: 1 + 0.11 * decay, // 進場瞬間放大再收回
    };
  };
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
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 40, marginTop: 64, maxWidth: 1010 }}>
        {steps.map((label, i) => {
          // stagger：每項延遲 3f（100ms），總預算 < 400ms
          const t = spring({ frame: frame - fps * 0.35 - i * 3, fps, config: motion.pop });
          const w = wobble(i);
          const enterY = interpolate(t, [0, 1], [motion.enterOffset * 1.5, 0]);
          const enterS = interpolate(t, [0, 1], [0.92, 1]);
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
                padding: "40px 48px",
                minWidth: 300,
                boxShadow: "0 24px 60px rgba(30,58,138,0.18)",
                opacity: t,
                transform: `translateY(${enterY}px) scale(${enterS * w.sc}) rotate(${w.rot}deg)`,
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
              <div style={{ color: theme.ink, fontSize: 38, fontWeight: 700, textAlign: "center", maxWidth: 260, lineHeight: 1.25 }}>{label}</div>
            </div>
          );
        })}
      </div>
      <Audio src={staticFile(scene.audio)} />
    </AbsoluteFill>
  );
};
