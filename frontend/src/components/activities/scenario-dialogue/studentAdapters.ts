/**
 * 學生正式作答時要注入 `ScenarioChatActivity` 的 adapters（Issue #1140 Stage 3）。
 *
 * `types.ts` 刻意把「AI 建議」與「朗讀」做成注入點：設計稿餵 mock，正式版餵這裡。
 *
 * ## 一次作答做兩件事
 *
 * 1. **上傳這次的錄音**。`ReplyComposer` 交出來的 `answer.audioUrl` 是本機 blob URL
 *    （`URL.createObjectURL`），不是 GCS 網址 —— 後端的建議端點讀的是
 *    `StudentItemProgress.recording_url`，所以得先上傳。上傳端點會回 `progress_id`。
 * 2. **拿建議**。把那個 `progress_id` 丟給 `/api/students/scenario-dialogue/feedback`。
 *
 * 上傳沿用既有的 `appendAudioToFormData`（處理各瀏覽器的音檔格式）與
 * `retryAudioUpload`（網路抖動重試），不自己寫一份。
 *
 * ## 配額用完（429）不能讓學生卡住
 *
 * `useScenarioChat` 對 `getFeedback` 的 reject 會「還原狀態讓學生重新作答」。那對
 * 網路錯誤是對的，對 429 是錯的 —— 次數已經用完，再答幾次都一樣，學生會原地打轉。
 *
 * 關鍵是：**伺服器的計數會跨工作階段累積，UI 的 attempts 只在記憶體**。學生昨天答過
 * 兩次、今天重新打開，畫面以為還有 3 次，伺服器只剩 1 次。所以 429 是會真的發生的，
 * 不是理論情況。
 *
 * 429 於是 **resolve 成一則說明**（而不是 reject）：對話往前走，學生看得到原因。
 * 其他錯誤照舊 reject，交給 hook 還原狀態讓他再試。
 */
import i18n from "i18next";

import { ApiError, apiClient } from "@/lib/api";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { appendAudioToFormData } from "@/utils/audioFormatDetection";
import { retryAudioUpload } from "@/utils/retryHelper";
import { speakEnglish } from "@/utils/speakEnglish";

import type {
  ScenarioAnswer,
  ScenarioChatAdapters,
  ScenarioChatItem,
  ScenarioFeedback,
} from "./types";

/** 後端的 429 detail code（`services/analysis_quota`）。 */
const QUOTA_CODE = "AI_ANALYSIS_QUOTA_EXCEEDED";

export interface StudentAdapterOptions {
  /** StudentAssignment 的 id（上傳錄音要用）。 */
  assignmentId: number;
  /** 錯誤要讓學生知道（hook 只會還原狀態，不會說話）。 */
  onError?: (message: string) => void;
}

/** 這次作答有沒有可上傳的錄音。文字作答目前沒有開放（見 `scenarioChatSettings`）。 */
function voiceUrlOf(answer: ScenarioAnswer): string | null {
  return answer.kind === "voice" && answer.audioUrl ? answer.audioUrl : null;
}

/**
 * 把 blob URL 取回成 Blob。
 *
 * `ReplyComposer` 只交出 object URL（Blob 自己留在它的 state 裡），所以這裡用 fetch
 * 把它讀回來 —— object URL 對同一個 document 來說就是個可 fetch 的來源。
 */
async function blobFromObjectUrl(url: string): Promise<Blob> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Cannot read recording: ${resp.status}`);
  return resp.blob();
}

/** 上傳一次作答的錄音，回 `progress_id`。 */
export async function uploadAnswerRecording(params: {
  assignmentId: number;
  contentItemId: number;
  blob: Blob;
  durationSeconds?: number;
}): Promise<number> {
  const apiUrl = import.meta.env.VITE_API_URL || "";
  const token = useStudentAuthStore.getState().token;

  const form = new FormData();
  form.append("assignment_id", String(params.assignmentId));
  form.append("content_item_id", String(params.contentItemId));
  if (params.durationSeconds != null) {
    form.append("duration_seconds", String(Math.round(params.durationSeconds)));
  }
  await appendAudioToFormData(form, "audio_file", params.blob);

  const result = await retryAudioUpload(
    async () => {
      const resp = await fetch(`${apiUrl}/api/students/upload-recording`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
      return resp.json();
    },
    (attempt, error) => {
      console.warn(`情境對話錄音上傳重試 (${attempt}):`, error);
    },
  );

  const progressId = result?.progress_id;
  if (typeof progressId !== "number") {
    throw new Error("Upload did not return a progress_id");
  }
  return progressId;
}

/**
 * 後端回應 → 畫面要的 `ScenarioFeedback`。
 *
 * 白名單：只取畫面會用到的三個欄位。後端已經不回分數了，這裡再擋一層 —— 學生畫面
 * 不顯示分數，型別上 `score` 是選填，一旦哪天多帶一個就會自己長出來。
 */
export function toScenarioFeedback(response: {
  verdict?: string;
  comment?: string;
  suggestion?: string | null;
}): ScenarioFeedback {
  return {
    verdict: response.verdict === "great" ? "great" : "improve",
    comment: response.comment ?? "",
    suggestion: response.suggestion || undefined,
  };
}

/** 這個錯誤是不是「這一題的 AI 次數用完了」。 */
export function isQuotaExhausted(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status !== 429) return false;
  const detail = error.detail as { code?: string } | string | undefined;
  // detail 可能是 dict（我們自己丟的）或字串（代理層改寫過）
  if (typeof detail === "object" && detail?.code === QUOTA_CODE) return true;
  return typeof detail === "string" && detail.includes(QUOTA_CODE);
}

/**
 * 預覽用的 adapters：**完全不碰網路**。
 *
 * 老師預覽有兩條路徑都會走到對話式畫面：
 *
 * * 派發 sheet 的即時預覽（`ScenarioDialoguePreview`，#1142）；
 * * `TeacherAssignmentPreviewPage` —— 它用 `isPreviewMode` 餵
 *   `StudentActivityPageContent` 預覽**真實作業**，practice_mode 也是真的，所以情境
 *   對話的作業一樣會走進來。
 *
 * 兩條都不能用學生版 adapters：那會拿老師的 token 去打學生專用端點（401／403），
 * 而且會寫 `StudentItemProgress`、動到配額。預覽的規則一向是「不打 AI、不扣點數」
 * （preview-architecture.md）。
 *
 * * `comment` 由呼叫端給（要帶 i18n 文案，明確標示是預覽）；
 * * `suggestion` 用老師**自己寫的參考答案**（他寫的，給他看合理）；學生端 payload
 *   沒有這個欄位，所以在那條路徑上自然是空的；
 * * **不給分數** —— 預覽的假分數會和批改頁的真分數互相干擾。
 */
export function createPreviewScenarioAdapters(
  comment: string,
): ScenarioChatAdapters {
  return {
    getFeedback: (item: ScenarioChatItem) =>
      Promise.resolve({
        verdict: "improve" as const,
        comment,
        suggestion: item.referenceAnswer || undefined,
      }),
    speak: (text: string) => {
      speakEnglish(text);
    },
    stopSpeech: () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    },
  };
}

export function createStudentScenarioAdapters({
  assignmentId,
  onError,
}: StudentAdapterOptions): ScenarioChatAdapters {
  return {
    getFeedback: async (
      item: ScenarioChatItem,
      answer: ScenarioAnswer,
    ): Promise<ScenarioFeedback> => {
      const audioUrl = voiceUrlOf(answer);
      if (!audioUrl || typeof item.id !== "number") {
        // 沒有錄音，或這一題不是資料庫裡的題目（不該發生）—— reject 讓學生重答
        throw new Error("No recording to send");
      }

      try {
        const blob = await blobFromObjectUrl(audioUrl);
        const itemProgressId = await uploadAnswerRecording({
          assignmentId,
          contentItemId: item.id,
          blob,
          durationSeconds: answer.durationSec,
        });
        const response = await apiClient.scenarioDialogueFeedback({
          item_progress_id: itemProgressId,
          ui_language: i18n.language,
        });
        return toScenarioFeedback(response);
      } catch (error) {
        if (isQuotaExhausted(error)) {
          // 次數用完：**resolve**，讓對話往前走並說明原因。reject 會被 hook 還原成
          // 「再答一次」，而再答幾次都一樣 —— 學生只會原地打轉（見檔頭）。
          return {
            verdict: "improve",
            comment: i18n.t("scenarioDialogue.chat.quotaExhausted"),
          };
        }
        onError?.(i18n.t("scenarioDialogue.chat.feedbackFailed"));
        throw error;
      }
    },

    // 既有的 production helper（#674 處理「中文系統語言會把 I 唸成 Capital I」）。
    // 設計稿自己寫了一份簡化版，正式路徑不用那一份。
    speak: (text: string) => {
      speakEnglish(text);
    },
    stopSpeech: () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    },
  };
}
