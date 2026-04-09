/**
 * Stickman - 大頭娃娃角色 (Phaser GameObjects.Graphics)
 *
 * 拆成兩層繪製：
 * - backLayer: 身體、頭、腿、後手 (繩子後面)
 * - frontLayer: 前手 (繩子前面)
 *
 * 由 TugOfWarScene 控制建立順序來實現圖層效果。
 */

import Phaser from "phaser";

const OUTLINE_COLOR = 0x1f2937;
const OUTLINE_WIDTH = 2.5;

export class Stickman {
  /** 繩子後面的圖層：身體、頭、腿、後手 */
  public backGraphics: Phaser.GameObjects.Graphics;
  /** 繩子前面的圖層：前手 */
  public frontGraphics: Phaser.GameObjects.Graphics;

  public x: number;
  public y: number;
  private color: number;
  private facingLeft: boolean;
  private isPulling = false;

  private readonly HEAD_RADIUS = 18;
  private readonly BODY_WIDTH = 8;
  private readonly BODY_HEIGHT = 35;
  private readonly ARM_THICKNESS = 6;
  private readonly LEG_THICKNESS = 7;
  private readonly LEG_LEN = 26;

  constructor(
    scene: Phaser.Scene,
    x: number,
    groundY: number,
    color: number,
    facingLeft: boolean,
  ) {
    this.x = x;
    this.y = groundY;
    this.color = color;
    this.facingLeft = facingLeft;
    this.backGraphics = scene.add.graphics();
    // frontGraphics created separately — caller inserts rope between back and front
    this.frontGraphics = scene.add.graphics();
  }

  setPulling(pulling: boolean) {
    this.isPulling = pulling;
  }

  setCooldown(_cooldown: boolean) {
    // No-op: cooldown no longer changes appearance
  }

  setX(x: number) {
    this.x = x;
  }

  update(_delta: number) {
    this.drawBack();
    this.drawFront();
  }

  /** Compute all positions used by both layers */
  private getPositions() {
    const dir = this.facingLeft ? -1 : 1;
    const x = this.x;
    const groundY = this.y;

    const leanBack = this.isPulling ? 12 : 0;
    const armPull = this.isPulling ? 4 : 0;

    const bodyBottomY = groundY - this.LEG_LEN;
    const leanOffsetX = -leanBack * dir;
    const bodyCenterY = bodyBottomY - this.BODY_HEIGHT / 2;
    const bodyCenterX = x + leanOffsetX * 0.5;
    const headY = bodyCenterY - this.BODY_HEIGHT / 2 - this.HEAD_RADIUS + 4;
    const headX = x + leanOffsetX;

    // Shoulder starts from body center, not outside
    const shoulderX = bodyCenterX + dir * 3;
    const shoulderY = bodyCenterY - 6;

    // Front hand (drawn in front of rope) — higher grip
    const frontElbowX = shoulderX + dir * 18;
    const frontElbowY = shoulderY + 2;
    const frontHandX = shoulderX + dir * (32 + armPull);
    const frontHandY = shoulderY - 2;

    // Back hand (drawn behind rope) — slightly lower grip
    const backElbowX = shoulderX + dir * 16;
    const backElbowY = shoulderY + 6;
    const backHandX = shoulderX + dir * (26 + armPull);
    const backHandY = shoulderY + 4;

    const kneeBend = this.isPulling ? 8 : 0;
    const frontFootX = x + dir * 14;
    const backFootX = x - dir * 12;
    const frontHipX = bodyCenterX + dir * 5;
    const backHipX = bodyCenterX - dir * 4;

    const frontKneeX =
      (frontHipX + frontFootX) / 2 + (this.isPulling ? dir * kneeBend : 0);
    const frontKneeY = (bodyBottomY + groundY) / 2 + (this.isPulling ? -3 : 0);
    const backKneeX =
      (backHipX + backFootX) / 2 + (this.isPulling ? dir * kneeBend * 0.5 : 0);
    const backKneeY = (bodyBottomY + groundY) / 2 + (this.isPulling ? -2 : 0);

    return {
      dir,
      x,
      groundY,
      bodyBottomY,
      bodyCenterX,
      bodyCenterY,
      headX,
      headY,
      shoulderX,
      shoulderY,
      frontElbowX,
      frontElbowY,
      frontHandX,
      frontHandY,
      backElbowX,
      backElbowY,
      backHandX,
      backHandY,
      frontFootX,
      backFootX,
      frontHipX,
      backHipX,
      frontKneeX,
      frontKneeY,
      backKneeX,
      backKneeY,
    };
  }

  /** Draw body, head, legs, back arm — behind the rope */
  private drawBack() {
    const g = this.backGraphics;
    g.clear();
    g.setAlpha(1);

    const p = this.getPositions();

    // === OUTLINES ===
    // Legs outline
    this.drawThickLimb(
      g,
      OUTLINE_COLOR,
      p.frontHipX,
      p.bodyBottomY,
      p.frontKneeX,
      p.frontKneeY,
      p.frontFootX,
      p.groundY,
      this.LEG_THICKNESS + OUTLINE_WIDTH * 2,
    );
    this.drawThickLimb(
      g,
      OUTLINE_COLOR,
      p.backHipX,
      p.bodyBottomY,
      p.backKneeX,
      p.backKneeY,
      p.backFootX,
      p.groundY,
      this.LEG_THICKNESS + OUTLINE_WIDTH * 2,
    );

    // Body outline
    g.fillStyle(OUTLINE_COLOR);
    g.fillEllipse(
      p.bodyCenterX,
      p.bodyCenterY,
      this.BODY_WIDTH * 2 + OUTLINE_WIDTH * 2,
      this.BODY_HEIGHT + OUTLINE_WIDTH * 2,
    );

    // Back arm outline
    this.drawThickLimb(
      g,
      OUTLINE_COLOR,
      p.shoulderX,
      p.shoulderY + 3,
      p.backElbowX,
      p.backElbowY,
      p.backHandX,
      p.backHandY,
      this.ARM_THICKNESS + OUTLINE_WIDTH * 2,
    );
    g.fillStyle(OUTLINE_COLOR);
    g.fillCircle(p.backHandX, p.backHandY, 5 + OUTLINE_WIDTH);

    // Head outline
    g.fillStyle(OUTLINE_COLOR);
    g.fillCircle(p.headX, p.headY, this.HEAD_RADIUS + OUTLINE_WIDTH);

    // === FILLS ===
    // Legs fill
    this.drawThickLimb(
      g,
      this.color,
      p.frontHipX,
      p.bodyBottomY,
      p.frontKneeX,
      p.frontKneeY,
      p.frontFootX,
      p.groundY,
      this.LEG_THICKNESS,
    );
    this.drawThickLimb(
      g,
      this.color,
      p.backHipX,
      p.bodyBottomY,
      p.backKneeX,
      p.backKneeY,
      p.backFootX,
      p.groundY,
      this.LEG_THICKNESS,
    );

    // Body fill
    g.fillStyle(this.color);
    g.fillEllipse(
      p.bodyCenterX,
      p.bodyCenterY,
      this.BODY_WIDTH * 2,
      this.BODY_HEIGHT,
    );

    // Back arm fill
    this.drawThickLimb(
      g,
      this.color,
      p.shoulderX,
      p.shoulderY + 3,
      p.backElbowX,
      p.backElbowY,
      p.backHandX,
      p.backHandY,
      this.ARM_THICKNESS,
    );
    g.fillStyle(this.color);
    g.fillCircle(p.backHandX, p.backHandY, 5);

    // Back fist knuckle
    g.lineStyle(1.5, OUTLINE_COLOR, 0.6);
    g.beginPath();
    g.arc(p.backHandX, p.backHandY, 4, -0.5 * p.dir, 0.5 * p.dir, false);
    g.strokePath();

    // Head fill
    g.fillStyle(this.color);
    g.fillCircle(p.headX, p.headY, this.HEAD_RADIUS);

    // Face
    this.drawFace(g, p);
  }

  /** Draw front arm — in front of the rope */
  private drawFront() {
    const g = this.frontGraphics;
    g.clear();
    g.setAlpha(1);

    const p = this.getPositions();

    // Front arm outline
    this.drawThickLimb(
      g,
      OUTLINE_COLOR,
      p.shoulderX,
      p.shoulderY,
      p.frontElbowX,
      p.frontElbowY,
      p.frontHandX,
      p.frontHandY,
      this.ARM_THICKNESS + OUTLINE_WIDTH * 2,
    );
    g.fillStyle(OUTLINE_COLOR);
    g.fillCircle(p.frontHandX, p.frontHandY, 5 + OUTLINE_WIDTH);

    // Front arm fill
    this.drawThickLimb(
      g,
      this.color,
      p.shoulderX,
      p.shoulderY,
      p.frontElbowX,
      p.frontElbowY,
      p.frontHandX,
      p.frontHandY,
      this.ARM_THICKNESS,
    );
    g.fillStyle(this.color);
    g.fillCircle(p.frontHandX, p.frontHandY, 5);

    // Front fist knuckle
    g.lineStyle(1.5, OUTLINE_COLOR, 0.6);
    g.beginPath();
    g.arc(p.frontHandX, p.frontHandY, 4, -0.5 * p.dir, 0.5 * p.dir, false);
    g.strokePath();
  }

  private drawFace(
    g: Phaser.GameObjects.Graphics,
    p: ReturnType<typeof this.getPositions>,
  ) {
    if (this.isPulling) {
      const eyeBaseX = p.headX + p.dir * 5;
      const eyeY = p.headY - 1;

      g.lineStyle(2.5, 0xffffff);
      const le = this.facingLeft ? -1 : 1;
      g.beginPath();
      g.moveTo(eyeBaseX - 5 - le * 2, eyeY - 2);
      g.lineTo(eyeBaseX - 5 + le * 2, eyeY);
      g.lineTo(eyeBaseX - 5 - le * 2, eyeY + 2);
      g.strokePath();
      g.beginPath();
      g.moveTo(eyeBaseX + 6 - le * 2, eyeY - 2);
      g.lineTo(eyeBaseX + 6 + le * 2, eyeY);
      g.lineTo(eyeBaseX + 6 - le * 2, eyeY + 2);
      g.strokePath();

      g.lineStyle(2, 0xffffff, 0.8);
      g.beginPath();
      g.moveTo(eyeBaseX - 8, eyeY - 6);
      g.lineTo(eyeBaseX - 2, eyeY - 5);
      g.strokePath();
      g.beginPath();
      g.moveTo(eyeBaseX + 3, eyeY - 5);
      g.lineTo(eyeBaseX + 9, eyeY - 6);
      g.strokePath();

      g.fillStyle(0x60a5fa);
      g.fillEllipse(p.headX - p.dir * 14, p.headY - 6, 4, 6);
    } else {
      const eyeBaseX = p.headX + p.dir * 5;
      const eyeY = p.headY - 1;

      g.lineStyle(2, 0x000000, 0.8);
      g.beginPath();
      g.moveTo(eyeBaseX - 8, eyeY - 1);
      g.lineTo(eyeBaseX - 1, eyeY - 1);
      g.strokePath();
      g.beginPath();
      g.moveTo(eyeBaseX + 3, eyeY - 1);
      g.lineTo(eyeBaseX + 10, eyeY - 1);
      g.strokePath();

      g.fillStyle(0xffffff);
      g.fillRect(eyeBaseX - 8, eyeY - 1, 7, 4);
      g.fillRect(eyeBaseX + 3, eyeY - 1, 7, 4);

      g.fillStyle(0x000000);
      g.fillCircle(eyeBaseX - 5 + p.dir * 1, eyeY + 1.5, 1.8);
      g.fillCircle(eyeBaseX + 6 + p.dir * 1, eyeY + 1.5, 1.8);
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

  destroy() {
    this.backGraphics.destroy();
    this.frontGraphics.destroy();
  }
}
