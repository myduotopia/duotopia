/**
 * ReplyComposer — 情境對話底部輸入區（#1133）。
 *
 * 依流程狀態切換：
 * - intro：「開始對話」主按鈕（也讓第一次自動朗讀發生在使用者點擊之後，避開瀏覽器自動播放限制）
 * - answer：老師派發時設定的回覆方式
 *   - 語音：標準 AudioRecorder（chat variant）錄音 → 試聽／重錄 →「送出」才成為對話中的語音訊息
 *   - 打字：聊天輸入框＋送出鈕（Enter 送出）
 * - waiting：AI 輸入中或等待使用者在建議氣泡上選「再試一次／下一題」時的提示
 * - finished：「提交作業」主按鈕
 * 補答模式（reviewing）上方多一列「正在補答第 N 題」＋取消。
 * 底部留 safe-area（瀏海機 home bar）。
 */

import { useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import AudioRecorder from "@/components/shared/AudioRecorder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReplyMode, ScenarioAnswer } from "./types";

export type ComposerState = "intro" | "answer" | "waiting" | "finished";

interface Props {
  state: ComposerState;
  replyMode: ReplyMode;
  waitingHint: string;
  reviewingNo: number | null;
  onStart: () => void;
  onSubmitAnswer: (answer: ScenarioAnswer) => void;
  onCancelReview: () => void;
  onSubmitAssignment: () => void;
}

interface PendingVoice {
  url: string;
  durationSec: number;
}

export function ReplyComposer({
  state,
  replyMode,
  waitingHint,
  reviewingNo,
  onStart,
  onSubmitAnswer,
  onCancelReview,
  onSubmitAssignment,
}: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingVoice | null>(null);
  // 送出後換一個 key 讓錄音元件回到初始狀態
  const [recorderKey, setRecorderKey] = useState(0);
  const pendingRef = useRef<PendingVoice | null>(null);
  pendingRef.current = pending;

  // 離開答題狀態時丟掉未送出的錄音
  useEffect(() => {
    if (state !== "answer" && pendingRef.current) {
      URL.revokeObjectURL(pendingRef.current.url);
      setPending(null);
      setRecorderKey((k) => k + 1);
    }
  }, [state]);

  const sendVoice = () => {
    if (!pending) return;
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
        >
          {t("scenarioDialogue.chat.submitAssignment")}
        </Button>
        <p className="text-center text-xs text-gray-500">
          {t("scenarioDialogue.chat.finishedHint")}
        </p>
      </div>
    );
  } else if (state === "waiting") {
    body = (
      <p className="flex min-h-12 items-center justify-center text-center text-sm text-gray-500">
        {waitingHint}
      </p>
    );
  } else if (replyMode === "voice") {
    body = (
      <div className="flex flex-wrap items-center justify-center gap-3">
        <AudioRecorder
          key={recorderKey}
          variant="chat"
          onRecordingComplete={(blob, _url, durationSeconds) => {
            // 自己建一份 URL：AudioRecorder 卸載時會 revoke 它自己的那份
            setPending({
              url: URL.createObjectURL(blob),
              durationSec: durationSeconds,
            });
          }}
          onReRecord={() => {
            if (pendingRef.current) URL.revokeObjectURL(pendingRef.current.url);
            setPending(null);
          }}
        />
        {pending && (
          <Button type="button" className="h-11" onClick={sendVoice}>
            <Send className="mr-1 h-4 w-4" />
            {t("scenarioDialogue.chat.send")}
          </Button>
        )}
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
      {reviewingNo !== null && state !== "finished" && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-blue-50 px-3 text-sm text-blue-800">
          <span>
            {t("scenarioDialogue.chat.reviewing", { no: reviewingNo })}
          </span>
          <Button
            type="button"
            variant="ghost"
            className="h-11 text-blue-800"
            onClick={onCancelReview}
          >
            <X className="mr-1 h-4 w-4" />
            {t("scenarioDialogue.chat.cancelReview")}
          </Button>
        </div>
      )}
      {body}
    </div>
  );
}
