import React from "react";
import { AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Caption } from "./Caption";
import { SceneMedia } from "./SceneMedia";
import { Sfx } from "./audio";
import { VH, VW, toScreen } from "./frame";
import { SceneT } from "./types";

export const SCENE_BG = "radial-gradient(130% 130% at 50% 20%, #eef3fc 0%, #dde6f6 55%, #cdd9ee 100%)";

// 單一操作場景（獨立成景時的攝影機邏輯；同畫面連續景改由 CameraGroup 統一運鏡）：
// - 有 clip → 播放中不縮放（保操作可讀），定格後才套 zoom / Ken Burns
// - 無 clip → 靜態截圖 + zoom/zoomStatic/Ken Burns（v1 行為不變）
export const ShotScene: React.FC<{ scene: SceneT }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const boxes = (scene.highlights ?? []).map(toScreen);
  const primary = boxes[0];
  const originX = primary ? ((primary.x + primary.w / 2) / VW) * 100 : 50;
  const originY = primary ? ((primary.y + primary.h / 2) / VH) * 100 : 50;

  const hasClip = Boolean(scene.clip);
  const clipFrames = hasClip ? Math.max(1, Math.round((scene.clipDurationSec ?? 0) * fps)) : 0;
  const frozen = hasClip && frame >= clipFrames;

  const zoomStart = hasClip ? clipFrames : 0;
  // 手機直式景不套桌機運鏡縮放（手機入鏡框已置中、highlights 走 toPhone）
  const scale = scene.mobile
    ? 1
    : hasClip && !frozen
    ? 1
    : scene.zoomStatic
      ? scene.zoom ?? 1
      : scene.zoom
        ? interpolate(frame, [zoomStart, zoomStart + fps * 1.1], [1, scene.zoom], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        : interpolate(frame, [zoomStart, durationInFrames], [1, 1.04], { extrapolateLeft: "clamp" });

  return (
    <AbsoluteFill style={{ background: SCENE_BG }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: `${originX}% ${originY}%` }}>
        <SceneMedia scene={scene} />
      </AbsoluteFill>
      {scene.caption ? <Caption text={scene.caption} /> : null}
      {scene.sfx?.length ? <Sfx events={scene.sfx} /> : null}
      <Audio src={staticFile(scene.audio)} />
    </AbsoluteFill>
  );
};
