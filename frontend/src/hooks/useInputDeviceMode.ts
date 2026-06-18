/**
 * useInputDeviceMode - distinguish desktop / mobile / tablet for input UX.
 *
 * Touch devices (phones, tablets) get a custom on-screen virtual keyboard
 * because the system keyboard's suggestion bar lets students "cheat" on
 * spelling/cloze activities. Desktops keep the native keyboard.
 *
 * Detection strategy (avoids UA sniffing):
 *   isDesktop = (any-pointer: fine)  — has a mouse / trackpad → physical
 *               keyboard is available, so never force the virtual keyboard.
 *               (#867: touchscreen Windows laptops/PCs were wrongly forced
 *               into the VK because they also report a coarse pointer.)
 *   isTouch   = (pointer: coarse) AND maxTouchPoints > 0
 *   isTablet  = viewport width >= 1024px
 *
 * Reactively updates on resize / pointer change so iPad rotation between
 * portrait (mobile-ish) and landscape (tablet) switches modes correctly,
 * and so plugging/unplugging a mouse re-evaluates desktop vs touch.
 */

import { useEffect, useState } from "react";

export type InputDeviceMode = "desktop" | "mobile" | "tablet";

const TABLET_BREAKPOINT = 1024;

function detect(): InputDeviceMode {
  if (typeof window === "undefined") return "desktop";
  // #867: a fine pointer (mouse / trackpad) means the student can use a
  // physical keyboard → treat as desktop and never force the virtual keyboard.
  if (window.matchMedia("(any-pointer: fine)").matches) return "desktop";
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
    const finePointerMq = window.matchMedia("(any-pointer: fine)");
    const widthMq = window.matchMedia(`(min-width: ${TABLET_BREAKPOINT}px)`);
    pointerMq.addEventListener("change", update);
    finePointerMq.addEventListener("change", update);
    widthMq.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      pointerMq.removeEventListener("change", update);
      finePointerMq.removeEventListener("change", update);
      widthMq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return mode;
}
