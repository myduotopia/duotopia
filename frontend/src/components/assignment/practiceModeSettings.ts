/**
 * practiceModeSettings — 派發進階條件設定的純邏輯（#878 Stage 3）
 *
 * 把原本散在 AssignmentDialog 各 onChange 的「開 A 連動關 B / 一鍵設多個 key」邏輯
 * 收斂成單一純函式 `applySettingChange`，呼叫端（Panel）只給 value + onChange(next)。
 * 這是 #846（派發 dialog 與派後編輯 sheet 各寫一份條件邏輯會漂移）的根治：
 * Stage 3.5 的 AssignmentDetailSheet 直接複用同一份。
 *
 * 純函式、無 React/DOM，便於單元測試（見 __tests__/practiceModeSettings.test.ts）。
 */
import {
  resolveScoreCategoryFE,
  type PracticeMode,
  type SettingSpec,
  type SettingKey,
  type SettingValue,
} from "@/lib/practiceMode";
import type { ScoreCategory } from "@/utils/scoreCategory";

/** Panel 管理的設定欄位子集（型別鏡射 AssignmentDialog 的 formData）。 */
export interface PracticeModeSettings {
  time_limit_per_question: 0 | 10 | 20 | 30 | 40;
  quiz_time_limit_seconds: 0 | 180 | 300 | 600 | 900 | 1200 | 1800;
  shuffle_questions: boolean;
  show_answer: boolean;
  play_audio: boolean;
  target_proficiency: number;
  show_translation: boolean;
  show_word: boolean;
  show_image: boolean;
  show_option_images: boolean;
}

type MutableSettings = Record<SettingKey, SettingValue>;

// 合法時間選項（鏡射 PracticeModeSettings 的 literal union）。API 回傳的時間值必須落在這些
// 選項上，<select> 才有對應 option 高亮；否則畫面會出現「無選中項」。
const TIME_PER_QUESTION_OPTIONS = [0, 10, 20, 30, 40] as const;
const QUIZ_TIME_OPTIONS = [0, 180, 300, 600, 900, 1200, 1800] as const;

function snapToNearest<T extends number>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  if (value == null) return fallback; // null/undefined → fallback（保留舊 `?? 30` 行為，Number(null)=0 會誤判）
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return options.reduce(
    (best, opt) => (Math.abs(opt - n) < Math.abs(best - n) ? opt : best),
    options[0],
  );
}

/**
 * 把 API 回傳的 time_limit_per_question 夾到最接近的合法選項（非數字→fallback 30）。
 * 防禦髒資料（如 15）讓 <select> 渲染不出高亮 option。
 */
export function clampPerQuestionTime(
  value: unknown,
): PracticeModeSettings["time_limit_per_question"] {
  return snapToNearest(value, TIME_PER_QUESTION_OPTIONS, 30);
}

/** 把 API 回傳的 quiz_time_limit_seconds 夾到最接近的合法選項（非數字→fallback 0）。 */
export function clampQuizTime(
  value: unknown,
): PracticeModeSettings["quiz_time_limit_seconds"] {
  return snapToNearest(value, QUIZ_TIME_OPTIONS, 0);
}

/**
 * 套用一次設定變更，回傳新的 value（純函式、不 mutate 入參）。
 * - toggle 開啟（true）時，連動關閉 `excludes` 列的 key（如 show_image ↔ show_option_images）。
 * - segmented 選某顆按鈕時，套用該按鈕的 `patch`（一次設多個 key，如「播放音檔」同時
 *   play_audio=true + show_answer=true + show_translation=false）。
 */
export function applySettingChange(
  value: PracticeModeSettings,
  spec: SettingSpec,
  rawNext: SettingValue,
): PracticeModeSettings {
  const next = { ...value } as MutableSettings;
  next[spec.key] = rawNext;

  if (spec.kind === "toggle" && rawNext === true && spec.excludes) {
    for (const ex of spec.excludes) next[ex] = false;
  }

  if (spec.kind === "segmented") {
    const opt = spec.options.find((o) => o.value === rawNext);
    if (opt?.patch) {
      for (const k of Object.keys(opt.patch) as SettingKey[]) {
        next[k] = opt.patch[k] as SettingValue;
      }
    }
  }

  return next as unknown as PracticeModeSettings;
}

/**
 * segmented 某顆按鈕是否為當前選中態。判定 = 主 key 相符 ∧ 該按鈕 patch 的所有 key 也相符
 * （沿用舊行為：如「顯示單字」鈕須 show_word=true ∧ play_audio=false 才算選中）。
 */
export function isSegmentedOptionActive(
  value: PracticeModeSettings,
  spec: SettingSpec & { kind: "segmented" },
  option: {
    value: SettingValue;
    patch?: Partial<Record<SettingKey, SettingValue>>;
  },
): boolean {
  const v = value as unknown as MutableSettings;
  if (v[spec.key] !== option.value) return false;
  if (option.patch) {
    for (const k of Object.keys(option.patch) as SettingKey[]) {
      if (v[k] !== option.patch[k]) return false;
    }
  }
  return true;
}

/** 拼寫/克漏字（含小考）在播放音檔時，「顯示答案」強制鎖定打勾（聽音作答必須給正解）。 */
const AUDIO_LOCKS_SHOW_ANSWER: ReadonlySet<PracticeMode> = new Set([
  "word_spelling",
  "word_cloze",
  "word_spelling_quiz",
  "word_cloze_quiz",
]);

export function isShowAnswerLockedByAudio(
  mode: PracticeMode,
  value: PracticeModeSettings,
): boolean {
  return AUDIO_LOCKS_SHOW_ANSWER.has(mode) && value.play_audio;
}

/**
 * 推導某顆 segmented 按鈕對應的成績類別（取代硬寫「→聽力/→寫作」）。
 * 該按鈕套用後的 play_audio：key 本身是 play_audio 時取 option.value、否則看 patch.play_audio、
 * 再 fallback 到當前 value.play_audio。丟給 resolveScoreCategoryFE（與後端規則等價）。
 */
export function segmentedScoreCategory(
  mode: PracticeMode,
  spec: SettingSpec & { kind: "segmented" },
  option: {
    value: SettingValue;
    patch?: Partial<Record<SettingKey, SettingValue>>;
  },
  value: PracticeModeSettings,
): ScoreCategory {
  const playAudio =
    spec.key === "play_audio"
      ? Boolean(option.value)
      : option.patch?.play_audio !== undefined
        ? Boolean(option.patch.play_audio)
        : value.play_audio;
  return resolveScoreCategoryFE(mode, playAudio);
}
