import React from "react";
import { AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { motion } from "../motion";
import { SceneT } from "./types";

// 片頭/片尾字卡（片尾用 progressDots 顯示系列進度）
export const TitleCard: React.FC<{ scene: SceneT; episode?: number; episodesTotal?: number }> = ({
  scene,
  episode = 1,
  episodesTotal = 7,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame, fps, config: motion.gentle });
  const subT = spring({ frame: frame - fps * 0.28, fps, config: motion.gentle });
  const line = spring({ frame: frame - fps * 0.15, fps, config: motion.gentle });
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 120% at 50% 0%, ${theme.brandLight} 0%, ${theme.brand} 45%, ${theme.brandDark} 100%)`,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: theme.font,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ color: "#c7dbff", fontSize: 40, fontWeight: 700, letterSpacing: 10, opacity: t, transform: `translateY(${interpolate(t, [0, 1], [motion.enterOffset, 0])}px)` }}>
          {scene.title}
        </div>
        <div
          style={{
            width: interpolate(line, [0, 1], [0, 120]),
            height: 4,
            background: "rgba(255,255,255,0.65)",
            borderRadius: 2,
            margin: "22px auto",
          }}
        />
        <div style={{ color: "white", fontSize: 100, fontWeight: 800, letterSpacing: 2, opacity: subT, transform: `translateY(${interpolate(subT, [0, 1], [motion.enterOffset, 0])}px)`, textShadow: "0 8px 40px rgba(0,0,0,0.25)" }}>
          {scene.subtitle}
        </div>
        {scene.progressDots ? (
          <div style={{ display: "flex", gap: 18, justifyContent: "center", marginTop: 48 }}>
            {Array.from({ length: episodesTotal }, (_, i) => {
              const dotT = spring({ frame: frame - fps * 0.5 - i * 2, fps, config: motion.pop });
              const done = i < episode;
              return (
                <div
                  key={i}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: done ? "white" : "rgba(255,255,255,0.28)",
                    boxShadow: done ? "0 0 14px rgba(255,255,255,0.7)" : "none",
                    transform: `scale(${dotT})`,
                  }}
                />
              );
            })}
          </div>
        ) : null}
      </div>
      <div style={{ position: "absolute", bottom: 60, display: "flex", alignItems: "center", gap: 12, color: "#c7dbff", fontSize: 28, fontWeight: 700, letterSpacing: 3, opacity: subT }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#c7dbff" }} />
        Duotopia · 老師操作教學
      </div>
      <Audio src={staticFile(scene.audio)} />
    </AbsoluteFill>
  );
};
