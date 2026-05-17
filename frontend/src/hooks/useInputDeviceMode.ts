/**
 * useInputDeviceMode - distinguish desktop / mobile / tablet for input UX.
 *
 * Touch devices (phones, tablets) get a custom on-screen virtual keyboard
 * because the system keyboard's suggestion bar lets students "cheat" on
 * spelling/cloze activities. Desktops keep the native keyboard.
 *
 * Detection strategy (avoids UA sniffing):
 *   isTouch  = (pointer: coarse) AND maxTouchPoints > 0
 *   isTablet = viewport width >= 1024px
 *
 * Reactively updates on resize / pointer change so iPad rotation between
 * portrait (mobile-ish) and landscape (tablet) switches modes correctly.
 */

import { useEffect, useState } from "react";

export type InputDeviceMode = "desktop" | "mobile" | "tablet";

const TABLET_BREAKPOINT = 1024;

function detect(): InputDeviceMode {
  if (typeof window === "undefined") return "desktop";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const touchPoints = navigator.maxTouchPoints ?? 0;
  const isTouch = coarse && touchPoints > 0;
  if (!isTouch) return "desktop";
  return window.innerWidth >= TABLET_BREAKPOINT ? "tablet" : "mobile";
}

export function useInputDeviceMode(): InputDeviceMode {
  const [mode, setMode] = useState<InputDeviceMode>(detect);

  useEffect(() => {
    const update = () => setMode(detect());
    const pointerMq = window.matchMedia("(pointer: coarse)");
    const widthMq = window.matchMedia(`(min-width: ${TABLET_BREAKPOINT}px)`);
    pointerMq.addEventListener("change", update);
    widthMq.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      pointerMq.removeEventListener("change", update);
      widthMq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return mode;
}
