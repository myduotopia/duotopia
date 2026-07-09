import React from "react";

/**
 * Shared drag logic for the draggable teaching tools.
 *
 * The returned handler is identical to each tool's original `startDrag`
 * except the ignore guard: it always ignores `button` and `.resize-handle`,
 * plus any selector passed in `extraIgnoreSelectors` (Timer adds
 * `.settings-panel`, Dice adds `.dice-clickable`, RPS adds none).
 */
export function useDraggable(extraIgnoreSelectors: string[] = []) {
  return (
    e: React.MouseEvent | React.TouchEvent,
    setPos: (pos: { x: number; y: number }) => void,
    currentPos: { x: number; y: number },
  ) => {
    const el = e.target as HTMLElement;
    if (
      el.closest("button") ||
      el.closest(".resize-handle") ||
      extraIgnoreSelectors.some((sel) => el.closest(sel))
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
}
