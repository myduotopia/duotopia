import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { theme } from "../theme";
import { ManifestT } from "./types";

// 每集影片縮圖（YouTube 封面/開頭識別用）：
// 左＝集數圓標＋集名＋品牌；右＝該集代表畫面（裱框微傾斜）。
// 全部取自 manifest：集數字卡（第一個 title 場景的 title/subtitle）＋第一個 shot 場景截圖
// （可用 manifest 頂層 thumbShot 覆寫）。渲染：npx remotion still EPn_thumb out/epn_thumb.png
export const makeThumbnail = (manifest: ManifestT): React.FC => {
  const titleScene = manifest.scenes.find((s) => s.kind === "title");
  const shotScene = manifest.scenes.find((s) => s.kind === "shot" && s.shot);
  const shot = (manifest as ManifestT & { thumbShot?: string }).thumbShot ?? shotScene?.shot;
  const Thumb: React.FC = () => (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 120% at 50% 0%, ${theme.brandLight} 0%, ${theme.brand} 45%, ${theme.brandDark} 100%)`,
        fontFamily: theme.font,
        overflow: "hidden",
      }}
    >
      {/* 右側：代表畫面，裱框微傾斜 */}
      {shot ? (
        <div
          style={{
            position: "absolute",
            right: -140,
            top: 140,
            width: 1150,
            height: 810,
            borderRadius: 28,
            overflow: "hidden",
            transform: "rotate(-5deg)",
            boxShadow: "0 60px 120px rgba(0,0,0,0.45), 0 0 0 10px rgba(255,255,255,0.25)",
          }}
        >
          <Img src={staticFile(shot)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      ) : null}
      {/* 左側：集數 + 集名 + 品牌 */}
      <div style={{ position: "absolute", left: 90, top: 0, bottom: 0, width: 760, display: "flex", flexDirection: "column", justifyContent: "center", gap: 36 }}>
        <div
          style={{
            alignSelf: "flex-start",
            display: "flex",
            alignItems: "center",
            gap: 20,
            background: "rgba(255,255,255,0.16)",
            border: "2px solid rgba(255,255,255,0.45)",
            borderRadius: 999,
            padding: "16px 40px 16px 20px",
          }}
        >
          <div
            style={{
              width: 76,
              height: 76,
              borderRadius: "50%",
              background: "white",
              color: theme.brand,
              fontSize: 44,
              fontWeight: 900,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {manifest.episode ?? "?"}
          </div>
          <span style={{ color: "white", fontSize: 52, fontWeight: 800, letterSpacing: 6 }}>
            {titleScene?.title ?? `第 ${manifest.episode} 集`}
          </span>
        </div>
        <div style={{ color: "white", fontSize: 118, fontWeight: 900, lineHeight: 1.15, textShadow: "0 10px 50px rgba(0,0,0,0.4)" }}>
          {titleScene?.subtitle ?? ""}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, color: "#c7dbff", fontSize: 34, fontWeight: 700, letterSpacing: 3 }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#c7dbff" }} />
          Duotopia · 老師操作教學
        </div>
      </div>
    </AbsoluteFill>
  );
  return Thumb;
};
