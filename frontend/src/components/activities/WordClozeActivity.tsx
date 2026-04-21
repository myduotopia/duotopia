/**
 * WordClozeActivity - Word Cloze Practice Activity
 *
 * Normal practice mode (non-Ebbinghaus): sequential order, all questions.
 * Student sees an example sentence with the target word blanked out and
 * types the correct form (e.g., "apples", "watching", "am").
 * Correct → next question. Incorrect → allow retry.
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
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api";
import ScoreOverlay from "./shared/ScoreOverlay";

interface ClozeQuestion {
  content_item_id: number;
  base_word: string;
  translation: string;
  blanked_sentence: string;
  sentence_translation: string;
  audio_url?: string;
  correct_answer_length: number;
}

interface WordClozeActivityProps {
  assignmentId: number;
  isPreviewMode?: boolean;
  isDemoMode?: boolean;
  onComplete?: () => void;
}

export default function WordClozeActivity({
  assignmentId,
  isPreviewMode = false,
  isDemoMode = false,
  onComplete,
}: WordClozeActivityProps) {
  const { t } = useTranslation();

  // State
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<ClozeQuestion[]>([]);
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
  const [playAudio, setPlayAudio] = useState(false);

  // Stats
  const [correctCount, setCorrectCount] = useState(0);

  // Timer
  const [timeLimit, setTimeLimit] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Audio
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [incorrectAnswer, setIncorrectAnswer] = useState<string | null>(null);
  const [allCompleted, setAllCompleted] = useState(false);

  // Start practice
  const startPractice = useCallback(async () => {
    try {
      setLoading(true);

      const apiEndpoint = isDemoMode
        ? `/api/demo/assignments/${assignmentId}/preview/word-cloze-start`
        : isPreviewMode
          ? `/api/teachers/assignments/${assignmentId}/preview/word-cloze-start`
          : `/api/students/assignments/${assignmentId}/vocabulary/cloze/start`;

      const data = await apiClient.get<{
        session_id: number | null;
        questions: ClozeQuestion[];
        total_questions: number;
        show_translation: boolean;
        play_audio: boolean;
        time_limit_per_question: number | null;
      }>(apiEndpoint);

      setQuestions(data.questions || []);
      setSessionId(data.session_id);
      setShowTranslation(data.show_translation ?? true);
      setPlayAudio(data.play_audio ?? false);
      setTimeLimit(data.time_limit_per_question || null);
      setTimeRemaining(data.time_limit_per_question || null);
      setCurrentIndex(0);
      setTypedAnswer("");
      setShowResult(false);
      setCorrectCount(0);
      setAllCompleted(false);
    } catch (error) {
      console.error("Error starting cloze practice:", error);
      toast.error(
        t("wordCloze.toast.startFailed") || "Failed to start practice",
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

  // Play audio for current question
  const playQuestionAudio = useCallback(() => {
    const q = questions[currentIndex];
    if (q?.audio_url) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      audioRef.current = new Audio(q.audio_url);
      audioRef.current.play().catch(console.error);
    }
  }, [questions, currentIndex]);

  useEffect(() => {
    if (playAudio && questions[currentIndex]?.audio_url && !showResult) {
      playQuestionAudio();
    }
  }, [currentIndex, playAudio, playQuestionAudio, questions, showResult]);

  // Timer
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

  useEffect(() => {
    if (
      timeRemaining === 0 &&
      !showResult &&
      !submitting &&
      questions.length > 0
    ) {
      handleSubmitAnswer(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRemaining]);

  const handleSubmitAnswer = async (isTimeout = false) => {
    if (showResult || submitting) return;

    const currentQ = questions[currentIndex];
    const answer = isTimeout ? "" : typedAnswer.trim();

    setSubmitting(true);

    // Skip API call in preview/demo — evaluate locally
    if (isPreviewMode || isDemoMode) {
      // Frontend doesn't know correct answer in preview, assume correct for demo
      const correct = !isTimeout && answer.length > 0;
      setIsCorrect(correct);
      setShowResult(true);
      if (correct) {
        setCorrectCount((prev) => prev + 1);
        setScoreOverlayOpen(true);
      } else {
        setIncorrectAnswer(answer);
      }
      setSubmitting(false);
      return;
    }

    try {
      const resp = await apiClient.post<{
        success: boolean;
        is_correct: boolean;
        correct_answer: string;
      }>(`/api/students/assignments/${assignmentId}/vocabulary/cloze/answer`, {
        content_item_id: currentQ.content_item_id,
        typed_answer: answer,
        time_spent_seconds: isTimeout ? timeLimit || 0 : 0,
        session_id: sessionId,
      });

      const correct = resp.is_correct;
      setIsCorrect(correct);
      setShowResult(true);

      if (correct) {
        setCorrectCount((prev) => prev + 1);
        setScoreOverlayOpen(true);
      } else {
        setIncorrectAnswer(answer);
      }
    } catch (error) {
      console.error("Error submitting cloze answer:", error);
      toast.error(
        t("wordCloze.toast.submitFailed") || "Failed to submit answer",
      );
    } finally {
      setSubmitting(false);
    }
  };

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

    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setAllCompleted(true);
    }
  };

  const handleRetry = () => {
    setShowResult(false);
    setTypedAnswer("");
    setIncorrectAnswer(null);
    if (timeLimit) {
      setTimeRemaining(timeLimit);
    }
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !showResult && !submitting && typedAnswer.trim()) {
      handleSubmitAnswer();
    }
  };

  const handleComplete = async () => {
    if (isPreviewMode || isDemoMode) {
      toast.success(t("wordCloze.toast.completed") || "Assignment completed!");
      onComplete?.();
      return;
    }

    if (completing) return;
    setCompleting(true);

    try {
      await apiClient.post(
        `/api/students/assignments/${assignmentId}/vocabulary/cloze/complete`,
      );
      toast.success(t("wordCloze.toast.completed") || "Assignment completed!");
      onComplete?.();
    } catch (error) {
      console.error("Error completing cloze assignment:", error);
      toast.error(
        t("wordCloze.toast.completeFailed") || "Failed to complete assignment",
      );
    } finally {
      setCompleting(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-8">
        <CardContent className="flex flex-col items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-4" />
          <p className="text-gray-600">
            {t("wordCloze.loading") || "Loading cloze questions..."}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (questions.length === 0) {
    return (
      <Card className="p-8">
        <CardContent className="text-center">
          <p className="text-gray-600">
            {t("wordCloze.noItems") ||
              "No cloze questions available. Ensure example sentences contain the target words."}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (allCompleted) {
    const accuracy =
      questions.length > 0
        ? Math.round((correctCount / questions.length) * 100)
        : 0;

    return (
      <Card className="p-8">
        <CardContent className="text-center space-y-6">
          <div className="flex justify-center">
            <CheckCircle className="h-16 w-16 text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800">
            {t("wordCloze.practiceComplete") || "Practice Complete!"}
          </h2>

          <div className="space-y-3 max-w-md mx-auto">
            <div className="flex justify-between text-sm text-gray-600">
              <span>{t("wordCloze.accuracy") || "Accuracy"}</span>
              <span className="font-medium">{accuracy}%</span>
            </div>
            <Progress value={accuracy} max={100} className="h-3" />

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-600">
                  {correctCount}
                </div>
                <div className="text-xs text-green-700">
                  {t("wordCloze.correct") || "Correct"}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-gray-600">
                  {questions.length}
                </div>
                <div className="text-xs text-gray-700">
                  {t("wordCloze.totalQuestions") || "Total"}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-4 justify-center">
            <Button variant="outline" onClick={() => startPractice()}>
              <RotateCcw className="h-4 w-4 mr-2" />
              {t("wordCloze.practiceAgain") || "Practice Again"}
            </Button>
            <Button onClick={handleComplete} disabled={completing}>
              {completing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              {t("wordCloze.submitAssignment") || "Submit Assignment"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentQ = questions[currentIndex];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              <FileText className="h-3 w-3 mr-1" />
              {t("wordCloze.wordCloze") || "Word Cloze"}
            </Badge>
            <span className="text-sm text-gray-600">
              {t("wordCloze.questionProgress", {
                current: currentIndex + 1,
                total: questions.length,
              }) || `${currentIndex + 1} / ${questions.length}`}
            </span>
          </div>
          <span className="text-sm font-medium text-indigo-600">
            {correctCount} / {currentIndex + (showResult && isCorrect ? 1 : 0)}{" "}
            {t("wordCloze.correctLabel") || "correct"}
          </span>
        </div>
        <Progress
          value={
            ((currentIndex + (showResult && isCorrect ? 1 : 0)) /
              questions.length) *
            100
          }
          max={100}
          className="h-2.5 [&>div]:bg-gradient-to-r [&>div]:from-indigo-500 [&>div]:to-purple-500"
        />
      </div>

      {/* Question content */}
      <div className="space-y-6">
        {/* Base word hint */}
        <div className="text-center">
          <p className="text-sm text-gray-500 mb-1">
            {t("wordCloze.baseWord") || "Base word"}
          </p>
          <h2 className="text-2xl font-bold text-gray-800">
            {currentQ.base_word}
            {showTranslation && currentQ.translation && (
              <span className="text-base text-gray-500 ml-2">
                ({currentQ.translation})
              </span>
            )}
          </h2>
        </div>

        {/* Audio Button */}
        {currentQ.audio_url && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="lg"
              onClick={playQuestionAudio}
              className="gap-2"
            >
              <Volume2 className="h-5 w-5" />
              {t("wordCloze.playAudio") || "Play Audio"}
            </Button>
          </div>
        )}

        {/* Blanked sentence */}
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-xl leading-relaxed text-gray-800 font-medium px-4">
            {currentQ.blanked_sentence}
          </p>
          {showTranslation && currentQ.sentence_translation && (
            <p className="text-sm text-gray-500 mt-2">
              {currentQ.sentence_translation}
            </p>
          )}
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
                <span>{t("wordCloze.timeUp") || "Time's up!"}</span>
              ) : (
                <>
                  <span>{timeRemaining}</span>
                  <span className="text-sm">
                    {t("wordCloze.seconds") || "s"}
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
              t("wordCloze.inputPlaceholder") || "Fill in the blank..."
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

          {showResult && !isCorrect && (
            <div className="text-center space-y-2">
              <div className="flex items-center justify-center gap-2 text-red-600">
                <XCircle className="h-5 w-5" />
                <span className="font-medium">
                  {incorrectAnswer
                    ? t("wordCloze.incorrectTryAgain") ||
                      "Incorrect, try again!"
                    : t("wordCloze.timeUpTryAgain") || "Time's up! Try again."}
                </span>
              </div>
              <Button onClick={handleRetry} variant="outline" className="gap-2">
                <RotateCcw className="h-4 w-4" />
                {t("wordCloze.retry") || "Retry"}
              </Button>
            </div>
          )}

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
                  {t("wordCloze.checkAnswer") || "Check"}
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      <ScoreOverlay
        open={scoreOverlayOpen}
        score={100}
        isError={false}
        onComplete={handleOverlayComplete}
      />
    </div>
  );
}
