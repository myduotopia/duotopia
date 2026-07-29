import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import {
  PHONE_BEZEL,
  PHONE_H,
  PHONE_RADIUS,
  PHONE_W,
  PHONE_X,
  PHONE_Y,
} from "./frame";

// EP4 手機直式「入鏡框」：
// - 框外＝同一畫面的截圖模糊放大鋪滿 16:9（沈浸背景）＋ 品牌藍暈染 + 壓暗
// - 中央＝深色手機外框（圓角、聽筒小條、底部 home 條），內容區放直式 clip
// children = 直式 clip/截圖（已在內容區座標渲染）。
export const PhoneFrame: React.FC<{ bgSrc?: string; children: React.ReactNode }> = ({
  bgSrc,
  children,
}) => {
  return (
    <AbsoluteFill>
      {/* 模糊放大截圖背景 */}
      {bgSrc ? (
        <Img
          src={staticFile(bgSrc)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(46px) saturate(1.1)",
            transform: "scale(1.25)",
          }}
        />
      ) : null}
      {/* 品牌藍暈染 + 壓暗，讓手機框跳出來 */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 120% at 50% 30%, rgba(37,99,235,0.28) 0%, rgba(30,58,138,0.55) 60%, rgba(15,23,42,0.72) 100%)",
        }}
      />

      {/* 手機外框（bezel） */}
      <div
        style={{
          position: "absolute",
          left: PHONE_X - PHONE_BEZEL,
          top: PHONE_Y - PHONE_BEZEL,
          width: PHONE_W + PHONE_BEZEL * 2,
          height: PHONE_H + PHONE_BEZEL * 2,
          borderRadius: PHONE_RADIUS,
          background: "linear-gradient(160deg, #2b2f36 0%, #14161a 100%)",
          boxShadow:
            "0 50px 120px rgba(0,0,0,0.55), 0 0 0 2px rgba(255,255,255,0.08), inset 0 0 0 2px rgba(255,255,255,0.06)",
        }}
      >
        {/* 聽筒小條 */}
        <div
          style={{
            position: "absolute",
            top: PHONE_BEZEL - 3,
            left: "50%",
            transform: "translateX(-50%)",
            width: 58,
            height: 6,
            borderRadius: 6,
            background: "rgba(255,255,255,0.18)",
          }}
        />
      </div>

      {/* 內容區（直式畫面，圓角裁切） */}
      <div
        style={{
          position: "absolute",
          left: PHONE_X,
          top: PHONE_Y,
          width: PHONE_W,
          height: PHONE_H,
          borderRadius: PHONE_RADIUS - PHONE_BEZEL,
          overflow: "hidden",
          background: "#fff",
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};
