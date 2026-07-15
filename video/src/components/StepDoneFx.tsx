import React from "react";
import { Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { motion } from "../motion";
import { SuccessBurst } from "./SuccessBurst";

// 步驟完成慶祝：徽章打勾由 StepBadge 處理，這裡是右上慶祝動效＋完成音。
// 在所屬 Sequence 的最後 1 秒觸發（單景 = 場景結尾；群組內 = 該子景結尾）。
export const StepDoneFx: React.FC = () => {
  const { fps, durationInFrames } = useVideoConfig();
  return (
    <>
      {/* 錨在右上步驟徽章下方：語意=該步驟完成，且永不蓋住畫面重點（如密碼 toast） */}
      <SuccessBurst cx={1735} cy={210} />
      <Sequence from={durationInFrames - fps} durationInFrames={fps}>
        <Audio src={staticFile("sfx/success.wav")} volume={motion.sfxVolume} />
      </Sequence>
    </>
  );
};
