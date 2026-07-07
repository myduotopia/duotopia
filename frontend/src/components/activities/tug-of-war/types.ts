/**
 * Tug of War Game - Type Definitions
 *
 * 拔河遊戲的型別定義。純前端遊戲，不寫入資料庫。
 */

export type QuestionMode =
  | "audio_to_english" // 音檔播放 → 選英文 (default)
  | "audio_to_chinese" // 音檔播放 → 選中文
  | "english_to_chinese" // 英文 → 選中文
  | "chinese_to_english" // 中文 → 選英文
  | "image_to_english" // 看圖 → 選英文
  | "cloze_to_english"; // 例句克漏字 → 選英文

export type Team = "a" | "b";

export type GameStatus = "waiting" | "playing" | "paused" | "finished";

export interface VocabItem {
  id: number;
  text: string; // English word
  translation: string; // Chinese translation
  audio_url?: string;
  image_url?: string;
  part_of_speech?: string;
  example_sentence?: string;
  example_sentence_translation?: string;
  example_sentence_audio_url?: string;
}

export interface Question {
  vocabItem: VocabItem;
  correctAnswer: string;
  prompt: string; // What's displayed as the question
  options: string[]; // All 4 options (1 correct + 3 distractors)
  optionsA: string[]; // Shuffled for Team A
  optionsB: string[]; // Shuffled differently for Team B
  hasAudio: boolean; // Whether this question uses audio playback
  hasImage: boolean; // Whether this question uses image as prompt
  hasCloze: boolean; // Whether this question shows a cloze sentence as prompt
  clozeSentence?: string; // Sentence with target word blanked
  clozeTranslation?: string; // Optional translation of the sentence
}

export interface AnswerRecord {
  question: Question;
  team: Team; // Who answered correctly
}

export interface GameState {
  questions: Question[]; // Shared list (same-question mode) / Team A's stream (diff mode)
  currentIndex: number; // Shared index / Team A's index in diff mode
  ropePosition: number; // negative = A leading, positive = B leading
  teamACooldown: boolean;
  teamBCooldown: boolean;
  questionMode: QuestionMode;
  showSentenceTranslation: boolean; // For cloze mode — default false
  audioMuted: boolean; // Persistent mute toggle across audio-mode questions
  gameStatus: GameStatus;
  scores: { a: number; b: number };
  answeredBy: Team | null; // Same-question mode: who answered current question (locks both)
  lastCorrectTeam: Team | null; // For animation
  answerHistory: AnswerRecord[]; // Track who answered each question

  // ---- Different-question-per-team mode (issue #920) ----
  // When on, each team has its own question stream and answers independently.
  // Audio modes force this off (a shared sound can't back two questions).
  diffMode: boolean;
  questionsB: Question[]; // Team B's stream (diff mode); === questions when same mode
  indexB: number; // Team B's index (diff mode)
  lockA: boolean; // Diff mode: Team A locked during its own transition
  lockB: boolean; // Diff mode: Team B locked during its own transition
}

export interface GameConfig {
  cooldownMs: number; // Default 2000ms
  transitionMs: number; // Time between questions, default 1000ms
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  cooldownMs: 2000,
  // 答對後停留時間：讓學生看清正解揭示（尤其音檔題無題目帶），落在 1-2 秒
  transitionMs: 1800,
};

// Keyboard mappings
export const TEAM_A_KEYS = ["1", "2", "3", "4"];
export const TEAM_B_KEYS = ["7", "8", "9", "0"];

// Display labels for options (shown in UI)
export const OPTION_LABELS = ["A", "B", "C", "D"];
