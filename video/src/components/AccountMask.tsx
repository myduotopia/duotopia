import React from "react";
import { theme } from "../theme";
import { FRAME, toScreen } from "./frame";

// 遮住 production 測試帳號 email（左下角），貼合裱框座標
export const AccountMask: React.FC = () => {
  const m = toScreen({ x: 0, y: 1006, w: 256, h: 74 });
  return (
    <div style={{ position: "absolute", left: m.x, top: m.y, width: m.w, height: m.h, background: "#fff", display: "flex", alignItems: "center", gap: 10, paddingLeft: 16, fontFamily: theme.font, borderBottomLeftRadius: 20 * FRAME }}>
      <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#e5e7eb" }} />
      <div style={{ color: "#94a3b8", fontSize: 20, fontWeight: 600 }}>老師帳號</div>
    </div>
  );
};
