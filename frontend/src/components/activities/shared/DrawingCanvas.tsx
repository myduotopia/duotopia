/**
 * DrawingCanvas - 手繪作畫區（共用元件）
 *
 * 供學生在數位裝置上用手指或觸控筆繪製答案的白板。
 * 純繪圖，無辨識功能，目前用於：
 * - 單字拼寫（WordSpellingSample）— showDrawingArea=true 時顯示
 *
 * === 行為 ===
 * 1. 使用者在 canvas 上繪製（PointerEvent）
 * 2. 清除按鈕 → canvas 清除
 */

import { useRef, useState, useCallback, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DrawingCanvasProps {
  isDisabled?: boolean;
  viewMode: "mobile" | "desktop";
}

export function DrawingCanvas({
  isDisabled = false,
  viewMode,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(400);

  // Track container width with ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setCanvasWidth(Math.round(w));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  const getCtx = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.strokeStyle = "#1e40af";
    ctx.lineWidth = (viewMode === "mobile" ? 2.5 : 3) * dpr;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    return ctx;
  };

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (isDisabled) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      isDrawingRef.current = true;

      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * dpr;
      const y = (e.clientY - rect.top) * dpr;

      const ctx = getCtx();
      ctx?.beginPath();
      ctx?.moveTo(x, y);
    },
    [isDisabled, dpr],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current || isDisabled) return;

      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * dpr;
      const y = (e.clientY - rect.top) * dpr;

      const ctx = getCtx();
      ctx?.lineTo(x, y);
      ctx?.stroke();
    },
    [isDisabled, dpr],
  );

  const handlePointerUp = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    setHasStrokes(true);
  }, []);

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
    isDrawingRef.current = false;
  }, []);

  const canvasHeight = viewMode === "mobile" ? 140 : 180;

  return (
    <div className="mt-4 select-none">
      <div className="relative" ref={containerRef}>
        <canvas
          ref={canvasRef}
          width={canvasWidth * dpr}
          height={canvasHeight * dpr}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className={cn(
            "w-full rounded-xl border-2 bg-white touch-none",
            isDisabled
              ? "border-gray-200 cursor-not-allowed opacity-50"
              : "border-blue-200 cursor-crosshair",
          )}
          style={{ width: canvasWidth, height: canvasHeight }}
        />
        {!hasStrokes && !isDisabled && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-gray-300">在此書寫單字</p>
          </div>
        )}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          onClick={handleClear}
          disabled={isDisabled || !hasStrokes}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            isDisabled || !hasStrokes
              ? "text-gray-300 cursor-not-allowed"
              : "text-gray-500 hover:bg-gray-100 hover:text-red-500",
          )}
          aria-label="清除畫布"
        >
          <Trash2 className="h-3.5 w-3.5" />
          清除
        </button>
      </div>
    </div>
  );
}
