/**
 * TugOfWarScene - Phaser 拔河遊戲場景
 *
 * 繪製火柴人 + 繩子拔河動畫。
 * 透過 scene.data 接收 React 傳來的狀態更新。
 */

import Phaser from "phaser";
import { Stickman } from "./Stickman";
import { Rope } from "./Rope";
import { VictoryAnimation } from "./VictoryAnimation";

const TEAM_A_COLOR = 0xef4444; // red
const TEAM_B_COLOR = 0x3b82f6; // blue
const SKY_COLOR = 0xe0f2fe;
const GROUND_COLOR = 0x86efac;
const GROUND_LINE_COLOR = 0x4ade80;

export interface TugOfWarState {
  ropePosition: number;
  maxPosition: number;
  winScore: number;
  lastCorrectTeam: "a" | "b" | null;
  isPaused: boolean;
  teamACooldown: boolean;
  teamBCooldown: boolean;
  winner: "a" | "b" | null;
}

export class TugOfWarScene extends Phaser.Scene {
  private stickmenA: Stickman[] = [];
  private stickmenB: Stickman[] = [];
  private rope!: Rope;
  private victoryAnim!: VictoryAnimation;
  private winLineGraphics!: Phaser.GameObjects.Graphics;
  private groundY = 0;
  private centerX = 0;
  private maxOffset = 0;
  private isVictoryPlaying = false;

  // Current state from React
  private state: TugOfWarState = {
    ropePosition: 0,
    maxPosition: 1,
    winScore: 1,
    lastCorrectTeam: null,
    isPaused: false,
    teamACooldown: false,
    teamBCooldown: false,
    winner: null,
  };

  constructor() {
    super({ key: "TugOfWarScene" });
  }

  create() {
    const { width, height } = this.scale;
    this.centerX = width / 2;
    this.groundY = height - 25;
    // Max offset: first stickman at 200px from center
    // Last stickman at 200 + 2*50 = 300px from center
    // Canvas half width = 500px, so max move = 500 - 300 - 20 = 180px
    // But also must not cross center: max move < 200 - 25 = 175px
    this.maxOffset = 120;

    // Background
    this.add.rectangle(width / 2, height / 2, width, height, SKY_COLOR);

    // Ground
    this.add.rectangle(
      width / 2,
      this.groundY + (height - this.groundY) / 2,
      width,
      height - this.groundY,
      GROUND_COLOR,
    );

    // Ground line
    const groundLine = this.add.graphics();
    groundLine.lineStyle(2, GROUND_LINE_COLOR);
    groundLine.beginPath();
    groundLine.moveTo(0, this.groundY);
    groundLine.lineTo(width, this.groundY);
    groundLine.strokePath();

    // Decorative grass tufts
    const grassG = this.add.graphics();
    grassG.lineStyle(2, 0x22c55e, 0.5);
    for (let gx = 20; gx < width; gx += 40 + Math.random() * 30) {
      const gy = this.groundY;
      grassG.beginPath();
      grassG.moveTo(gx, gy);
      grassG.lineTo(gx - 3, gy - 8 - Math.random() * 4);
      grassG.strokePath();
      grassG.beginPath();
      grassG.moveTo(gx + 4, gy);
      grassG.lineTo(gx + 6, gy - 6 - Math.random() * 4);
      grassG.strokePath();
    }

    // Win line markers (drawn dynamically in update)
    this.winLineGraphics = this.add.graphics();

    // === Layer order: stickman back → rope → stickman front ===

    // 1) Create stickmen (this creates both backGraphics and frontGraphics)
    for (let i = 0; i < 3; i++) {
      const sx = this.centerX - 200 - i * 50;
      this.stickmenA.push(
        new Stickman(this, sx, this.groundY, TEAM_A_COLOR, false),
      );
    }
    for (let i = 0; i < 3; i++) {
      const sx = this.centerX + 200 + i * 50;
      this.stickmenB.push(
        new Stickman(this, sx, this.groundY, TEAM_B_COLOR, true),
      );
    }

    // 2) Rope — created after stickmen's backGraphics, before frontGraphics are brought up
    const ropeY = this.groundY - 48;
    this.rope = new Rope(this, this.centerX, ropeY, 540, this.groundY);

    // 3) Bring all front hands to top (above rope)
    [...this.stickmenA, ...this.stickmenB].forEach((s) => {
      this.children.bringToTop(s.frontGraphics);
    });

    // Victory animation
    this.victoryAnim = new VictoryAnimation(this);

    // Listen for state updates from React
    this.data.set("state", this.state);
    this.data.events.on(
      "changedata-state",
      (_: unknown, value: TugOfWarState) => {
        this.state = value;
        this.applyState();
      },
    );
  }

  private applyState() {
    const {
      ropePosition,
      winScore,
      lastCorrectTeam,
      teamACooldown,
      teamBCooldown,
      isPaused,
    } = this.state;

    // Update rope position — each point moves rope by maxOffset/winScore
    // so at exactly winScore points, flag reaches the win line
    const clampedWin = Math.max(winScore, 1);
    const targetOffset = (ropePosition / clampedWin) * this.maxOffset;
    this.rope.setTargetOffset(targetOffset);

    // Flag color
    if (ropePosition < 0) {
      this.rope.setFlagColor(TEAM_A_COLOR);
    } else if (ropePosition > 0) {
      this.rope.setFlagColor(TEAM_B_COLOR);
    } else {
      this.rope.setFlagColor(0xf59e0b);
    }

    // Stickmen pulling animation
    const isPullingA = !isPaused && lastCorrectTeam === "a";
    const isPullingB = !isPaused && lastCorrectTeam === "b";

    this.stickmenA.forEach((s) => {
      s.setPulling(isPullingA);
      s.setCooldown(teamACooldown);
    });
    this.stickmenB.forEach((s) => {
      s.setPulling(isPullingB);
      s.setCooldown(teamBCooldown);
    });

    // Victory animation: trigger or reset
    const { winner } = this.state;
    if (winner && !this.isVictoryPlaying) {
      this.isVictoryPlaying = true;

      // Hide normal stickmen
      this.stickmenA.forEach((s) => {
        s.backGraphics.setVisible(false);
        s.frontGraphics.setVisible(false);
      });
      this.stickmenB.forEach((s) => {
        s.backGraphics.setVisible(false);
        s.frontGraphics.setVisible(false);
      });

      // Get current positions
      const ropeOffset = this.rope.offset;
      const ax = this.stickmenA.map(
        (_, i) => this.centerX - 200 - i * 50 + ropeOffset,
      );
      const bx = this.stickmenB.map(
        (_, i) => this.centerX + 200 + i * 50 + ropeOffset,
      );

      this.victoryAnim.start(winner, { ax, bx, groundY: this.groundY });
    } else if (!winner && this.isVictoryPlaying) {
      // Reset: restore normal stickmen
      this.isVictoryPlaying = false;
      this.victoryAnim.cleanup();

      this.stickmenA.forEach((s) => {
        s.backGraphics.setVisible(true);
        s.frontGraphics.setVisible(true);
      });
      this.stickmenB.forEach((s) => {
        s.backGraphics.setVisible(true);
        s.frontGraphics.setVisible(true);
      });
    }
  }

  update(_time: number, delta: number) {
    // Update rope
    this.rope.update(delta);

    // Move stickmen with rope offset
    const ropeOffset = this.rope.offset;
    this.stickmenA.forEach((s, i) => {
      s.setX(this.centerX - 200 - i * 50 + ropeOffset);
      s.update(delta);
    });
    this.stickmenB.forEach((s, i) => {
      s.setX(this.centerX + 200 + i * 50 + ropeOffset);
      s.update(delta);
    });

    // Draw win lines
    this.drawWinLines();

    // Victory animation
    if (this.isVictoryPlaying) {
      this.victoryAnim.update(delta);
    }
  }

  private drawWinLines() {
    const g = this.winLineGraphics;
    g.clear();

    const winOffset = this.maxOffset;
    const top = this.groundY - 90;
    const bottom = this.groundY;

    // Left win line (Team A wins here) — dashed
    this.drawDashedLine(
      g,
      this.centerX - winOffset,
      top,
      bottom,
      0xef4444,
      0.5,
    );

    // Right win line (Team B wins here) — dashed
    this.drawDashedLine(
      g,
      this.centerX + winOffset,
      top,
      bottom,
      0x3b82f6,
      0.5,
    );
  }

  private drawDashedLine(
    g: Phaser.GameObjects.Graphics,
    x: number,
    top: number,
    bottom: number,
    color: number,
    alpha: number,
    dashLen = 6,
    gapLen = 4,
  ) {
    g.lineStyle(2, color, alpha);
    let y = top;
    while (y < bottom) {
      const endY = Math.min(y + dashLen, bottom);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, endY);
      g.strokePath();
      y += dashLen + gapLen;
    }
  }
}
