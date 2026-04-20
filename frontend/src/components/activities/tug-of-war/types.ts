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
  | "image_to_english"; // 看圖 → 選英文

export type Team = "a" | "b";

export type GameStatus = "waiting" | "playing" | "paused" | "finished";

export interface VocabItem {
  id: number;
  text: string; // English word
  translation: string; // Chinese translation
  audio_url?: string;
  image_url?: string;
  part_of_speech?: string;
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
}

export interface AnswerRecord {
  question: Question;
  team: Team; // Who answered correctly
}

export interface GameState {
  questions: Question[];
  currentIndex: number;
  ropePosition: number; // negative = A leading, positive = B leading
  teamACooldown: boolean;
  teamBCooldown: boolean;
  questionMode: QuestionMode;
  gameStatus: GameStatus;
  scores: { a: number; b: number };
  answeredBy: Team | null; // Who answered the current question
  lastCorrectTeam: Team | null; // For animation
  answerHistory: AnswerRecord[]; // Track who answered each question
}

export interface GameConfig {
  cooldownMs: number; // Default 2000ms
  transitionMs: number; // Time between questions, default 1000ms
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  cooldownMs: 2000,
  transitionMs: 1200,
};

// Keyboard mappings
export const TEAM_A_KEYS = ["1", "2", "3", "4"];
export const TEAM_B_KEYS = ["7", "8", "9", "0"];

// Display labels for options (shown in UI)
export const OPTION_LABELS = ["A", "B", "C", "D"];
