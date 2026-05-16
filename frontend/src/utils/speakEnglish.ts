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
 */

export interface SpeakEnglishOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
}

function pickEnglishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  return (
    voices.find((v) => v.lang === "en-US") ??
    voices.find((v) => v.lang.toLowerCase().startsWith("en")) ??
    null
  );
}

export function speakEnglish(text: string, options: SpeakEnglishOptions = {}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  const synth = window.speechSynthesis;
  synth.cancel();

  const doSpeak = () => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = options.rate ?? 1.0;
    utterance.pitch = options.pitch ?? 1.0;
    utterance.volume = options.volume ?? 1.0;

    const voice = pickEnglishVoice();
    if (voice) {
      utterance.voice = voice;
    } else {
      console.warn(
        "[speakEnglish] No English voice available; falling back to lang=en-US only.",
      );
    }

    synth.speak(utterance);
  };

  if (synth.getVoices().length === 0) {
    const handler = () => {
      synth.removeEventListener("voiceschanged", handler);
      doSpeak();
    };
    synth.addEventListener("voiceschanged", handler);
    return;
  }

  doSpeak();
}
