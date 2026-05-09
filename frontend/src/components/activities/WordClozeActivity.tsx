/**
 * WordClozeActivity - Word Cloze Practice Activity
 *
 * Ebbinghaus memory-curve practice (mirrors WordSelectionActivity):
 * - Each round backend picks 10 least-familiar words.
 * - Student fills the blank in the example sentence.
 * - Audio is played automatically each new question.
 * - Correct → animation → next question.
 * - Incorrect → retry button (same question stays).
 * - On round completion: stats + Next Round / Submit.
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
  FileText,
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
import { aggregateTierCounts, weightedMastery } from "./wordFamiliarity";

interface ClozeQuestion {
  content_item_id: number;
  base_word: string;
  translation: string;
  blanked_sentence: string;
  sentence_translation: string;
  audio_url?: string;
  // Backend-supplied so the frontend can do a local compare in
  // preview/demo mode (mirrors how word_selection exposes translation).
  correct_answer: string;
  correct_answer_length: number;
}

interface ProficiencyStatus {
  current_mastery: number;
  target_mastery: number;
  achieved: boolean;
  words_mastered: number;
  // Issue #711: 5-tier classification counts. Optional so a backend
  // serving the older 3-tier shape still type-checks during rollout.
  words_master?: number;
  words_familiar?: number;
  words_medium?: number;
  words_unfamiliar?: number;
  words_very_unfamiliar?: number;
  total_words: number;
}

interface WordClozeActivityProps {
  assignmentId: number;
  isPreviewMode?: boolean;
  isDemoMode?: boolean;
  initialPracticeMode?: boolean;
  onComplete?: () => void;
}

export default function WordClozeActivity({
  assignmentId,
  isPreviewMode = false,
  isDemoMode = false,
  initialPracticeMode = false,
  onComplete,
}: WordClozeActivityProps) {
  const { t } = useTranslation();

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

  const [showTranslation, setShowTranslation] = useState(true);
  const [audioOnlyMode, setAudioOnlyMode] = useState(false);
  const [showAnswerOnWrong, setShowAnswerOnWrong] = useState(false);

  const [proficiency, setProficiency] = useState<ProficiencyStatus>({
    current_mastery: 0,
    target_mastery: 80,
    achieved: false,
    words_mastered: 0,
    words_master: 0,
    words_familiar: 0,
    words_medium: 0,
    words_unfamiliar: 0,
    words_very_unfamiliar: 0,
    total_words: 0,
  });
  const [showAchievementDialog, setShowAchievementDialog] = useState(false);
  const [isPracticeMode, setIsPracticeMode] = useState(initialPracticeMode);
  const [roundCompleted, setRoundCompleted] = useState(false);

  const practicedWordIdsRef = useRef<number[]>([]);
  // Issue #711: count-based local tracking for preview/demo (no DB).
  const [previewWordCounts, setPreviewWordCounts] = useState<
    Record<number, { correct: number; incorrect: number }>
  >({});

  const recordPreviewAnswer = useCallback(
    (wordId: number, isCorrectAnswer: boolean) => {
      setPreviewWordCounts((prev) => {
        const cur = prev[wordId] ?? { correct: 0, incorrect: 0 };
        return {
          ...prev,
          [wordId]: isCorrectAnswer
            ? { ...cur, correct: cur.correct + 1 }
            : { ...cur, incorrect: cur.incorrect + 1 },
        };
      });
    },
    [],
  );

  const previewTierCounts = useMemo(
    () => aggregateTierCounts(previewWordCounts, proficiency.total_words),
    [previewWordCounts, proficiency.total_words],
  );

  // Issue #711: weighted preview proficiency (medium counts as 0.5).
  const previewProficiency = useMemo(
    () => weightedMastery(previewTierCounts) * 100,
    [previewTierCounts],
  );

  const displayProficiency =
    isPreviewMode || isDemoMode
      ? previewProficiency
      : proficiency.current_mastery;

  const displayTierCounts = useMemo(() => {
    if (isPreviewMode || isDemoMode) return previewTierCounts;
    const master = proficiency.words_master ?? proficiency.words_mastered ?? 0;
    const familiar = proficiency.words_familiar ?? 0;
    const medium = proficiency.words_medium ?? 0;
    const unfamiliar = proficiency.words_unfamiliar ?? 0;
    const accountedFor = master + familiar + medium + unfamiliar;
    const very_unfamiliar =
      proficiency.words_very_unfamiliar ??
      Math.max(0, proficiency.total_words - accountedFor);
    return {
      master,
      familiar,
      medium,
      unfamiliar,
      very_unfamiliar,
      total: proficiency.total_words,
    };
  }, [isPreviewMode, isDemoMode, previewTierCounts, proficiency]);

  const displayWordsMastered = displayTierCounts.master;

  const [, setCorrectCount] = useState(0);

  const [timeLimit, setTimeLimit] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [incorrectAnswer, setIncorrectAnswer] = useState<string | null>(null);

  const startPractice = useCallback(async () => {
    try {
      setLoading(true);

      const excludeParam =
        (isPreviewMode || isDemoMode) && practicedWordIdsRef.current.length > 0
          ? `?exclude_ids=${practicedWordIdsRef.current.join(",")}`
          : "";

      const apiEndpoint = isDemoMode
        ? `/api/demo/assignments/${assignmentId}/preview/word-cloze-start${excludeParam}`
        : isPreviewMode
          ? `/api/teachers/assignments/${assignmentId}/preview/word-cloze-start${excludeParam}`
          : `/api/students/assignments/${assignmentId}/vocabulary/cloze/start`;

      const data = await apiClient.get<{
        session_id: number | null;
        questions: ClozeQuestion[];
        total_questions: number;
        current_proficiency: number;
        target_proficiency: number;
        words_mastered: number;
        words_master?: number;
        words_familiar?: number;
        words_medium?: number;
        words_unfamiliar?: number;
        words_very_unfamiliar?: number;
        achieved: boolean;
        is_practice_mode?: boolean;
        show_translation: boolean;
        play_audio: boolean;
        show_answer?: boolean;
        time_limit_per_question: number | null;
      }>(apiEndpoint);

      setQuestions(data.questions || []);
      setSessionId(data.session_id);
      setIsPracticeMode(data.is_practice_mode ?? false);
      // Audio mode hides translation hint; translation mode shows it.
      setAudioOnlyMode(data.play_audio ?? false);
      setShowTranslation(
        (data.show_translation ?? true) && !(data.play_audio ?? false),
      );
      // play_audio mode forces show_answer=true.
      setShowAnswerOnWrong(
        (data.show_answer ?? false) || (data.play_audio ?? false),
      );
      setTimeLimit(data.time_limit_per_question || null);
      setTimeRemaining(data.time_limit_per_question || null);
      setProficiency({
        current_mastery: data.current_proficiency || 0,
        target_mastery: data.target_proficiency || 80,
        achieved: data.achieved ?? false,
        words_mastered: data.words_mastered ?? 0,
        words_master: data.words_master ?? data.words_mastered ?? 0,
        words_familiar: data.words_familiar ?? 0,
        words_medium: data.words_medium ?? 0,
        words_unfamiliar: data.words_unfamiliar ?? 0,
        words_very_unfamiliar: data.words_very_unfamiliar ?? 0,
        total_words: data.total_questions || 0,
      });
      setCurrentIndex(0);
      setRoundCompleted(false);
      setTypedAnswer("");
      setShowResult(false);
      setCorrectCount(0);

      if (isPreviewMode || isDemoMode) {
        const newIds = (data.questions || []).map(
          (q: ClozeQuestion) => q.content_item_id,
        );
        const hasOverlap = newIds.some((id: number) =>
          practicedWordIdsRef.current.includes(id),
        );
        if (hasOverlap && practicedWordIdsRef.current.length > 0) {
          practicedWordIdsRef.current = [...newIds];
        } else {
          practicedWordIdsRef.current = [
            ...practicedWordIdsRef.current,
            ...newIds,
          ];
        }
      }
    } catch (error) {
      console.error("Error starting cloze practice:", error);
      toast.error(
        t("wordCloze.toast.startFailed") || "Failed to start practice",
      );
    } finally {
      setLoading(false);
    }
  }, [assignmentId, isPreviewMode, isDemoMode, t]);

  const fetchProficiency = useCallback(async () => {
    if (isPreviewMode || isDemoMode) return;
    try {
      const data = await apiClient.get<ProficiencyStatus>(
        `/api/students/assignments/${assignmentId}/vocabulary/cloze/proficiency`,
      );
      setProficiency(data);
    } catch (error) {
      console.error("Error fetching proficiency:", error);
    }
  }, [assignmentId, isPreviewMode, isDemoMode]);

  useEffect(() => {
    startPractice();
  }, [startPractice]);

  useEffect(() => {
    if (!loading && !roundCompleted && inputRef.current) {
      inputRef.current.focus();
    }
  }, [currentIndex, loading, roundCompleted, showResult]);

  const playQuestionAudio = useCallback(() => {
    const q = questions[currentIndex];
    if (q?.audio_url) {
      if (audioRef.current) audioRef.current.pause();
      audioRef.current = new Audio(q.audio_url);
      audioRef.current.play().catch(console.error);
    }
  }, [questions, currentIndex]);

  // Auto-play sentence audio on each new question
  useEffect(() => {
    if (
      questions[currentIndex]?.audio_url &&
      !showResult &&
      !roundCompleted &&
      !loading
    ) {
      playQuestionAudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, questions.length, roundCompleted, loading]);

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

    if (isPreviewMode || isDemoMode) {
      // Local compare against the backend-supplied correct answer
      // (case-insensitive, trimmed) — same pattern as spelling.
      const expected = (currentQ.correct_answer || "").trim().toLowerCase();
      const correct =
        !isTimeout && expected.length > 0 && answer.toLowerCase() === expected;
      setIsCorrect(correct);
      setShowResult(true);
      if (correct) {
        setCorrectCount((prev) => prev + 1);
        setScoreOverlayOpen(true);
      } else {
        setIncorrectAnswer(answer);
      }
      recordPreviewAnswer(currentQ.content_item_id, correct);
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
      await fetchProficiency();
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
    if (timeLimit) setTimeRemaining(timeLimit);

    if (currentIndex < questions.length - 1) {
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
      toast.success(t("wordCloze.toast.completed") || "Assignment completed!");
      setShowAchievementDialog(false);
      onComplete?.();
      return;
    }
    if (completing) return;
    setCompleting(true);
    try {
      await apiClient.post(`/api/students/assignments/${assignmentId}/submit`);
      toast.success(t("wordCloze.toast.submitted") || "Assignment submitted!");
      setIsPracticeMode(true);
      setShowAchievementDialog(false);
      setRoundCompleted(false);
    } catch (error) {
      console.error("Error submitting cloze assignment:", error);
      toast.error(
        t("wordCloze.toast.completeFailed") || "Failed to submit assignment.",
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
              "No cloze questions available (example sentences must contain the target word)"}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (roundCompleted) {
    return (
      <Card className="p-8">
        <CardContent className="text-center space-y-6">
          <div className="flex justify-center">
            <CheckCircle className="h-16 w-16 text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800">
            {t("wordCloze.roundComplete") || "Round Complete!"}
          </h2>

          {isPracticeMode && (
            <div className="flex items-center gap-2 justify-center text-sm text-blue-600 bg-blue-50 rounded-lg px-4 py-2">
              <Info className="h-4 w-4" />
              <span>
                {t("wordCloze.practiceModeHint") ||
                  "Practice mode — your score will not be affected"}
              </span>
            </div>
          )}

          <div className="space-y-2 max-w-md mx-auto">
            <div className="flex justify-between text-sm text-gray-600">
              <span>{t("wordCloze.currentProficiency") || "Proficiency"}</span>
              <span>
                {displayProficiency.toFixed(1)}% / {proficiency.target_mastery}%
              </span>
            </div>
            <Progress value={displayProficiency} max={100} className="h-3" />
          </div>

          <div className="text-gray-600">
            <p>
              {t("wordCloze.wordsMastered", {
                mastered: displayWordsMastered,
                total: proficiency.total_words,
              }) ||
                `${displayWordsMastered} / ${proficiency.total_words} words mastered`}
            </p>
          </div>

          {/* Issue #711: 五檔熟悉度單字數量 */}
          <div className="grid grid-cols-5 gap-1.5 max-w-md mx-auto">
            <div className="rounded bg-green-100 px-1 py-1.5 text-center">
              <div className="text-[10px] font-medium text-green-800">
                {t("wordFamiliarity.tierMaster") || "精熟"}
              </div>
              <div className="text-base font-semibold text-green-800">
                {displayTierCounts.master}
              </div>
            </div>
            <div className="rounded bg-lime-100 px-1 py-1.5 text-center">
              <div className="text-[10px] font-medium text-lime-800">
                {t("wordFamiliarity.tierFamiliar") || "熟悉"}
              </div>
              <div className="text-base font-semibold text-lime-800">
                {displayTierCounts.familiar}
              </div>
            </div>
            <div className="rounded bg-yellow-100 px-1 py-1.5 text-center">
              <div className="text-[10px] font-medium text-yellow-800">
                {t("wordFamiliarity.tierMedium") || "普通"}
              </div>
              <div className="text-base font-semibold text-yellow-800">
                {displayTierCounts.medium}
              </div>
            </div>
            <div className="rounded bg-orange-100 px-1 py-1.5 text-center">
              <div className="text-[10px] font-medium text-orange-800">
                {t("wordFamiliarity.tierUnfamiliar") || "不熟悉"}
              </div>
              <div className="text-base font-semibold text-orange-800">
                {displayTierCounts.unfamiliar}
              </div>
            </div>
            <div className="rounded bg-gray-100 px-1 py-1.5 text-center">
              <div className="text-[10px] font-medium text-gray-700">
                {t("wordFamiliarity.tierVeryUnfamiliar") || "很不熟"}
              </div>
              <div className="text-base font-semibold text-gray-700">
                {displayTierCounts.very_unfamiliar}
              </div>
            </div>
          </div>

          {isPracticeMode ? (
            <div className="flex gap-4 justify-center">
              <Button onClick={handleStartNextRound}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("wordCloze.continuePractice") || "Continue Practice"}
              </Button>
              <Button variant="outline" onClick={handleCompleteAssignment}>
                <CheckCircle className="h-4 w-4 mr-2" />
                {t("wordCloze.backToList") || "Back to List"}
              </Button>
            </div>
          ) : proficiency.achieved ? (
            <div className="space-y-4">
              <div className="flex justify-center">
                <Trophy className="h-12 w-12 text-yellow-500" />
              </div>
              <p className="text-green-600 font-medium">
                {t("wordCloze.targetReached") ||
                  "Congratulations! You've reached the target proficiency!"}
              </p>
              <div className="flex gap-4 justify-center">
                <Button
                  variant="outline"
                  onClick={handleContinuePractice}
                  disabled={completing}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t("wordCloze.keepPracticing") || "Keep Practicing"}
                </Button>
                <Button onClick={handleSubmitAssignment} disabled={completing}>
                  {completing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  {t("wordCloze.submitAssignment") || "Submit Assignment"}
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={handleStartNextRound}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t("wordCloze.nextRound") || "Start Next Round"}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const currentQ = questions[currentIndex];

  return (
    <div className="space-y-6">
      {isPracticeMode && (
        <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 rounded-lg px-4 py-2">
          <BookOpen className="h-4 w-4" />
          <span>
            {t("wordCloze.practiceModeHeader") ||
              "Practice mode — your submitted score will not change"}
          </span>
        </div>
      )}

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
        {/* Translation hint (Chinese meaning only — never show base word) */}
        {showTranslation && currentQ.translation && (
          <div className="text-center">
            <p className="text-sm text-gray-500 mb-1">
              {t("wordCloze.translationHint") || "Translation"}
            </p>
            <h2 className="text-xl font-bold text-gray-800">
              {currentQ.translation}
            </h2>
          </div>
        )}

        {currentQ.audio_url && (
          <div className="flex flex-col items-center gap-2">
            <Button
              variant={audioOnlyMode ? "default" : "outline"}
              size="lg"
              onClick={playQuestionAudio}
              className={cn(
                "gap-2",
                audioOnlyMode &&
                  "h-16 px-8 text-lg bg-blue-600 hover:bg-blue-700 text-white shadow-lg",
              )}
            >
              <Volume2 className={audioOnlyMode ? "h-7 w-7" : "h-5 w-5"} />
              {t("wordCloze.playAudio") || "Play Audio"}
            </Button>
            {audioOnlyMode && (
              <p className="text-xs text-gray-500">
                {t("wordCloze.tapToReplay") || "點擊播放，可以重複聆聽"}
              </p>
            )}
          </div>
        )}

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
              {showAnswerOnWrong && currentQ.correct_answer && (
                <p className="text-sm text-gray-700">
                  {t("wordCloze.correctAnswerLabel") || "正確答案"}:{" "}
                  <span className="font-bold">{currentQ.correct_answer}</span>
                </p>
              )}
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

      <Dialog
        open={showAchievementDialog}
        onOpenChange={setShowAchievementDialog}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Trophy className="h-6 w-6 text-yellow-500" />
              {t("wordCloze.achievementTitle") || "Congratulations!"}
            </DialogTitle>
            <DialogDescription className="space-y-4 pt-4">
              <p className="text-lg">
                {t("wordCloze.achievementMessage", {
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
                ? t("wordCloze.continuePractice") || "Continue Practice"
                : t("wordCloze.keepPracticing") || "Keep Practicing"}
            </Button>
            {isPracticeMode ? (
              <Button onClick={handleCompleteAssignment}>
                <CheckCircle className="h-4 w-4 mr-2" />
                {t("wordCloze.backToList") || "Back to List"}
              </Button>
            ) : (
              <Button onClick={handleSubmitAssignment} disabled={completing}>
                {completing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                {t("wordCloze.submitAssignment") || "Submit Assignment"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
