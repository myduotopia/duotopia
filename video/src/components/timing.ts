// 場景時長與運鏡群組的排程計算（makeEpisode / CameraGroup / Root 共用同一套算法）
import { motion } from "../motion";
import { ManifestT, SceneT } from "./types";

export const sceneFrames = (s: SceneT, fps: number) => Math.max(1, Math.round(s.durationSec * fps));

// 連續 sameScreen 場景折成運鏡群組：[[單景], [群組首景, 續景, ...], ...]
export const groupScenes = (scenes: SceneT[]): SceneT[][] => {
  const out: SceneT[][] = [];
  for (const s of scenes) {
    if (s.sameScreen && out.length > 0) out[out.length - 1].push(s);
    else out.push([s]);
  }
  return out;
};

export const groupFrames = (g: SceneT[], fps: number) => g.reduce((a, s) => a + sceneFrames(s, fps), 0);

// 整集總長：群組加總，扣掉「群組之間」轉場的重疊（群組內無轉場）
export const episodeFrames = (m: ManifestT): number => {
  const groups = groupScenes(m.scenes);
  let total = 0;
  groups.forEach((g, gi) => {
    total += groupFrames(g, m.fps);
    if (gi > 0 && (g[0].transition ?? "slide") !== "none") total -= motion.transition;
  });
  return Math.max(1, total);
};
