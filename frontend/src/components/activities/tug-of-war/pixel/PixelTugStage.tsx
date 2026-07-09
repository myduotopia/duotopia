/**
 * PixelTugStage — 拔河對戰動畫舞台（issue #920，取代 Phaser 層）
 *
 * 全寬像素風場景：天空/雲/草地/勝利線標桿/繩+旗/雙方各 3 角色，可選音檔懸掛看板。
 * 以固定邏輯座標（STAGE_W×STAGE_H）繪製，外層依容器大小算 scale 等比縮放 →
 * pixel-perfect 且零 reflow。角色姿勢、旗色、繩位皆由 props 推導；動畫全交 CSS。
 */

import {
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  type CSSProperties,
} from "react";
import type { Team } from "../types";
import { TEAM_COLORS } from "./palette";
import { makeSheet, spriteStyle, PLAY_KEYFRAME } from "./renderSprite";
import { CHAR_W, type CharPose } from "./sprites/character";
import { PixelCharacter } from "./PixelCharacter";
import { CLOUD1, CLOUD2, BUSH, makeGrass, makePole } from "./sprites/scenery";
import { ROPE_TILE, FLAG } from "./sprites/ropeFlag";
import { makeSign } from "./sprites/sign";

// ---- 邏輯座標系 ----
const STAGE_W = 960;
const STAGE_H = 280;
const S = 5; // 1 sprite px → 5 stage px（角色/繩/旗）
const SCENE_S = 4; // 場景裝飾用較小倍率
const GROUND_Y = 232;
const CENTER_X = STAGE_W / 2;
const MAX_OFFSET = 240; // 旗子到勝利線的最大位移
const CHAR_XS = [46, 138, 230];
const CHAR_TOP = GROUND_Y - 31 * S + S;

export interface PixelTugStageProps {
  ropePosition: number; // 負 = A 領先
  winScore: number;
  /** 各隊是否正在拉繩（答對過場中）；同題模式一次只有一邊、不同題可各自為真。 */
  pullA: boolean;
  pullB: boolean;
  teamACooldown: boolean;
  teamBCooldown: boolean;
  winner: Team | "draw" | null;
  /** 顯示音檔懸掛看板（有音檔的題型）。 */
  showSign?: boolean;
  /** 看板靜音狀態（靜音顯示紅斜線）。 */
  audioMuted?: boolean;
  onSignClick?: () => void;
  /** 隊伍分數（顯示於各隊旗桿正上方）。 */
  scoreA?: number;
  scoreB?: number;
  /** 勝負後的再玩一次。 */
  onReplay?: () => void;
  teamAWinsLabel?: string;
  teamBWinsLabel?: string;
  drawLabel?: string;
  replayLabel?: string;
}

function poseFor(
  team: Team,
  winner: Team | "draw" | null,
  pulling: boolean,
  cooldown: boolean,
): CharPose {
  if (winner) {
    if (winner === "draw") return "idle";
    return winner === team ? "victory" : "defeat";
  }
  if (pulling) return "pull";
  if (cooldown) return "dizzy";
  return "idle";
}

const CONFETTI_COLORS = ["#e83b3b", "#4d9be6", "#f9c22b", "#1ebc73", "#f68181"];

export function PixelTugStage(props: PixelTugStageProps) {
  const {
    ropePosition,
    winScore,
    pullA,
    pullB,
    teamACooldown,
    teamBCooldown,
    winner,
    showSign = false,
    audioMuted = false,
    onSignClick,
    scoreA = 0,
    scoreB = 0,
    onReplay,
    teamAWinsLabel = "Team A Wins!",
    teamBWinsLabel = "Team B Wins!",
    drawLabel = "Draw!",
    replayLabel = "Play Again",
  } = props;

  // ---- 靜態場景 sheets（隊色/尺寸固定，一次算好）----
  const scenery = useMemo(() => {
    const grass = makeSheet(makeGrass(), {}, "grass");
    return {
      cloud1: makeSheet([CLOUD1], {}, "cloud1"),
      cloud2: makeSheet([CLOUD2], {}, "cloud2"),
      bush: makeSheet([BUSH], {}, "bush"),
      grass,
      poleA: makeSheet(makePole(), TEAM_COLORS.a, "poleA"),
      poleB: makeSheet(makePole(), TEAM_COLORS.b, "poleB"),
      rope: makeSheet([ROPE_TILE], {}, "rope"),
      flagA: makeSheet(
        [FLAG],
        { F: TEAM_COLORS.a.T, f: TEAM_COLORS.a.t },
        "flagA",
      ),
      flagB: makeSheet(
        [FLAG],
        { F: TEAM_COLORS.b.T, f: TEAM_COLORS.b.t },
        "flagB",
      ),
      flagN: makeSheet(
        [FLAG],
        { F: TEAM_COLORS.neutral.T, f: TEAM_COLORS.neutral.t },
        "flagN",
      ),
    };
  }, []);
  const signSheet = useMemo(
    () =>
      showSign
        ? makeSheet(
            [makeSign(audioMuted)],
            { z: "#e83b3b" }, // 靜音紅斜線
            `sign-${audioMuted ? "muted" : "on"}`,
          )
        : null,
    [showSign, audioMuted],
  );

  // ---- 舞台縮放：等比塞進場景容器 ----
  const sceneRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    const recompute = () => {
      const sc = Math.min(el.clientWidth / STAGE_W, el.clientHeight / STAGE_H);
      if (sc > 0 && Number.isFinite(sc)) setScale(sc);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- 由 props 推導 ----
  const safeWin = Math.max(1, winScore);
  const tugOffset = (ropePosition / safeWin) * MAX_OFFSET;
  const lead = ropePosition < 0 ? "a" : ropePosition > 0 ? "b" : "neutral";
  const flagSheet =
    lead === "a" ? scenery.flagA : lead === "b" ? scenery.flagB : scenery.flagN;
  const poseA = poseFor("a", winner, pullA, teamACooldown);
  const poseB = poseFor("b", winner, pullB, teamBCooldown);

  const stageStyle: CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: STAGE_W,
    height: STAGE_H,
    transform: `translate(-50%, -50%) scale(${scale})`,
    transformOrigin: "center center",
  };

  return (
    <div
      ref={sceneRef}
      className="relative h-full w-full overflow-hidden"
      style={{ background: "linear-gradient(#8fd3ff 0%, #c7ecff 100%)" }}
    >
      <style>{keyframes}</style>

      <div style={stageStyle}>
        {/* 雲 */}
        {[
          { s: scenery.cloud1, x: 60, y: 26, sc: SCENE_S, dur: 90 },
          { s: scenery.cloud2, x: 420, y: 12, sc: SCENE_S, dur: 120 },
          { s: scenery.cloud1, x: 760, y: 44, sc: 3, dur: 75 },
        ].map((c, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: c.x,
              top: c.y,
              opacity: 0.95,
              animation: `tow-drift ${c.dur}s linear infinite`,
              animationDelay: `${-i * 22}s`,
              ...spriteStyle(c.s, c.sc),
            }}
          />
        ))}

        {/* 地面（左右外擴，縮小時仍鋪滿） */}
        <div
          style={{
            position: "absolute",
            left: -2000,
            right: -2000,
            bottom: 0,
            height: 48,
            backgroundImage: scenery.grass.url
              ? `url(${scenery.grass.url})`
              : undefined,
            backgroundSize: `${16 * SCENE_S}px ${12 * SCENE_S}px`,
            backgroundRepeat: "repeat-x",
            imageRendering: "pixelated",
          }}
        />
        {/* 草叢 */}
        {[
          [30, 0],
          [880, 0],
          [200, 4],
          [700, 4],
        ].map(([x, dy], i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: GROUND_Y - 14 + dy,
              ...spriteStyle(scenery.bush, SCENE_S),
            }}
          />
        ))}

        {/* 勝利線標桿（左紅右藍） */}
        <div
          style={{
            position: "absolute",
            left: CENTER_X - MAX_OFFSET - 16,
            top: GROUND_Y - 176,
            ...spriteStyle(scenery.poleA, SCENE_S),
          }}
        />
        <div
          style={{
            position: "absolute",
            left: CENTER_X + MAX_OFFSET - 16,
            top: GROUND_Y - 176,
            transform: "scaleX(-1)",
            ...spriteStyle(scenery.poleB, SCENE_S),
          }}
        />

        {/* 分數：各隊旗桿正上方（紅隊左、藍隊右） */}
        {[
          { x: CENTER_X - MAX_OFFSET + 4, v: scoreA, color: "#e83b3b" },
          { x: CENTER_X + MAX_OFFSET + 4, v: scoreB, color: "#4d9be6" },
        ].map((s, i) => (
          <div
            key={i}
            className="pixel-font"
            style={{
              position: "absolute",
              left: s.x,
              top: 6,
              zIndex: 8,
              transform: "translateX(-50%)",
              fontSize: 40,
              lineHeight: 1,
              fontWeight: "bold",
              color: s.color,
              textShadow:
                "2px 0 #fff, -2px 0 #fff, 0 2px #fff, 0 -2px #fff, 2px 2px #fff, -2px -2px #fff",
            }}
          >
            {s.v}
          </div>
        ))}

        {/* 繩 + 旗 + 角色（一起位移） */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translateX(${tugOffset}px)`,
            transition: "transform 0.5s cubic-bezier(0.2,0,0,1)",
          }}
        >
          {/* 繩 */}
          <div
            style={{
              position: "absolute",
              left: -2000,
              right: -2000,
              top: GROUND_Y - 56,
              height: 6 * S,
              backgroundImage: scenery.rope.url
                ? `url(${scenery.rope.url})`
                : undefined,
              backgroundSize: `${8 * S}px ${6 * S}px`,
              backgroundRepeat: "repeat-x",
              imageRendering: "pixelated",
            }}
          />
          {/* 中央旗 */}
          <div
            style={{
              position: "absolute",
              left: CENTER_X - 6 * S,
              top: GROUND_Y - 56,
              zIndex: 5,
              ...spriteStyle(flagSheet, S),
            }}
          />
          {/* 角色 */}
          {CHAR_XS.map((x, i) => (
            <PixelCharacter
              key={`a${i}`}
              team="a"
              pose={poseA}
              scale={S}
              left={x}
              top={CHAR_TOP}
              zIndex={10 + i}
              delayMs={-i * 130}
            />
          ))}
          {CHAR_XS.map((x, i) => (
            <PixelCharacter
              key={`b${i}`}
              team="b"
              pose={poseB}
              scale={S}
              left={STAGE_W - x - CHAR_W * S}
              top={CHAR_TOP}
              zIndex={10 + i}
              delayMs={-i * 130}
            />
          ))}
        </div>

        {/* 音檔懸掛看板 */}
        {showSign && signSheet && (
          <div
            onClick={onSignClick}
            className="tow-swing"
            style={{
              position: "absolute",
              left: "50%",
              top: -6,
              zIndex: 6,
              cursor: onSignClick ? "pointer" : "default",
              ...spriteStyle(signSheet, SCENE_S),
            }}
          />
        )}
      </div>

      {/* 勝負演出 */}
      {winner && (
        <div className="absolute inset-0 z-30 flex flex-col items-start justify-start gap-2 bg-[#2e222f]/25 pt-[2.5%]">
          {Array.from({ length: 26 }, (_, i) => (
            <div
              key={i}
              className="tow-confetti"
              style={{
                position: "absolute",
                top: -20,
                left: `${4 + ((i * 37) % 92)}%`,
                width: i % 3 === 0 ? 8 : 12,
                height: i % 3 === 0 ? 8 : 12,
                background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                imageRendering: "pixelated",
                animationDuration: `${1.3 + (i % 5) * 0.22}s`,
                animationDelay: `${(i % 7) * 0.12}s`,
              }}
            />
          ))}
          <div className="mx-auto flex flex-col items-center gap-3">
            <div
              className={`pixel-font tow-pop border-4 bg-[#2e222f] px-6 py-3 text-center font-bold ${
                winner === "a"
                  ? "border-[#f68181] text-[#f68181]"
                  : winner === "b"
                    ? "border-[#8fd3ff] text-[#8fd3ff]"
                    : "border-white text-white"
              }`}
              style={{
                fontSize: "clamp(22px, 6vh, 46px)",
                boxShadow: "0 6px 0 rgba(0,0,0,.4)",
              }}
            >
              {winner === "a"
                ? teamAWinsLabel
                : winner === "b"
                  ? teamBWinsLabel
                  : drawLabel}
            </div>
            {onReplay && (
              <button
                onClick={onReplay}
                className="pixel-font bg-[#625565] px-4 py-2 text-sm text-white border-b-[3px] border-[#3e3546] active:translate-y-[2px]"
              >
                ↻ {replayLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const keyframes = `
@keyframes ${PLAY_KEYFRAME} { from { background-position-x: 0; } to { background-position-x: var(--tow-endx); } }
@keyframes tow-drift { from { transform: translateX(0); } to { transform: translateX(-1160px); } }
@keyframes tow-swing { 0%,100% { transform: translateX(-50%) rotate(-1.6deg); } 50% { transform: translateX(-50%) rotate(1.6deg); } }
@keyframes tow-confFall { 0% { transform: translateY(0) rotate(0deg); opacity: 1; } 100% { transform: translateY(340px) rotate(540deg); opacity: .9; } }
@keyframes tow-pop { 0% { transform: scale(.3); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
@keyframes tow-phoneTilt { 0%,35% { transform: rotate(0); } 60%,100% { transform: rotate(-90deg); } }
.tow-swing { transform-origin: top center; animation: tow-swing 3.4s ease-in-out infinite; }
.tow-confetti { animation-name: tow-confFall; animation-timing-function: linear; animation-fill-mode: forwards; animation-iteration-count: infinite; }
.tow-pop { animation: tow-pop .35s cubic-bezier(0.175,0.885,0.32,1.275); }
.tow-phone-tilt { animation: tow-phoneTilt 1.8s ease-in-out infinite; }
`;
