/**
 * TugOfWarSample - 獨立測試頁面
 *
 * 純前端測試 Phaser 拔河動畫，不需要登入或 API。
 * 路由: /sample/tug-of-war
 */

import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { TugOfWarScene } from "@/games/tug-of-war/TugOfWarScene";
import type { TugOfWarState } from "@/games/tug-of-war/TugOfWarScene";

export default function TugOfWarSample() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  const [ropePosition, setRopePosition] = useState(0);
  const [lastTeam, setLastTeam] = useState<"a" | "b" | null>(null);
  const [cooldownA, setCooldownA] = useState(false);
  const [cooldownB, setCooldownB] = useState(false);

  // Init Phaser
  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: 800,
      height: 200,
      parent: containerRef.current,
      transparent: false,
      scene: [TugOfWarScene],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
      },
    });
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  // Sync state to Phaser
  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;
    const scene = game.scene.getScene("TugOfWarScene");
    if (!scene) return;

    const state: TugOfWarState = {
      ropePosition,
      maxPosition: 10,
      winScore: 6,
      lastCorrectTeam: lastTeam,
      isPaused: false,
      teamACooldown: cooldownA,
      teamBCooldown: cooldownB,
      winner: ropePosition <= -winScore ? "a" : ropePosition >= winScore ? "b" : null,
    };
    scene.data.set("state", state);
  }, [ropePosition, lastTeam, cooldownA, cooldownB]);

  const winScore = 6;

  const pullA = () => {
    setRopePosition((p) => Math.max(p - 1, -winScore));
    setLastTeam("a");
    setTimeout(() => setLastTeam(null), 800);
  };

  const pullB = () => {
    setRopePosition((p) => Math.min(p + 1, winScore));
    setLastTeam("b");
    setTimeout(() => setLastTeam(null), 800);
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 20 }}>
      <h1 style={{ fontSize: 24, fontWeight: "bold", marginBottom: 16 }}>
        Tug of War - Phaser Test
      </h1>

      {/* Phaser canvas */}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          borderRadius: 8,
          overflow: "hidden",
          marginBottom: 20,
        }}
      />

      {/* Controls */}
      <div
        style={{
          display: "flex",
          gap: 16,
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        <button
          onClick={pullA}
          style={{
            padding: "10px 24px",
            background: "#EF4444",
            color: "white",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            fontWeight: "bold",
          }}
        >
          A Pull (←)
        </button>
        <button
          onClick={() => setRopePosition(0)}
          style={{
            padding: "10px 24px",
            background: "#6B7280",
            color: "white",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
          }}
        >
          Reset
        </button>
        <button
          onClick={pullB}
          style={{
            padding: "10px 24px",
            background: "#3B82F6",
            color: "white",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            fontWeight: "bold",
          }}
        >
          B Pull (→)
        </button>
      </div>

      {/* State info */}
      <div style={{ textAlign: "center", color: "#6B7280" }}>
        <p>Rope position: {ropePosition}</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 8 }}>
          <label>
            <input
              type="checkbox"
              checked={cooldownA}
              onChange={(e) => setCooldownA(e.target.checked)}
            />{" "}
            A Cooldown
          </label>
          <label>
            <input
              type="checkbox"
              checked={cooldownB}
              onChange={(e) => setCooldownB(e.target.checked)}
            />{" "}
            B Cooldown
          </label>
        </div>
      </div>
    </div>
  );
}
