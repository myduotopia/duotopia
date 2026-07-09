/**
 * TugOfWarSample - 拔河像素動畫獨立測試頁（issue #920）
 *
 * 純前端測試 PixelTugStage，不需登入或 API。可手動觸發拉繩 / 冷卻 / 勝負 / 重置，
 * 驗證所有動畫狀態。路由: /sample/tug-of-war
 */

import { useState } from "react";
import { PixelTugStage } from "@/components/activities/tug-of-war/pixel/PixelTugStage";
import type { Team } from "@/components/activities/tug-of-war/types";

const WIN_SCORE = 5;

export default function TugOfWarSample() {
  const [rope, setRope] = useState(0);
  const [pullA, setPullA] = useState(false);
  const [pullB, setPullB] = useState(false);
  const [coolA, setCoolA] = useState(false);
  const [coolB, setCoolB] = useState(false);
  const [winner, setWinner] = useState<Team | "draw" | null>(null);
  const [showSign, setShowSign] = useState(false);

  const pull = (team: Team) => {
    const next =
      team === "a"
        ? Math.max(rope - 1, -WIN_SCORE)
        : Math.min(rope + 1, WIN_SCORE);
    setRope(next);
    if (team === "a") {
      setPullA(true);
      setTimeout(() => setPullA(false), 700);
    } else {
      setPullB(true);
      setTimeout(() => setPullB(false), 700);
    }
    if (next <= -WIN_SCORE) setWinner("a");
    if (next >= WIN_SCORE) setWinner("b");
  };

  const reset = () => {
    setRope(0);
    setPullA(false);
    setPullB(false);
    setCoolA(false);
    setCoolB(false);
    setWinner(null);
  };

  const btn = (bg: string): React.CSSProperties => ({
    padding: "10px 20px",
    background: bg,
    color: "white",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: "bold",
  });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Silkscreen&family=Patrick+Hand&display=swap');
        .pixel-font { font-family: 'Silkscreen', monospace; }
        .handwrite-font { font-family: 'Patrick Hand', cursive; }
      `}</style>
      <h1 style={{ fontSize: 24, fontWeight: "bold", marginBottom: 16 }}>
        Tug of War — Pixel Stage Test
      </h1>

      {/* Stage */}
      <div
        style={{
          width: "100%",
          height: 320,
          borderRadius: 8,
          overflow: "hidden",
          marginBottom: 20,
          boxShadow: "0 4px 20px rgba(0,0,0,.15)",
        }}
      >
        <PixelTugStage
          ropePosition={rope}
          winScore={WIN_SCORE}
          pullA={pullA}
          pullB={pullB}
          teamACooldown={coolA}
          teamBCooldown={coolB}
          winner={winner}
          showSign={showSign}
          onSignClick={() => setShowSign((s) => s)}
          onReplay={reset}
          teamAWinsLabel="Team A Wins!"
          teamBWinsLabel="Team B Wins!"
          drawLabel="Draw!"
          replayLabel="Play Again"
        />
      </div>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          gap: 12,
          justifyContent: "center",
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <button onClick={() => pull("a")} style={btn("#e83b3b")}>
          A Pull
        </button>
        <button onClick={reset} style={btn("#6B7280")}>
          Reset
        </button>
        <button onClick={() => pull("b")} style={btn("#4d9be6")}>
          B Pull
        </button>
        <button onClick={() => setWinner("a")} style={btn("#ae2334")}>
          A Wins
        </button>
        <button onClick={() => setWinner("b")} style={btn("#4d65b4")}>
          B Wins
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          justifyContent: "center",
          flexWrap: "wrap",
          color: "#6B7280",
        }}
      >
        <span>Rope: {rope}</span>
        <label>
          <input
            type="checkbox"
            checked={coolA}
            onChange={(e) => setCoolA(e.target.checked)}
          />{" "}
          A Cooldown
        </label>
        <label>
          <input
            type="checkbox"
            checked={coolB}
            onChange={(e) => setCoolB(e.target.checked)}
          />{" "}
          B Cooldown
        </label>
        <label>
          <input
            type="checkbox"
            checked={showSign}
            onChange={(e) => setShowSign(e.target.checked)}
          />{" "}
          Audio Sign
        </label>
      </div>
    </div>
  );
}
