/**
 * 手機橫放擋作答（#1158 E-3，只限情境對話；其他作業類型併入 #1166）。
 *
 * - `usePhoneLandscape()`：畫面橫的（orientation: landscape）且視窗高度 ≤ 500px 才算「手機橫放」；
 *   平板橫放、電腦不算。跟著 matchMedia 變化即時更新。
 * - `PhoneLandscapeOverlay`：整頁蓋一層深色半透明提示（旋轉手機圖示＋「請把手機轉回直立再作答」
 *   ＋錄音會作廢的小字）。只是蓋住，不卸載底下的對話，轉回直立後提示消失、進度都還在。
 *   錄音中轉橫時丟掉錄音、停止朗讀，由 ScenarioChatActivity／ReplyComposer 處理。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const PHONE_LANDSCAPE_QUERY =
  "(orientation: landscape) and (max-height: 500px)";

function matches(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(PHONE_LANDSCAPE_QUERY).matches;
}

/** 手機橫放（橫的且高度很矮）時為 true */
export function usePhoneLandscape(): boolean {
  const [landscape, setLandscape] = useState(matches);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(PHONE_LANDSCAPE_QUERY);
    const update = () => setLandscape(mql.matches);
    update();
    // Safari < 14 只有 addListener
    if (mql.addEventListener) {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }
    mql.addListener(update);
    return () => mql.removeListener(update);
  }, []);
  return landscape;
}

export function PhoneLandscapeOverlay() {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-gray-900/85 px-8 text-center text-white"
      role="alert"
      data-testid="scenario-landscape-overlay"
    >
      <svg
        width="56"
        height="56"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M11 18h2" />
        <path d="M3 9a6 6 0 0 1 3-4" />
        <path d="M3 5v4h4" />
      </svg>
      <p className="text-lg font-bold">
        {t("scenarioDialogue.chat.landscapeTitle")}
      </p>
      <p className="max-w-sm text-sm leading-relaxed text-gray-300">
        {t("scenarioDialogue.chat.landscapeHint")}
      </p>
    </div>
  );
}
