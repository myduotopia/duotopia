/**
 * AudioRecorderChatControls — AudioRecorder `variant="chat"` 的畫面（#1133 情境對話）。
 *
 * 從 AudioRecorder 抽出來，錄音邏輯（MediaRecorder、驗證、清理）仍在 AudioRecorder，
 * 這裡只負責畫面。只給 AudioRecorder 內部使用，其他地方請用 `<AudioRecorder variant="chat" />`；
 * 目前只有情境對話的 ReplyComposer 用（例句朗讀等其他錄音不走這個 variant）。
 *
 * #1158 E3 改版（像通訊軟體的語音訊息）：只用圖示按鈕、不放說明文字（每顆都有 aria-label），
 * 一列置中，主按鈕 72px。外層（ReplyComposer）負責把這一列放在畫面最下方、下半疊在淺藍底色條
 * （高度＝主按鈕一半）上；兩側的秒數／音量條／時長放在底色條那一半的高度（`self-end h-9`）。
 * - A 待錄：藍色大麥克風。
 * - B 錄音中：紅色停止鈕（處理中轉圈）＋左側秒數（有上限時「0:12 / 2:00」）＋右側音量條。
 * - C 錄完：重錄（左，小圓灰）／送出（中，大圓藍紙飛機，`onSend`）／試聽（右，小圓淺藍 ▶，
 *   標準 AudioPlayer minimal＋tone="soft"）＋時長。沒傳 onSend 就不顯示送出鈕。
 * - D 停用（`disabled`，例如等 AI 建議）：灰色麥克風，aria-label／title 帶停用原因
 *   （`disabledReason`）；原因文字由外層顯示在底色條右側。
 * 錄音失敗時左下角顯示紅字（淡白底、一行截斷，完整訊息在 title；pointer-events-auto，
 * 滑過才看得到 title，#1158 E2b）。
 * 按鈕與試聽鈕 pointer-events-auto，配合外層 pointer-events-none 的錄音區（#1158 E2）。
 */

import {
  AlertCircle,
  Loader2,
  Mic,
  RotateCcw,
  Send,
  Square,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { AudioErrorData } from "@/utils/audioErrorLogger";
import AudioPlayer from "./AudioPlayer";

interface Props {
  isRecording: boolean;
  isStopping: boolean;
  /** 錄音中顯示的秒數（有上限時含上限） */
  recordingTimeLabel: string;
  /** 錄完後的時長（試聽鈕旁） */
  recordedTimeLabel: string;
  audioUrl: string | null;
  showError: boolean;
  errorMessage?: string;
  readOnly: boolean;
  disabled: boolean;
  /** 停用原因（D 狀態），放進麥克風的 aria-label／title */
  disabledReason?: string;
  onStart: () => void;
  onStop: () => void;
  onReRecord: () => void;
  /** 錄完後的「送出」（C 狀態中間的大鈕） */
  onSend?: () => void;
  onError?: (error: AudioErrorData) => void;
}

/**
 * 按鈕一律 pointer-events-auto：外層錄音區是 pointer-events-none（按鈕列上半浮在對話區，
 * 按鈕之間的空白要讓點擊／滾輪穿到對話）。在一般版面裡這個 class 沒有作用。
 */
/** 主按鈕：72px 圓、白色外圈＋淡陰影 */
const BIG =
  "pointer-events-auto flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full border-4 border-white shadow-md transition-colors";
/** 兩側小按鈕：48px 圓 */
const SMALL =
  "pointer-events-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-[3px] border-white shadow transition-colors";
/** 兩側附屬資訊：放在底色條那一半的高度 */
const SIDE = "flex h-9 w-14 items-center self-end";

export default function AudioRecorderChatControls({
  isRecording,
  isStopping,
  recordingTimeLabel,
  recordedTimeLabel,
  audioUrl,
  showError,
  errorMessage,
  readOnly,
  disabled,
  disabledReason,
  onStart,
  onStop,
  onReRecord,
  onSend,
  onError,
}: Props) {
  const { t } = useTranslation();
  const locked = readOnly || disabled;
  const startLabel = t("audioRecorder.ui.startRecording");
  const lockedLabel = disabledReason
    ? t("audioRecorder.ui.startRecordingDisabled", { reason: disabledReason })
    : startLabel;

  return (
    <div
      className="relative flex w-full items-center justify-center gap-5"
      data-testid="chat-recorder-controls"
    >
      {/* A 待錄／D 停用 */}
      {!isRecording && !audioUrl && (
        <button
          type="button"
          onClick={onStart}
          disabled={locked}
          className={cn(
            BIG,
            locked
              ? "cursor-not-allowed bg-gray-200 text-gray-400"
              : "bg-blue-600 text-white hover:bg-blue-700",
          )}
          aria-label={locked ? lockedLabel : startLabel}
          title={locked ? lockedLabel : startLabel}
          data-state={locked ? "disabled" : "idle"}
        >
          <Mic className="h-8 w-8" aria-hidden />
        </button>
      )}

      {/* B 錄音中 */}
      {isRecording && (
        <>
          <span
            className={cn(
              SIDE,
              "w-24 justify-end whitespace-nowrap text-sm font-medium tabular-nums text-red-600",
            )}
          >
            {recordingTimeLabel}
          </span>
          <button
            type="button"
            onClick={onStop}
            disabled={isStopping}
            className={cn(BIG, "bg-red-600 text-white hover:bg-red-700")}
            aria-label={
              isStopping
                ? t("audioRecorder.ui.processing")
                : t("audioRecorder.ui.stopRecording")
            }
            data-state="recording"
          >
            {isStopping ? (
              <Loader2 className="h-7 w-7 animate-spin" aria-hidden />
            ) : (
              <Square className="h-6 w-6 fill-current" aria-hidden />
            )}
          </button>
          <span className={cn(SIDE, "w-24 gap-1")} aria-hidden>
            {[45, 85, 60, 100, 50].map((h, i) => (
              <span
                key={i}
                className="w-1 rounded-full bg-red-400 animate-pulse"
                style={{
                  height: `${isStopping ? 30 : h * 0.7}%`,
                  animationDelay: `${i * 150}ms`,
                }}
              />
            ))}
          </span>
        </>
      )}

      {/* C 錄完：重錄／送出／試聽 */}
      {audioUrl && !isRecording && (
        <>
          {!readOnly && (
            <button
              type="button"
              onClick={onReRecord}
              disabled={disabled}
              className={cn(
                SMALL,
                "bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50",
              )}
              aria-label={t("audioRecorder.ui.reRecord")}
              title={t("audioRecorder.ui.reRecord")}
            >
              <RotateCcw className="h-5 w-5" aria-hidden />
            </button>
          )}
          {onSend && (
            <button
              type="button"
              onClick={onSend}
              disabled={disabled}
              className={cn(BIG, "bg-blue-600 text-white hover:bg-blue-700")}
              aria-label={t("audioRecorder.ui.send")}
              title={t("audioRecorder.ui.send")}
              data-state="recorded"
            >
              <Send className="h-7 w-7" aria-hidden />
            </button>
          )}
          <span className="pointer-events-auto relative">
            <AudioPlayer
              audioUrl={audioUrl}
              variant="minimal"
              tone="soft"
              showTitle={false}
              onError={onError}
              ariaLabel={t("audioRecorder.ui.playRecording", {
                duration: recordedTimeLabel,
              })}
            />
            <span className="absolute left-full top-1/2 ml-1 mt-1 whitespace-nowrap text-xs tabular-nums text-gray-600">
              {recordedTimeLabel}
            </span>
          </span>
        </>
      )}

      {showError && !isRecording && (
        // 淡白底：錯誤字可能疊到對話區；限寬一行截斷，完整訊息放 title
        <span
          className="pointer-events-auto absolute bottom-1 left-3 flex max-w-[40%] items-center gap-1 rounded bg-white/90 px-1 text-xs leading-tight text-red-600"
          title={errorMessage || t("audioRecorder.ui.recordingFailedCheckMic")}
          data-testid="chat-recorder-error"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">
            {errorMessage || t("audioRecorder.ui.recordingFailedCheckMic")}
          </span>
        </span>
      )}
    </div>
  );
}
