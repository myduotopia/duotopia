/**
 * useCardRecorder — issue #892 共用錄音機制。
 *
 * 把原 WordReadingTemplate 內嵌的 MediaRecorder 邏輯抽成共用 hook，讓 word 與
 * sentence 兩個 Template 共用同一套錄音行為（避免兩套實作漂移）。逐項保留：
 *   - getUserMedia + MediaRecorder 分段收音
 *   - 每秒計時（recordingTime）
 *   - timeLimit>0 時自動停止（auto-stop timer）
 *   - 停止時比對時長，超過 timeLimit + 0.5s 容差則丟棄並回報 onOverLimit
 *   - 卸載時清理計時器與進行中的錄音
 *
 * 不負責：blob 上傳、Azure 分析、10 秒分析上限（那些留在 Template 的分析流程）。
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseCardRecorderParams {
  /** 每題錄音限時（秒）；0 = 不限時 */
  timeLimit?: number;
  /** 錄音完成（未超時）：blob + object URL */
  onComplete: (blob: Blob, url: string) => void;
  /** 無法啟動錄音（權限等） */
  onError?: (message: string) => void;
  /** 錄音超過限時被丟棄 */
  onOverLimit?: (recordedSeconds: number, limitSeconds: number) => void;
}

export interface UseCardRecorderResult {
  isRecording: boolean;
  recordingTime: number;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
}

export const useCardRecorder = ({
  timeLimit = 0,
  onComplete,
  onError,
  onOverLimit,
}: UseCardRecorderParams): UseCardRecorderResult => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(0);

  // 以 ref 保存最新 callback，避免 hook 依賴變動導致重建
  const cbRef = useRef({ onComplete, onError, onOverLimit });
  cbRef.current = { onComplete, onError, onOverLimit };

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });

        // 超時容差 0.5s：auto-stop 觸發時實際時長會略大於 timeLimit，仍應接受
        if (timeLimit > 0 && startTimeRef.current > 0) {
          const elapsed = (Date.now() - startTimeRef.current) / 1000;
          if (elapsed > timeLimit + 0.5) {
            cbRef.current.onOverLimit?.(Math.round(elapsed), timeLimit);
            stream.getTracks().forEach((t) => t.stop());
            clearTimers();
            return; // 丟棄超時錄音
          }
        }

        const url = URL.createObjectURL(blob);
        cbRef.current.onComplete(blob, url);
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      startTimeRef.current = Date.now();

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

      if (timeLimit > 0) {
        autoStopRef.current = setTimeout(() => {
          if (mediaRecorderRef.current?.state === "recording") {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
          }
          autoStopRef.current = null;
        }, timeLimit * 1000);
      }
    } catch (error) {
      console.error("Error starting recording:", error);
      cbRef.current.onError?.("無法啟動錄音，請檢查麥克風權限");
    }
  }, [timeLimit, clearTimers]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    clearTimers();
  }, [clearTimers]);

  // 卸載清理
  useEffect(() => {
    return () => {
      clearTimers();
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, [clearTimers]);

  return { isRecording, recordingTime, startRecording, stopRecording };
};
