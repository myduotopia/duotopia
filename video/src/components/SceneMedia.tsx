import React from "react";
import { Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { AccountMask } from "./AccountMask";
import { HighlightBox, SpotlightOverlay } from "./Focus";
import { FRAME, OX, OY, VH, VW, toScreen } from "./frame";
import { SceneT } from "./types";

// 媒體層：裱框內容（clip 播放/尾幀定格/靜態截圖）+ mask + spotlight/highlight。
// 不含攝影機 transform、字幕、音訊——由 ShotScene（單景）或 CameraGroup（運鏡群組）包覆。
// hlDelayOverride：覆寫焦點標記進場時機；傳大負值 = 立即全亮（群組內同焦點連續景不重閃）
export const SceneMedia: React.FC<{ scene: SceneT; hlDelayOverride?: number }> = ({ scene, hlDelayOverride }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const boxes = (scene.highlights ?? []).map(toScreen);

  const hasClip = Boolean(scene.clip);
  const clipFrames = hasClip ? Math.max(1, Math.round((scene.clipDurationSec ?? 0) * fps)) : 0;
  const frozen = hasClip && frame >= clipFrames;
  // highlight 進場時間：clip 預設 = 定格開始；靜態預設 = 場景開頭
  const hlDelay = hlDelayOverride ?? Math.round((scene.hlAtSec ?? (hasClip ? scene.clipDurationSec ?? 0 : 0)) * fps);
  // 退場時間：點擊後畫面會變，框不得殘留（未設 = 不退場，靜態講解景適用）
  const hlOff = scene.hlOffSec !== undefined ? Math.round(scene.hlOffSec * fps) : undefined;

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: OX,
          top: OY,
          width: VW * FRAME,
          height: VH * FRAME,
          borderRadius: 20,
          overflow: "hidden",
          boxShadow: "0 40px 90px rgba(30,58,138,0.28), 0 8px 24px rgba(15,23,42,0.15)",
          border: "1px solid rgba(255,255,255,0.6)",
        }}
      >
        {hasClip && !frozen ? (
          <OffthreadVideo src={staticFile(scene.clip as string)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Img src={staticFile((frozen ? scene.freezeShot : scene.shot) ?? scene.shot ?? (scene.freezeShot as string))} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
      </div>
      {scene.mask ? <AccountMask /> : null}
      {scene.spotlight ? <SpotlightOverlay box={toScreen(scene.spotlight)} delayFrames={hlDelay} offFrames={hlOff} /> : null}
      {boxes.map((b, i) => (
        <HighlightBox key={i} box={b} delayFrames={hlDelay} offFrames={hlOff} />
      ))}
    </>
  );
};

// clip 場景的定格起始 frame（攝影機/群組排程共用）
export const clipFreezeFrame = (scene: SceneT, fps: number): number =>
  scene.clip ? Math.max(1, Math.round((scene.clipDurationSec ?? 0) * fps)) : 0;
