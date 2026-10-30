/**
 * ReplyComposer — 情境對話底部輸入區（#1133）。
 *
 * 依流程狀態切換：
 * - intro：「開始對話」主按鈕（也讓第一次自動朗讀發生在使用者點擊之後，避開瀏覽器自動播放限制）
 * - answer：老師派發時設定的回覆方式
 *   - 語音：標準 AudioRecorder（chat variant）錄音 → 重錄／送出／試聽 →「送出」才成為對話中的語音訊息
 *   - 打字：聊天輸入框＋送出鈕（Enter 送出）
 * - waiting：AI 輸入中或等待使用者在建議氣泡上選「再試一次／下一題」。語音模式顯示灰色停用的
 *   麥克風，原因（waitingHint）寫在底色條右側小字，也放進麥克風的 aria-label。
 *
 * 語音錄音區（answer／waiting，#1158 E3）固定在作答畫面最下方，像通訊軟體的語音訊息：
 * 只有圖示按鈕；淺藍底色條（blue-50＋上緣 blue-100 細線）高度＝主按鈕一半（36px，h-9），
 * 再加 safe-area 底部留白同色；按鈕列垂直置中在底色條上緣，上半浮在對話區上（外框 -mt-9、
 * 整個錄音區 pointer-events-none，只有按鈕／試聽鈕／重答膠囊 pointer-events-auto，按鈕之間的
 * 空白不吃對話區的點擊與滾輪）。錄音失敗（AudioRecorder onError）也視同停止錄音。對話捲動區要在底部多留按鈕上半的高度（
 * ScenarioChatActivity 依 isFloatingDock 加 padding），最新訊息才不會被擋住。
 * 「正在重答第 N 題 ✕」是深藍小膠囊，浮在按鈕列上方；✕＝放棄重答回到目前題，錄音中隱藏 ✕
 * 免得誤按（#1158 E-2 重答流程）。intro／finished 維持文字主按鈕（白底區塊，不浮）。
 * - finished：「提交作業」主按鈕；傳了 submitDisabledReason（老師預覽，#1158 E2）就停用，
 *   下方小字改成停用原因（「預覽不會送出」），title 也寫同一句
 * 回頭重答（retryNo）時上方多一條「正在重答第 N 題 ✕」；✕ 取消重答、回到進行中的題目
 * （等 AI 建議時不能取消，不顯示 ✕）。外層以 key 區分重答／主流程，切換時元件重掛、
 * 未送出的錄音丟掉；卸載時 revoke 未送出的錄音 URL。
 * 底部留 safe-area（瀏海機 home bar）。
 * - 中斷（interrupted，#1158 E-3 手機橫放）：變成 true 時若正在錄音，錄音立刻停止並丟掉
 *   （AudioRecorder discardSignal），回到待錄；已錄完未送出的保留。
 * - waiting 也用在按「開始對話」後看作答要求的倒數（#1158 E-3）：麥克風停用，小字寫原因。
 */

import { useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import AudioRecorder from "@/components/shared/AudioRecorder";
import { SCENARIO_MAX_RECORDING_SECONDS } from "./recordingLimits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { ReplyMode, ScenarioAnswer } from "./types";

export type ComposerState = "intro" | "answer" | "waiting" | "finished";

interface Props {
  state: ComposerState;
  replyMode: ReplyMode;
  waitingHint: string;
  /** 正在回頭重答的題號（1 起算）；主流程為 null */
  retryNo: number | null;
  canCancelRetry: boolean;
  onStart: () => void;
  onSubmitAnswer: (answer: ScenarioAnswer) => void;
  onCancelRetry: () => void;
  onSubmitAssignment: () => void;
  /** 有值＝「提交作業」停用，並把這句當作停用原因顯示（老師預覽） */
  submitDisabledReason?: string;
  /** 手機橫放等中斷：變成 true 時丟掉正在錄的錄音（#1158 E-3） */
  interrupted?: boolean;
}

interface PendingVoice {
  url: string;
  durationSec: number;
}

export function ReplyComposer({
  state,
  replyMode,
  waitingHint,
  retryNo,
  canCancelRetry,
  onStart,
  onSubmitAnswer,
  onCancelRetry,
  onSubmitAssignment,
  submitDisabledReason,
  interrupted = false,
}: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingVoice | null>(null);
  // 送出後換一個 key 讓錄音元件回到初始狀態
  const [recorderKey, setRecorderKey] = useState(0);
  // 錄音中：重答提示的 ✕ 先藏起來
  const [recording, setRecording] = useState(false);
  const pendingRef = useRef<PendingVoice | null>(null);
  pendingRef.current = pending;
  // 中斷時丟掉正在錄的錄音（AudioRecorder discardSignal）
  const [discardSignal, setDiscardSignal] = useState(0);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  useEffect(() => {
    if (!interrupted || !recordingRef.current) return;
    setDiscardSignal((n) => n + 1);
    setRecording(false);
  }, [interrupted]);

  // 離開答題狀態時丟掉未送出的錄音
  useEffect(() => {
    if (state !== "answer") setRecording(false);
    if (state !== "answer" && pendingRef.current) {
      URL.revokeObjectURL(pendingRef.current.url);
      setPending(null);
      setRecorderKey((k) => k + 1);
    }
  }, [state]);

  // 卸載時釋放未送出的錄音
  useEffect(
    () => () => {
      if (pendingRef.current) URL.revokeObjectURL(pendingRef.current.url);
    },
    [],
  );

  const sendVoice = () => {
    if (!pending) return;
    // 送出後音檔歸對話紀錄管（由 useScenarioChat 卸載時釋放）；先清 ref，
    // 免得重答結束時本元件被換 key 卸載、把剛送出的音檔 revoke 掉
    pendingRef.current = null;
    onSubmitAnswer({
      kind: "voice",
      audioUrl: pending.url,
      durationSec: pending.durationSec,
    });
    setPending(null);
    setRecorderKey((k) => k + 1);
  };

  const sendText = () => {
    const value = text.trim();
    if (!value) return;
    onSubmitAnswer({ kind: "text", text: value });
    setText("");
  };

  let body: React.ReactNode;
  if (state === "intro") {
    body = (
      <Button type="button" className="h-12 w-full" onClick={onStart}>
        {t("scenarioDialogue.chat.start")}
      </Button>
    );
  } else if (state === "finished") {
    body = (
      <div className="space-y-1">
        <Button
          type="button"
          className="h-12 w-full"
          onClick={onSubmitAssignment}
          disabled={Boolean(submitDisabledReason)}
          title={submitDisabledReason || undefined}
        >
          {t("scenarioDialogue.chat.submitAssignment")}
        </Button>
        <p className="text-center text-xs text-gray-500">
          {submitDisabledReason || t("scenarioDialogue.chat.finishedHint")}
        </p>
      </div>
    );
  } else if (state === "waiting" && replyMode !== "voice") {
    body = (
      <p className="flex min-h-12 items-center justify-center text-center text-sm text-gray-500">
        {waitingHint}
      </p>
    );
  } else if (replyMode === "voice") {
    const waiting = state === "waiting";
    return (
      <div
        className="pointer-events-none relative z-10 -mt-9 shrink-0"
        data-testid="scenario-reply-dock"
      >
        {retryNo !== null && (
          <div className="absolute inset-x-0 bottom-full mb-2 flex justify-center px-3">
            <div
              className="pointer-events-auto flex min-h-9 items-center gap-2 rounded-full bg-blue-900 py-1 pl-4 pr-1 text-sm text-white shadow-md"
              data-testid="scenario-retry-banner"
            >
              <span className={cn(!(canCancelRetry && !recording) && "pr-3")}>
                {t("scenarioDialogue.chat.retrying", { no: retryNo })}
              </span>
              {canCancelRetry && !recording && (
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
                  onClick={onCancelRetry}
                  aria-label={t("scenarioDialogue.chat.cancelRetry")}
                  title={t("scenarioDialogue.chat.cancelRetry")}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          </div>
        )}
        <div className="relative">
          {/* 底色條：主按鈕高度的一半 */}
          <div
            className="absolute inset-x-0 bottom-0 h-9 border-t border-blue-100 bg-blue-50"
            data-testid="scenario-reply-strip"
            aria-hidden
          />
          {waiting && (
            <p
              className="absolute bottom-0 right-3 flex h-9 max-w-[calc(50%-3rem)] items-center text-right text-xs leading-tight text-gray-500"
              role="status"
            >
              {waitingHint}
            </p>
          )}
          {/* 按鈕列整列仍不擋點擊／滾輪，只有按鈕本身可點（AudioRecorderChatControls 內 pointer-events-auto） */}
          <div className="relative">
            <AudioRecorder
              key={recorderKey}
              variant="chat"
              disabled={waiting}
              disabledReason={waiting ? waitingHint : undefined}
              discardSignal={discardSignal}
              onSend={sendVoice}
              onRecordingStart={() => setRecording(true)}
              onRecordingStop={() => setRecording(false)}
              // 錄音失敗（太短、驗證失敗、例外）不會呼叫 onRecordingStop，
              // 這裡也要收起「錄音中」，重答的 ✕ 才會再出現
              onError={() => setRecording(false)}
              // 上限要擋在前端：超過的話上傳端會回 400，而學生只會看到一句看不懂的
              // 錯誤（夥伴 staging 回報）。到時間自動停，並在計時器上顯示上限。
              autoStop={SCENARIO_MAX_RECORDING_SECONDS}
              onRecordingComplete={(blob, _url, durationSeconds) => {
                // 自己建一份 URL：AudioRecorder 卸載時會 revoke 它自己的那份
                setPending({
                  url: URL.createObjectURL(blob),
                  durationSec: durationSeconds,
                });
              }}
              onReRecord={() => {
                if (pendingRef.current)
                  URL.revokeObjectURL(pendingRef.current.url);
                setPending(null);
              }}
            />
          </div>
        </div>
        {/* safe-area（瀏海機 home bar）同底色 */}
        <div
          className="bg-blue-50"
          style={{ height: "env(safe-area-inset-bottom)" }}
        />
      </div>
    );
  } else {
    body = (
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          sendText();
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("scenarioDialogue.chat.typePlaceholder")}
          className="h-11 flex-1 text-base"
          aria-label={t("scenarioDialogue.chat.typePlaceholder")}
        />
        <Button
          type="submit"
          className="h-11 w-11 shrink-0 p-0"
          disabled={!text.trim()}
          aria-label={t("scenarioDialogue.chat.send")}
        >
          <Send className="h-5 w-5" />
        </Button>
      </form>
    );
  }

  return (
    <div
      className="border-t border-gray-200 bg-white px-3 pt-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {retryNo !== null && (
        <div className="mb-2 flex min-h-11 items-center justify-between gap-2 rounded-lg bg-blue-50 px-3 text-sm text-blue-800">
          <span>{t("scenarioDialogue.chat.retrying", { no: retryNo })}</span>
          {canCancelRetry && (
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-11 p-0 text-blue-800"
              onClick={onCancelRetry}
              aria-label={t("scenarioDialogue.chat.cancelRetry")}
              title={t("scenarioDialogue.chat.cancelRetry")}
            >
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>
      )}
      {body}
    </div>
  );
}
