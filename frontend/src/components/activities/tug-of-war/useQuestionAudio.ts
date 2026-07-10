/**
 * useQuestionAudio — 拔河音檔播放（issue #920）
 *
 * 從舊 QuestionDisplay 上提的音檔邏輯，改為集中管理：只此一份 audio element，
 * 由場景中央的懸掛看板統一驅動（避免兩隊各一份題目帶造成重複播放）。
 * 音檔題自動循環播放（間隔 1.5s），克漏字念整句例句；有 URL 用 <audio>，
 * 否則 fallback 用 SpeechSynthesis。
 */

import { useRef, useCallback, useEffect, useState } from "react";
import type { Question } from "./types";

interface UseQuestionAudioOptions {
  /** 是否啟用自動循環（題目顯示中、未靜音、該題有音檔）。 */
  enabled: boolean;
  /** 靜音。 */
  muted: boolean;
}

export function useQuestionAudio(
  question: Question | null,
  { enabled, muted }: UseQuestionAudioOptions,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const isPlayingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const stopLoop = useCallback(() => {
    if (loopTimerRef.current) {
      clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    speechSynthesis.cancel();
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  const playOnce = useCallback(() => {
    if (!question) return undefined;
    const isCloze = question.hasCloze;
    const url = isCloze
      ? question.vocabItem.example_sentence_audio_url
      : question.vocabItem.audio_url;
    const ttsText = isCloze
      ? question.vocabItem.example_sentence || ""
      : question.vocabItem.text;

    if (!url) {
      const utterance = new SpeechSynthesisUtterance(ttsText);
      utterance.lang = "en-US";
      utterance.rate = 0.9;
      speechSynthesis.speak(utterance);
      return utterance;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(() => {
      const utterance = new SpeechSynthesisUtterance(ttsText);
      utterance.lang = "en-US";
      utterance.rate = 0.9;
      speechSynthesis.speak(utterance);
    });
    return audio;
  }, [question]);

  const startLoop = useCallback(() => {
    if (!isMountedRef.current) return;
    stopLoop();
    isPlayingRef.current = true;
    setIsPlaying(true);

    const playAndSchedule = () => {
      if (!isMountedRef.current || !isPlayingRef.current) return;
      const result = playOnce();

      const scheduleNext = () => {
        if (!isMountedRef.current || !isPlayingRef.current) return;
        loopTimerRef.current = setTimeout(playAndSchedule, 1500);
      };

      if (result instanceof HTMLAudioElement) {
        result.addEventListener("ended", scheduleNext, { once: true });
        result.addEventListener("error", scheduleNext, { once: true });
      } else if (result instanceof SpeechSynthesisUtterance) {
        result.addEventListener("end", scheduleNext, { once: true });
      }
    };

    playAndSchedule();
  }, [playOnce, stopLoop]);

  // Auto-play loop while enabled and not muted
  useEffect(() => {
    isMountedRef.current = true;
    if (enabled && !muted) {
      startLoop();
    } else {
      stopLoop();
    }
    return () => {
      isMountedRef.current = false;
      stopLoop();
      speechSynthesis.cancel();
    };
    // question.vocabItem.id ensures re-loop on question change
  }, [question?.vocabItem.id, enabled, muted, startLoop, stopLoop]);

  /** 手動立即重播一次（懸掛看板點擊）。 */
  const replay = useCallback(() => {
    if (muted) return;
    playOnce();
  }, [muted, playOnce]);

  return { isPlaying, replay };
}
