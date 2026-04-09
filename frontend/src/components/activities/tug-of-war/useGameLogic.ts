/**
 * useGameLogic - Tug of War game logic hook
 *
 * 管理拔河遊戲的核心邏輯：題目生成、搶答、冷卻、計分。
 * 純前端邏輯，不呼叫後端 API。
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

function generateQuestions(
  vocabItems: VocabItem[],
  mode: QuestionMode,
): Question[] {
  const items = shuffleArray(vocabItems);

  return items.map((item) => {
    // Determine correct answer and prompt based on mode
    let correctAnswer: string;
    let prompt: string;
    let hasAudio = false;

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
    }

    // Generate distractors from other vocab items
    const isAnswerEnglish =
      mode === "audio_to_english" || mode === "chinese_to_english";
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
    };
  });
}

export function useGameLogic(
  vocabItems: VocabItem[],
  config: GameConfig = DEFAULT_GAME_CONFIG,
) {
  const [gameState, setGameState] = useState<GameState>({
    questions: [],
    currentIndex: 0,
    ropePosition: 0,
    teamACooldown: false,
    teamBCooldown: false,
    questionMode: "audio_to_english",
    gameStatus: "waiting",
    scores: { a: 0, b: 0 },
    answeredBy: null,
    lastCorrectTeam: null,
    answerHistory: [],
  });

  const cooldownTimerA = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimerB = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (cooldownTimerA.current) clearTimeout(cooldownTimerA.current);
      if (cooldownTimerB.current) clearTimeout(cooldownTimerB.current);
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
    };
  }, []);

  const startGame = useCallback(
    (mode: QuestionMode = "audio_to_english") => {
      const questions = generateQuestions(vocabItems, mode);
      setGameState({
        questions,
        currentIndex: 0,
        ropePosition: 0,
        teamACooldown: false,
        teamBCooldown: false,
        questionMode: mode,
        gameStatus: "playing",
        scores: { a: 0, b: 0 },
        answeredBy: null,
        lastCorrectTeam: null,
        answerHistory: [],
      });
    },
    [vocabItems],
  );

  const changeMode = useCallback(
    (mode: QuestionMode) => {
      // Regenerate questions with new mode, reset game
      const questions = generateQuestions(vocabItems, mode);
      setGameState({
        questions,
        currentIndex: 0,
        ropePosition: 0,
        teamACooldown: false,
        teamBCooldown: false,
        questionMode: mode,
        gameStatus: "playing",
        scores: { a: 0, b: 0 },
        answeredBy: null,
        lastCorrectTeam: null,
        answerHistory: [],
      });
    },
    [vocabItems],
  );

  const handleAnswer = useCallback(
    (team: Team, selectedAnswer: string) => {
      setGameState((prev) => {
        // Guard: game not playing or already answered or in cooldown
        if (prev.gameStatus !== "playing") return prev;
        if (prev.answeredBy !== null) return prev;
        if (team === "a" && prev.teamACooldown) return prev;
        if (team === "b" && prev.teamBCooldown) return prev;

        const currentQuestion = prev.questions[prev.currentIndex];
        if (!currentQuestion) return prev;

        const isCorrect = selectedAnswer === currentQuestion.correctAnswer;

        if (isCorrect) {
          // Correct answer - this team scores
          const winScore = Math.floor(prev.questions.length / 2) + 1;
          const rawRope =
            team === "a" ? prev.ropePosition - 1 : prev.ropePosition + 1;
          // Clamp rope position so it never exceeds win boundaries
          const newRope = Math.max(-winScore, Math.min(winScore, rawRope));
          const newScores = {
            ...prev.scores,
            [team]: prev.scores[team] + 1,
          };
          const newHistory = [
            ...prev.answerHistory,
            { question: currentQuestion, team },
          ];

          // Check win condition: first to Math.floor(total/2) + 1
          const hasWon = newScores[team] >= winScore;

          // Clear any cooldown timers
          if (cooldownTimerA.current) clearTimeout(cooldownTimerA.current);
          if (cooldownTimerB.current) clearTimeout(cooldownTimerB.current);

          if (hasWon) {
            // Immediate win — no transition to next question
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

          // Schedule transition to next question
          transitionTimer.current = setTimeout(() => {
            setGameState((s) => {
              const nextIndex = s.currentIndex + 1;
              if (nextIndex >= s.questions.length) {
                // Loop back to start — game continues until a team reaches winScore
                return {
                  ...s,
                  currentIndex: 0,
                  answeredBy: null,
                  teamACooldown: false,
                  teamBCooldown: false,
                  lastCorrectTeam: null,
                };
              }
              return {
                ...s,
                currentIndex: nextIndex,
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
          // Wrong answer - apply cooldown to this team
          const cooldownKey = team === "a" ? "teamACooldown" : "teamBCooldown";
          const timerRef = team === "a" ? cooldownTimerA : cooldownTimerB;

          if (timerRef.current) clearTimeout(timerRef.current);

          timerRef.current = setTimeout(() => {
            setGameState((s) => ({
              ...s,
              [cooldownKey]: false,
            }));
          }, config.cooldownMs);

          return {
            ...prev,
            [cooldownKey]: true,
          };
        }
      });
    },
    [config.cooldownMs, config.transitionMs],
  );

  const currentQuestion =
    gameState.gameStatus === "playing" && gameState.questions.length > 0
      ? gameState.questions[gameState.currentIndex]
      : null;

  const totalQuestions = gameState.questions.length;
  const progress = totalQuestions > 0 ? gameState.currentIndex + 1 : 0;
  const winScore = totalQuestions > 0 ? Math.floor(totalQuestions / 2) + 1 : 1;

  const winner: Team | null =
    gameState.gameStatus === "finished"
      ? gameState.scores.a > gameState.scores.b
        ? "a"
        : "b"
      : null;

  return {
    gameState,
    currentQuestion,
    totalQuestions,
    winScore,
    progress,
    winner,
    answerHistory: gameState.answerHistory,
    startGame,
    changeMode,
    handleAnswer,
  };
}
