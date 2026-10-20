/**
 * AudioRecorderChatControls — AudioRecorder `variant="chat"` 的畫面（#1133 情境對話）。
 *
 * 從 AudioRecorder 抽出來，錄音邏輯（MediaRecorder、驗證、清理）仍在 AudioRecorder，
 * 這裡只負責畫面：大圓麥克風，點一下開始（秒數＋聲波）、再點停止（處理中轉圈）→
 * 試聽（AudioPlayer compact）／重錄；錄音失敗顯示紅字。
 * 只給 AudioRecorder 內部使用，其他地方請用 `<AudioRecorder variant="chat" />`。
 */

import { AlertCircle, Loader2, Mic, RotateCcw, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { AudioErrorData } from "@/utils/audioErrorLogger";
import AudioPlayer from "./AudioPlayer";

interface Props {
  isRecording: boolean;
  isStopping: boolean;
  recordingTimeLabel: string;
  audioUrl: string | null;
  showError: boolean;
  errorMessage?: string;
  description?: string;
  readOnly: boolean;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
  onReRecord: () => void;
  onError?: (error: AudioErrorData) => void;
}

export default function AudioRecorderChatControls({
  isRecording,
  isStopping,
  recordingTimeLabel,
  audioUrl,
  showError,
  errorMessage,
  description,
  readOnly,
  disabled,
  onStart,
  onStop,
  onReRecord,
  onError,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2">
      {!isRecording && !audioUrl && (
        <>
          <button
            type="button"
            onClick={onStart}
            disabled={readOnly || disabled}
            className="h-16 w-16 rounded-full bg-primary text-primary-foreground shadow-md flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-50"
            aria-label={t("audioRecorder.ui.startRecording")}
          >
            <Mic className="h-7 w-7" />
          </button>
          <span className="text-xs text-gray-500">
            {description || t("audioRecorder.ui.tapToRecord")}
          </span>
        </>
      )}

      {isRecording && (
        <>
          <div className="flex items-center gap-4">
            <span className="w-12 text-right text-base font-medium tabular-nums text-red-600">
              {recordingTimeLabel}
            </span>
            <button
              type="button"
              onClick={onStop}
              disabled={isStopping}
              className="h-16 w-16 rounded-full bg-red-600 text-white shadow-md flex items-center justify-center hover:bg-red-700 transition-colors"
              aria-label={t("audioRecorder.ui.stopRecording")}
            >
              {isStopping ? (
                <Loader2 className="h-7 w-7 animate-spin" />
              ) : (
                <Square className="h-6 w-6 fill-current" />
              )}
            </button>
            <div className="flex h-8 w-12 items-center gap-1" aria-hidden>
              {[45, 85, 60, 100, 50].map((h, i) => (
                <span
                  key={i}
                  className="w-1.5 rounded-full bg-red-500 animate-pulse"
                  style={{
                    height: `${isStopping ? 20 : h}%`,
                    animationDelay: `${i * 150}ms`,
                  }}
                />
              ))}
            </div>
          </div>
          <span className="text-xs text-gray-500">
            {isStopping
              ? t("audioRecorder.ui.processing")
              : t("audioRecorder.ui.tapToStop")}
          </span>
        </>
      )}

      {audioUrl && !isRecording && (
        <div className="flex items-center gap-2">
          <AudioPlayer
            audioUrl={audioUrl}
            variant="compact"
            showTitle={false}
            onError={onError}
          />
          {!readOnly && (
            <Button
              variant="outline"
              onClick={onReRecord}
              disabled={disabled}
              className="h-11"
            >
              <RotateCcw className="w-4 h-4 mr-1" />
              {t("audioRecorder.ui.reRecord")}
            </Button>
          )}
        </div>
      )}

      {showError && !isRecording && (
        <div className="flex items-center gap-1 text-red-600 text-xs">
          <AlertCircle className="w-4 h-4" />
          {errorMessage || t("audioRecorder.ui.recordingFailedCheckMic")}
        </div>
      )}
    </div>
  );
}
