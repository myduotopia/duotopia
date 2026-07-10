import React from "react";
import { AbsoluteFill, Audio, staticFile, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { motion } from "../motion";
import { theme } from "../theme";
import { Bgm } from "./audio";
import { CameraGroup } from "./CameraGroup";
import { LocationChip, StepBadge } from "./Hud";
import { ShotScene } from "./ShotScene";
import { StepDoneFx } from "./StepDoneFx";
import { StepIntroCard } from "./StepIntroCard";
import { TitleCard } from "./TitleCard";
import { episodeFrames, groupFrames, groupScenes, sceneFrames } from "./timing";
import { ManifestT, SceneT } from "./types";

export { episodeFrames, sceneFrames };

// 單一場景 + HUD 疊層
const SceneView: React.FC<{ scene: SceneT; prev?: SceneT; manifest: ManifestT; withWhoosh: boolean }> = ({
  scene,
  prev,
  manifest,
  withWhoosh,
}) => {
  const isShot = scene.kind === "shot";
  return (
    <AbsoluteFill>
      {scene.kind === "title" ? (
        <TitleCard scene={scene} episode={manifest.episode} episodesTotal={manifest.episodesTotal} />
      ) : scene.kind === "steps" ? (
        <StepIntroCard scene={scene} />
      ) : (
        <ShotScene scene={scene} />
      )}
      {isShot && scene.page ? <LocationChip page={scene.page} changed={scene.page !== prev?.page} /> : null}
      {isShot && scene.step ? (
        <StepBadge step={scene.step} changed={scene.step.index !== prev?.step?.index} done={scene.stepDone} />
      ) : null}
      {isShot && scene.stepDone ? <StepDoneFx /> : null}
      {withWhoosh ? <Audio src={staticFile("sfx/whoosh.wav")} volume={motion.sfxVolume * 0.6} /> : null}
    </AbsoluteFill>
  );
};

// 工廠：一份 manifest → 一個 Episode 元件。新增一集 = 只加 manifest + 素材。
// 素材連續性原則：連續 sameScreen 場景折成 CameraGroup 一鏡到底（HUD 跟子景走）；
// 素材斷裂處（字卡、兩段錄影之間、靜態截圖插入）才有 slide/fade 轉場。
export const makeEpisode = (manifest: ManifestT): React.FC => {
  const groups = groupScenes(manifest.scenes);
  const total = episodeFrames(manifest); // 常數，提到元件外——別在每幀渲染時重算
  const Episode: React.FC = () => {
    const { fps } = useVideoConfig();
    return (
      <AbsoluteFill style={{ backgroundColor: theme.bg }}>
        <TransitionSeries>
          {groups.flatMap((g, gi) => {
            const tr = g[0].transition ?? "slide";
            const prevScene = gi > 0 ? groups[gi - 1][groups[gi - 1].length - 1] : undefined;
            const els: React.ReactNode[] = [];
            if (gi > 0 && tr !== "none") {
              els.push(
                <TransitionSeries.Transition
                  key={`t-${g[0].id}`}
                  presentation={tr === "fade" ? fade() : slide({ direction: "from-right" })}
                  timing={linearTiming({ durationInFrames: motion.transition, easing: motion.enter })}
                />
              );
            }
            const withWhoosh = gi > 0 && tr === "slide";
            els.push(
              <TransitionSeries.Sequence key={g[0].id} durationInFrames={groupFrames(g, fps)}>
                {g.length === 1 ? (
                  <SceneView scene={g[0]} prev={prevScene} manifest={manifest} withWhoosh={withWhoosh} />
                ) : (
                  <AbsoluteFill>
                    <CameraGroup scenes={g} prev={prevScene} />
                    {withWhoosh ? (
                      <Audio src={staticFile("sfx/whoosh.wav")} volume={motion.sfxVolume * 0.6} />
                    ) : null}
                  </AbsoluteFill>
                )}
              </TransitionSeries.Sequence>
            );
            return els;
          })}
        </TransitionSeries>
        {manifest.bgm ? <Bgm src={manifest.bgm} totalFrames={total} volume={manifest.bgmVolume} /> : null}
      </AbsoluteFill>
    );
  };
  return Episode;
};
