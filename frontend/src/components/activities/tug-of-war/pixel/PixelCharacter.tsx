/**
 * PixelCharacter — 單一拔河角色（issue #920）
 *
 * 依 team + pose 產生對應 spritesheet（隊色替換、B 隊鏡像），以 CSS steps() 播放。
 * spritesheet 由 makeSheet module-cache，pose 切換只是換背景圖，零 JS 動畫迴圈。
 */

import { useMemo } from "react";
import type { Team } from "../types";
import { TEAM_COLORS } from "./palette";
import { makeSheet, spriteStyle } from "./renderSprite";
import { CHAR_ANIMS, type CharPose } from "./sprites/character";

interface PixelCharacterProps {
  team: Team;
  pose: CharPose;
  /** 邏輯像素縮放（1 sprite px → scale stage px）。 */
  scale: number;
  /** 舞台絕對定位。 */
  left: number;
  top: number;
  zIndex?: number;
  /** 三人動作錯開的動畫延遲（ms，負值）。 */
  delayMs?: number;
}

export function PixelCharacter({
  team,
  pose,
  scale,
  left,
  top,
  zIndex = 10,
  delayMs = 0,
}: PixelCharacterProps) {
  const style = useMemo(() => {
    const anim = CHAR_ANIMS[pose];
    const sheet = makeSheet(anim.frames, TEAM_COLORS[team], `char-${pose}`);
    return spriteStyle(sheet, scale, anim.dur);
  }, [team, pose, scale]);

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        zIndex,
        animationDelay: delayMs ? `${delayMs}ms` : undefined,
        transform: team === "b" ? "scaleX(-1)" : undefined,
        ...style,
      }}
    />
  );
}
