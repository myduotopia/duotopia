import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { X, GripHorizontal, Triangle, Play, Square } from "lucide-react";
import { useDraggable } from "./hooks/useDraggable";
import { useResizable } from "./hooks/useResizable";
import type { ToolProps } from "./types";

// Timer Component
const TimerTool: React.FC<ToolProps> = ({ show, onClose, zCounterRef }) => {
  const [isActive, setIsActive] = useState(false);
  const [isBeeping, setIsBeeping] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timerScale, setTimerScale] = useState(1);
  const [timerPos, setTimerPos] = useState({ x: 40, y: 80 });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasInitializedTimerPos = useRef(false);

  const startDrag = useDraggable([".settings-panel"]);
  const startResize = useResizable(containerRef, 280, 320, 0.5);

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
      audioRef.current.play().catch(() => {});
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

export default TimerTool;
