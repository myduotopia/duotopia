/**
 * AudioPlayer — 播放音檔（播放／暫停、進度條、時間、重新播放）。
 *
 * variant：default（大卡）、compact（一列）、minimal（只有播放鈕）。
 * tone（選用，#1133）：`onPrimary` 給放在主色藍底上的地方（例如情境對話的學生回答氣泡），
 * 只影響 compact 外觀：不鋪綠底、按鈕半透明白、進度條與文字白色。預設 `default` ＝原本綠色外觀，
 * 既有使用處不變。
 * fallbackDuration（選用，秒，#1133）：音檔還讀不到時長時（例如 Chrome 錄音 webm 播放前常是
 * 未知）改顯示這個秒數，不顯示 `--:--`；讀到真正時長後以真正時長為準。不傳時行為不變。
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause, RotateCcw, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AudioErrorData } from "@/utils/audioErrorLogger";
import { fixAudioDuration } from "@/utils/fixAudioDuration";

interface AudioPlayerProps {
  audioUrl?: string;
  title?: string;
  className?: string;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onError?: (error: AudioErrorData) => void; // 錯誤回調
  autoPlay?: boolean;
  showTitle?: boolean;
  variant?: "default" | "compact" | "minimal";
  /** compact 專用配色：onPrimary＝放在主色藍底上（淺色按鈕）；預設綠色外觀 */
  tone?: "default" | "onPrimary";
  readOnly?: boolean;
  /** 讀不到音檔時長時改顯示的秒數（例如錄音當下記下的秒數）；不傳＝顯示 --:-- */
  fallbackDuration?: number;
}

export default function AudioPlayer({
  audioUrl,
  title = "已錄製音檔",
  className,
  onPlay,
  onPause,
  onEnded,
  onError,
  autoPlay = false,
  showTitle = true,
  variant = "default",
  tone = "default",
  readOnly = false,
  fallbackDuration,
}: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Format time helper
  const formatTime = useCallback((seconds: number, showPlaceholder = false) => {
    // For duration display (showPlaceholder=true), show --:-- if not loaded yet
    if (
      showPlaceholder &&
      (seconds === 0 || isNaN(seconds) || !isFinite(seconds))
    ) {
      return "--:--";
    }
    // For current time, always show a valid time
    if (isNaN(seconds) || !isFinite(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  // Update progress
  useEffect(() => {
    if (isPlaying && audioRef.current) {
      progressIntervalRef.current = setInterval(() => {
        if (audioRef.current) {
          setCurrentTime(audioRef.current.currentTime);
        }
      }, 100);
    } else {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    }

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, [isPlaying]);

  // Reset states when audioUrl changes
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setIsLoaded(false);
    setIsPlaying(false);
  }, [audioUrl]);

  // Handle audio element events
  useEffect(() => {
    if (!audioRef.current || !audioUrl) return;

    const audio = audioRef.current;

    // Set the source immediately
    audio.src = audioUrl;

    const updateDuration = () => {
      if (
        audio.duration &&
        !isNaN(audio.duration) &&
        isFinite(audio.duration) &&
        audio.duration > 0
      ) {
        setDuration(audio.duration);
        setIsLoaded(true);
      }
    };

    const handleLoadedMetadata = () => {
      updateDuration();
    };

    const handleLoadedData = () => {
      updateDuration();
    };

    const handleCanPlay = () => {
      updateDuration();
    };

    const handleCanPlayThrough = () => {
      updateDuration();
    };

    const handleDurationChange = () => {
      updateDuration();
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      // Also update duration if it wasn't set
      if (duration === 0) {
        updateDuration();
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      if (onEnded) onEnded();
    };

    const handlePlay = () => {
      setIsPlaying(true);
      if (onPlay) onPlay();
    };

    const handlePause = () => {
      setIsPlaying(false);
      if (onPause) onPause();
    };

    const handleError = () => {
      console.error("🔴 Audio playback error:", {
        code: audio.error?.code,
        message: audio.error?.message,
        url: audioUrl,
      });

      // 通知父元件處理錯誤
      if (onError) {
        onError({
          errorType: "load_failed",
          errorCode: audio.error?.code,
          errorMessage: audio.error?.message,
          audioUrl: audioUrl,
          audioDuration: duration,
        });
      }

      setIsPlaying(false);
    };

    const handleStalled = () => {
      console.warn("⏸️ Audio loading stalled:", audioUrl);

      // 通知父元件處理錯誤
      if (onError) {
        onError({
          errorType: "stalled",
          audioUrl: audioUrl,
          audioDuration: duration,
        });
      }
    };

    // Add all event listeners
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("loadeddata", handleLoadedData);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("canplaythrough", handleCanPlayThrough);
    audio.addEventListener("durationchange", handleDurationChange);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("error", handleError);
    audio.addEventListener("stalled", handleStalled);

    // Try to force load metadata
    audio.load();

    // Apply iOS Safari fMP4 duration fix (seek-to-end trick).
    // Must be called after load() so the element has a src set.
    fixAudioDuration(audio);

    // Check if duration is already available (cached audio)
    if (
      audio.duration &&
      !isNaN(audio.duration) &&
      isFinite(audio.duration) &&
      audio.duration > 0
    ) {
      setDuration(audio.duration);
      setIsLoaded(true);
    }

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("loadeddata", handleLoadedData);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("canplaythrough", handleCanPlayThrough);
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("stalled", handleStalled);
    };
  }, [audioUrl, onEnded, onPlay, onPause]);

  // Detect duration = 0 errors
  useEffect(() => {
    if (isLoaded && duration === 0 && audioUrl) {
      console.error("⚠️ Audio duration is 0:", audioUrl);

      // 通知父元件處理錯誤
      if (onError) {
        onError({
          errorType: "duration_zero",
          audioUrl: audioUrl,
          audioDuration: 0,
        });
      }
    }
  }, [isLoaded, duration, audioUrl, onError]);

  // Play/pause toggle
  const togglePlayback = useCallback(() => {
    if (!audioRef.current || !audioUrl) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch((err) => {
        console.error("Failed to play audio:", err);
      });
    }
  }, [isPlaying, audioUrl]);

  // Reset playback
  const resetPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, [isPlaying]);

  // Progress bar click handler
  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!audioRef.current || !isLoaded) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentage = clickX / rect.width;
      const newTime = percentage * duration;

      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    },
    [duration, isLoaded],
  );

  // Auto play
  useEffect(() => {
    if (autoPlay && audioUrl && audioRef.current && isLoaded) {
      audioRef.current.play().catch((err) => {
        console.error("Auto play failed:", err);
      });
    }
  }, [autoPlay, audioUrl, isLoaded]);

  if (!audioUrl) {
    return null;
  }

  // 讀不到真正時長時，用外層給的秒數顯示（不傳 fallbackDuration 時就是 duration）
  const shownDuration =
    duration > 0 ? duration : (fallbackDuration ?? duration);
  const progressPercentage =
    shownDuration > 0 ? Math.min(100, (currentTime / shownDuration) * 100) : 0;

  // Minimal variant - only play button
  if (variant === "minimal") {
    return (
      <div className={cn("inline-flex", className)}>
        <audio ref={audioRef} preload="metadata" />
        <button
          onClick={togglePlayback}
          className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center hover:bg-green-700 transition-colors"
          title={isPlaying ? "暫停播放" : "播放錄音"}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 text-white" />
          ) : (
            <Play className="w-4 h-4 text-white ml-0.5" />
          )}
        </button>
      </div>
    );
  }

  if (variant === "compact") {
    const onPrimary = tone === "onPrimary";
    return (
      <div
        className={cn(
          "rounded-lg flex items-center gap-3",
          onPrimary ? "p-0" : "bg-green-50 p-3",
          className,
        )}
      >
        <audio ref={audioRef} preload="metadata" />

        <button
          onClick={togglePlayback}
          className={cn(
            "rounded-full flex items-center justify-center transition-colors",
            onPrimary
              ? "w-11 h-11 bg-white/20 hover:bg-white/30"
              : "w-10 h-10 bg-green-600 hover:bg-green-700",
          )}
        >
          {isPlaying ? (
            <Pause className="w-5 h-5 text-white" />
          ) : (
            <Play className="w-5 h-5 text-white ml-0.5" />
          )}
        </button>

        {showTitle && (
          <div className="flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <span className="text-sm text-gray-800 font-medium">{title}</span>
          </div>
        )}

        <div className="flex-1 flex items-center gap-2">
          <div
            className={cn(
              "flex-1 h-1.5 rounded-full cursor-pointer overflow-hidden",
              onPrimary ? "bg-white/30" : "bg-green-200",
            )}
            onClick={handleProgressClick}
          >
            <div
              className={cn(
                "h-full rounded-full transition-all duration-100",
                onPrimary ? "bg-white" : "bg-green-500",
              )}
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <span
            className={cn(
              "text-xs font-medium whitespace-nowrap min-w-[65px] text-right",
              onPrimary ? "text-primary-foreground" : "text-gray-700",
            )}
          >
            {formatTime(currentTime)} / {formatTime(shownDuration, true)}
          </span>
        </div>

        {!readOnly && (
          <button
            onClick={resetPlayback}
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
              onPrimary ? "hover:bg-white/20" : "hover:bg-green-100",
            )}
            title="重新播放"
          >
            <RotateCcw
              className={cn(
                "w-4 h-4",
                onPrimary ? "text-white" : "text-green-600",
              )}
            />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "bg-green-50 rounded-2xl p-4 border-2 border-green-100",
        className,
      )}
    >
      <audio ref={audioRef} preload="metadata" />

      <div className="flex items-center gap-4">
        {/* Play/Pause Button */}
        <button
          onClick={togglePlayback}
          className="w-14 h-14 bg-green-600 rounded-full flex items-center justify-center hover:bg-green-700 transition-colors shadow-md"
        >
          {isPlaying ? (
            <Pause className="w-6 h-6 text-white" />
          ) : (
            <Play className="w-6 h-6 text-white ml-1" />
          )}
        </button>

        {/* Title and Progress */}
        <div className="flex-1 flex items-center gap-3">
          {showTitle && (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span className="text-sm font-medium text-gray-800 whitespace-nowrap">
                {title}
              </span>
            </div>
          )}

          {/* Progress Bar with Time */}
          <div className="flex-1 flex items-center gap-3">
            <div
              className="flex-1 h-2 bg-green-200 rounded-full cursor-pointer overflow-hidden"
              onClick={handleProgressClick}
            >
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-100"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>

            {/* Time Display - Current / Total */}
            <span className="text-sm text-gray-700 font-medium whitespace-nowrap min-w-[80px] text-right">
              {formatTime(currentTime)} / {formatTime(shownDuration, true)}
            </span>
          </div>
        </div>

        {/* Reset Button */}
        {!readOnly && (
          <button
            onClick={resetPlayback}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-green-100 transition-colors"
            title="重新播放"
          >
            <RotateCcw className="w-5 h-5 text-green-600" />
          </button>
        )}
      </div>
    </div>
  );
}
