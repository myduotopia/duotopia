import React, { useState, useEffect, useCallback, useRef } from "react";
import { X, GripHorizontal, Volume2, Gamepad2 } from "lucide-react";
import DieFace from "./DieFace";
import { useDraggable } from "./hooks/useDraggable";
import { useResizable } from "./hooks/useResizable";
import type { ToolProps } from "./types";

// Dice Component
const DiceTool: React.FC<ToolProps> = ({ show, onClose, zCounterRef }) => {
  const [, setDiceValue] = useState(1);
  const [isRolling, setIsRolling] = useState(false);
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const [enableTransition, setEnableTransition] = useState(true);
  const [diceScale, setDiceScale] = useState(1.6);
  const [dicePos, setDicePos] = useState<{ x: number; y: number } | null>(null);
  const [useArcadeSound, setUseArcadeSound] = useState(false);
  const rollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasInitializedDicePos = useRef(false);
  const diceContainerRef = useRef<HTMLDivElement>(null);
  const defaultAudioRef = useRef<HTMLAudioElement | null>(null);
  const arcadeAudioRef = useRef<HTMLAudioElement | null>(null);

  const startDrag = useDraggable([".dice-clickable"]);
  const startResize = useResizable(diceContainerRef, 200, 200, 0.8);

  const clampDicePos = useCallback(
    (pos: { x: number; y: number }) => ({
      x: Math.min(
        Math.max(0, pos.x),
        Math.max(0, window.innerWidth - 200 * diceScale),
      ),
      y: Math.min(
        Math.max(0, pos.y),
        Math.max(0, window.innerHeight - 200 * diceScale),
      ),
    }),
    [diceScale],
  );

  // Initialize dice position to center when first shown; re-clamp on re-open
  useEffect(() => {
    if (show) {
      if (!hasInitializedDicePos.current) {
        const centerX = window.innerWidth / 2 - 100;
        const centerY = window.innerHeight / 2 - 100;
        setDicePos({ x: centerX, y: centerY });
        hasInitializedDicePos.current = true;
      } else {
        setDicePos((prev) => (prev ? clampDicePos(prev) : prev));
      }
      if (diceContainerRef.current) {
        zCounterRef.current += 1;
        diceContainerRef.current.style.zIndex = String(zCounterRef.current);
      }
    }
  }, [show, clampDicePos, zCounterRef]);

  // Clamp on window resize
  useEffect(() => {
    const onResize = () =>
      setDicePos((prev) => (prev ? clampDicePos(prev) : prev));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampDicePos]);

  // Clean up roll timer on unmount
  useEffect(() => {
    return () => {
      if (rollTimerRef.current) clearTimeout(rollTimerRef.current);
    };
  }, []);

  // Preload dice sounds
  useEffect(() => {
    const defaultAudio = new Audio(
      "https://storage.googleapis.com/duotopia-social-media-videos/website/sounds/diceroll.mp3",
    );
    defaultAudio.preload = "auto";
    defaultAudioRef.current = defaultAudio;

    const arcadeAudio = new Audio(
      "https://storage.googleapis.com/duotopia-social-media-videos/website/sounds/Go%2C%20Dice%20Roll.mp3",
    );
    arcadeAudio.preload = "auto";
    arcadeAudioRef.current = arcadeAudio;

    return () => {
      defaultAudio.pause();
      defaultAudio.src = "";
      arcadeAudio.pause();
      arcadeAudio.src = "";
    };
  }, []);

  const playDiceSound = useCallback(() => {
    const audio = useArcadeSound
      ? arcadeAudioRef.current
      : defaultAudioRef.current;
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  }, [useArcadeSound]);

  const rollDice = () => {
    // Prevent overlapping rolls
    if (isRolling) return;

    // Clear any pending timeouts
    if (rollTimerRef.current) clearTimeout(rollTimerRef.current);

    setIsRolling(true);
    playDiceSound();
    const newValue = Math.floor(Math.random() * 6) + 1;
    const targetRotations: Record<number, { x: number; y: number }> = {
      1: { x: 0, y: 0 },
      2: { x: 0, y: 180 },
      3: { x: 0, y: -90 },
      4: { x: 0, y: 90 },
      5: { x: -90, y: 0 },
      6: { x: 90, y: 0 },
    };

    // Enable transition for animation
    setEnableTransition(true);

    // Set rotation with 1440 offset for smooth rolling animation
    setRotation({
      x: targetRotations[newValue].x + 1440,
      y: targetRotations[newValue].y + 1440,
    });

    // Wait for CSS animation to complete (700ms)
    rollTimerRef.current = setTimeout(() => {
      setDiceValue(newValue);
      setIsRolling(false);

      // Disable transition temporarily to reset rotation without animation
      setEnableTransition(false);

      // Reset rotation to target value for next roll
      requestAnimationFrame(() => {
        setRotation({
          x: targetRotations[newValue].x,
          y: targetRotations[newValue].y,
        });
      });
    }, 700);
  };

  if (!show || !dicePos) return null;

  return (
    <div
      ref={diceContainerRef}
      className="fixed flex flex-col items-center justify-center group bg-white/50 backdrop-blur-md rounded-xl"
      style={{
        zIndex: 200,
        width: "200px",
        height: "200px",
        left: `${dicePos.x}px`,
        top: `${dicePos.y}px`,
        transform: `scale(${diceScale})`,
        transformOrigin: "top left",
      }}
      onMouseDownCapture={(e) => {
        zCounterRef.current += 1;
        (e.currentTarget as HTMLElement).style.zIndex = String(
          zCounterRef.current,
        );
      }}
      onMouseDown={(e) => startDrag(e, setDicePos, dicePos)}
      onTouchStart={(e) => startDrag(e, setDicePos, dicePos)}
    >
      <div className="absolute inset-0 pointer-events-none transition-opacity opacity-0 group-hover:opacity-100">
        {/* Top-left L */}
        <div
          className="resize-handle pointer-events-auto absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-blue-400 rounded-tl cursor-nwse-resize"
          onMouseDown={(e) => startResize(e, setDiceScale, diceScale, -1)}
          onTouchStart={(e) => startResize(e, setDiceScale, diceScale, -1)}
        />
        {/* Top-right L */}
        <div
          className="resize-handle pointer-events-auto absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-blue-400 rounded-tr cursor-nesw-resize"
          onMouseDown={(e) => startResize(e, setDiceScale, diceScale)}
          onTouchStart={(e) => startResize(e, setDiceScale, diceScale)}
        />
        {/* Bottom-left L */}
        <div
          className="resize-handle pointer-events-auto absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-blue-400 rounded-bl cursor-nesw-resize"
          onMouseDown={(e) => startResize(e, setDiceScale, diceScale, -1)}
          onTouchStart={(e) => startResize(e, setDiceScale, diceScale, -1)}
        />
        {/* Bottom-right L */}
        <div
          className="resize-handle pointer-events-auto absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-blue-400 rounded-br cursor-nwse-resize"
          onMouseDown={(e) => startResize(e, setDiceScale, diceScale)}
          onTouchStart={(e) => startResize(e, setDiceScale, diceScale)}
        />
      </div>
      <div className="absolute top-0 w-full flex justify-between items-center px-4 pt-5 pb-1 opacity-0 group-hover:opacity-100 pointer-events-none">
        <GripHorizontal
          size={18}
          className="text-gray-400 pointer-events-auto"
        />
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-red-500 pointer-events-auto"
          aria-label="Close dice"
        >
          <X size={18} />
        </button>
      </div>

      {/* Sound toggle */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setUseArcadeSound((prev) => !prev);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute bottom-1 right-1/2 translate-x-1/2 z-10 text-gray-400 hover:text-blue-500 transition-all pointer-events-auto opacity-0 group-hover:opacity-100"
        title={useArcadeSound ? "Arcade sound" : "Default sound"}
      >
        {useArcadeSound ? <Gamepad2 size={14} /> : <Volume2 size={14} />}
      </button>

      <div
        className="dice-clickable w-28 h-28 cursor-pointer select-none"
        style={{ perspective: "800px" }}
        onClick={(e) => {
          e.stopPropagation();
          rollDice();
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className={`relative w-full h-full ${enableTransition ? "transition-transform duration-700 ease-out" : ""}`}
          style={{
            transformStyle: "preserve-3d",
            transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
          }}
        >
          <DieFace dots={1} transform="translateZ(56px)" isRed={true} />
          <DieFace dots={2} transform="rotateY(180deg) translateZ(56px)" />
          <DieFace dots={3} transform="rotateY(90deg) translateZ(56px)" />
          <DieFace dots={4} transform="rotateY(-90deg) translateZ(56px)" />
          <DieFace dots={5} transform="rotateX(90deg) translateZ(56px)" />
          <DieFace dots={6} transform="rotateX(-90deg) translateZ(56px)" />
        </div>
      </div>
    </div>
  );
};

export default DiceTool;
