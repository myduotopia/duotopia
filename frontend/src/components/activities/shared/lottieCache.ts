/**
 * Lottie 動畫 module-level 快取
 *
 * 共用於 ScoreOverlay 和 PronunciationScoreChart，
 * 所有 instance 只 fetch 一次。
 */

export const SCORE_ANIMATION_URLS: Record<string, string> = {
  awesome: "/lottie/Star rating - Awesome.json",
  good: "/lottie/Star rating - good.json",
  okay: "/lottie/Star rating - Okay.json",
  bad: "/lottie/Star rating - Bad.json",
  confetti: "/lottie/confetti.json",
};

let cachedAnimations: Record<string, object> | null = null;
let loadingPromise: Promise<Record<string, object>> | null = null;

export function getCachedAnimations(): Record<string, object> | null {
  return cachedAnimations;
}

export function loadLottieAnimations(): Promise<Record<string, object>> {
  if (cachedAnimations) return Promise.resolve(cachedAnimations);
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const entries = Object.entries(SCORE_ANIMATION_URLS);
    const results: Record<string, object> = {};
    await Promise.all(
      entries.map(async ([key, url]) => {
        try {
          const res = await fetch(url);
          if (res.ok) results[key] = await res.json();
        } catch {
          // 靜默失敗
        }
      }),
    );
    cachedAnimations = results;
    return results;
  })();
  return loadingPromise;
}
