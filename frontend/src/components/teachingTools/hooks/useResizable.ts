import React from "react";

/** Compute max scale so the tool can fill up to 95% of the viewport */
export const getMaxScale = (baseW: number, baseH: number): number => {
  const maxScaleX = (window.innerWidth * 0.95) / baseW;
  const maxScaleY = (window.innerHeight * 0.95) / baseH;
  return Math.min(maxScaleX, maxScaleY);
};

/**
 * Shared resize logic for the draggable teaching tools.
 *
 * The returned handler is identical to each tool's original `startResize`
 * except the base dimensions fall back to `fallbackW`/`fallbackH` when the
 * container ref isn't measurable, and the minimum scale is parameterized
 * (Timer uses 0.5, Dice/RPS use 0.8).
 */
export function useResizable(
  containerRef: React.RefObject<HTMLElement>,
  fallbackW: number,
  fallbackH: number,
  minScale: number,
) {
  return (
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
        const baseW = containerRef.current?.offsetWidth ?? fallbackW;
        const baseH = containerRef.current?.offsetHeight ?? fallbackH;
        setScale(
          Math.max(
            minScale,
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
}
