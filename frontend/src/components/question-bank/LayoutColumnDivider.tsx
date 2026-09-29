/**
 * 並排雙欄之間的欄寬分隔線（Issue #1082 編輯器修訂二）。
 *
 * 放在雙欄列「第一欄」裡（第一欄要 `relative`），以 `absolute -right-3 w-3` 剛好蓋住
 * grid 的 `gap-3`（12px）。平常只有 hover 才看得到一條細線；按住拖動時，依指標在整列
 * 寬度的位置吸附到左欄 1/3、1/2、2/3 三個位置（`SplitPosition`），值有變才呼叫 onChange。
 *
 * 不是 dnd-kit 的 draggable：dnd-kit 只從區塊的拖曳把手啟動，這裡用原生 pointer events
 * 並 `stopPropagation`，兩者互不干擾。鍵盤：Tab 到分隔線後用 ← → 切換位置。
 * 小於 md 寬度時欄位會上下堆疊，分隔線隱藏。
 */

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { SplitPosition } from "./layoutEditorModel";

export interface LayoutColumnDividerProps {
  position: SplitPosition;
  onChange: (pos: SplitPosition) => void;
  /** 整列（grid 容器）的 ref，用來換算指標位置 → 分割位置 */
  rowRef: React.RefObject<HTMLDivElement>;
  testId: string;
}

/** 指標在列內的相對位置 → 最近的分割位置（分界在 1/3 與 1/2、1/2 與 2/3 的中點） */
export function splitFromFraction(frac: number): SplitPosition {
  if (frac < 5 / 12) return 1;
  if (frac < 7 / 12) return 2;
  return 3;
}

export default function LayoutColumnDivider({
  position,
  onChange,
  rowRef,
  testId,
}: LayoutColumnDividerProps) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const last = useRef<SplitPosition>(position);

  const emit = (pos: SplitPosition) => {
    if (pos === last.current) return;
    last.current = pos;
    onChange(pos);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = position;
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const frac = Math.min(
      1,
      Math.max(0, (e.clientX - rect.left) / rect.width),
    );
    emit(splitFromFraction(frac));
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    let next: SplitPosition | null = null;
    if (e.key === "ArrowLeft") next = Math.max(1, position - 1) as SplitPosition;
    else if (e.key === "ArrowRight")
      next = Math.min(3, position + 1) as SplitPosition;
    else if (e.key === "Home") next = 1;
    else if (e.key === "End") next = 3;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    last.current = position;
    emit(next);
  };

  const label = t("questionBank.group.layout.resizeColumns");
  return (
    <button
      type="button"
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={1}
      aria-valuemax={3}
      aria-valuenow={position}
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        "group/divider absolute inset-y-0 -right-3 z-10 hidden w-3 cursor-col-resize touch-none items-stretch justify-center md:flex",
        "focus:outline-none",
      )}
      data-testid={testId}
      data-dragging={dragging || undefined}
    >
      <span
        aria-hidden
        className={cn(
          "my-1 w-px rounded-full transition-colors",
          dragging
            ? "w-0.5 bg-blue-500"
            : "bg-transparent group-hover/row:bg-gray-300 group-hover/divider:bg-blue-400 group-focus-visible/divider:bg-blue-500",
        )}
      />
    </button>
  );
}
