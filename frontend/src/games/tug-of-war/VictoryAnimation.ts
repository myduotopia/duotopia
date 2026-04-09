/**
 * VictoryAnimation - 勝利動畫
 *
 * 贏的隊伍火柴人跳躍歡呼，輸的隊伍跌坐在地。
 * 作為獨立 Phaser Scene overlay 使用。
 */

import Phaser from "phaser";

const OUTLINE_COLOR = 0x1f2937;
const OUTLINE_WIDTH = 2.5;
const HEAD_RADIUS = 18;
const BODY_WIDTH = 8;
const BODY_HEIGHT = 35;
const ARM_THICKNESS = 6;
const LEG_THICKNESS = 7;
const LEG_LEN = 26;

interface CelebCharacter {
  x: number;
  baseY: number;
  color: number;
  facingLeft: boolean;
  phase: number; // animation phase offset
  graphics: Phaser.GameObjects.Graphics;
}

export class VictoryAnimation {
  private scene: Phaser.Scene;
  private winners: CelebCharacter[] = [];
  private losers: CelebCharacter[] = [];
  private elapsed = 0;
  private active = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Start the victory animation.
   * @param winnerTeam "a" or "b"
   * @param stickmenPositions positions of all stickmen {ax[], bx[], groundY}
   */
  start(
    winnerTeam: "a" | "b",
    positions: { ax: number[]; bx: number[]; groundY: number },
  ) {
    this.cleanup();
    this.elapsed = 0;
    this.active = true;

    const { ax, bx, groundY } = positions;
    const winPositions = winnerTeam === "a" ? ax : bx;
    const losePositions = winnerTeam === "a" ? bx : ax;
    const winColor = winnerTeam === "a" ? 0xef4444 : 0x3b82f6;
    const loseColor = winnerTeam === "a" ? 0x3b82f6 : 0xef4444;
    // A隊在左邊，B隊在右邊
    // 失敗者面向對手（面向中間）：A隊向右(false)，B隊向左(true)
    // 勝利者面向觀眾（正面），facingLeft 不影響正面繪圖
    const winFacing = winnerTeam === "a" ? false : true;
    const loseFacing = winnerTeam === "a" ? true : false; // loser頭朝中間（OTZ方向）

    // Create winner characters
    winPositions.forEach((x, i) => {
      this.winners.push({
        x,
        baseY: groundY,
        color: winColor,
        facingLeft: winFacing,
        phase: i * 0.4,
        graphics: this.scene.add.graphics(),
      });
    });

    // Create loser characters
    losePositions.forEach((x, i) => {
      this.losers.push({
        x,
        baseY: groundY,
        color: loseColor,
        facingLeft: loseFacing,
        phase: i * 0.3,
        graphics: this.scene.add.graphics(),
      });
    });
  }

  update(delta: number) {
    if (!this.active) return;
    this.elapsed += delta;

    // Draw winners (jumping)
    this.winners.forEach((c) => {
      this.drawJumping(c);
    });

    // Draw losers (sitting on ground)
    this.losers.forEach((c) => {
      this.drawDefeated(c);
    });
  }

  private drawJumping(c: CelebCharacter) {
    const g = c.graphics;
    g.clear();

    const time = this.elapsed * 0.003 + c.phase;
    const jumpHeight = Math.abs(Math.sin(time * Math.PI)) * 30;
    const dir = c.facingLeft ? -1 : 1;
    const groundY = c.baseY - jumpHeight;

    // Positions
    const bodyBottomY = groundY - LEG_LEN;
    const bodyCenterY = bodyBottomY - BODY_HEIGHT / 2;
    const bodyCenterX = c.x;
    const headY = bodyCenterY - BODY_HEIGHT / 2 - HEAD_RADIUS + 4;
    const headX = c.x;

    // === Legs (spread in air) ===
    const leftFootX = c.x - 12;
    const rightFootX = c.x + 12;
    const leftKneeX = c.x - 6;
    const rightKneeX = c.x + 6;
    const kneeY = bodyBottomY + LEG_LEN * 0.45;

    // Leg outlines
    this.drawThickLimb(
      g,
      OUTLINE_COLOR,
      bodyCenterX - 4,
      bodyBottomY,
      leftKneeX,
      kneeY,
      leftFootX,
      groundY + LEG_LEN,
      LEG_THICKNESS + OUTLINE_WIDTH * 2,
    );
    this.drawThickLimb(
      g,
      OUTLINE_COLOR,
      bodyCenterX + 4,
      bodyBottomY,
      rightKneeX,
      kneeY,
      rightFootX,
      groundY + LEG_LEN,
      LEG_THICKNESS + OUTLINE_WIDTH * 2,
    );
    // Leg fills
    this.drawThickLimb(
      g,
      c.color,
      bodyCenterX - 4,
      bodyBottomY,
      leftKneeX,
      kneeY,
      leftFootX,
      groundY + LEG_LEN,
      LEG_THICKNESS,
    );
    this.drawThickLimb(
      g,
      c.color,
      bodyCenterX + 4,
      bodyBottomY,
      rightKneeX,
      kneeY,
      rightFootX,
      groundY + LEG_LEN,
      LEG_THICKNESS,
    );

    // === Body (wider for front view) ===
    const frontBodyW = BODY_WIDTH * 3;
    g.fillStyle(OUTLINE_COLOR);
    g.fillEllipse(
      bodyCenterX,
      bodyCenterY,
      frontBodyW + OUTLINE_WIDTH * 2,
      BODY_HEIGHT + OUTLINE_WIDTH * 2,
    );
    g.fillStyle(c.color);
    g.fillEllipse(bodyCenterX, bodyCenterY, frontBodyW, BODY_HEIGHT);

    // === Arms (front view: arms from shoulder sides, not chest center) ===
    const shoulderY = bodyCenterY - BODY_HEIGHT / 2 + 6;
    const armWave = Math.sin(time * Math.PI * 2) * 8;

    // Left arm (starts from left edge of body)
    const lShoulderX = bodyCenterX - 12;
    const lElbowX = lShoulderX - 10;
    const lElbowY = shoulderY - 14;
    const lHandX = lShoulderX - 16;
    const lHandY = shoulderY - 30 + armWave;
    this.drawThickLimb(
      g,
      OUTLINE_COLOR,
      lShoulderX,
      shoulderY,
      lElbowX,
      lElbowY,
      lHandX,
      lHandY,
      ARM_THICKNESS + OUTLINE_WIDTH * 2,
    );
    this.drawThickLimb(
      g,
      c.color,
      lShoulderX,
      shoulderY,
      lElbowX,
      lElbowY,
      lHandX,
      lHandY,
      ARM_THICKNESS,
    );
    g.fillStyle(OUTLINE_COLOR);
    g.fillCircle(lHandX, lHandY, 5 + OUTLINE_WIDTH);
    g.fillStyle(c.color);
    g.fillCircle(lHandX, lHandY, 5);

    // Right arm (starts from right edge of body)
    const rShoulderX = bodyCenterX + 12;
    const rElbowX = rShoulderX + 10;
    const rElbowY = shoulderY - 14;
    const rHandX = rShoulderX + 16;
    const rHandY = shoulderY - 30 - armWave;
    this.drawThickLimb(
      g,
      OUTLINE_COLOR,
      rShoulderX,
      shoulderY,
      rElbowX,
      rElbowY,
      rHandX,
      rHandY,
      ARM_THICKNESS + OUTLINE_WIDTH * 2,
    );
    this.drawThickLimb(
      g,
      c.color,
      rShoulderX,
      shoulderY,
      rElbowX,
      rElbowY,
      rHandX,
      rHandY,
      ARM_THICKNESS,
    );
    g.fillStyle(OUTLINE_COLOR);
    g.fillCircle(rHandX, rHandY, 5 + OUTLINE_WIDTH);
    g.fillStyle(c.color);
    g.fillCircle(rHandX, rHandY, 5);

    // === Head ===
    g.fillStyle(OUTLINE_COLOR);
    g.fillCircle(headX, headY, HEAD_RADIUS + OUTLINE_WIDTH);
    g.fillStyle(c.color);
    g.fillCircle(headX, headY, HEAD_RADIUS);

    // Happy eyes: ^ ^ shape (front facing, centered)
    const eyeY = headY - 2;
    g.lineStyle(2.5, 0xffffff);
    // Left eye ^
    g.beginPath();
    g.moveTo(headX - 9, eyeY + 1);
    g.lineTo(headX - 6, eyeY - 3);
    g.lineTo(headX - 3, eyeY + 1);
    g.strokePath();
    // Right eye ^
    g.beginPath();
    g.moveTo(headX + 3, eyeY + 1);
    g.lineTo(headX + 6, eyeY - 3);
    g.lineTo(headX + 9, eyeY + 1);
    g.strokePath();
  }

  private drawDefeated(c: CelebCharacter) {
    const g = c.graphics;
    g.clear();

    const groundY = c.baseY;
    const time = this.elapsed * 0.003 + c.phase;
    const dir = c.facingLeft ? -1 : 1;

    // OTZ pose: kneeling, body prostrated forward, head near ground
    // dir points toward center — head faces the opponent

    // Knee anchored on ground
    const kneeX = c.x;
    const kneeY = groundY;

    // === Z part: legs (two legs, offset for depth) ===
    // Depth offset: "behind" = away from viewer, "front" = toward viewer
    // Viewer is at the bottom of screen, so offset perpendicular to facing direction
    const depthOff = 3;

    // Back leg (further from viewer)
    const bKneeX = kneeX + dir * depthOff;
    const bShinMidX = bKneeX - dir * 10;
    const bShinMidY = groundY - 2;
    const bFootX = bKneeX - dir * 20;
    const bFootY = groundY - 6;
    const bThighMidX = bKneeX + dir * 2;
    const bThighMidY = groundY - 13;
    const bHipX = bKneeX + dir * 3;

    // Front leg (closer to viewer)
    const fKneeX = kneeX - dir * depthOff;
    const fShinMidX = fKneeX - dir * 10;
    const fShinMidY = groundY - 2;
    const fFootX = fKneeX - dir * 20;
    const fFootY = groundY - 6;
    const fThighMidX = fKneeX + dir * 2;
    const fThighMidY = groundY - 13;
    const fHipX = fKneeX + dir * 3;

    const hipX = kneeX + dir * 3;
    const hipY = groundY - LEG_LEN;

    // === T part: torso — horizontal with slight upward arch (隆起) ===
    const shoulderX = hipX + dir * 30;
    const shoulderY = hipY;
    const backMidX = hipX + dir * 15;
    const backMidY = hipY - 8; // arch upward = 背部隆起

    // === Arms: two arms, offset for depth, straight down to ground ===
    const bArmX = shoulderX - dir * 4 + dir * depthOff; // back arm (further from viewer)
    const bElbowY = shoulderY + (groundY - shoulderY) * 0.5;
    const bHandY = groundY + 2;

    const fArmX = shoulderX - dir * 4 - dir * depthOff; // front arm (closer to viewer)
    const fElbowY = shoulderY + (groundY - shoulderY) * 0.5;
    const fHandY = groundY + 2;

    // === O part: head at front of torso ===
    const headX = shoulderX + dir * (HEAD_RADIUS + 2);
    const headY = shoulderY;

    // Draw order: back to front

    // Back leg (drawn first, behind)
    this.drawThickLimb(
      g,
      OUTLINE_COLOR,
      bKneeX,
      kneeY,
      bShinMidX,
      bShinMidY,
      bFootX,
      bFootY,
      LEG_THICKNESS + OUTLINE_WIDTH * 2,
    );
    this.drawThickLimb(
      g,
      c.color,
      bKneeX,
      kneeY,
      bShinMidX,
      bShinMidY,
      bFootX,
      bFootY,
      LEG_THICKNESS,
    );
    this.drawThickLimb(
      g,
      OUTLINE_COLOR,
      bKneeX,
      kneeY,
      bThighMidX,
      bThighMidY,
      bHipX,
      hipY,
      LEG_THICKNESS + OUTLINE_WIDTH * 2,
    );
    this.drawThickLimb(
      g,
      c.color,
      bKneeX,
      kneeY,
      bThighMidX,
      bThighMidY,
      bHipX,
      hipY,
      LEG_THICKNESS,
    );

    // Front leg (drawn second, in front)
    this.drawThickLimb(
      g,
      OUTLINE_COLOR,
      fKneeX,
      kneeY,
      fShinMidX,
      fShinMidY,
      fFootX,
      fFootY,
      LEG_THICKNESS + OUTLINE_WIDTH * 2,
    );
    this.drawThickLimb(
      g,
      c.color,
      fKneeX,
      kneeY,
      fShinMidX,
      fShinMidY,
      fFootX,
      fFootY,
      LEG_THICKNESS,
    );
    this.drawThickLimb(
      g,
      OUTLINE_COLOR,
      fKneeX,
      kneeY,
      fThighMidX,
      fThighMidY,
      fHipX,
      hipY,
      LEG_THICKNESS + OUTLINE_WIDTH * 2,
    );
    this.drawThickLimb(
      g,
      c.color,
      fKneeX,
      kneeY,
      fThighMidX,
      fThighMidY,
      fHipX,
      hipY,
      LEG_THICKNESS,
    );

    // Back arm (drawn before torso/head, further from viewer)
    this.drawThickLimb(
      g,
      OUTLINE_COLOR,
      bArmX,
      shoulderY,
      bArmX,
      bElbowY,
      bArmX,
      bHandY,
      ARM_THICKNESS + OUTLINE_WIDTH * 2,
    );
    this.drawThickLimb(
      g,
      c.color,
      bArmX,
      shoulderY,
      bArmX,
      bElbowY,
      bArmX,
      bHandY,
      ARM_THICKNESS,
    );

    // Torso (smooth arc using quadratic bezier sampling)
    const TORSO_THICKNESS = BODY_WIDTH * 2;
    this.drawSmoothArc(
      g,
      OUTLINE_COLOR,
      hipX,
      hipY,
      backMidX,
      backMidY,
      shoulderX,
      shoulderY,
      TORSO_THICKNESS + OUTLINE_WIDTH * 2,
    );
    this.drawSmoothArc(
      g,
      c.color,
      hipX,
      hipY,
      backMidX,
      backMidY,
      shoulderX,
      shoulderY,
      TORSO_THICKNESS,
    );

    // Head
    g.fillStyle(OUTLINE_COLOR);
    g.fillCircle(headX, headY, HEAD_RADIUS + OUTLINE_WIDTH);
    g.fillStyle(c.color);
    g.fillCircle(headX, headY, HEAD_RADIUS);

    // Front arm (drawn after head, closer to viewer)
    this.drawThickLimb(
      g,
      OUTLINE_COLOR,
      fArmX,
      shoulderY,
      fArmX,
      fElbowY,
      fArmX,
      fHandY,
      ARM_THICKNESS + OUTLINE_WIDTH * 2,
    );
    this.drawThickLimb(
      g,
      c.color,
      fArmX,
      shoulderY,
      fArmX,
      fElbowY,
      fArmX,
      fHandY,
      ARM_THICKNESS,
    );

    // Crying face (side view, half-open sad eyes)
    const eyeBaseX = headX + dir * 5;
    const eyeY = headY - 1;

    // Half-open eyes: white slit with droopy upper eyelid
    // Eye 1
    g.fillStyle(0xffffff);
    g.fillEllipse(eyeBaseX - 5, eyeY, 6, 4);
    g.fillStyle(0x000000);
    g.fillCircle(eyeBaseX - 5 + dir * 1, eyeY + 0.5, 1.5);
    // Droopy upper eyelid
    g.lineStyle(2, OUTLINE_COLOR, 0.7);
    g.beginPath();
    g.moveTo(eyeBaseX - 8, eyeY - 1);
    g.lineTo(eyeBaseX - 2, eyeY);
    g.strokePath();

    // Eye 2
    g.fillStyle(0xffffff);
    g.fillEllipse(eyeBaseX + 6, eyeY, 6, 4);
    g.fillStyle(0x000000);
    g.fillCircle(eyeBaseX + 6 + dir * 1, eyeY + 0.5, 1.5);
    // Droopy upper eyelid
    g.lineStyle(2, OUTLINE_COLOR, 0.7);
    g.beginPath();
    g.moveTo(eyeBaseX + 3, eyeY - 1);
    g.lineTo(eyeBaseX + 9, eyeY);
    g.strokePath();

    // Tear drops (animated, dripping down)
    const tearOffset = (time * 20) % 18;
    g.fillStyle(0x60a5fa);
    g.fillEllipse(eyeBaseX - 5, eyeY + 6 + tearOffset, 3, 5);
    g.fillEllipse(eyeBaseX + 6, eyeY + 8 + tearOffset * 0.8, 3, 5);
  }

  /** Draw a smooth arc using quadratic bezier curve (control point = midpoint) */
  private drawSmoothArc(
    g: Phaser.GameObjects.Graphics,
    color: number,
    x1: number,
    y1: number,
    cx: number,
    cy: number,
    x2: number,
    y2: number,
    thickness: number,
  ) {
    g.fillStyle(color);
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Quadratic bezier: B(t) = (1-t)²·P0 + 2(1-t)t·C + t²·P1
      const mt = 1 - t;
      const px = mt * mt * x1 + 2 * mt * t * cx + t * t * x2;
      const py = mt * mt * y1 + 2 * mt * t * cy + t * t * y2;
      g.fillCircle(px, py, thickness / 2);
    }
  }

  private drawThickLimb(
    g: Phaser.GameObjects.Graphics,
    color: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    thickness: number,
  ) {
    g.fillStyle(color);
    const segments = [
      { sx: x1, sy: y1, ex: x2, ey: y2 },
      { sx: x2, sy: y2, ex: x3, ey: y3 },
    ];
    for (const seg of segments) {
      const steps = 8;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = seg.sx + (seg.ex - seg.sx) * t;
        const py = seg.sy + (seg.ey - seg.sy) * t;
        g.fillCircle(px, py, thickness / 2);
      }
    }
  }

  isActive() {
    return this.active;
  }

  cleanup() {
    this.winners.forEach((c) => c.graphics.destroy());
    this.losers.forEach((c) => c.graphics.destroy());
    this.winners = [];
    this.losers = [];
    this.active = false;
  }

  destroy() {
    this.cleanup();
  }
}
