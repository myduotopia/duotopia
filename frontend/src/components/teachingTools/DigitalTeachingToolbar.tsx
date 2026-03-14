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
  HelpCircle,
  ExternalLink,
  BookOpen,
  Users,
  Hand,
  ChevronLeft,
  ChevronRight,
  Volume2,
  Gamepad2,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
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

/** Compute max scale so the tool can fill up to 95% of the viewport */
const getMaxScale = (baseW: number, baseH: number): number => {
  const maxScaleX = (window.innerWidth * 0.95) / baseW;
  const maxScaleY = (window.innerHeight * 0.95) / baseH;
  return Math.min(maxScaleX, maxScaleY);
};

// Timer Component
const TimerTool: React.FC<{
  show: boolean;
  onClose: () => void;
  zCounterRef: React.MutableRefObject<number>;
}> = ({ show, onClose, zCounterRef }) => {
  const [, setMinutes] = useState(0);
  const [, setSeconds] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [isBeeping, setIsBeeping] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timerScale, setTimerScale] = useState(1);
  const [timerPos, setTimerPos] = useState({ x: 40, y: 80 });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasInitializedTimerPos = useRef(false);

  const clampTimerPos = useCallback(
    (pos: { x: number; y: number }) => {
      const w = containerRef.current?.offsetWidth ?? 280;
      const h = containerRef.current?.offsetHeight ?? 320;
      return {
        x: Math.min(
          Math.max(0, pos.x),
          Math.max(0, window.innerWidth - w * timerScale),
        ),
        y: Math.min(
          Math.max(0, pos.y),
          Math.max(0, window.innerHeight - h * timerScale),
        ),
      };
    },
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
      // Bring to front when opened
      if (containerRef.current) {
        zCounterRef.current += 1;
        containerRef.current.style.zIndex = String(zCounterRef.current);
      }
    }
  }, [show, clampTimerPos, zCounterRef]);

  // Clamp on window resize
  useEffect(() => {
    const onResize = () => setTimerPos((prev) => clampTimerPos(prev));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampTimerPos]);

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
        const baseW = containerRef.current?.offsetWidth ?? 280;
        const baseH = containerRef.current?.offsetHeight ?? 320;
        setScale(
          Math.max(
            0.5,
            Math.min(getMaxScale(baseW, baseH), startScale + delta),
          ),
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
  };

  if (!show) return null;

  return (
    <div
      className="fixed flex flex-col items-center group bg-white/50 backdrop-blur-md rounded-xl pb-4"
      ref={containerRef}
      style={{
        zIndex: 200,
        width: "280px",
        left: `${timerPos.x}px`,
        top: `${timerPos.y}px`,
        transform: `scale(${timerScale})`,
        transformOrigin: "top left",
      }}
      onMouseDownCapture={(e) => {
        zCounterRef.current += 1;
        (e.currentTarget as HTMLElement).style.zIndex = String(
          zCounterRef.current,
        );
      }}
      onMouseDown={(e) => startDrag(e, setTimerPos, timerPos)}
      onTouchStart={(e) => startDrag(e, setTimerPos, timerPos)}
    >
      <div className="absolute top-0 w-full flex justify-between items-center px-6 pt-5 pb-1 opacity-0 group-hover:opacity-100 pointer-events-none">
        <GripHorizontal
          size={18}
          className="text-gray-400 pointer-events-auto"
        />
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

          <div className="flex items-center gap-2 text-gray-900 font-mono font-black text-4xl">
            {/* Minutes tens digit */}
            <div className="flex flex-col items-center">
              <button
                onClick={() => {
                  if (!isActive) setTimeLeft(Math.max(0, timeLeft + 600));
                }}
                className="text-gray-400 hover:text-blue-500"
                aria-label="Increase minutes tens"
              >
                <Triangle size={12} className="fill-current" />
              </button>
              <span>{String(currentMin).padStart(2, "0")[0]}</span>
              <button
                onClick={() => {
                  if (!isActive) setTimeLeft(Math.max(0, timeLeft - 600));
                }}
                className="text-gray-400 hover:text-blue-500 rotate-180"
                aria-label="Decrease minutes tens"
              >
                <Triangle size={12} className="fill-current" />
              </button>
            </div>
            {/* Minutes ones digit */}
            <div className="flex flex-col items-center">
              <button
                onClick={() => {
                  if (!isActive) setTimeLeft(Math.max(0, timeLeft + 60));
                }}
                className="text-gray-400 hover:text-blue-500"
                aria-label="Increase minutes ones"
              >
                <Triangle size={12} className="fill-current" />
              </button>
              <span>{String(currentMin).padStart(2, "0")[1]}</span>
              <button
                onClick={() => {
                  if (!isActive) setTimeLeft(Math.max(0, timeLeft - 60));
                }}
                className="text-gray-400 hover:text-blue-500 rotate-180"
                aria-label="Decrease minutes ones"
              >
                <Triangle size={12} className="fill-current" />
              </button>
            </div>
            <span className="text-blue-500/30">:</span>
            {/* Seconds tens digit */}
            <div className="flex flex-col items-center">
              <button
                onClick={() => {
                  if (!isActive) setTimeLeft(Math.max(0, timeLeft + 10));
                }}
                className="text-gray-400 hover:text-blue-500"
                aria-label="Increase seconds tens"
              >
                <Triangle size={12} className="fill-current" />
              </button>
              <span>{String(currentSec).padStart(2, "0")[0]}</span>
              <button
                onClick={() => {
                  if (!isActive) setTimeLeft(Math.max(0, timeLeft - 10));
                }}
                className="text-gray-400 hover:text-blue-500 rotate-180"
                aria-label="Decrease seconds tens"
              >
                <Triangle size={12} className="fill-current" />
              </button>
            </div>
            {/* Seconds ones digit */}
            <div className="flex flex-col items-center">
              <button
                onClick={() => {
                  if (!isActive) setTimeLeft(Math.max(0, timeLeft + 1));
                }}
                className="text-gray-400 hover:text-blue-500"
                aria-label="Increase seconds ones"
              >
                <Triangle size={12} className="fill-current" />
              </button>
              <span>{String(currentSec).padStart(2, "0")[1]}</span>
              <button
                onClick={() => {
                  if (!isActive) setTimeLeft(Math.max(0, timeLeft - 1));
                }}
                className="text-gray-400 hover:text-blue-500 rotate-180"
                aria-label="Decrease seconds ones"
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
          className="resize-handle pointer-events-auto absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-blue-400 rounded-tl cursor-nwse-resize"
          onMouseDown={(e) => startResize(e, setTimerScale, timerScale, -1)}
          onTouchStart={(e) => startResize(e, setTimerScale, timerScale, -1)}
        />
        {/* Top-right L */}
        <div
          className="resize-handle pointer-events-auto absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-blue-400 rounded-tr cursor-nesw-resize"
          onMouseDown={(e) => startResize(e, setTimerScale, timerScale)}
          onTouchStart={(e) => startResize(e, setTimerScale, timerScale)}
        />
        {/* Bottom-left L */}
        <div
          className="resize-handle pointer-events-auto absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-blue-400 rounded-bl cursor-nesw-resize"
          onMouseDown={(e) => startResize(e, setTimerScale, timerScale, -1)}
          onTouchStart={(e) => startResize(e, setTimerScale, timerScale, -1)}
        />
        {/* Bottom-right L */}
        <div
          className="resize-handle pointer-events-auto absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-blue-400 rounded-br cursor-nwse-resize"
          onMouseDown={(e) => startResize(e, setTimerScale, timerScale)}
          onTouchStart={(e) => startResize(e, setTimerScale, timerScale)}
        />
      </div>
    </div>
  );
};

// Dice Component
const DiceTool: React.FC<{
  show: boolean;
  onClose: () => void;
  zCounterRef: React.MutableRefObject<number>;
}> = ({ show, onClose, zCounterRef }) => {
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
        className="absolute w-full h-full bg-white border border-gray-200 rounded-xl flex items-center justify-center shadow-inner"
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
        setScale(
          Math.max(0.8, Math.min(getMaxScale(200, 200), startScale + delta)),
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

// RPS (Rock-Paper-Scissors) Slot Machine Component
const RPS_CHOICES = ["✊", "✋", "✌️"];
const RPS_REEL = (() => {
  const arr: string[] = [];
  for (let i = 0; i < 20; i++) RPS_CHOICES.forEach((c) => arr.push(c));
  return arr;
})();

const RpsTool: React.FC<{
  show: boolean;
  onClose: () => void;
  zCounterRef: React.MutableRefObject<number>;
}> = ({ show, onClose, zCounterRef }) => {
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

    setTimeout(() => {
      setIsSpinning(false);
      if (newIndexL > 30) {
        setTimeout(() => {
          setReelTransitionL(false);
          setReelIndexL((newIndexL % 3) + 3);
        }, 50);
      }
      if (newIndexR > 30) {
        setTimeout(() => {
          setReelTransitionR(false);
          setReelIndexR((newIndexR % 3) + 3);
        }, 50);
      }
    }, 1900);
  };

  const startDrag = (
    e: React.MouseEvent | React.TouchEvent,
    setPos: (pos: { x: number; y: number }) => void,
    currentPos: { x: number; y: number },
  ) => {
    if (
      (e.target as HTMLElement).closest("button") ||
      (e.target as HTMLElement).closest(".resize-handle")
    )
      return;

    const clientX = (e as React.TouchEvent).touches
      ? (e as React.TouchEvent).touches[0].clientX
      : (e as React.MouseEvent).clientX;
    const clientY = (e as React.TouchEvent).touches
      ? (e as React.TouchEvent).touches[0].clientY
      : (e as React.MouseEvent).clientY;

    const startX = clientX - currentPos.x;
    const startY = clientY - currentPos.y;
    let frameId: number | null = null;
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      const moveX = (moveEvent as TouchEvent).touches
        ? (moveEvent as TouchEvent).touches[0].clientX
        : (moveEvent as MouseEvent).clientX;
      const moveY = (moveEvent as TouchEvent).touches
        ? (moveEvent as TouchEvent).touches[0].clientY
        : (moveEvent as MouseEvent).clientY;
      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() =>
        setPos({ x: moveX - startX, y: moveY - startY }),
      );
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
    direction: number = 1,
  ) => {
    e.stopPropagation();
    const clientX = (e as React.TouchEvent).touches
      ? (e as React.TouchEvent).touches[0].clientX
      : (e as React.MouseEvent).clientX;
    const startX = clientX;
    const startScale = currentScale;
    let frameId: number | null = null;
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      const moveX = (moveEvent as TouchEvent).touches
        ? (moveEvent as TouchEvent).touches[0].clientX
        : (moveEvent as MouseEvent).clientX;
      const delta = direction * (moveX - startX) * 0.005;
      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const baseW = rpsContainerRef.current?.offsetWidth ?? 220;
        const baseH = rpsContainerRef.current?.offsetHeight ?? 260;
        setScale(
          Math.max(
            0.8,
            Math.min(getMaxScale(baseW, baseH), startScale + delta),
          ),
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

// Main Toolbar Component
const HELP_DISMISSED_KEY = "duotopia_help_dismissed";
const TEACHER_MANUAL_URL =
  "https://www.canva.com/design/DAHDIN6lTPU/RZTs5TqZoyJRKob2f1-f6Q/view?utm_content=DAHDIN6lTPU&utm_campaign=designshare&utm_medium=link2&utm_source=uniquelinks&utlId=h10dd0c0854";
const STUDENT_GUIDE_URL =
  "https://www.canva.com/design/DAHDJKkPn6Q/DZqIgDN_g7ZTVwpZbDd6kw/view?utm_content=DAHDJKkPn6Q&utm_campaign=designshare&utm_medium=link2&utm_source=uniquelinks&utlId=h4500142b17";

const DigitalTeachingToolbar: React.FC = () => {
  const { t } = useTranslation();
  const user = useTeacherAuthStore((state) => state.user);
  const [showTimer, setShowTimer] = useState(false);
  const [showDice, setShowDice] = useState(false);
  const [showRps, setShowRps] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toolbarY, setToolbarY] = useState<number | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [helpDismissed, setHelpDismissed] = useState(
    () => localStorage.getItem(HELP_DISMISSED_KEY) === "true",
  );
  const [showHelp, setShowHelp] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(
    () => localStorage.getItem("duotopia-toolbar-collapsed") === "true",
  );
  const zCounterRef = useRef(200);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("duotopia-toolbar-collapsed", String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    if (toolbarY === null) {
      setToolbarY(window.innerHeight / 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!helpDismissed) {
      setShowHelp(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDismissChange = useCallback((checked: boolean) => {
    setHelpDismissed(checked);
    if (checked) {
      localStorage.setItem(HELP_DISMISSED_KEY, "true");
    } else {
      localStorage.removeItem(HELP_DISMISSED_KEY);
    }
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
          const halfH = (toolbarRef.current?.offsetHeight ?? 180) / 2;
          setToolbarY(
            Math.max(
              halfH,
              Math.min(window.innerHeight - halfH, moveY - startOffset),
            ),
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
    setShowTimer((prev) => {
      if (!prev) {
        setShowShareDialog(false);
        setShowHelp(false);
      }
      return !prev;
    });
  }, []);

  const handleToggleDice = useCallback(() => {
    setShowDice((prev) => {
      if (!prev) {
        setShowShareDialog(false);
        setShowHelp(false);
      }
      return !prev;
    });
  }, []);

  const handleToggleRps = useCallback(() => {
    setShowRps((prev) => {
      if (!prev) {
        setShowShareDialog(false);
        setShowHelp(false);
      }
      return !prev;
    });
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

      {/* Help Dialog */}
      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="sm:max-w-md pointer-events-auto">
          <DialogHeader>
            <DialogTitle>{t("teacherToolbar.help.title")}</DialogTitle>
            <DialogDescription>
              {t("teacherToolbar.help.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <a
              href={TEACHER_MANUAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="relative flex flex-col items-center justify-center gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors min-h-[160px]"
            >
              <BookOpen className="h-20 w-20 text-blue-500" />
              <span className="text-sm font-semibold text-gray-800 leading-tight text-center">
                {t("teacherToolbar.help.teacherManual")}
              </span>
              <ExternalLink className="absolute bottom-3 right-3 h-4 w-4 text-blue-400" />
            </a>
            <a
              href={STUDENT_GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="relative flex flex-col items-center justify-center gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors min-h-[160px]"
            >
              <Users className="h-20 w-20 text-blue-500" />
              <span className="text-sm font-semibold text-gray-800 leading-tight text-center">
                {t("teacherToolbar.help.studentGuide")}
              </span>
              <ExternalLink className="absolute bottom-3 right-3 h-4 w-4 text-blue-400" />
            </a>
          </div>
          <div className="flex items-center justify-center gap-2 pt-1">
            <Checkbox
              id="help-dismiss"
              checked={helpDismissed}
              onCheckedChange={(checked) =>
                handleDismissChange(checked as boolean)
              }
            />
            <label
              htmlFor="help-dismiss"
              className="text-sm text-gray-600 cursor-pointer"
            >
              {t("teacherToolbar.help.dontShowAgain")}
            </label>
          </div>
          <Button onClick={() => setShowHelp(false)} className="w-full">
            {t("teacherToolbar.help.start")}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Side toolbar */}
      <div
        ref={toolbarRef}
        className="fixed right-0 flex flex-col gap-1 bg-white/90 backdrop-blur-md shadow-2xl border border-gray-200 border-r-0 rounded-l-xl p-1.5 z-[150] pointer-events-auto transition-transform duration-300"
        style={{
          top: `${toolbarY ?? window.innerHeight / 2}px`,
          transform: `translateY(-50%)${isCollapsed ? " translateX(100%)" : ""}`,
        }}
      >
        {/* Drag handle */}
        <div
          className="flex justify-center py-0.5 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 transition-colors"
          onMouseDown={handleToolbarDrag}
          onTouchStart={handleToolbarDrag}
          title="拖曳上下移動"
        >
          <GripHorizontal size={18} />
        </div>
        <button
          onClick={handleToggleTimer}
          className={`p-2 rounded-lg transition-all duration-300 ${
            showTimer
              ? "bg-blue-500 text-white shadow-md"
              : "hover:bg-gray-100 text-blue-500"
          }`}
          aria-label="Timer"
        >
          <Timer size={24} />
        </button>

        <button
          onClick={handleToggleDice}
          className={`p-2 rounded-lg transition-all duration-300 ${
            showDice
              ? "bg-blue-500 text-white shadow-md"
              : "hover:bg-gray-100 text-blue-500"
          }`}
          aria-label="Dice"
        >
          <Dice5 size={24} />
        </button>

        <button
          onClick={handleToggleRps}
          className={`p-2 rounded-lg transition-all duration-300 ${
            showRps
              ? "bg-blue-500 text-white shadow-md"
              : "hover:bg-gray-100 text-blue-500"
          }`}
          aria-label="Rock Paper Scissors"
        >
          <Hand size={24} />
        </button>

        <div className="mx-1 border-t border-gray-200" />

        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            setShowShareDialog((prev) => {
              if (!prev) {
                setShowTimer(false);
                setShowDice(false);
                setShowRps(false);
                setShowHelp(false);
              }
              return !prev;
            });
          }}
          className={`p-2 rounded-lg transition-all duration-300 ${
            showShareDialog
              ? "bg-blue-500 text-white shadow-md"
              : "hover:bg-gray-100 text-blue-500"
          }`}
          aria-label={t("teacherDashboard.share.button")}
        >
          <Share2 size={24} />
        </button>

        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            setShowHelp((prev) => {
              if (!prev) {
                setShowShareDialog(false);
                setShowTimer(false);
                setShowDice(false);
                setShowRps(false);
              }
              return !prev;
            });
          }}
          className={`p-2 rounded-lg transition-all duration-300 ${
            showHelp
              ? "bg-red-500 text-white shadow-md"
              : helpDismissed
                ? "hover:bg-gray-100 text-blue-500"
                : "hover:bg-red-50 text-red-500"
          }`}
          aria-label="Help"
        >
          <HelpCircle size={24} />
        </button>

        <div className="mx-1 border-t border-gray-200" />
        <button
          onClick={toggleCollapse}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-all duration-300"
          aria-label="Collapse toolbar"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Expand tab (visible only when collapsed) */}
      {isCollapsed && (
        <button
          className="fixed right-0 z-[150] pointer-events-auto bg-white/90 backdrop-blur-md shadow-lg border border-gray-200 border-r-0 rounded-l-lg px-1 py-3 hover:bg-blue-50 text-blue-500 transition-all duration-300"
          style={{
            top: `${toolbarY ?? window.innerHeight / 2}px`,
            transform: "translateY(-50%)",
          }}
          onClick={toggleCollapse}
          aria-label="Expand toolbar"
        >
          <ChevronLeft size={18} />
        </button>
      )}

      {/* Tools */}
      <div className="pointer-events-auto">
        <TimerTool
          show={showTimer}
          onClose={() => setShowTimer(false)}
          zCounterRef={zCounterRef}
        />
      </div>
      <div className="pointer-events-auto">
        <DiceTool
          show={showDice}
          onClose={() => setShowDice(false)}
          zCounterRef={zCounterRef}
        />
      </div>
      <div className="pointer-events-auto">
        <RpsTool
          show={showRps}
          onClose={() => setShowRps(false)}
          zCounterRef={zCounterRef}
        />
      </div>
    </div>
  );
};

export default DigitalTeachingToolbar;
