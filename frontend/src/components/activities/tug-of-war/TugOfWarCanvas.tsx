/**
 * TugOfWarCanvas - 火柴人拔河 Canvas 動畫
 *
 * 用原生 HTML5 Canvas 繪製火柴人角色 + 繩子拔河場景。
 * A隊(紅) vs B隊(藍)，繩子位置隨 ropePosition 移動。
 */

import { useRef, useEffect, useCallback } from "react";
import type { Team } from "./types";

interface TugOfWarCanvasProps {
  ropePosition: number;
  maxPosition: number;
  lastCorrectTeam: Team | null;
  isPaused: boolean;
  teamACooldown: boolean;
  teamBCooldown: boolean;
}

const TEAM_A_COLOR = "#EF4444"; // red
const TEAM_B_COLOR = "#3B82F6"; // blue
const ROPE_COLOR = "#92400E";
const GROUND_COLOR = "#86EFAC"; // light green
const SKY_COLOR = "#E0F2FE"; // light blue

function drawStickman(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  color: string,
  facingLeft: boolean,
  pullPhase: number, // 0-1, animation phase
  isCooldown: boolean,
) {
  const dir = facingLeft ? -1 : 1;
  const headRadius = 10;
  const bodyLen = 30;
  const limbLen = 20;

  // Pulling animation: body leans back, arms reach forward
  const leanAngle = Math.sin(pullPhase * Math.PI * 2) * 0.15;
  const armReach = Math.sin(pullPhase * Math.PI * 2) * 5;

  ctx.save();
  ctx.globalAlpha = isCooldown ? 0.4 : 1;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";

  // Head
  const headX = x;
  const headY = groundY - bodyLen - limbLen - headRadius;
  ctx.beginPath();
  ctx.arc(headX, headY, headRadius, 0, Math.PI * 2);
  ctx.fill();

  // Body (with lean)
  const bodyTopX = headX;
  const bodyTopY = headY + headRadius;
  const bodyBottomX = headX + Math.sin(leanAngle) * bodyLen * dir * -1;
  const bodyBottomY = groundY - limbLen;
  ctx.beginPath();
  ctx.moveTo(bodyTopX, bodyTopY);
  ctx.lineTo(bodyBottomX, bodyBottomY);
  ctx.stroke();

  // Arms - reaching toward rope
  const shoulderX = bodyTopX + (bodyBottomX - bodyTopX) * 0.3;
  const shoulderY = bodyTopY + (bodyBottomY - bodyTopY) * 0.3;
  // Both arms reaching forward
  const handX = shoulderX + dir * (limbLen + 10 + armReach);
  const handY = shoulderY + 5;
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(handX, handY);
  ctx.stroke();
  // Second arm slightly different angle
  const hand2X = shoulderX + dir * (limbLen + 8 + armReach);
  const hand2Y = shoulderY + 12;
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(hand2X, hand2Y);
  ctx.stroke();

  // Legs - bracing stance
  const hipX = bodyBottomX;
  const hipY = bodyBottomY;
  // Front leg (bent forward)
  const knee1X = hipX + dir * 8;
  const knee1Y = hipY + limbLen * 0.6;
  const foot1X = hipX + dir * 15;
  const foot1Y = groundY;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(knee1X, knee1Y);
  ctx.lineTo(foot1X, foot1Y);
  ctx.stroke();
  // Back leg (stretched back)
  const foot2X = hipX - dir * 12;
  const foot2Y = groundY;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(foot2X, foot2Y);
  ctx.stroke();

  ctx.restore();
}

export function TugOfWarCanvas({
  ropePosition,
  maxPosition,
  lastCorrectTeam,
  isPaused,
  teamACooldown,
  teamBCooldown,
}: TugOfWarCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const frameRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const groundY = H - 20;
    const centerX = W / 2;

    // Rope offset based on position
    const clampedMax = Math.max(maxPosition, 1);
    const offsetRatio = ropePosition / clampedMax;
    const maxOffset = W * 0.3;
    const ropeOffset = offsetRatio * maxOffset;

    // Animation phase
    frameRef.current += 1;
    const pullPhase = frameRef.current / 30; // ~0.5s cycle at 60fps
    const isPullingA = !isPaused && lastCorrectTeam === "a";
    const isPullingB = !isPaused && lastCorrectTeam === "b";

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Sky
    ctx.fillStyle = SKY_COLOR;
    ctx.fillRect(0, 0, W, groundY);

    // Ground
    ctx.fillStyle = GROUND_COLOR;
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.strokeStyle = "#4ADE80";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(W, groundY);
    ctx.stroke();

    // Center line (dashed)
    ctx.strokeStyle = "#D1D5DB";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(centerX, groundY - 80);
    ctx.lineTo(centerX, groundY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Rope
    const ropeY = groundY - 45;
    const ropeStartX = centerX - 120 + ropeOffset;
    const ropeEndX = centerX + 120 + ropeOffset;
    ctx.strokeStyle = ROPE_COLOR;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(ropeStartX, ropeY);
    ctx.lineTo(ropeEndX, ropeY);
    ctx.stroke();

    // Flag at rope center
    const flagX = centerX + ropeOffset;
    ctx.fillStyle =
      ropePosition < 0
        ? TEAM_A_COLOR
        : ropePosition > 0
          ? TEAM_B_COLOR
          : "#F59E0B";
    ctx.beginPath();
    ctx.moveTo(flagX, ropeY - 25);
    ctx.lineTo(flagX + 12, ropeY - 18);
    ctx.lineTo(flagX, ropeY - 11);
    ctx.closePath();
    ctx.fill();
    // Flag pole
    ctx.strokeStyle = "#4B5563";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(flagX, ropeY - 25);
    ctx.lineTo(flagX, ropeY);
    ctx.stroke();

    // Team A stickmen (left side, facing right)
    const teamABaseX = centerX - 140 + ropeOffset;
    for (let i = 0; i < 3; i++) {
      drawStickman(
        ctx,
        teamABaseX - i * 35,
        groundY,
        TEAM_A_COLOR,
        false, // facing right
        isPullingA ? pullPhase + i * 0.3 : 0,
        teamACooldown,
      );
    }

    // Team B stickmen (right side, facing left)
    const teamBBaseX = centerX + 140 + ropeOffset;
    for (let i = 0; i < 3; i++) {
      drawStickman(
        ctx,
        teamBBaseX + i * 35,
        groundY,
        TEAM_B_COLOR,
        true, // facing left
        isPullingB ? pullPhase + i * 0.3 : 0,
        teamBCooldown,
      );
    }

    animRef.current = requestAnimationFrame(draw);
  }, [
    ropePosition,
    maxPosition,
    lastCorrectTeam,
    isPaused,
    teamACooldown,
    teamBCooldown,
  ]);

  useEffect(() => {
    // Set canvas size
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1);
      canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
      }
    }

    animRef.current = requestAnimationFrame(draw);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [draw]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1);
        canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
        }
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg"
      style={{ height: "180px" }}
    />
  );
}
