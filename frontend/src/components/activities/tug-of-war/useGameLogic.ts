/**
 * useGameLogic - Tug of War game logic hook
 *
 * 管理拔河遊戲的核心邏輯：題目生成、搶答、冷卻、計分。純前端邏輯，不呼叫後端 API。
 *
 * 支援兩種出題方式（issue #920）：
 * - 同題模式（預設）：兩隊看同一題，搶答成功者得分、雙方一起進下一題。
 * - 不同題模式（diffMode）：兩隊各有獨立題目流，各自作答互不干擾。
 *   聽音檔模式強制關閉（共用聲音無法對應兩題）。
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type {
  VocabItem,
  Question,
  QuestionMode,
  Team,
  GameState,
  GameConfig,
} from "./types";
import { DEFAULT_GAME_CONFIG } from "./types";

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const CLOZE_BLANK = "_____";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 例句是否含目標字（word-boundary、大小寫不敏感）→ 決定 cloze 有效。 */
function sentenceContainsWord(sentence: string, target: string): boolean {
  if (!sentence || !target) return false;
  return new RegExp(`\\b${escapeRegex(target)}\\b`, "i").test(sentence);
}

function makeCloze(sentence: string, target: string): string {
  if (!sentence) return CLOZE_BLANK;
  if (!target) return sentence;
  const re = new RegExp(`\\b${escapeRegex(target)}\\b`, "gi");
  if (re.test(sentence)) {
    return sentence.replace(re, CLOZE_BLANK);
  }
  // 例句不含目標字 → 原樣回傳（不硬補空格）；正常情況已由 hasValidCloze 過濾掉，防禦性
  return sentence;
}

/** 有效克漏字：例句存在且含目標字（否則無答案，不出題）。 */
export function hasValidCloze(item: VocabItem): boolean {
  return !!item.example_sentence && sentenceContainsWord(item.example_sentence, item.text);
}

/** 音檔題有效：單字有錄音（audio→英/翻譯 需真音檔，不吃 TTS fallback）。 */
export function hasWordAudio(item: VocabItem): boolean {
  return !!item.audio_url;
}

/** 聽音檔模式（強制同題；其餘模式可開不同題）。 */
export function isAudioOnlyMode(mode: QuestionMode): boolean {
  return mode === "audio_to_english" || mode === "audio_to_chinese";
}

function generateQuestions(
  vocabItems: VocabItem[],
  mode: QuestionMode,
): Question[] {
  let items = shuffleArray(vocabItems);

  // Image modes: prefer items with image_url (fallback to all if < 4)
  if (mode === "image_to_english") {
    const withImages = items.filter((i) => i.image_url);
    if (withImages.length >= 4) {
      items = withImages;
    }
  }

  // 音檔題：只保留有錄音的字（沒音檔不出題）
  if (mode === "audio_to_english" || mode === "audio_to_chinese") {
    items = items.filter(hasWordAudio);
  }

  // 克漏字：只保留「例句含目標字」的有效題（沒答案不出題）
  if (mode === "cloze_to_english") {
    items = items.filter(hasValidCloze);
  }

  return items.map((item) => {
    // Determine correct answer and prompt based on mode
    let correctAnswer: string;
    let prompt: string;
    let hasAudio = false;
    let hasImage = false;
    let hasCloze = false;
    let clozeSentence: string | undefined;
    let clozeTranslation: string | undefined;

    switch (mode) {
      case "audio_to_english":
        correctAnswer = item.text;
        prompt = ""; // Audio playback, no text prompt
        hasAudio = true;
        break;
      case "audio_to_chinese":
        correctAnswer = item.translation;
        prompt = "";
        hasAudio = true;
        break;
      case "english_to_chinese":
        correctAnswer = item.translation;
        prompt = item.text;
        break;
      case "chinese_to_english":
        correctAnswer = item.text;
        prompt = item.translation;
        break;
      case "image_to_english":
        correctAnswer = item.text;
        prompt = "";
        hasImage = true;
        break;
      case "cloze_to_english":
        correctAnswer = item.text;
        prompt = "";
        hasCloze = true;
        hasAudio = true;
        clozeSentence = makeCloze(item.example_sentence || "", item.text);
        clozeTranslation = item.example_sentence_translation || undefined;
        break;
    }

    // Generate distractors from other vocab items
    const isAnswerEnglish =
      mode === "audio_to_english" ||
      mode === "chinese_to_english" ||
      mode === "image_to_english" ||
      mode === "cloze_to_english";
    const pool = vocabItems
      .filter((v) => v.id !== item.id)
      .map((v) => (isAnswerEnglish ? v.text : v.translation))
      .filter((v) => v !== correctAnswer);

    const distractors = shuffleArray(pool).slice(0, 3);

    // If not enough distractors, pad with placeholders
    while (distractors.length < 3) {
      distractors.push(`---`);
    }

    const options = [correctAnswer, ...distractors];
    const optionsA = shuffleArray(options);
    const optionsB = shuffleArray(options);

    return {
      vocabItem: item,
      correctAnswer,
      prompt,
      options,
      optionsA,
      optionsB,
      hasAudio,
      hasImage,
      hasCloze,
      clozeSentence,
      clozeTranslation,
    };
  });
}

/** 建立一局新遊戲狀態（startGame / changeMode / setDiffMode 共用）。 */
function buildGameState(
  prev: GameState,
  vocabItems: VocabItem[],
  mode: QuestionMode,
  wantDiff: boolean,
): GameState {
  const questions = generateQuestions(vocabItems, mode);
  // 聽音檔模式強制同題
  const diffMode = wantDiff && !isAudioOnlyMode(mode);
  const questionsB = diffMode ? generateQuestions(vocabItems, mode) : questions;
  return {
    questions,
    questionsB,
    currentIndex: 0,
    indexB: 0,
    ropePosition: 0,
    teamACooldown: false,
    teamBCooldown: false,
    questionMode: mode,
    showSentenceTranslation: prev.showSentenceTranslation,
    audioMuted: prev.audioMuted,
    gameStatus: "playing",
    scores: { a: 0, b: 0 },
    answeredBy: null,
    lastCorrectTeam: null,
    answerHistory: [],
    diffMode,
    lockA: false,
    lockB: false,
  };
}

export function useGameLogic(
  vocabItems: VocabItem[],
  config: GameConfig = DEFAULT_GAME_CONFIG,
) {
  const [gameState, setGameState] = useState<GameState>({
    questions: [],
    questionsB: [],
    currentIndex: 0,
    indexB: 0,
    ropePosition: 0,
    teamACooldown: false,
    teamBCooldown: false,
    questionMode: "audio_to_english",
    showSentenceTranslation: false,
    audioMuted: false,
    gameStatus: "waiting",
    scores: { a: 0, b: 0 },
    answeredBy: null,
    lastCorrectTeam: null,
    answerHistory: [],
    diffMode: false,
    lockA: false,
    lockB: false,
  });

  const cooldownTimerA = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimerB = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // shared / team A
  const transitionTimerB = useRef<ReturnType<typeof setTimeout> | null>(null); // team B (diff mode)

  const clearAllTimers = useCallback(() => {
    for (const t of [
      cooldownTimerA,
      cooldownTimerB,
      transitionTimer,
      transitionTimerB,
    ]) {
      if (t.current) {
        clearTimeout(t.current);
        t.current = null;
      }
    }
  }, []);

  // Cleanup timers on unmount
  useEffect(() => clearAllTimers, [clearAllTimers]);

  const startGame = useCallback(
    (mode: QuestionMode = "audio_to_english") => {
      clearAllTimers();
      setGameState((prev) =>
        buildGameState(prev, vocabItems, mode, prev.diffMode),
      );
    },
    [vocabItems, clearAllTimers],
  );

  const changeMode = useCallback(
    (mode: QuestionMode) => {
      clearAllTimers();
      setGameState((prev) =>
        buildGameState(prev, vocabItems, mode, prev.diffMode),
      );
    },
    [vocabItems, clearAllTimers],
  );

  /** 切換「兩隊不同題」；聽音檔模式忽略（強制同題）。重開一局避免進行中狀態混亂。 */
  const setDiffMode = useCallback(
    (wantDiff: boolean) => {
      clearAllTimers();
      setGameState((prev) =>
        buildGameState(prev, vocabItems, prev.questionMode, wantDiff),
      );
    },
    [vocabItems, clearAllTimers],
  );

  const toggleSentenceTranslation = useCallback(() => {
    setGameState((prev) => ({
      ...prev,
      showSentenceTranslation: !prev.showSentenceTranslation,
    }));
  }, []);

  const toggleAudioMute = useCallback(() => {
    setGameState((prev) => ({ ...prev, audioMuted: !prev.audioMuted }));
  }, []);

  const handleAnswer = useCallback(
    (team: Team, selectedAnswer: string) => {
      setGameState((prev) => {
        if (prev.gameStatus !== "playing") return prev;
        if (team === "a" && prev.teamACooldown) return prev;
        if (team === "b" && prev.teamBCooldown) return prev;

        // Win condition: first team to floor(total/2)+1 points
        const winScore = Math.floor(prev.questions.length / 2) + 1;

        // -------- Different-question-per-team mode --------
        if (prev.diffMode) {
          // Each team locked/advances independently
          if (team === "a" && prev.lockA) return prev;
          if (team === "b" && prev.lockB) return prev;

          const question =
            team === "a"
              ? prev.questions[prev.currentIndex]
              : prev.questionsB[prev.indexB];
          if (!question) return prev;

          const isCorrect = selectedAnswer === question.correctAnswer;

          if (!isCorrect) {
            const cooldownKey =
              team === "a" ? "teamACooldown" : "teamBCooldown";
            const timerRef = team === "a" ? cooldownTimerA : cooldownTimerB;
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
              setGameState((s) => ({ ...s, [cooldownKey]: false }));
            }, config.cooldownMs);
            return { ...prev, [cooldownKey]: true };
          }

          const rawRope =
            team === "a" ? prev.ropePosition - 1 : prev.ropePosition + 1;
          const newRope = Math.max(-winScore, Math.min(winScore, rawRope));
          const newScores = { ...prev.scores, [team]: prev.scores[team] + 1 };
          const newHistory = [...prev.answerHistory, { question, team }];
          const hasWon = newScores[team] >= winScore;

          if (hasWon) {
            clearAllTimers();
            return {
              ...prev,
              ropePosition: newRope,
              scores: newScores,
              lastCorrectTeam: team,
              lockA: false,
              lockB: false,
              teamACooldown: false,
              teamBCooldown: false,
              gameStatus: "finished" as const,
              answerHistory: newHistory,
            };
          }

          // Schedule this team's own transition to its next question
          const lockKey = team === "a" ? "lockA" : "lockB";
          const idxKey = team === "a" ? "currentIndex" : "indexB";
          const listLen =
            team === "a" ? prev.questions.length : prev.questionsB.length;
          const timerRef = team === "a" ? transitionTimer : transitionTimerB;
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            setGameState((s) => {
              const cur = team === "a" ? s.currentIndex : s.indexB;
              const next = cur + 1 >= listLen ? 0 : cur + 1;
              return { ...s, [idxKey]: next, [lockKey]: false };
            });
          }, config.transitionMs);

          return {
            ...prev,
            ropePosition: newRope,
            scores: newScores,
            lastCorrectTeam: team,
            [lockKey]: true,
            answerHistory: newHistory,
          };
        }

        // -------- Same-question mode (shared, unchanged behaviour) --------
        if (prev.answeredBy !== null) return prev;

        const currentQuestion = prev.questions[prev.currentIndex];
        if (!currentQuestion) return prev;

        const isCorrect = selectedAnswer === currentQuestion.correctAnswer;

        if (isCorrect) {
          const rawRope =
            team === "a" ? prev.ropePosition - 1 : prev.ropePosition + 1;
          const newRope = Math.max(-winScore, Math.min(winScore, rawRope));
          const newScores = { ...prev.scores, [team]: prev.scores[team] + 1 };
          const newHistory = [
            ...prev.answerHistory,
            { question: currentQuestion, team },
          ];
          const hasWon = newScores[team] >= winScore;

          if (cooldownTimerA.current) clearTimeout(cooldownTimerA.current);
          if (cooldownTimerB.current) clearTimeout(cooldownTimerB.current);

          if (hasWon) {
            return {
              ...prev,
              ropePosition: newRope,
              scores: newScores,
              answeredBy: team,
              lastCorrectTeam: team,
              teamACooldown: false,
              teamBCooldown: false,
              gameStatus: "finished" as const,
              answerHistory: newHistory,
            };
          }

          transitionTimer.current = setTimeout(() => {
            setGameState((s) => {
              const nextIndex = s.currentIndex + 1;
              const looped = nextIndex >= s.questions.length ? 0 : nextIndex;
              return {
                ...s,
                currentIndex: looped,
                answeredBy: null,
                teamACooldown: false,
                teamBCooldown: false,
                lastCorrectTeam: null,
              };
            });
          }, config.transitionMs);

          return {
            ...prev,
            ropePosition: newRope,
            scores: newScores,
            answeredBy: team,
            lastCorrectTeam: team,
            teamACooldown: false,
            teamBCooldown: false,
            answerHistory: newHistory,
          };
        } else {
          const cooldownKey = team === "a" ? "teamACooldown" : "teamBCooldown";
          const timerRef = team === "a" ? cooldownTimerA : cooldownTimerB;
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            setGameState((s) => ({ ...s, [cooldownKey]: false }));
          }, config.cooldownMs);
          return { ...prev, [cooldownKey]: true };
        }
      });
    },
    [config.cooldownMs, config.transitionMs, clearAllTimers],
  );

  const playing =
    gameState.gameStatus === "playing" && gameState.questions.length > 0;

  // Per-team current question (same mode → both point at shared question)
  const currentQuestionA = playing
    ? gameState.questions[gameState.currentIndex]
    : null;
  const currentQuestionB = playing
    ? gameState.diffMode
      ? gameState.questionsB[gameState.indexB]
      : gameState.questions[gameState.currentIndex]
    : null;
  const currentQuestion = currentQuestionA; // shared alias (same-mode banner etc.)

  const totalQuestions = gameState.questions.length;
  const progressA = totalQuestions > 0 ? gameState.currentIndex + 1 : 0;
  const progressB =
    gameState.questionsB.length > 0 ? gameState.indexB + 1 : progressA;
  const winScore = totalQuestions > 0 ? Math.floor(totalQuestions / 2) + 1 : 1;

  // Per-team locked (options disabled) + pulling (pull animation)
  const answeredA = gameState.diffMode
    ? gameState.lockA
    : gameState.answeredBy !== null;
  const answeredB = gameState.diffMode
    ? gameState.lockB
    : gameState.answeredBy !== null;
  const pullA = gameState.diffMode
    ? gameState.lockA
    : gameState.answeredBy === "a";
  const pullB = gameState.diffMode
    ? gameState.lockB
    : gameState.answeredBy === "b";

  const winner: Team | "draw" | null =
    gameState.gameStatus === "finished"
      ? gameState.scores.a > gameState.scores.b
        ? "a"
        : gameState.scores.b > gameState.scores.a
          ? "b"
          : "draw"
      : null;

  return {
    gameState,
    currentQuestion,
    currentQuestionA,
    currentQuestionB,
    answeredA,
    answeredB,
    pullA,
    pullB,
    totalQuestions,
    winScore,
    progress: progressA,
    progressB,
    winner,
    answerHistory: gameState.answerHistory,
    startGame,
    changeMode,
    setDiffMode,
    handleAnswer,
    toggleSentenceTranslation,
    toggleAudioMute,
  };
}
