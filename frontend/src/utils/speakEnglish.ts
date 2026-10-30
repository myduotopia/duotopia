/**
 * speakEnglish - 強制以英文 voice 播放文字的 Web Speech API helper
 *
 * Issue #674: 學生端系統語言設為中文時，瀏覽器 TTS 預設可能 fallback 到中文 voice，
 * 即使 utterance.lang = "en-US" 也會把 "I" 唸成 "Capital I"、"6:00" 唸成「六」。
 * 解法：明確從 getVoices() 挑一個 en-* voice 指派到 utterance.voice。
 *
 * 行為：
 * - 優先挑 en-US，否則任何 lang 以 "en" 開頭的 voice
 * - voices 尚未載入時等一次 voiceschanged 事件後再 speak
 * - 找不到英文 voice 時仍以 lang="en-US" 播放（不阻斷使用者），並 console.warn
 * - 每次呼叫前 cancel() 既有發音
 * - `onError`（可選，#1158 E2）：朗讀實際出錯（utterance 的 error 事件，被 cancel／打斷的
 *   "canceled"／"interrupted" 不算）或找不到英文 voice 時呼叫，讓呼叫端改用文字補救
 * - 逾時保底（#1158 E2b）：有 `onError` 時，呼叫後 START_TIMEOUT_MS 內沒有 onstart（瀏覽器靜默
 *   擋掉自動朗讀、語音清單一直沒載入等）就當作出錯呼叫 `onError`。下一次呼叫或 cleanup 會取消
 *   上一句的逾時；每一句的 `onError` 最多呼叫一次。
 * - `onEnd`（可選）：這一句結束（唸完、出錯、被打斷）時呼叫，給 SpeakableWords 清播放中標示
 *
 * `stopSpeaking()`：停止朗讀並取消逾時保底（停掉不算失敗）。
 *
 * `primeSpeechSynthesis()`：在使用者點擊當下先唸一段音量 0 的空字串並觸發載入語音清單，
 * 之後計時器裡的自動朗讀才不會被瀏覽器（iOS Safari 等）的手勢限制擋掉（#1158 E-2）。
 */

export interface SpeakEnglishOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  /** 朗讀出錯或沒有英文 voice 時呼叫 */
  onError?: () => void;
  /** 這一句結束時呼叫：唸完、出錯、被 cancel／打斷都算（播放中標示用） */
  onEnd?: () => void;
}

/** 呼叫後多久還沒開始唸就當作失敗（瀏覽器擋自動朗讀時常常什麼事件都不給） */
export const START_TIMEOUT_MS = 2500;

/** 上一句的「沒開始唸」逾時；新的一句開始時取消，免得把錯誤算到已被取代的那一句 */
let pendingStartTimer: ReturnType<typeof setTimeout> | null = null;

function clearStartTimer() {
  if (pendingStartTimer !== null) {
    clearTimeout(pendingStartTimer);
    pendingStartTimer = null;
  }
}

/** 這兩種 error 是 cancel()／下一句打斷造成的，不是朗讀失敗 */
const BENIGN_SPEECH_ERRORS = new Set(["canceled", "interrupted"]);

function pickEnglishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  return (
    voices.find((v) => v.lang === "en-US") ??
    voices.find((v) => v.lang.toLowerCase().startsWith("en")) ??
    null
  );
}

export function speakEnglish(
  text: string,
  options: SpeakEnglishOptions = {},
): (() => void) | void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  const synth = window.speechSynthesis;
  synth.cancel();
  clearStartTimer();

  // onError 最多一次：沒有英文 voice、error 事件、逾時三條路可能先後都到
  let errored = false;
  let myTimer: ReturnType<typeof setTimeout> | null = null;
  /** 只取消「自己這一句」的逾時：舊句子晚到的事件不能把新句子的保底取消掉 */
  const clearMine = () => {
    if (myTimer !== null && pendingStartTimer === myTimer) clearStartTimer();
    myTimer = null;
  };
  const fail = options.onError
    ? () => {
        clearMine();
        if (errored) return;
        errored = true;
        options.onError?.();
      }
    : undefined;
  if (fail) {
    myTimer = setTimeout(fail, START_TIMEOUT_MS);
    pendingStartTimer = myTimer;
  }

  const doSpeak = () => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = options.rate ?? 1.0;
    utterance.pitch = options.pitch ?? 1.0;
    utterance.volume = options.volume ?? 1.0;

    const { onEnd } = options;
    if (fail) utterance.onstart = () => clearMine();
    if (onEnd || fail) {
      utterance.onend = () => {
        if (fail) clearMine();
        onEnd?.();
      };
      utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        onEnd?.();
        if (!fail) return;
        if (BENIGN_SPEECH_ERRORS.has(event.error)) clearMine();
        else fail();
      };
    }

    const voice = pickEnglishVoice();
    if (voice) {
      utterance.voice = voice;
    } else {
      console.warn(
        "[speakEnglish] No English voice available; falling back to lang=en-US only.",
      );
      fail?.();
    }

    synth.speak(utterance);
  };

  if (synth.getVoices().length === 0) {
    const handler = () => {
      synth.removeEventListener("voiceschanged", handler);
      doSpeak();
    };
    synth.addEventListener("voiceschanged", handler);
    // Return cleanup so callers (e.g. React useEffect) can cancel on unmount
    return () => {
      synth.removeEventListener("voiceschanged", handler);
      clearStartTimer();
      synth.cancel();
    };
  }

  doSpeak();
}

/** 停止朗讀，並取消還沒開始那一句的逾時保底（停掉不算朗讀失敗） */
export function stopSpeaking(): void {
  clearStartTimer();
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}

/** 在使用者點擊當下解鎖朗讀（見檔頭說明） */
export function primeSpeechSynthesis(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  synth.getVoices();
  const u = new SpeechSynthesisUtterance("");
  u.volume = 0;
  synth.speak(u);
}
