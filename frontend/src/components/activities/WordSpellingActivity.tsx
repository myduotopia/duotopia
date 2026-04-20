/**
 * WordSpellingActivity - Word Spelling Practice Activity
 *
 * Normal practice mode (non-Ebbinghaus): sequential order, all words.
 * Student sees translation (and optionally audio/image) and types the word.
 * Correct → next question. Incorrect → clear input, retry.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Volume2,
  CheckCircle,
  XCircle,
  Clock,
  Send,
  RotateCcw,
  Keyboard,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api";
import ScoreOverlay from "./shared/ScoreOverlay";

interface SpellingWord {
  content_item_id: number;
  text: string;
  translation: string;
  audio_url?: string;
  image_url?: string;
}

interface WordSpellingActivityProps {
  assignmentId: number;
  isPreviewMode?: boolean;
  isDemoMode?: boolean;
  onComplete?: () => void;
}

export default function WordSpellingActivity({
  assignmentId,
  isPreviewMode = false,
  isDemoMode = false,
  onComplete,
}: WordSpellingActivityProps) {
  const { t } = useTranslation();

  // State
  const [loading, setLoading] = useState(true);
  const [words, setWords] = useState<SpellingWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [scoreOverlayOpen, setScoreOverlayOpen] = useState(false);
  const nextQuestionCalledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Settings
  const [showTranslation, setShowTranslation] = useState(true);
  const [showImage, setShowImage] = useState(true);
  const [playAudio, setPlayAudio] = useState(false);

  // Stats
  const [correctCount, setCorrectCount] = useState(0);

  // Timer
  const [timeLimit, setTimeLimit] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Audio ref
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Track incorrect answer text to show feedback
  const [incorrectAnswer, setIncorrectAnswer] = useState<string | null>(null);

  // Completed state
  const [allCompleted, setAllCompleted] = useState(false);

  // Start practice session
  const startPractice = useCallback(async () => {
    try {
      setLoading(true);

      const apiEndpoint = isDemoMode
        ? `/api/demo/assignments/${assignmentId}/preview/word-spelling-start`
        : isPreviewMode
          ? `/api/teachers/assignments/${assignmentId}/preview/word-spelling-start`
          : `/api/students/assignments/${assignmentId}/vocabulary/spelling/start`;

      const data = await apiClient.get<{
        session_id: number | null;
        words: SpellingWord[];
        total_words: number;
        show_translation: boolean;
        show_image: boolean;
        play_audio: boolean;
        time_limit_per_question: number | null;
      }>(apiEndpoint);

      setWords(data.words || []);
      setSessionId(data.session_id);
      setShowTranslation(data.show_translation ?? true);
      setShowImage(data.show_image ?? true);
      setPlayAudio(data.play_audio ?? false);
      setTimeLimit(data.time_limit_per_question || null);
      setTimeRemaining(data.time_limit_per_question || null);
      setCurrentIndex(0);
      setTypedAnswer("");
      setShowResult(false);
      setCorrectCount(0);
      setAllCompleted(false);
    } catch (error) {
      console.error("Error starting practice:", error);
      toast.error(
        t("wordSpelling.toast.startFailed") || "Failed to start practice",
      );
    } finally {
      setLoading(false);
    }
  }, [assignmentId, isPreviewMode, isDemoMode, t]);

  useEffect(() => {
    startPractice();
  }, [startPractice]);

  // Focus input when question changes
  useEffect(() => {
    if (!loading && !allCompleted && inputRef.current) {
      inputRef.current.focus();
    }
  }, [currentIndex, loading, allCompleted, showResult]);

  // Play audio for current word
  const playWordAudio = useCallback(() => {
    const currentWord = words[currentIndex];
    if (currentWord?.audio_url) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      audioRef.current = new Audio(currentWord.audio_url);
      audioRef.current.play().catch(console.error);
    }
  }, [words, currentIndex]);

  // Auto-play audio when word changes if play_audio is enabled
  useEffect(() => {
    if (playAudio && words[currentIndex]?.audio_url && !showResult) {
      playWordAudio();
    }
  }, [currentIndex, playAudio, playWordAudio, words, showResult]);

  // Timer countdown
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!timeLimit || showResult || allCompleted || loading) {
      return;
    }

    setTimeRemaining(timeLimit);

    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null || prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [currentIndex, timeLimit, showResult, allCompleted, loading]);

  // Handle timeout
  useEffect(() => {
    if (timeRemaining === 0 && !showResult && !submitting && words.length > 0) {
      handleSubmitAnswer(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRemaining]);

  // Submit answer
  const handleSubmitAnswer = async (isTimeout = false) => {
    if (showResult || submitting) return;

    const currentWord = words[currentIndex];
    const answer = isTimeout ? "" : typedAnswer.trim();
    const correct =
      !isTimeout &&
      answer.toLowerCase() === currentWord.text.trim().toLowerCase();

    setIsCorrect(correct);
    setShowResult(true);
    setSubmitting(true);

    if (correct) {
      setCorrectCount((prev) => prev + 1);
      setScoreOverlayOpen(true);
    } else {
      setIncorrectAnswer(answer);
    }

    // Skip API call in preview/demo mode
    if (isPreviewMode || isDemoMode) {
      setSubmitting(false);
      return;
    }

    try {
      await apiClient.post(
        `/api/students/assignments/${assignmentId}/vocabulary/spelling/answer`,
        {
          content_item_id: currentWord.content_item_id,
          typed_answer: answer,
          time_spent_seconds: isTimeout ? timeLimit || 0 : 0,
          session_id: sessionId,
        },
      );
    } catch (error) {
      console.error("Error submitting answer:", error);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle correct answer overlay complete → next question
  const handleOverlayComplete = () => {
    if (nextQuestionCalledRef.current) return;
    nextQuestionCalledRef.current = true;
    setTimeout(() => {
      nextQuestionCalledRef.current = false;
    }, 300);

    setScoreOverlayOpen(false);
    setShowResult(false);
    setTypedAnswer("");
    setIncorrectAnswer(null);

    if (timeLimit) {
      setTimeRemaining(timeLimit);
    }

    if (currentIndex < words.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setAllCompleted(true);
    }
  };

  // Handle retry after incorrect answer
  const handleRetry = () => {
    setShowResult(false);
    setTypedAnswer("");
    setIncorrectAnswer(null);
    if (timeLimit) {
      setTimeRemaining(timeLimit);
    }
    inputRef.current?.focus();
  };

  // Handle key press (Enter to submit)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !showResult && !submitting && typedAnswer.trim()) {
      handleSubmitAnswer();
    }
  };

  // Handle complete assignment
  const handleComplete = async () => {
    if (isPreviewMode || isDemoMode) {
      toast.success(
        t("wordSpelling.toast.completed") || "Assignment completed!",
      );
      onComplete?.();
      return;
    }

    if (completing) return;
    setCompleting(true);

    try {
      await apiClient.post(
        `/api/students/assignments/${assignmentId}/vocabulary/spelling/complete`,
      );
      toast.success(
        t("wordSpelling.toast.completed") || "Assignment completed!",
      );
      onComplete?.();
    } catch (error) {
      console.error("Error completing assignment:", error);
      toast.error(
        t("wordSpelling.toast.completeFailed") ||
          "Failed to complete assignment",
      );
    } finally {
      setCompleting(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <Card className="p-8">
        <CardContent className="flex flex-col items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-4" />
          <p className="text-gray-600">
            {t("wordSpelling.loading") || "Loading vocabulary items..."}
          </p>
        </CardContent>
      </Card>
    );
  }

  // No words
  if (words.length === 0) {
    return (
      <Card className="p-8">
        <CardContent className="text-center">
          <p className="text-gray-600">
            {t("wordSpelling.noItems") || "No vocabulary items found"}
          </p>
        </CardContent>
      </Card>
    );
  }

  // All completed view
  if (allCompleted) {
    const accuracy =
      words.length > 0 ? Math.round((correctCount / words.length) * 100) : 0;

    return (
      <Card className="p-8">
        <CardContent className="text-center space-y-6">
          <div className="flex justify-center">
            <CheckCircle className="h-16 w-16 text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800">
            {t("wordSpelling.practiceComplete") || "Practice Complete!"}
          </h2>

          {/* Results */}
          <div className="space-y-3 max-w-md mx-auto">
            <div className="flex justify-between text-sm text-gray-600">
              <span>{t("wordSpelling.accuracy") || "Accuracy"}</span>
              <span className="font-medium">{accuracy}%</span>
            </div>
            <Progress value={accuracy} max={100} className="h-3" />

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-600">
                  {correctCount}
                </div>
                <div className="text-xs text-green-700">
                  {t("wordSpelling.correct") || "Correct"}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-gray-600">
                  {words.length}
                </div>
                <div className="text-xs text-gray-700">
                  {t("wordSpelling.totalWords") || "Total"}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-4 justify-center">
            <Button variant="outline" onClick={() => startPractice()}>
              <RotateCcw className="h-4 w-4 mr-2" />
              {t("wordSpelling.practiceAgain") || "Practice Again"}
            </Button>
            <Button onClick={handleComplete} disabled={completing}>
              {completing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              {t("wordSpelling.submitAssignment") || "Submit Assignment"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentWord = words[currentIndex];

  return (
    <div className="space-y-6">
      {/* Header: Question number + progress */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              <Keyboard className="h-3 w-3 mr-1" />
              {t("wordSpelling.wordSpelling") || "Word Spelling"}
            </Badge>
            <span className="text-sm text-gray-600">
              {t("wordSpelling.questionProgress", {
                current: currentIndex + 1,
                total: words.length,
              }) || `${currentIndex + 1} / ${words.length}`}
            </span>
          </div>
          <span className="text-sm font-medium text-indigo-600">
            {correctCount} / {currentIndex + (showResult && isCorrect ? 1 : 0)}{" "}
            {t("wordSpelling.correctLabel") || "correct"}
          </span>
        </div>
        <Progress
          value={
            ((currentIndex + (showResult && isCorrect ? 1 : 0)) /
              words.length) *
            100
          }
          max={100}
          className="h-2.5 [&>div]:bg-gradient-to-r [&>div]:from-indigo-500 [&>div]:to-purple-500"
        />
      </div>

      {/* Question content */}
      <div className="space-y-6">
        {/* Image */}
        {showImage && currentWord.image_url && (
          <div className="flex justify-center">
            <img
              src={currentWord.image_url}
              alt=""
              className="max-h-48 object-contain rounded-lg"
            />
          </div>
        )}

        {/* Translation hint */}
        {showTranslation && currentWord.translation && (
          <div className="text-center">
            <p className="text-sm text-gray-500 mb-1">
              {t("wordSpelling.translationHint") || "Translation"}
            </p>
            <h2 className="text-2xl font-bold text-gray-800">
              {currentWord.translation}
            </h2>
          </div>
        )}

        {/* Audio Button */}
        {currentWord.audio_url && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="lg"
              onClick={playWordAudio}
              className="gap-2"
            >
              <Volume2 className="h-5 w-5" />
              {t("wordSpelling.playAudio") || "Play Audio"}
            </Button>
          </div>
        )}

        {/* Prompt */}
        <div className="text-center text-gray-600">
          {t("wordSpelling.typeTheWord") || "Type the correct spelling:"}
        </div>

        {/* Timer */}
        {timeLimit && timeRemaining !== null && (
          <div className="flex justify-center">
            <div
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full text-lg font-medium",
                timeRemaining === 0
                  ? "bg-red-100 text-red-700"
                  : timeRemaining <= 5
                    ? "bg-red-100 text-red-700"
                    : timeRemaining <= 10
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-gray-100 text-gray-700",
              )}
            >
              <Clock className="h-5 w-5" />
              {timeRemaining === 0 ? (
                <span>{t("wordSpelling.timeUp") || "Time's up!"}</span>
              ) : (
                <>
                  <span>{timeRemaining}</span>
                  <span className="text-sm">
                    {t("wordSpelling.seconds") || "s"}
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="max-w-md mx-auto space-y-3">
          <Input
            ref={inputRef}
            type="text"
            value={typedAnswer}
            onChange={(e) => setTypedAnswer(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              t("wordSpelling.inputPlaceholder") || "Type the word here..."
            }
            disabled={showResult || submitting}
            className={cn(
              "text-center text-xl h-14 rounded-xl border-2",
              showResult && isCorrect && "border-green-500 bg-green-50",
              showResult && !isCorrect && "border-red-500 bg-red-50",
              !showResult && "border-gray-300 focus:border-indigo-500",
            )}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />

          {/* Incorrect feedback */}
          {showResult && !isCorrect && (
            <div className="text-center space-y-2">
              <div className="flex items-center justify-center gap-2 text-red-600">
                <XCircle className="h-5 w-5" />
                <span className="font-medium">
                  {incorrectAnswer
                    ? t("wordSpelling.incorrectTryAgain") ||
                      "Incorrect, try again!"
                    : t("wordSpelling.timeUpTryAgain") ||
                      "Time's up! Try again."}
                </span>
              </div>
              <Button onClick={handleRetry} variant="outline" className="gap-2">
                <RotateCcw className="h-4 w-4" />
                {t("wordSpelling.retry") || "Retry"}
              </Button>
            </div>
          )}

          {/* Submit button (only when not showing result) */}
          {!showResult && (
            <Button
              onClick={() => handleSubmitAnswer()}
              disabled={!typedAnswer.trim() || submitting}
              className="w-full h-12 text-lg"
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <CheckCircle className="h-5 w-5 mr-2" />
                  {t("wordSpelling.checkAnswer") || "Check"}
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Score overlay for correct answer */}
      <ScoreOverlay
        open={scoreOverlayOpen}
        score={100}
        isError={false}
        onComplete={handleOverlayComplete}
      />
    </div>
  );
}
