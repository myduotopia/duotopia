/**
 * Rope - 拔河繩子 (Phaser GameObjects.Graphics)
 *
 * 繪製繩子 + 中間標記旗幟，兩端自然下垂到地面。
 */

import Phaser from "phaser";

export class Rope {
  private graphics: Phaser.GameObjects.Graphics;
  private centerX: number;
  private ropeY: number;
  private ropeLength: number;
  private groundY: number;
  public offset = 0; // visual offset in pixels
  private targetOffset = 0;
  private flagColor = 0xf59e0b; // amber

  constructor(
    scene: Phaser.Scene,
    centerX: number,
    ropeY: number,
    ropeLength: number,
    groundY: number,
  ) {
    this.graphics = scene.add.graphics();
    this.centerX = centerX;
    this.ropeY = ropeY;
    this.ropeLength = ropeLength;
    this.groundY = groundY;
  }

  setTargetOffset(offset: number) {
    this.targetOffset = offset;
  }

  setFlagColor(color: number) {
    this.flagColor = color;
  }

  update(delta: number) {
    // Smooth interpolation toward target
    const speed = 0.004 * delta;
    this.offset += (this.targetOffset - this.offset) * Math.min(speed, 0.3);

    this.draw();
  }

  private draw() {
    const g = this.graphics;
    g.clear();

    const x = this.centerX + this.offset;
    const y = this.ropeY;
    const halfLen = this.ropeLength / 2;
    const groundY = this.groundY;

    // --- Left drooping tail ---
    const leftEndX = x - halfLen;
    const tailLen = 35;
    // Curved droop using quadratic bezier approximation (series of lines)
    g.lineStyle(5, 0x92400e);
    g.beginPath();
    g.moveTo(leftEndX, y);
    const lCtrlX = leftEndX - tailLen * 0.3;
    const lCtrlY = y + (groundY - y) * 0.4;
    const lEndX = leftEndX - tailLen * 0.15;
    const lEndY = groundY;
    // Draw curve as segments
    for (let t = 0; t <= 1; t += 0.05) {
      const px =
        (1 - t) * (1 - t) * leftEndX + 2 * (1 - t) * t * lCtrlX + t * t * lEndX;
      const py =
        (1 - t) * (1 - t) * y + 2 * (1 - t) * t * lCtrlY + t * t * lEndY;
      g.lineTo(px, py);
    }
    g.strokePath();

    // --- Right drooping tail ---
    const rightEndX = x + halfLen;
    g.beginPath();
    g.moveTo(rightEndX, y);
    const rCtrlX = rightEndX + tailLen * 0.3;
    const rCtrlY = y + (groundY - y) * 0.4;
    const rEndX = rightEndX + tailLen * 0.15;
    const rEndY = groundY;
    for (let t = 0; t <= 1; t += 0.05) {
      const px =
        (1 - t) * (1 - t) * rightEndX +
        2 * (1 - t) * t * rCtrlX +
        t * t * rEndX;
      const py =
        (1 - t) * (1 - t) * y + 2 * (1 - t) * t * rCtrlY + t * t * rEndY;
      g.lineTo(px, py);
    }
    g.strokePath();

    // --- Main horizontal rope ---
    // Shadow
    g.lineStyle(6, 0x000000, 0.1);
    g.beginPath();
    g.moveTo(leftEndX, y + 3);
    g.lineTo(rightEndX, y + 3);
    g.strokePath();

    // Rope
    g.lineStyle(5, 0x92400e);
    g.beginPath();
    g.moveTo(leftEndX, y);
    g.lineTo(rightEndX, y);
    g.strokePath();

    // Rope texture (lighter stripes)
    g.lineStyle(2, 0xb45309, 0.6);
    for (let i = -halfLen; i < halfLen; i += 12) {
      g.beginPath();
      g.moveTo(x + i, y - 2);
      g.lineTo(x + i + 6, y + 2);
      g.strokePath();
    }

    // Center marker line (fixed position)
    g.lineStyle(2, 0xd1d5db, 0.5);
    g.beginPath();
    g.moveTo(this.centerX, y - 15);
    g.lineTo(this.centerX, y + 15);
    g.strokePath();

    // Flag at rope center (moves with rope)
    const flagX = x;
    g.lineStyle(2, 0x4b5563);
    g.beginPath();
    g.moveTo(flagX, y);
    g.lineTo(flagX, y - 28);
    g.strokePath();

    g.fillStyle(this.flagColor);
    g.fillTriangle(flagX, y - 28, flagX + 16, y - 22, flagX, y - 16);
  }

  destroy() {
    this.graphics.destroy();
  }
}
