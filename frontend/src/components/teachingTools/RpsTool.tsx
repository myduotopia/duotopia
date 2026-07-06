import React, { useState, useEffect, useCallback, useRef } from "react";
import { X, GripHorizontal, Play } from "lucide-react";
import { useDraggable } from "./hooks/useDraggable";
import { useResizable } from "./hooks/useResizable";
import type { ToolProps } from "./types";

// RPS (Rock-Paper-Scissors) Slot Machine Component
const RPS_CHOICES = ["✊", "✋", "✌️"];
const RPS_REEL = (() => {
  const arr: string[] = [];
  for (let i = 0; i < 20; i++) RPS_CHOICES.forEach((c) => arr.push(c));
  return arr;
})();

const RpsTool: React.FC<ToolProps> = ({ show, onClose, zCounterRef }) => {
  const ITEM_H = 120;

  const [reelIndexL, setReelIndexL] = useState(3);
  const [reelIndexR, setReelIndexR] = useState(3);
  const [reelTransitionL, setReelTransitionL] = useState(false);
  const [reelTransitionR, setReelTransitionR] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [rpsPos, setRpsPos] = useState({ x: 0, y: 0 });
  const [rpsScale, setRpsScale] = useState(1);
  const hasInitialized = useRef(false);
  const rpsContainerRef = useRef<HTMLDivElement>(null);
  const spinTimerRef = useRef<NodeJS.Timeout | null>(null);
  const resetTimerLRef = useRef<NodeJS.Timeout | null>(null);
  const resetTimerRRef = useRef<NodeJS.Timeout | null>(null);

  const startDrag = useDraggable();
  const startResize = useResizable(rpsContainerRef, 220, 260, 0.8);

  const clampRpsPos = useCallback(
    (pos: { x: number; y: number }) => {
      const w = rpsContainerRef.current?.offsetWidth ?? 220;
      const h = rpsContainerRef.current?.offsetHeight ?? 260;
      return {
        x: Math.min(
          Math.max(0, pos.x),
          Math.max(0, window.innerWidth - w * rpsScale),
        ),
        y: Math.min(
          Math.max(0, pos.y),
          Math.max(0, window.innerHeight - h * rpsScale),
        ),
      };
    },
    [rpsScale],
  );

  useEffect(() => {
    if (show) {
      if (!hasInitialized.current) {
        setRpsPos({
          x: window.innerWidth / 2 - 210,
          y: window.innerHeight / 2 - 130,
        });
        hasInitialized.current = true;
      } else {
        setRpsPos((prev) => clampRpsPos(prev));
      }
      if (rpsContainerRef.current) {
        zCounterRef.current += 1;
        rpsContainerRef.current.style.zIndex = String(zCounterRef.current);
      }
    }
  }, [show, clampRpsPos, zCounterRef]);

  useEffect(() => {
    const onResize = () => setRpsPos((prev) => clampRpsPos(prev));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampRpsPos]);

  // Clean up spin timers on unmount
  useEffect(() => {
    return () => {
      if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
      if (resetTimerLRef.current) clearTimeout(resetTimerLRef.current);
      if (resetTimerRRef.current) clearTimeout(resetTimerRRef.current);
    };
  }, []);

  const spin = () => {
    if (isSpinning) return;
    setIsSpinning(true);

    // Left reel
    const targetL = Math.floor(Math.random() * 3);
    const diffL = (targetL - (reelIndexL % 3) + 3) % 3;
    const advanceL = 15 + (diffL === 0 ? 3 : diffL);
    const newIndexL = reelIndexL + advanceL;

    // Right reel — slightly different advance for visual variety
    const targetR = Math.floor(Math.random() * 3);
    const diffR = (targetR - (reelIndexR % 3) + 3) % 3;
    const advanceR = 18 + (diffR === 0 ? 3 : diffR);
    const newIndexR = reelIndexR + advanceR;

    setReelTransitionL(true);
    setReelTransitionR(true);
    setReelIndexL(newIndexL);
    setReelIndexR(newIndexR);

    spinTimerRef.current = setTimeout(() => {
      setIsSpinning(false);
      if (newIndexL > 30) {
        resetTimerLRef.current = setTimeout(() => {
          setReelTransitionL(false);
          setReelIndexL((newIndexL % 3) + 3);
        }, 50);
      }
      if (newIndexR > 30) {
        resetTimerRRef.current = setTimeout(() => {
          setReelTransitionR(false);
          setReelIndexR((newIndexR % 3) + 3);
        }, 50);
      }
    }, 1900);
  };

  if (!show) return null;

  return (
    <div
      className="fixed flex flex-col items-center group bg-white/50 backdrop-blur-md rounded-xl pb-5"
      ref={rpsContainerRef}
      style={{
        zIndex: 200,
        width: "420px",
        left: `${rpsPos.x}px`,
        top: `${rpsPos.y}px`,
        transform: `scale(${rpsScale})`,
        transformOrigin: "top left",
      }}
      onMouseDownCapture={(e) => {
        zCounterRef.current += 1;
        (e.currentTarget as HTMLElement).style.zIndex = String(
          zCounterRef.current,
        );
      }}
      onMouseDown={(e) => startDrag(e, setRpsPos, rpsPos)}
      onTouchStart={(e) => startDrag(e, setRpsPos, rpsPos)}
    >
      {/* Drag handle + close */}
      <div className="absolute top-0 w-full flex justify-between items-center px-4 pt-5 pb-1 opacity-0 group-hover:opacity-100 pointer-events-none">
        <GripHorizontal
          size={18}
          className="text-gray-400 pointer-events-auto"
        />
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-red-500 pointer-events-auto"
          aria-label="Close RPS"
        >
          <X size={18} />
        </button>
      </div>

      {/* Two slot reels side by side */}
      <div
        className="mt-10 flex items-center gap-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Left reel */}
        <div
          className="rounded-xl overflow-hidden relative bg-white/70"
          style={{ width: "160px", height: ITEM_H }}
        >
          <div
            className="absolute top-0 left-0 right-0 pointer-events-none z-10"
            style={{
              height: 16,
              background:
                "linear-gradient(to bottom, rgba(255,255,255,0.7), transparent)",
            }}
          />
          <div
            className="absolute bottom-0 left-0 right-0 pointer-events-none z-10"
            style={{
              height: 16,
              background:
                "linear-gradient(to top, rgba(255,255,255,0.7), transparent)",
            }}
          />
          <div
            style={{
              transform: `translateY(${-(reelIndexL * ITEM_H)}px)`,
              transition: reelTransitionL
                ? "transform 1.8s cubic-bezier(0.17, 0.67, 0.12, 0.99)"
                : "none",
            }}
          >
            {RPS_REEL.map((choice, i) => (
              <div
                key={i}
                className="flex items-center justify-center select-none"
                style={{ height: ITEM_H, fontSize: "6rem" }}
              >
                {choice}
              </div>
            ))}
          </div>
        </div>

        {/* Right reel */}
        <div
          className="rounded-xl overflow-hidden relative bg-white/70"
          style={{ width: "160px", height: ITEM_H }}
        >
          <div
            className="absolute top-0 left-0 right-0 pointer-events-none z-10"
            style={{
              height: 16,
              background:
                "linear-gradient(to bottom, rgba(255,255,255,0.7), transparent)",
            }}
          />
          <div
            className="absolute bottom-0 left-0 right-0 pointer-events-none z-10"
            style={{
              height: 16,
              background:
                "linear-gradient(to top, rgba(255,255,255,0.7), transparent)",
            }}
          />
          <div
            style={{
              transform: `translateY(${-(reelIndexR * ITEM_H)}px)`,
              transition: reelTransitionR
                ? "transform 1.8s cubic-bezier(0.17, 0.67, 0.12, 0.99)"
                : "none",
            }}
          >
            {RPS_REEL.map((choice, i) => (
              <div
                key={i}
                className="flex items-center justify-center select-none"
                style={{ height: ITEM_H, fontSize: "6rem" }}
              >
                {choice}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Spin button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          spin();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        disabled={isSpinning}
        className={`mt-4 rounded-full w-12 h-12 flex items-center justify-center shadow-lg transition-all ${
          isSpinning
            ? "bg-gray-200 text-gray-400 cursor-not-allowed"
            : "bg-blue-500 text-white hover:bg-blue-600 hover:scale-105"
        }`}
        aria-label="Spin"
      >
        <Play size={20} fill="currentColor" />
      </button>

      {/* Resize handles */}
      <div className="absolute inset-0 pointer-events-none transition-opacity opacity-0 group-hover:opacity-100">
        <div
          className="resize-handle pointer-events-auto absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-blue-400 rounded-tl cursor-nwse-resize"
          onMouseDown={(e) => startResize(e, setRpsScale, rpsScale, -1)}
          onTouchStart={(e) => startResize(e, setRpsScale, rpsScale, -1)}
        />
        <div
          className="resize-handle pointer-events-auto absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-blue-400 rounded-tr cursor-nesw-resize"
          onMouseDown={(e) => startResize(e, setRpsScale, rpsScale)}
          onTouchStart={(e) => startResize(e, setRpsScale, rpsScale)}
        />
        <div
          className="resize-handle pointer-events-auto absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-blue-400 rounded-bl cursor-nesw-resize"
          onMouseDown={(e) => startResize(e, setRpsScale, rpsScale, -1)}
          onTouchStart={(e) => startResize(e, setRpsScale, rpsScale, -1)}
        />
        <div
          className="resize-handle pointer-events-auto absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-blue-400 rounded-br cursor-nwse-resize"
          onMouseDown={(e) => startResize(e, setRpsScale, rpsScale)}
          onTouchStart={(e) => startResize(e, setRpsScale, rpsScale)}
        />
      </div>
    </div>
  );
};

export default RpsTool;
