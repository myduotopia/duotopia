/**
 * HandwritingCanvas - 手寫輸入元件（共用）
 *
 * 使用 Chrome Handwriting Recognition API（實驗性）辨識手寫英文單字。
 * 供以下活動使用：
 * - 單字拼寫（WordSpellingSample）— inputMethod="handwriting"
 * - 單字克漏字（WordClozeSample）— inputMethod="handwriting"
 *
 * === 行為 ===
 * 1. Mount 時 feature-detect；不支援則顯示提示訊息
 * 2. 使用者在 canvas 上書寫（PointerEvent）
 * 3. 最後一筆放開後 1500ms，自動呼叫 getPrediction()
 * 4. 辨識完成 → 呼叫 onResult(text)，canvas 自動清除
 * 5. 清除按鈕 → canvas 清除 + 呼叫 onClear()
 *
 * === 注意 ===
 * - 需 Chrome 並開啟 chrome://flags/#handwriting-recognition-web-platform-api
 * - 整詞辨識（非逐字），辨識結果整個傳給父層
 * - 不含答題業務邏輯，答案比對由父層處理
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface HandwritingCanvasProps {
  /** 辨識完成，回傳辨識文字（整個單字） */
  onResult: (word: string) => void;
  /** 使用者按清除，父層同步清空 slots */
  onClear: () => void;
  isDisabled: boolean;
  viewMode: "mobile" | "desktop";
}

export function HandwritingCanvas({
  onResult,
  onClear,
  isDisabled,
  viewMode,
}: HandwritingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const recognizerRef = useRef<HandwritingRecognizer | null>(null);
  const drawingRef = useRef<HandwritingDrawing | null>(null);
  const currentStrokeRef = useRef<HandwritingStroke | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isSupported, setIsSupported] = useState<boolean | null>(null); // null = 偵測中
  const [isRecognizing, setIsRecognizing] = useState(false);
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

  // ── 初始化：feature detect + 建立 recognizer ──────────────────────────
  useEffect(() => {
    const supported = "createHandwritingRecognizer" in navigator;
    setIsSupported(supported);
    if (!supported) return;

    let mounted = true;
    navigator
      .createHandwritingRecognizer({ languages: ["en"] })
      .then((rec) => {
        if (!mounted) {
          rec.finish();
          return;
        }
        recognizerRef.current = rec;
        drawingRef.current = rec.startDrawing({ recognitionType: "text" });
      })
      .catch(() => {
        if (mounted) setIsSupported(false);
      });

    return () => {
      mounted = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      recognizerRef.current?.finish();
    };
  }, []);

  // ── Canvas 繪圖工具 ────────────────────────────────────────────────────
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

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  // ── 觸發辨識（debounce 後呼叫）────────────────────────────────────────
  const triggerRecognition = useCallback(async () => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    setIsRecognizing(true);
    try {
      const predictions = await drawing.getPrediction();
      if (predictions.length > 0 && predictions[0].text.trim()) {
        onResult(predictions[0].text.trim());
      }
    } catch {
      // 辨識失敗時靜默處理，不影響使用者
    } finally {
      // 辨識後清除 canvas 與 drawing，讓使用者可重寫
      drawing.clear();
      clearCanvas();
      setHasStrokes(false);
      setIsRecognizing(false);
    }
  }, [onResult, clearCanvas]);

  // ── Pointer Events ─────────────────────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (isDisabled || !drawingRef.current || !isSupported) return;
      if (typeof HandwritingStroke === "undefined") return;
      e.currentTarget.setPointerCapture(e.pointerId);

      // 取消待執行的辨識
      if (timerRef.current) clearTimeout(timerRef.current);

      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;

      // 新筆畫 — HandwritingStroke uses CSS coordinates
      const stroke = new HandwritingStroke();
      stroke.addPoint({ x: cssX, y: cssY, t: e.timeStamp });
      currentStrokeRef.current = stroke;

      // 開始畫線 — canvas uses DPR-scaled coordinates
      const ctx = getCtx();
      ctx?.beginPath();
      ctx?.moveTo(cssX * dpr, cssY * dpr);
    },
    [isDisabled, isSupported, dpr],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!currentStrokeRef.current || isDisabled) return;

      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;

      currentStrokeRef.current.addPoint({ x: cssX, y: cssY, t: e.timeStamp });

      const ctx = getCtx();
      ctx?.lineTo(cssX * dpr, cssY * dpr);
      ctx?.stroke();
    },
    [isDisabled, dpr],
  );

  const handlePointerUp = useCallback(() => {
    const stroke = currentStrokeRef.current;
    if (!stroke || !drawingRef.current) return;

    drawingRef.current.addStroke(stroke);
    currentStrokeRef.current = null;
    setHasStrokes(true);

    // 1500ms 後自動辨識
    timerRef.current = setTimeout(triggerRecognition, 1500);
  }, [triggerRecognition]);

  // ── 清除 ──────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    drawingRef.current?.clear();
    clearCanvas();
    setHasStrokes(false);
    currentStrokeRef.current = null;
    onClear();
  }, [clearCanvas, onClear]);

  // ── Canvas 尺寸（配合 devicePixelRatio 避免模糊）──────────────────────
  const canvasHeight = viewMode === "mobile" ? 140 : 180;

  // ── 不支援時顯示提示 ──────────────────────────────────────────────────
  if (isSupported === false) {
    return (
      <div
        className="mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500"
        style={{ minHeight: canvasHeight }}
      >
        <p className="font-medium text-gray-600">此瀏覽器不支援手寫辨識</p>
        <p className="text-xs">
          需使用 Chrome 並至{" "}
          <code className="rounded bg-gray-100 px-1 text-xs">
            chrome://flags/#handwriting-recognition-web-platform-api
          </code>{" "}
          開啟實驗性功能
        </p>
      </div>
    );
  }

  // ── 偵測中 ────────────────────────────────────────────────────────────
  if (isSupported === null) {
    return (
      <div
        className="mt-4 rounded-xl border-2 border-gray-200 bg-gray-50 animate-pulse"
        style={{ height: canvasHeight }}
      />
    );
  }

  // ── 手寫 Canvas ────────────────────────────────────────────────────────
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

        {/* 辨識中遮罩 */}
        {isRecognizing && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/80">
            <p className="text-sm font-medium text-blue-600 animate-pulse">
              辨識中...
            </p>
          </div>
        )}

        {/* 提示文字（還沒畫時顯示） */}
        {!hasStrokes && !isRecognizing && !isDisabled && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-gray-300">在此書寫單字</p>
          </div>
        )}
      </div>

      {/* 清除按鈕 */}
      <div className="mt-2 flex justify-end">
        <button
          onClick={handleClear}
          disabled={isDisabled || (!hasStrokes && !isRecognizing)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            isDisabled || (!hasStrokes && !isRecognizing)
              ? "text-gray-300 cursor-not-allowed"
              : "text-gray-500 hover:bg-gray-100 hover:text-red-500",
          )}
          aria-label="清除手寫內容"
        >
          <Trash2 className="h-3.5 w-3.5" />
          清除
        </button>
      </div>
    </div>
  );
}
