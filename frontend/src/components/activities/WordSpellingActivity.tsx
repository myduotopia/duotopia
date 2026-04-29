/**
 * WordSpellingActivity - Word Spelling Practice Activity
 *
 * Ebbinghaus memory-curve practice (mirrors WordSelectionActivity):
 * - Each "round" the backend picks 10 least-familiar words.
 * - Student types the word (audio is the primary hint).
 * - Correct → animation → next question.
 * - Incorrect → retry button (same word stays).
 * - When the round is complete, show stats + "Start Next Round" or
 *   "Submit Assignment" once target proficiency is reached.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  Volume2,
  CheckCircle,
  XCircle,
  Clock,
  Send,
  RotateCcw,
  Keyboard,
  Trophy,
  RefreshCw,
  BookOpen,
  Info,
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
  memory_strength: number;
}

interface ProficiencyStatus {
  current_mastery: number;
  target_mastery: number;
  achieved: boolean;
  words_mastered: number;
  total_words: number;
}

interface WordSpellingActivityProps {
  assignmentId: number;
  isPreviewMode?: boolean;
  isDemoMode?: boolean;
  initialPracticeMode?: boolean;
  onComplete?: () => void;
}

export default function WordSpellingActivity({
  assignmentId,
  isPreviewMode = false,
  isDemoMode = false,
  initialPracticeMode = false,
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

  // Proficiency
  const [proficiency, setProficiency] = useState<ProficiencyStatus>({
    current_mastery: 0,
    target_mastery: 80,
    achieved: false,
    words_mastered: 0,
    total_words: 0,
  });
  const [showAchievementDialog, setShowAchievementDialog] = useState(false);

  // Issue #460: practice-only mode (already submitted, score locked)
  const [isPracticeMode, setIsPracticeMode] = useState(initialPracticeMode);

  // Round tracking
  const [roundCompleted, setRoundCompleted] = useState(false);

  // Preview/demo only — track practiced ids to avoid repetition next round
  const practicedWordIdsRef = useRef<number[]>([]);

  // Preview/demo only — local SM-2 simulation (not persisted)
  const [previewWordStrengths, setPreviewWordStrengths] = useState<
    Record<number, number>
  >({});

  const calculateNewStrength = (
    currentStrength: number | undefined,
    correct: boolean,
  ): number => {
    if (currentStrength === undefined) {
      return correct ? 0.5 : 0.0;
    }
    if (correct) return Math.min(1.0, currentStrength + 0.15);
    return Math.max(0.0, currentStrength - 0.2);
  };

  const previewProficiency = useMemo(() => {
    const strengths = Object.values(previewWordStrengths);
    if (strengths.length === 0) return 0;
    const totalWords = proficiency.total_words || strengths.length;
    const sum = strengths.reduce((acc, s) => acc + s, 0);
    return (sum / totalWords) * 100;
  }, [previewWordStrengths, proficiency.total_words]);

  const previewWordsMastered = useMemo(() => {
    const targetThreshold = ((proficiency.target_mastery || 80) / 100) * 0.8;
    return Object.values(previewWordStrengths).filter(
      (s) => s >= targetThreshold,
    ).length;
  }, [previewWordStrengths, proficiency.target_mastery]);

  const displayProficiency =
    isPreviewMode || isDemoMode
      ? previewProficiency
      : proficiency.current_mastery;

  const displayWordsMastered =
    isPreviewMode || isDemoMode
      ? previewWordsMastered
      : proficiency.words_mastered;

  // Stats (per round) — kept for completeness; current implementation
  // doesn't display per-round count, but useful for future analytics.
  const [, setCorrectCount] = useState(0);

  // Timer
  const [timeLimit, setTimeLimit] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [incorrectAnswer, setIncorrectAnswer] = useState<string | null>(null);

  // Start practice session — picks a round of 10 unfamiliar words
  const startPractice = useCallback(async () => {
    try {
      setLoading(true);

      const excludeParam =
        (isPreviewMode || isDemoMode) && practicedWordIdsRef.current.length > 0
          ? `?exclude_ids=${practicedWordIdsRef.current.join(",")}`
          : "";

      const apiEndpoint = isDemoMode
        ? `/api/demo/assignments/${assignmentId}/preview/word-spelling-start${excludeParam}`
        : isPreviewMode
          ? `/api/teachers/assignments/${assignmentId}/preview/word-spelling-start${excludeParam}`
          : `/api/students/assignments/${assignmentId}/vocabulary/spelling/start`;

      const data = await apiClient.get<{
        session_id: number | null;
        words: SpellingWord[];
        total_words: number;
        current_proficiency: number;
        target_proficiency: number;
        words_mastered: number;
        achieved: boolean;
        is_practice_mode?: boolean;
        show_translation: boolean;
        show_image: boolean;
        play_audio: boolean;
        time_limit_per_question: number | null;
      }>(apiEndpoint);

      setWords(data.words || []);
      setSessionId(data.session_id);
      setIsPracticeMode(data.is_practice_mode ?? false);
      setShowTranslation(data.show_translation ?? true);
      setTimeLimit(data.time_limit_per_question || null);
      setTimeRemaining(data.time_limit_per_question || null);
      setProficiency({
        current_mastery: data.current_proficiency || 0,
        target_mastery: data.target_proficiency || 80,
        achieved: data.achieved ?? false,
        words_mastered: data.words_mastered ?? 0,
        total_words: data.total_words || 0,
      });
      setCurrentIndex(0);
      setRoundCompleted(false);
      setTypedAnswer("");
      setShowResult(false);
      setCorrectCount(0);

      if (isPreviewMode || isDemoMode) {
        const newWordIds = (data.words || []).map(
          (w: SpellingWord) => w.content_item_id,
        );
        const hasOverlap = newWordIds.some((id: number) =>
          practicedWordIdsRef.current.includes(id),
        );
        if (hasOverlap && practicedWordIdsRef.current.length > 0) {
          practicedWordIdsRef.current = [...newWordIds];
        } else {
          practicedWordIdsRef.current = [
            ...practicedWordIdsRef.current,
            ...newWordIds,
          ];
        }
      }
    } catch (error) {
      console.error("Error starting spelling practice:", error);
      toast.error(
        t("wordSpelling.toast.startFailed") || "Failed to start practice",
      );
    } finally {
      setLoading(false);
    }
  }, [assignmentId, isPreviewMode, isDemoMode, t]);

  const fetchProficiency = useCallback(async () => {
    if (isPreviewMode || isDemoMode) return;
    try {
      const data = await apiClient.get<ProficiencyStatus>(
        `/api/students/assignments/${assignmentId}/vocabulary/spelling/proficiency`,
      );
      setProficiency(data);
    } catch (error) {
      console.error("Error fetching proficiency:", error);
    }
  }, [assignmentId, isPreviewMode, isDemoMode]);

  useEffect(() => {
    startPractice();
  }, [startPractice]);

  // Focus input on question switch
  useEffect(() => {
    if (!loading && !roundCompleted && inputRef.current) {
      inputRef.current.focus();
    }
  }, [currentIndex, loading, roundCompleted, showResult]);

  const playWordAudio = useCallback(() => {
    const currentWord = words[currentIndex];
    if (currentWord?.audio_url) {
      if (audioRef.current) audioRef.current.pause();
      audioRef.current = new Audio(currentWord.audio_url);
      audioRef.current.play().catch(console.error);
    }
  }, [words, currentIndex]);

  // Auto-play audio once per new question (audio is the spelling hint)
  useEffect(() => {
    if (
      words[currentIndex]?.audio_url &&
      !showResult &&
      !roundCompleted &&
      !loading
    ) {
      playWordAudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, words.length, roundCompleted, loading]);

  // Timer
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!timeLimit || showResult || roundCompleted || loading) return;
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
  }, [currentIndex, timeLimit, showResult, roundCompleted, loading]);

  // Auto-fail on timeout
  useEffect(() => {
    if (timeRemaining === 0 && !showResult && !submitting && words.length > 0) {
      handleSubmitAnswer(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRemaining]);

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

    // Preview/demo: simulate SM-2 locally
    if (isPreviewMode || isDemoMode) {
      const wordId = currentWord.content_item_id;
      setPreviewWordStrengths((prev) => ({
        ...prev,
        [wordId]: calculateNewStrength(prev[wordId], correct),
      }));
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
      await fetchProficiency();
    } catch (error) {
      console.error("Error submitting spelling answer:", error);
      toast.error(
        t("wordSpelling.toast.submitFailed") || "Failed to submit answer",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Correct overlay → next question; or retry on incorrect
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
    if (timeLimit) setTimeRemaining(timeLimit);

    if (currentIndex < words.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setRoundCompleted(true);
    }
  };

  const handleRetry = () => {
    setShowResult(false);
    setTypedAnswer("");
    setIncorrectAnswer(null);
    if (timeLimit) setTimeRemaining(timeLimit);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !showResult && !submitting && typedAnswer.trim()) {
      handleSubmitAnswer();
    }
  };

  const handleStartNextRound = () => {
    startPractice();
  };

  const handleSubmitAssignment = async () => {
    if (isPreviewMode || isDemoMode) {
      toast.success(
        t("wordSpelling.toast.completed") || "Assignment completed!",
      );
      setShowAchievementDialog(false);
      onComplete?.();
      return;
    }
    if (completing) return;
    setCompleting(true);
    try {
      await apiClient.post(`/api/students/assignments/${assignmentId}/submit`);
      toast.success(
        t("wordSpelling.toast.submitted") || "Assignment submitted!",
      );
      setIsPracticeMode(true);
      setShowAchievementDialog(false);
      setRoundCompleted(false);
    } catch (error) {
      console.error("Error submitting assignment:", error);
      toast.error(
        t("wordSpelling.toast.completeFailed") ||
          "Failed to submit assignment.",
      );
    } finally {
      setCompleting(false);
    }
  };

  const handleCompleteAssignment = () => {
    onComplete?.();
  };

  const handleContinuePractice = () => {
    setShowAchievementDialog(false);
    startPractice();
  };

  // Loading
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

  // Round complete view
  if (roundCompleted) {
    return (
      <Card className="p-8">
        <CardContent className="text-center space-y-6">
          <div className="flex justify-center">
            <CheckCircle className="h-16 w-16 text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800">
            {t("wordSpelling.roundComplete") || "Round Complete!"}
          </h2>

          {isPracticeMode && (
            <div className="flex items-center gap-2 justify-center text-sm text-blue-600 bg-blue-50 rounded-lg px-4 py-2">
              <Info className="h-4 w-4" />
              <span>
                {t("wordSpelling.practiceModeHint") ||
                  "Practice mode — your score will not be affected"}
              </span>
            </div>
          )}

          <div className="space-y-2 max-w-md mx-auto">
            <div className="flex justify-between text-sm text-gray-600">
              <span>
                {t("wordSpelling.currentProficiency") || "Proficiency"}
              </span>
              <span>
                {displayProficiency.toFixed(1)}% / {proficiency.target_mastery}%
              </span>
            </div>
            <Progress value={displayProficiency} max={100} className="h-3" />
          </div>

          <div className="text-gray-600">
            <p>
              {t("wordSpelling.wordsMastered", {
                mastered: displayWordsMastered,
                total: proficiency.total_words,
              }) ||
                `${displayWordsMastered} / ${proficiency.total_words} words mastered`}
            </p>
          </div>

          {isPracticeMode ? (
            <div className="flex gap-4 justify-center">
              <Button onClick={handleStartNextRound}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("wordSpelling.continuePractice") || "Continue Practice"}
              </Button>
              <Button variant="outline" onClick={handleCompleteAssignment}>
                <CheckCircle className="h-4 w-4 mr-2" />
                {t("wordSpelling.backToList") || "Back to List"}
              </Button>
            </div>
          ) : proficiency.achieved ? (
            <div className="space-y-4">
              <div className="flex justify-center">
                <Trophy className="h-12 w-12 text-yellow-500" />
              </div>
              <p className="text-green-600 font-medium">
                {t("wordSpelling.targetReached") ||
                  "Congratulations! You've reached the target proficiency!"}
              </p>
              <div className="flex gap-4 justify-center">
                <Button
                  variant="outline"
                  onClick={handleContinuePractice}
                  disabled={completing}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t("wordSpelling.keepPracticing") || "Keep Practicing"}
                </Button>
                <Button onClick={handleSubmitAssignment} disabled={completing}>
                  {completing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  {t("wordSpelling.submitAssignment") || "Submit Assignment"}
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={handleStartNextRound}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t("wordSpelling.nextRound") || "Start Next Round"}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const currentWord = words[currentIndex];

  return (
    <div className="space-y-6">
      {isPracticeMode && (
        <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 rounded-lg px-4 py-2">
          <BookOpen className="h-4 w-4" />
          <span>
            {t("wordSpelling.practiceModeHeader") ||
              "Practice mode — your submitted score will not change"}
          </span>
        </div>
      )}

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
            {displayProficiency.toFixed(0)}% / {proficiency.target_mastery}%
          </span>
        </div>
        <Progress
          value={displayProficiency}
          max={100}
          className="h-2.5 [&>div]:bg-gradient-to-r [&>div]:from-indigo-500 [&>div]:to-purple-500"
        />
      </div>

      <div className="space-y-6">
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

        <div className="text-center text-gray-600">
          {t("wordSpelling.typeTheWord") || "Type the correct spelling:"}
        </div>

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

      <ScoreOverlay
        open={scoreOverlayOpen}
        score={100}
        isError={false}
        onComplete={handleOverlayComplete}
      />

      <Dialog
        open={showAchievementDialog}
        onOpenChange={setShowAchievementDialog}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Trophy className="h-6 w-6 text-yellow-500" />
              {t("wordSpelling.achievementTitle") || "Congratulations!"}
            </DialogTitle>
            <DialogDescription className="space-y-4 pt-4">
              <p className="text-lg">
                {t("wordSpelling.achievementMessage", {
                  target: proficiency.target_mastery,
                }) ||
                  `You've reached the target proficiency of ${proficiency.target_mastery}%!`}
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={handleContinuePractice}
              disabled={completing}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {isPracticeMode
                ? t("wordSpelling.continuePractice") || "Continue Practice"
                : t("wordSpelling.keepPracticing") || "Keep Practicing"}
            </Button>
            {isPracticeMode ? (
              <Button onClick={handleCompleteAssignment}>
                <CheckCircle className="h-4 w-4 mr-2" />
                {t("wordSpelling.backToList") || "Back to List"}
              </Button>
            ) : (
              <Button onClick={handleSubmitAssignment} disabled={completing}>
                {completing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                {t("wordSpelling.submitAssignment") || "Submit Assignment"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
