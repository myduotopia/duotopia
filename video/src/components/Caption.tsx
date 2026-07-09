import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { motion } from "../motion";

// 底部字幕（精緻膠囊 lower-third，EP1 定案款）
export const Caption: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame, fps, config: motion.gentle });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 72, display: "flex", justifyContent: "center", opacity: t, transform: `translateY(${interpolate(t, [0, 1], [42, 0])}px)`, fontFamily: theme.font }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          background: "rgba(17,24,39,0.86)",
          color: "white",
          fontSize: 42,
          fontWeight: 600,
          letterSpacing: 0.5,
          padding: "20px 40px 20px 30px",
          borderRadius: 999,
          maxWidth: 1500,
          lineHeight: 1.3,
          boxShadow: "0 18px 50px rgba(15,23,42,0.4)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ width: 8, alignSelf: "stretch", borderRadius: 999, background: `linear-gradient(${theme.brandLight}, ${theme.brand})`, flexShrink: 0 }} />
        <span>{text}</span>
      </div>
    </div>
  );
};
