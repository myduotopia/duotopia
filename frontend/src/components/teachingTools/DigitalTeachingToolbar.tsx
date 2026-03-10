import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  Timer,
  Dice5,
  X,
  GripHorizontal,
  Triangle,
  Play,
  Square,
  Share2,
  Copy,
  Check,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Timer Component
const TimerTool: React.FC<{ show: boolean; onClose: () => void }> = ({
  show,
  onClose,
}) => {
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [isBeeping, setIsBeeping] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timerScale, setTimerScale] = useState(1);
  const [timerPos, setTimerPos] = useState({ x: 40, y: 80 });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasInitializedTimerPos = useRef(false);

  const clampTimerPos = useCallback(
    (pos: { x: number; y: number }) => ({
      x: Math.min(Math.max(0, pos.x), window.innerWidth - 320 * timerScale),
      y: Math.min(Math.max(0, pos.y), window.innerHeight - 420 * timerScale),
    }),
    [timerScale],
  );

  // Initialize timer position to center when first shown; re-clamp on re-open
  useEffect(() => {
    if (show) {
      if (!hasInitializedTimerPos.current) {
        const centerX = window.innerWidth / 2 - 150;
        const centerY = window.innerHeight / 2 - 150;
        setTimerPos({ x: centerX, y: centerY });
        hasInitializedTimerPos.current = true;
      } else {
        setTimerPos((prev) => clampTimerPos(prev));
      }
    }
  }, [show, clampTimerPos]);

  // Clamp on window resize
  useEffect(() => {
    const onResize = () => setTimerPos((prev) => clampTimerPos(prev));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampTimerPos]);

  // 固定點大小，同時讓間距跟隨工具縮放
  const handleTransform = useCallback(
    (tx: number, ty: number) => ({
      transform: `translate(${tx}%, ${ty}%) scale(${1 / timerScale})`,
      transformOrigin: "center",
    }),
    [timerScale],
  );

  // 初始化音效
  useEffect(() => {
    const audio = new Audio(
      "https://storage.googleapis.com/duotopia-social-media-videos/website/sounds/timerring.mp3.mp3",
    );
    audio.loop = true;
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  const stopBeeping = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsBeeping(false);
  }, []);

  const startBeeping = useCallback(() => {
    setIsBeeping(true);
    if (audioRef.current) {
      audioRef.current
        .play()
        .catch((e) => console.log("Audio play prevented:", e));
    }
  }, []);

  // 計時邏輯
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isActive && timeLeft > 0) {
      interval = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    } else if (timeLeft === 0 && isActive) {
      setIsActive(false);
      startBeeping();
      clearInterval(interval!);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isActive, timeLeft, startBeeping]);

  const currentMin = isBeeping ? 0 : Math.floor(timeLeft / 60);
  const currentSec = isBeeping ? 0 : timeLeft % 60;

  // 時鐘刻度
  const ticksElement = useMemo(() => {
    const ticks = [];
    for (let i = 0; i < 60; i++) {
      const isMajor = i % 5 === 0;
      ticks.push(
        <div
          key={i}
          className={`absolute ${isMajor ? "bg-gray-800" : "bg-gray-400"}`}
          style={{
            width: isMajor ? "3px" : "1px",
            height: isMajor ? "14px" : "7px",
            left: "50%",
            top: "50%",
            transformOrigin: `50% 110px`,
            transform: `translate(-50%, -110px) rotate(${i * 6}deg)`,
          }}
        />,
      );
    }
    return ticks;
  }, []);

  const startDrag = (
    e: React.MouseEvent | React.TouchEvent,
    setPos: (pos: { x: number; y: number }) => void,
    currentPos: { x: number; y: number },
  ) => {
    if (
      (e.target as HTMLElement).closest("button") ||
      (e.target as HTMLElement).closest(".resize-handle") ||
      (e.target as HTMLElement).closest(".settings-panel")
    ) {
      return;
    }

    const clientX = (e as React.TouchEvent).touches
      ? (e as React.TouchEvent).touches[0].clientX
      : (e as React.MouseEvent).clientX;
    const clientY = (e as React.TouchEvent).touches
      ? (e as React.TouchEvent).touches[0].clientY
      : (e as React.MouseEvent).clientY;

    const startX = clientX - currentPos.x;
    const startY = clientY - currentPos.y;
    let frameId: number | null = null;

    // Prevent text selection during drag
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      const moveX = (moveEvent as TouchEvent).touches
        ? (moveEvent as TouchEvent).touches[0].clientX
        : (moveEvent as MouseEvent).clientX;
      const moveY = (moveEvent as TouchEvent).touches
        ? (moveEvent as TouchEvent).touches[0].clientY
        : (moveEvent as MouseEvent).clientY;

      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        setPos({ x: moveX - startX, y: moveY - startY });
      });

      if ((moveEvent as TouchEvent).touches) moveEvent.preventDefault();
    };

    const onEnd = () => {
      if (frameId) cancelAnimationFrame(frameId);
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  };

  const startResize = (
    e: React.MouseEvent | React.TouchEvent,
    setScale: (scale: number) => void,
    currentScale: number,
    direction: number = 1, // use -1 for left handles so pulling outward increases size
  ) => {
    e.stopPropagation();
    const clientX = (e as React.TouchEvent).touches
      ? (e as React.TouchEvent).touches[0].clientX
      : (e as React.MouseEvent).clientX;
    const startX = clientX;
    const startScale = currentScale;
    let frameId: number | null = null;

    // Prevent text selection during resize
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      const moveX = (moveEvent as TouchEvent).touches
        ? (moveEvent as TouchEvent).touches[0].clientX
        : (moveEvent as MouseEvent).clientX;
      const delta = direction * (moveX - startX) * 0.005;

      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        setScale(Math.max(0.5, Math.min(1.5, startScale + delta)));
      });

      if ((moveEvent as TouchEvent).touches) moveEvent.preventDefault();
    };

    const onEnd = () => {
      if (frameId) cancelAnimationFrame(frameId);
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  };

  if (!show) return null;

  return (
    <div
      className="fixed flex flex-col items-center group z-[200] bg-white/50 backdrop-blur-md rounded-2xl pb-4"
      ref={containerRef}
      style={{
        width: "280px",
        left: `${timerPos.x}px`,
        top: `${timerPos.y}px`,
        transform: `scale(${timerScale})`,
        transformOrigin: "top left",
      }}
      onMouseDown={(e) => startDrag(e, setTimerPos, timerPos)}
      onTouchStart={(e) => startDrag(e, setTimerPos, timerPos)}
    >
      <div className="absolute top-0 w-full flex justify-between items-center px-6 pt-5 pb-1 opacity-0 group-hover:opacity-100 pointer-events-none">
        <GripHorizontal size={18} className="text-gray-400 pointer-events-auto" />
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-red-500 pointer-events-auto"
          aria-label="Close timer"
        >
          <X size={18} />
        </button>
      </div>

      <div
        className={`relative flex items-center justify-center w-[220px] h-[220px] mt-8 rounded-full bg-white/70 backdrop-blur-md border-[6px] border-white/80 transition-all ${
          isBeeping ? "animate-pulse ring-8 ring-blue-400" : ""
        }`}
      >
        {ticksElement}
        <div
          className="relative flex flex-col items-center z-10 select-none"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex gap-4 mb-4">
            <button
              onClick={() => {
                if (isBeeping) stopBeeping();
                if (!isActive && timeLeft > 0) {
                  setIsActive(true);
                }
              }}
              disabled={isActive}
              className={`rounded-full shadow-lg w-10 h-10 flex items-center justify-center ${
                isActive
                  ? "bg-gray-100 text-gray-300"
                  : "bg-green-500 text-white hover:scale-105 transition-transform"
              }`}
              aria-label="Start timer"
            >
              <Play size={18} fill="currentColor" />
            </button>
            <button
              onClick={() => {
                stopBeeping();
                setIsActive(false);
                setTimeLeft(0);
                setMinutes(0);
                setSeconds(0);
              }}
              className="rounded-full bg-red-500 text-white shadow-lg w-10 h-10 flex items-center justify-center hover:scale-105 transition-transform"
              aria-label="Stop timer"
            >
              <Square size={16} fill="currentColor" />
            </button>
          </div>

          <div className="flex items-center gap-1 text-gray-900 font-mono font-black text-4xl">
            <div className="flex flex-col items-center">
              <button
                onClick={() => {
                  if (!isActive)
                    setTimeLeft(
                      Math.max(
                        0,
                        timeLeft + 60,
                      ),
                    );
                }}
                className="text-gray-400 hover:text-blue-500"
                aria-label="Increase minutes"
              >
                <Triangle size={12} className="fill-current" />
              </button>
              <span>{String(currentMin).padStart(2, "0")}</span>
              <button
                onClick={() => {
                  if (!isActive)
                    setTimeLeft(
                      Math.max(
                        0,
                        timeLeft - 60,
                      ),
                    );
                }}
                className="text-gray-400 hover:text-blue-500 rotate-180"
                aria-label="Decrease minutes"
              >
                <Triangle size={12} className="fill-current" />
              </button>
            </div>
            <span className="text-blue-500/30">:</span>
            <div className="flex flex-col items-center">
              <button
                onClick={() => {
                  if (!isActive)
                    setTimeLeft(
                      Math.max(
                        0,
                        timeLeft + 10,
                      ),
                    );
                }}
                className="text-gray-400 hover:text-blue-500"
                aria-label="Increase seconds"
              >
                <Triangle size={12} className="fill-current" />
              </button>
              <span>{String(currentSec).padStart(2, "0")}</span>
              <button
                onClick={() => {
                  if (!isActive)
                    setTimeLeft(
                      Math.max(
                        0,
                        timeLeft - 10,
                      ),
                    );
                }}
                className="text-gray-400 hover:text-blue-500 rotate-180"
                aria-label="Decrease seconds"
              >
                <Triangle size={12} className="fill-current" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className="flex gap-4 mt-4 bg-white/50 backdrop-blur-sm px-4 py-2 rounded-full border border-white/50 shadow-sm select-none"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {[1, 3, 5, 10].map((m) => (
          <button
            key={m}
            onClick={() => {
              if (!isActive) {
                setMinutes(m);
                setSeconds(0);
                setTimeLeft(m * 60);
              }
            }}
            className="text-sm font-bold text-gray-500 hover:text-blue-500 transition-colors"
          >
            {m}m
          </button>
        ))}
      </div>

      <div className="absolute inset-0 pointer-events-none transition-opacity opacity-0 group-hover:opacity-100">
        {/* Top-left L */}
        <div
          className="resize-handle pointer-events-auto absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-blue-400 rounded-tl-lg cursor-nwse-resize"
          onMouseDown={(e) => startResize(e, setTimerScale, timerScale, -1)}
          onTouchStart={(e) => startResize(e, setTimerScale, timerScale, -1)}
        />
        {/* Top-right L */}
        <div
          className="resize-handle pointer-events-auto absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-blue-400 rounded-tr-lg cursor-nesw-resize"
          onMouseDown={(e) => startResize(e, setTimerScale, timerScale)}
          onTouchStart={(e) => startResize(e, setTimerScale, timerScale)}
        />
        {/* Bottom-left L */}
        <div
          className="resize-handle pointer-events-auto absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-blue-400 rounded-bl-lg cursor-nesw-resize"
          onMouseDown={(e) => startResize(e, setTimerScale, timerScale, -1)}
          onTouchStart={(e) => startResize(e, setTimerScale, timerScale, -1)}
        />
        {/* Bottom-right L */}
        <div
          className="resize-handle pointer-events-auto absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-blue-400 rounded-br-lg cursor-nwse-resize"
          onMouseDown={(e) => startResize(e, setTimerScale, timerScale)}
          onTouchStart={(e) => startResize(e, setTimerScale, timerScale)}
        />
      </div>
    </div>
  );
};

// Dice Component
const DiceTool: React.FC<{ show: boolean; onClose: () => void }> = ({
  show,
  onClose,
}) => {
  const [, setDiceValue] = useState(1);
  const [isRolling, setIsRolling] = useState(false);
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const [enableTransition, setEnableTransition] = useState(true);
  const [diceScale, setDiceScale] = useState(1.6);
  const [dicePos, setDicePos] = useState<{ x: number; y: number } | null>(null);
  const handleTransform = useCallback(
    (tx: number, ty: number, extraY: number = 0) => ({
      transform: `translate(${tx}%, ${ty}%) translateY(${extraY}px) scale(${1 / diceScale})`,
      transformOrigin: "center",
    }),
    [diceScale],
  );

  const rollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasInitializedDicePos = useRef(false);

  const clampDicePos = useCallback(
    (pos: { x: number; y: number }) => ({
      x: Math.min(Math.max(0, pos.x), window.innerWidth - 200 * diceScale),
      y: Math.min(Math.max(0, pos.y), window.innerHeight - 200 * diceScale),
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
    }
  }, [show, clampDicePos]);

  // Clamp on window resize
  useEffect(() => {
    const onResize = () =>
      setDicePos((prev) => (prev ? clampDicePos(prev) : prev));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampDicePos]);

  const rollDice = () => {
    // Prevent overlapping rolls
    if (isRolling) return;

    // Clear any pending timeouts
    if (rollTimerRef.current) clearTimeout(rollTimerRef.current);

    setIsRolling(true);
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

  const DieFace: React.FC<{
    dots: number;
    transform: string;
    isRed?: boolean;
  }> = ({ dots, transform, isRed = false }) => {
    const dotMap: Record<number, Array<[number, number]>> = {
      1: [[50, 50]],
      2: [
        [25, 25],
        [75, 75],
      ],
      3: [
        [25, 25],
        [50, 50],
        [75, 75],
      ],
      4: [
        [25, 25],
        [25, 75],
        [75, 25],
        [75, 75],
      ],
      5: [
        [25, 25],
        [25, 75],
        [50, 50],
        [75, 25],
        [75, 75],
      ],
      6: [
        [25, 20],
        [25, 50],
        [25, 80],
        [75, 20],
        [75, 50],
        [75, 80],
      ],
    };

    return (
      <div
        className="absolute w-full h-full bg-white border border-gray-200 rounded-2xl flex items-center justify-center shadow-inner"
        style={{ transform, backfaceVisibility: "hidden" }}
      >
        <svg width="100%" height="100%" viewBox="0 0 100 100">
          {(dotMap[dots] || []).map(([cx, cy], i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={dots === 1 ? 12 : 8}
              fill={isRed ? "#ef4444" : "#374151"}
            />
          ))}
        </svg>
      </div>
    );
  };

  const startDrag = (
    e: React.MouseEvent | React.TouchEvent,
    setPos: (pos: { x: number; y: number }) => void,
    currentPos: { x: number; y: number },
  ) => {
    if (
      (e.target as HTMLElement).closest("button") ||
      (e.target as HTMLElement).closest(".resize-handle") ||
      (e.target as HTMLElement).closest(".dice-clickable")
    ) {
      return;
    }

    const clientX = (e as React.TouchEvent).touches
      ? (e as React.TouchEvent).touches[0].clientX
      : (e as React.MouseEvent).clientX;
    const clientY = (e as React.TouchEvent).touches
      ? (e as React.TouchEvent).touches[0].clientY
      : (e as React.MouseEvent).clientY;

    const startX = clientX - currentPos.x;
    const startY = clientY - currentPos.y;
    let frameId: number | null = null;

    // Prevent text selection during drag
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      const moveX = (moveEvent as TouchEvent).touches
        ? (moveEvent as TouchEvent).touches[0].clientX
        : (moveEvent as MouseEvent).clientX;
      const moveY = (moveEvent as TouchEvent).touches
        ? (moveEvent as TouchEvent).touches[0].clientY
        : (moveEvent as MouseEvent).clientY;

      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        setPos({ x: moveX - startX, y: moveY - startY });
      });

      if ((moveEvent as TouchEvent).touches) moveEvent.preventDefault();
    };

    const onEnd = () => {
      if (frameId) cancelAnimationFrame(frameId);
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  };

  const startResize = (
    e: React.MouseEvent | React.TouchEvent,
    setScale: (scale: number) => void,
    currentScale: number,
    direction: number = 1, // use -1 for left handles so pulling outward increases size
  ) => {
    e.stopPropagation();
    const clientX = (e as React.TouchEvent).touches
      ? (e as React.TouchEvent).touches[0].clientX
      : (e as React.MouseEvent).clientX;
    const startX = clientX;
    const startScale = currentScale;
    let frameId: number | null = null;

    // Prevent text selection during resize
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      const moveX = (moveEvent as TouchEvent).touches
        ? (moveEvent as TouchEvent).touches[0].clientX
        : (moveEvent as MouseEvent).clientX;
      const delta = (moveX - startX) * 0.005 * direction;

      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        setScale(Math.max(0.8, Math.min(2.4, startScale + delta)));
      });

      if ((moveEvent as TouchEvent).touches) moveEvent.preventDefault();
    };

    const onEnd = () => {
      if (frameId) cancelAnimationFrame(frameId);
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  };

  if (!show || !dicePos) return null;

  return (
    <div
      className="fixed flex flex-col items-center justify-center group z-[200] bg-white/50 backdrop-blur-md rounded-2xl"
      style={{
        width: "200px",
        height: "200px",
        left: `${dicePos.x}px`,
        top: `${dicePos.y}px`,
        transform: `scale(${diceScale})`,
        transformOrigin: "top left",
      }}
      onMouseDown={(e) => startDrag(e, setDicePos, dicePos)}
      onTouchStart={(e) => startDrag(e, setDicePos, dicePos)}
    >
      <div className="absolute inset-0 pointer-events-none transition-opacity opacity-0 group-hover:opacity-100">
        {/* Top-left L */}
        <div
          className="resize-handle pointer-events-auto absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-blue-400 rounded-tl-lg cursor-nwse-resize"
          onMouseDown={(e) => startResize(e, setDiceScale, diceScale, -1)}
          onTouchStart={(e) => startResize(e, setDiceScale, diceScale, -1)}
        />
        {/* Top-right L */}
        <div
          className="resize-handle pointer-events-auto absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-blue-400 rounded-tr-lg cursor-nesw-resize"
          onMouseDown={(e) => startResize(e, setDiceScale, diceScale)}
          onTouchStart={(e) => startResize(e, setDiceScale, diceScale)}
        />
        {/* Bottom-left L */}
        <div
          className="resize-handle pointer-events-auto absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-blue-400 rounded-bl-lg cursor-nesw-resize"
          onMouseDown={(e) => startResize(e, setDiceScale, diceScale, -1)}
          onTouchStart={(e) => startResize(e, setDiceScale, diceScale, -1)}
        />
        {/* Bottom-right L */}
        <div
          className="resize-handle pointer-events-auto absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-blue-400 rounded-br-lg cursor-nwse-resize"
          onMouseDown={(e) => startResize(e, setDiceScale, diceScale)}
          onTouchStart={(e) => startResize(e, setDiceScale, diceScale)}
        />
      </div>
      <div className="absolute top-0 w-full flex justify-between items-center px-4 pt-5 pb-1 opacity-0 group-hover:opacity-100 pointer-events-none">
        <GripHorizontal size={18} className="text-gray-400 pointer-events-auto" />
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-red-500 pointer-events-auto"
          aria-label="Close dice"
        >
          <X size={18} />
        </button>
      </div>

      <div
        className="dice-clickable w-20 h-20 cursor-pointer select-none"
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
          <DieFace dots={1} transform="translateZ(40px)" isRed={true} />
          <DieFace dots={2} transform="rotateY(180deg) translateZ(40px)" />
          <DieFace dots={3} transform="rotateY(90deg) translateZ(40px)" />
          <DieFace dots={4} transform="rotateY(-90deg) translateZ(40px)" />
          <DieFace dots={5} transform="rotateX(90deg) translateZ(40px)" />
          <DieFace dots={6} transform="rotateX(-90deg) translateZ(40px)" />
        </div>
      </div>
    </div>
  );
};

// Removed DrawingCanvas and all drawing-related UI and logic.

// Main Toolbar Component
const DigitalTeachingToolbar: React.FC = () => {
  const { t } = useTranslation();
  const user = useTeacherAuthStore((state) => state.user);
  const [showTimer, setShowTimer] = useState(false);
  const [showDice, setShowDice] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toolbarY, setToolbarY] = useState<number | null>(null);

  useEffect(() => {
    if (toolbarY === null) {
      setToolbarY(window.innerHeight / 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToolbarDrag = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const currentY = toolbarY ?? window.innerHeight / 2;
      const clientY = (e as React.TouchEvent).touches
        ? (e as React.TouchEvent).touches[0].clientY
        : (e as React.MouseEvent).clientY;
      const startOffset = clientY - currentY;
      let frameId: number | null = null;

      document.body.style.userSelect = "none";

      const onMove = (moveEvent: MouseEvent | TouchEvent) => {
        const moveY = (moveEvent as TouchEvent).touches
          ? (moveEvent as TouchEvent).touches[0].clientY
          : (moveEvent as MouseEvent).clientY;
        if (frameId) cancelAnimationFrame(frameId);
        frameId = requestAnimationFrame(() => {
          setToolbarY(
            Math.max(40, Math.min(window.innerHeight - 40, moveY - startOffset)),
          );
        });
        if ((moveEvent as TouchEvent).touches) moveEvent.preventDefault();
      };

      const onEnd = () => {
        if (frameId) cancelAnimationFrame(frameId);
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onEnd);
        window.removeEventListener("touchmove", onMove);
        window.removeEventListener("touchend", onEnd);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onEnd);
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onEnd);
    },
    [toolbarY],
  );

  const handleToggleTimer = useCallback(() => {
    setShowTimer((prev) => !prev);
  }, []);

  const handleToggleDice = useCallback(() => {
    setShowDice((prev) => !prev);
  }, []);

  const getStudentLoginUrl = useCallback(() => {
    if (!user?.email) return "";
    return `${window.location.origin}/student/login?teacher_email=${user.email}`;
  }, [user?.email]);

  const handleCopyUrl = useCallback(async () => {
    const url = getStudentLoginUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy URL:", err);
    }
  }, [getStudentLoginUrl]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[140]">
      {/* Share to Students Dialog */}
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent className="sm:max-w-md pointer-events-auto">
          <DialogHeader>
            <DialogTitle>{t("teacherDashboard.share.title")}</DialogTitle>
            <DialogDescription>
              {t("teacherDashboard.share.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex justify-center p-4 bg-white border rounded-lg">
              <QRCodeSVG value={getStudentLoginUrl()} size={200} />
            </div>
            <div className="flex items-center space-x-2">
              <Input value={getStudentLoginUrl()} readOnly className="flex-1" />
              <Button
                size="sm"
                onClick={handleCopyUrl}
                className="flex-shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    {t("teacherDashboard.share.copied")}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    {t("teacherDashboard.share.copy")}
                  </>
                )}
              </Button>
            </div>
            <div className="text-sm text-gray-600 space-y-2">
              <p>{t("teacherDashboard.share.instructions")}</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>{t("teacherDashboard.share.instruction1")}</li>
                <li>{t("teacherDashboard.share.instruction2")}</li>
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Side toolbar */}
      <div
        className="fixed right-0 flex flex-col gap-1 bg-white/90 backdrop-blur-md shadow-2xl border border-gray-200 border-r-0 rounded-l-xl p-1.5 z-[150] pointer-events-auto"
        style={{
          top: `${toolbarY ?? window.innerHeight / 2}px`,
          transform: "translateY(-50%)",
        }}
      >
        {/* Drag handle */}
        <div
          className="flex justify-center py-0.5 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 transition-colors"
          onMouseDown={handleToolbarDrag}
          onTouchStart={handleToolbarDrag}
          title="拖曳上下移動"
        >
          <GripHorizontal size={14} />
        </div>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            setShowShareDialog((prev) => !prev);
            setShowTimer(false);
            setShowDice(false);
          }}
          className={`p-1.5 rounded-lg transition-all duration-300 ${
            showShareDialog
              ? "bg-blue-500 text-white shadow-md"
              : "hover:bg-gray-100 text-blue-500"
          }`}
          aria-label={t("teacherDashboard.share.button")}
        >
          <Share2 size={18} />
        </button>

        <button
          onClick={handleToggleTimer}
          className={`p-1.5 rounded-lg transition-all duration-300 ${
            showTimer
              ? "bg-blue-500 text-white shadow-md"
              : "hover:bg-gray-100 text-blue-500"
          }`}
          aria-label="Timer"
        >
          <Timer size={18} />
        </button>

        <button
          onClick={handleToggleDice}
          className={`p-1.5 rounded-lg transition-all duration-300 ${
            showDice
              ? "bg-blue-500 text-white shadow-md"
              : "hover:bg-gray-100 text-blue-500"
          }`}
          aria-label="Dice"
        >
          <Dice5 size={18} />
        </button>
      </div>

      {/* Tools */}
      <div className="pointer-events-auto">
        <TimerTool show={showTimer} onClose={() => setShowTimer(false)} />
      </div>
      <div className="pointer-events-auto">
        <DiceTool show={showDice} onClose={() => setShowDice(false)} />
      </div>
    </div>
  );
};

export default DigitalTeachingToolbar;
