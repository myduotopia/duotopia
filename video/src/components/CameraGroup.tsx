import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { motion } from "../motion";
import { Caption } from "./Caption";
import { LocationChip, StepBadge } from "./Hud";
import { SCENE_BG } from "./ShotScene";
import { SceneMedia } from "./SceneMedia";
import { StepDoneFx } from "./StepDoneFx";
import { Sfx } from "./audio";
import { VH, VW, toScreen } from "./frame";
import { sceneFrames } from "./timing";
import { Box, SceneT } from "./types";

// 運鏡群組：同一段連續錄影的相鄰場景一鏡到底（素材連續 → 畫面連續）。
// 運鏡文法 v3：
// - 置中：焦點放大後平移到畫面中心（scale+translate；角落元素 clamp 到邊界=「不在此限」）
// - 全局過渡：兩個深 zoom 焦點之間切換，先拉回全幅再推進新焦點（觀眾不迷失）
// - HUD 跟子景走：page/step 變化才做更新動畫；stepDone 在該子景結尾打勾/慶祝
// ⚠ 置中與 zoom 公式在 qa_frames.py 有 Python 對照實作（置中驗算用），改這裡要同步改那裡。
type Cam = { s: number; tx: number; ty: number; cx: number; cy: number };

const TWEEN = 24; // 0.8s @30fps 單段運鏡
const VIA_FULL_MIN_SCALE = 1.15; // 兩端都深於此 zoom 才需要全局過渡
const VIA_FULL_MIN_DIST = 400; // 焦點中心距離（px）超過才需要全局過渡
const VIA_FULL_MIN_SCENE = 75; // 子景短於 2.5s 塞不下兩段，退化單段

const FULL_CAM: Cam = { s: 1, tx: 0, ty: 0, cx: VW / 2, cy: VH / 2 };

const focusOf = (s: SceneT): Box | undefined => s.camera ?? s.spotlight ?? s.highlights?.[0];

// 焦點框 → 攝影機狀態：框越小 zoom 越大（留呼吸邊距，上限 1.8），焦點中心平移到畫面中心，
// translate clamp 讓內容不出界（角落元素因此只能「盡量靠中」）
// EP6（2026-07-17 使用者指定）：群組內場景可用 `zoom` 覆寫倍率（突破呼吸邊距的 ~2.08 極限，上限 4）。
// ⚠ 改這裡要同步改 qa_frames.py 的 Python 對照實作。
const cameraFor = (scene: SceneT): Cam => {
  const focus = focusOf(scene);
  if (!focus) return FULL_CAM;
  const b = toScreen(focus);
  const auto = Math.min(1.8, Math.max(1, Math.min(VW / (b.w + 520), VH / (b.h + 520))));
  const s = scene.zoom ? Math.min(4, Math.max(1, scene.zoom)) : auto;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const tx = Math.min(0, Math.max(VW - VW * s, VW / 2 - cx * s));
  const ty = Math.min(0, Math.max(VH - VH * s, VH / 2 - cy * s));
  return { s, tx, ty, cx, cy };
};

const lerpCam = (a: Cam, b: Cam, p: number): Cam => ({
  s: a.s + (b.s - a.s) * p,
  tx: a.tx + (b.tx - a.tx) * p,
  ty: a.ty + (b.ty - a.ty) * p,
  cx: a.cx + (b.cx - a.cx) * p,
  cy: a.cy + (b.cy - a.cy) * p,
});

// 子景 i 的運鏡計畫：direct（單段）或 via-full（先回全局再推進）
export const tweenPlan = (from: Cam, to: Cam, sceneLenFrames: number): "direct" | "via-full" => {
  const dist = Math.hypot(to.cx - from.cx, to.cy - from.cy);
  if (from.s > VIA_FULL_MIN_SCALE && to.s > VIA_FULL_MIN_SCALE && dist > VIA_FULL_MIN_DIST && sceneLenFrames >= VIA_FULL_MIN_SCENE) {
    return "via-full";
  }
  return "direct";
};

// 子景開始後第幾 frame 運鏡完成（tts 腳本排 hlAtSec、qa 驗時序都用同一定義）
export const tweenDoneFrames = (plan: "direct" | "via-full"): number =>
  plan === "via-full" ? TWEEN * 2 : TWEEN;

export const CameraGroup: React.FC<{ scenes: SceneT[]; prev?: SceneT }> = ({ scenes, prev }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const starts: number[] = [];
  let acc = 0;
  for (const s of scenes) {
    starts.push(acc);
    acc += sceneFrames(s, fps);
  }
  let idx = 0;
  for (let i = 0; i < scenes.length; i++) if (frame >= starts[i]) idx = i;

  const cams = scenes.map(cameraFor);
  let cam = cams[idx];
  if (idx > 0) {
    const from = cams[idx - 1];
    const to = cams[idx];
    const plan = tweenPlan(from, to, sceneFrames(scenes[idx], fps));
    const local = frame - starts[idx];
    const ease = (a: number, b: number) =>
      interpolate(local, [a, b], [0, 1], {
        easing: motion.move,
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    if (plan === "via-full") {
      // 先拉回全局（觀眾看到整頁與相對位置），再推進新焦點
      cam = local < TWEEN ? lerpCam(from, FULL_CAM, ease(0, TWEEN)) : lerpCam(FULL_CAM, to, ease(TWEEN, TWEEN * 2));
    } else if (local < TWEEN) {
      cam = lerpCam(from, to, ease(0, TWEEN));
    }
  }

  return (
    <AbsoluteFill style={{ background: SCENE_BG }}>
      <AbsoluteFill style={{ transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})`, transformOrigin: "0 0" }}>
        {scenes.map((s, i) => {
          // 與前一景同焦點的純靜態續景 → 標記不重閃（傳大負值 = 立即全亮）
          const still =
            i > 0 &&
            !s.clip &&
            !scenes[i - 1].clip &&
            JSON.stringify(focusOf(s) ?? null) === JSON.stringify(focusOf(scenes[i - 1]) ?? null);
          return (
            <Sequence key={s.id} from={starts[i]} durationInFrames={sceneFrames(s, fps)}>
              <SceneMedia scene={s} hlDelayOverride={still ? -100 : undefined} />
            </Sequence>
          );
        })}
      </AbsoluteFill>
      {scenes.map((s, i) => {
        const before = i > 0 ? scenes[i - 1] : prev;
        return (
          <Sequence key={`ov-${s.id}`} from={starts[i]} durationInFrames={sceneFrames(s, fps)}>
            {s.caption ? <Caption text={s.caption} /> : null}
            {s.page ? <LocationChip page={s.page} changed={s.page !== before?.page} /> : null}
            {s.step ? (
              <StepBadge step={s.step} changed={s.step.index !== before?.step?.index} done={s.stepDone} />
            ) : null}
            {s.stepDone ? <StepDoneFx /> : null}
            {s.sfx?.length ? <Sfx events={s.sfx} /> : null}
            <Audio src={staticFile(s.audio)} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
