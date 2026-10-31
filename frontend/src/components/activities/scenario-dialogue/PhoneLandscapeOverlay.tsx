/**
 * 手機橫放擋作答（#1158 E-3，只限情境對話；其他作業類型併入 #1166）。
 *
 * - `usePhoneLandscape()`：以「螢幕」判斷，不看視窗大小（修正 E3）——
 *   螢幕方向是橫的（`screen.orientation.type` 以 landscape 開頭；沒有這個 API 時退回
 *   `window.orientation`，再退回 matchMedia orientation）且螢幕短邊 ≤ 500px 才算「手機橫放」。
 *   平板、電腦（螢幕短邊大）不算，桌機把視窗拉成矮寬也不擋。
 *   不用視窗高度，是因為 LINE／FB 內建瀏覽器、Firefox Android 跳出鍵盤會把視窗壓矮，
 *   直立也會被誤判成橫的；另外輸入框有焦點（正在打字）時一律不判橫放，多一層保險。
 *   跟著方向改變、視窗大小改變、焦點進出即時更新。
 * - `PhoneLandscapeOverlay`：整頁蓋一層深色半透明提示（旋轉手機圖示＋「請把手機轉回直立再作答」）。
 *   `showRecordingHint` 為真（語音作答且正在作答）才多一行「錄音中轉成橫的…會作廢」小字。
 *   只是蓋住，不卸載底下的對話，轉回直立後提示消失、進度都還在。老師預覽一樣擋。
 *   錄音中轉橫時丟掉錄音、停止朗讀、暫停出題，由 ScenarioChatActivity／ReplyComposer／
 *   useScenarioChat 處理。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** 螢幕短邊不超過這個（px）才算手機 */
export const PHONE_MAX_SHORT_SIDE = 500;

const LANDSCAPE_QUERY = "(orientation: landscape)";

function isLandscapeOrientation(): boolean {
  const type = window.screen?.orientation?.type;
  if (typeof type === "string") return type.startsWith("landscape");
  const legacy = (window as { orientation?: unknown }).orientation;
  if (typeof legacy === "number") return Math.abs(legacy) === 90;
  if (!window.matchMedia) return false;
  return window.matchMedia(LANDSCAPE_QUERY).matches;
}

function isPhoneSizedScreen(): boolean {
  const s = window.screen;
  if (!s || !(s.width > 0) || !(s.height > 0)) return false;
  return Math.min(s.width, s.height) <= PHONE_MAX_SHORT_SIDE;
}

function isTextInputFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["button", "checkbox", "radio", "range", "submit", "file"].includes(
    type,
  );
}

/** 現在是不是「手機橫放」（螢幕橫的、螢幕短邊 ≤ 500px、沒有在打字） */
export function detectPhoneLandscape(): boolean {
  if (typeof window === "undefined") return false;
  return (
    isPhoneSizedScreen() && isLandscapeOrientation() && !isTextInputFocused()
  );
}

/** 手機橫放時為 true */
export function usePhoneLandscape(): boolean {
  const [landscape, setLandscape] = useState(detectPhoneLandscape);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setLandscape(detectPhoneLandscape());
    update();
    const orientation = window.screen?.orientation;
    orientation?.addEventListener?.("change", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    const mql = window.matchMedia?.(LANDSCAPE_QUERY);
    // Safari < 14 只有 addListener
    if (mql?.addEventListener) mql.addEventListener("change", update);
    else mql?.addListener?.(update);
    return () => {
      orientation?.removeEventListener?.("change", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      if (mql?.removeEventListener) mql.removeEventListener("change", update);
      else mql?.removeListener?.(update);
    };
  }, []);
  return landscape;
}

export function PhoneLandscapeOverlay({
  showRecordingHint = false,
}: {
  /** 語音作答且正在作答時才顯示「錄音中轉橫會作廢」小字 */
  showRecordingHint?: boolean;
}) {
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
      {showRecordingHint && (
        <p className="max-w-sm text-sm leading-relaxed text-gray-300">
          {t("scenarioDialogue.chat.landscapeHint")}
        </p>
      )}
    </div>
  );
}
