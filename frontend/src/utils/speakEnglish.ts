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

  const doSpeak = () => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = options.rate ?? 1.0;
    utterance.pitch = options.pitch ?? 1.0;
    utterance.volume = options.volume ?? 1.0;

    const { onError } = options;
    if (onError) {
      utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        if (!BENIGN_SPEECH_ERRORS.has(event.error)) onError();
      };
    }

    const voice = pickEnglishVoice();
    if (voice) {
      utterance.voice = voice;
    } else {
      console.warn(
        "[speakEnglish] No English voice available; falling back to lang=en-US only.",
      );
      onError?.();
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
      synth.cancel();
    };
  }

  doSpeak();
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
