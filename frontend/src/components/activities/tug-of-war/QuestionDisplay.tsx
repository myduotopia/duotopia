/**
 * QuestionDisplay - 題目顯示區
 *
 * 顯示在各隊選項上方。根據題型顯示文字或音檔播放按鈕。
 * 音檔模式：自動重複播放，間隔 1 秒。點擊可手動觸發。
 */

import { useRef, useCallback, useEffect, useState } from "react";
import { Volume2, VolumeOff } from "lucide-react";
import type { Question } from "./types";

interface QuestionDisplayProps {
  question: Question;
  showPrompt: boolean; // false when question is answered
}

export function QuestionDisplay({
  question,
  showPrompt,
}: QuestionDisplayProps) {
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
    const url = question.vocabItem.audio_url;
    if (!url) {
      const utterance = new SpeechSynthesisUtterance(question.vocabItem.text);
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
      const utterance = new SpeechSynthesisUtterance(question.vocabItem.text);
      utterance.lang = "en-US";
      utterance.rate = 0.9;
      speechSynthesis.speak(utterance);
    });
    return audio;
  }, [question.vocabItem.audio_url, question.vocabItem.text]);

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

  // Auto-play loop for audio questions — only on question change
  useEffect(() => {
    isMountedRef.current = true;
    if (question.hasAudio && showPrompt) {
      startLoop();
    }
    return () => {
      isMountedRef.current = false;
      stopLoop();
      speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.vocabItem.id, showPrompt]);

  if (!showPrompt) {
    return (
      <div className="text-center py-2 h-16 flex items-center justify-center">
        <span className="text-4xl font-bold text-green-600 handwrite-font">
          {question.correctAnswer}
        </span>
      </div>
    );
  }

  if (question.hasAudio) {
    return (
      <div className="text-center py-2 h-16 flex items-center justify-center">
        <button
          onClick={() => {
            if (isPlaying) {
              stopLoop();
            } else {
              startLoop();
            }
          }}
          className="p-3 rounded-full hover:bg-white/30 transition-colors cursor-pointer"
        >
          {isPlaying ? (
            <VolumeOff className="h-10 w-10 text-gray-400" strokeWidth={2.5} />
          ) : (
            <Volume2 className="h-10 w-10 text-gray-700" strokeWidth={2.5} />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="text-center py-2 h-16 flex items-center justify-center">
      <span className="text-4xl font-bold handwrite-font">{question.prompt}</span>
    </div>
  );
}
