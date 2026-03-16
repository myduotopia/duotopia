/**
 * ScoreOverlay - 共用分數動畫 overlay 元件
 *
 * 答對：星級動畫 + 鼓勵語 + confetti（高分）→ 動畫結束自動 fade out → onComplete
 * 答錯：sad 動畫 + 鼓勵語 → 自動 fade out 或點擊 → onComplete
 *
 * 不包含題目跳轉邏輯，由父組件透過 onComplete 處理。
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import Lottie from "lottie-react";

// Lottie 星級動畫路徑（放在 public/lottie/ 下）
const SCORE_ANIMATION_URLS: Record<string, string> = {
  awesome: "/lottie/Star rating - Awesome.json",
  good: "/lottie/Star rating - good.json",
  okay: "/lottie/Star rating - Okay.json",
  bad: "/lottie/Star rating - Bad.json",
  confetti: "/lottie/confetti.json",
};

// Module-level 快取：所有 ScoreOverlay instance 共用，只 fetch 一次。
// 注意：這些變數不會在 HMR 時重置（module 不會被重新載入），
// 這是刻意的設計——避免每次 hot reload 都重新 fetch Lottie JSON。
let cachedAnimations: Record<string, object> | null = null;
let loadingPromise: Promise<Record<string, object>> | null = null;

function loadLottieAnimations(): Promise<Record<string, object>> {
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

export interface ScoreOverlayProps {
  /** 是否顯示 overlay */
  open: boolean;
  /** 分數（0-100） */
  score: number;
  /** 是否為錯誤（挑戰失敗） */
  isError: boolean;
  /** 是否顯示正確答案（錯誤時） */
  showAnswer?: boolean;
  /** 正確答案文字（錯誤時顯示） */
  answerText?: string;
  /** overlay 結束後的 callback（fade out 完成後觸發） */
  onComplete: () => void;
}

/** 根據分數取得鼓勵語 i18n key */
function getEncouragementKey(score: number, isError: boolean): string {
  if (isError) return "scoreOverlay.encouragement.error";
  if (score >= 90) return "scoreOverlay.encouragement.awesome";
  if (score >= 80) return "scoreOverlay.encouragement.good";
  if (score >= 60) return "scoreOverlay.encouragement.okay";
  return "scoreOverlay.encouragement.bad";
}

/** 根據分數取得動畫 key */
function getAnimationKey(score: number, isError: boolean): string {
  if (isError) return "bad";
  if (score >= 90) return "awesome";
  if (score >= 80) return "good";
  if (score >= 60) return "okay";
  return "bad";
}

const ScoreOverlay: React.FC<ScoreOverlayProps> = ({
  open,
  score,
  isError,
  showAnswer = false,
  answerText,
  onComplete,
}) => {
  const { t } = useTranslation();
  const [lottieAnimations, setLottieAnimations] = useState<
    Record<string, object>
  >(cachedAnimations ?? {});
  const [fading, setFading] = useState(false);
  const fadingRef = useRef(false);
  const completeCalledRef = useRef(false);

  // 從 module-level 快取載入（已載入過就同步取得）
  useEffect(() => {
    let cancelled = false;
    loadLottieAnimations().then((result) => {
      if (!cancelled) setLottieAnimations(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 重置 fade 狀態
  useEffect(() => {
    if (open) {
      setFading(false);
      fadingRef.current = false;
      completeCalledRef.current = false;
    }
  }, [open]);

  // fade out 完成後觸發 onComplete
  useEffect(() => {
    if (!fading) return;
    const timer = setTimeout(() => {
      setFading(false);
      fadingRef.current = false;
      if (!completeCalledRef.current) {
        completeCalledRef.current = true;
        onComplete();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [fading, onComplete]);

  const startFadeOut = useCallback(() => {
    if (fadingRef.current) return;
    fadingRef.current = true;
    setFading(true);
  }, []);

  if (!open) return null;

  const animKey = getAnimationKey(score, isError);
  const animData = lottieAnimations[animKey];
  const confettiData = lottieAnimations["confetti"];
  const showConfetti = !isError && score >= 80 && confettiData;
  const encouragementKey = getEncouragementKey(score, isError);

  // 錯誤 + 顯示答案：動畫結束後不自動關閉，等待點擊
  const errorWithAnswer = isError && showAnswer && answerText;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-500",
        fading ? "opacity-0" : "opacity-100",
      )}
      onClick={errorWithAnswer ? startFadeOut : undefined}
    >
      {/* 背景漸層 */}
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-b",
          isError
            ? "from-gray-500/20 via-gray-400/10 to-transparent"
            : "from-indigo-400/15 via-purple-300/10 to-transparent",
        )}
      />

      {/* Confetti 背景層（高分才撒花） */}
      {showConfetti && (
        <Lottie
          animationData={confettiData}
          loop={false}
          className="absolute inset-0 pointer-events-none"
          style={{ width: "100%", height: "100%" }}
        />
      )}

      {/* 中間：動畫 + 鼓勵語 */}
      <div className="relative flex flex-col items-center gap-3">
        {animData ? (
          <Lottie
            animationData={animData}
            loop={false}
            style={{ width: isError ? 180 : 200, height: isError ? 180 : 200 }}
            onComplete={errorWithAnswer ? undefined : startFadeOut}
          />
        ) : isError ? (
          <XCircle className="h-20 w-20 text-red-600" />
        ) : (
          <CheckCircle className="h-20 w-20 text-green-600" />
        )}

        <p
          className={cn(
            "text-center font-bold drop-shadow-lg",
            isError
              ? "text-2xl text-gray-500"
              : score >= 90
                ? "text-5xl text-amber-500"
                : score >= 80
                  ? "text-4xl text-yellow-600"
                  : "text-3xl text-gray-600",
          )}
        >
          {t(encouragementKey)}
        </p>

        {/* 錯誤時顯示正確答案 */}
        {errorWithAnswer && (
          <div className="mt-2 p-4 bg-white/90 rounded-lg border border-gray-200 shadow-lg max-w-md">
            <p className="text-sm text-gray-500 mb-1">
              {t("rearrangement.correctAnswer")}
            </p>
            <p className="text-lg font-medium text-gray-800">{answerText}</p>
            <p className="text-xs text-gray-400 mt-2 text-center">
              {t("scoreOverlay.tapToRetry")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScoreOverlay;
