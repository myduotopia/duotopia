import React from "react";
import { Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { motion } from "../motion";
import { SfxEvent } from "./types";

// 場景內音效事件（點擊/叮聲…），時間點來自錄影 steps.json 的 click 時間戳
export const Sfx: React.FC<{ events: SfxEvent[] }> = ({ events }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {events.map((e, i) => (
        <Sequence key={i} from={Math.round(e.t * fps)} durationInFrames={fps * 2}>
          <Audio src={staticFile(`sfx/${e.type}.wav`)} volume={motion.sfxVolume} />
        </Sequence>
      ))}
    </>
  );
};

// 整集背景音樂：loop、壓低音量、頭尾各 1.5s 淡入淡出
export const Bgm: React.FC<{ src: string; totalFrames: number; volume?: number }> = ({ src, totalFrames, volume }) => {
  const { fps } = useVideoConfig();
  const fadeF = Math.round(fps * 1.5);
  const vol = volume ?? motion.bgmVolume;
  return (
    <Audio
      src={staticFile(src)}
      loop
      volume={(f) =>
        interpolate(f, [0, fadeF, totalFrames - fadeF, totalFrames], [0, vol, vol, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      }
    />
  );
};
