/**
 * WordSelectionActivity - Word Selection Practice Activity
 *
 * Phase 2-3: Vocabulary selection quiz with Ebbinghaus memory curve tracking
 *
 * Features:
 * - Display word card (image, word text, audio playback)
 * - 4-choice selection UI (1 correct + 3 AI-generated distractors)
 * - Proficiency progress bar at top
 * - Visual feedback on correct/incorrect selection
 * - Achievement dialog when target_proficiency is reached
 * - Issue #437: Adaptive layout —
 *   (a) Question image: horizontal (image left, options right) on wide
 *       viewport (≥768px); vertical on narrow viewport.
 *   (b) Option images (#631 mode): options grid switches to 4×1 when its
 *       container is wide enough (~600px) to fit four images, else 2×2.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
  Trophy,
  RefreshCw,
  Clock,
  Send,
  BookOpen,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api";
import ScoreOverlay from "./shared/ScoreOverlay";
import { aggregateTierCounts, weightedMastery } from "./wordFamiliarity";

interface OptionEntry {
  text: string;
  image_url?: string | null;
}

interface WordOption {
  content_item_id: number;
  text: string;
  translation: string;
  audio_url?: string;
  image_url?: string;
  memory_strength: number;
  options: OptionEntry[];
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

interface WordSelectionActivityProps {
  assignmentId: number;
  isPreviewMode?: boolean;
  isDemoMode?: boolean; // Demo mode - uses public demo API endpoints
  initialPracticeMode?: boolean; // True when assignment is already GRADED (re-practice)
  showAnswer?: boolean; // 答錯後是否揭示正確答案
  onComplete?: () => void;
}

export default function WordSelectionActivity({
  assignmentId,
  isPreviewMode = false,
  isDemoMode = false,
  initialPracticeMode = false,
  showAnswer = false,
  onComplete,
}: WordSelectionActivityProps) {
  const { t } = useTranslation();
  // Note: Using apiClient which auto-detects token (student or teacher)

  // State
  const [loading, setLoading] = useState(true);
  const [words, setWords] = useState<WordOption[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [scoreOverlayOpen, setScoreOverlayOpen] = useState(false);
  const nextQuestionCalledRef = useRef(false);
  const showAnswerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Settings
  const [showWord, setShowWord] = useState(true);
  const [showImage, setShowImage] = useState(true);
  const [showOptionImages, setShowOptionImages] = useState(false); // Issue #631
  const [playAudio, setPlayAudio] = useState(false);

  // Proficiency
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

  // Issue #460: Practice-only mode (assignment already submitted, score locked)
  const [isPracticeMode, setIsPracticeMode] = useState(initialPracticeMode);

  // Round tracking
  const [roundCompleted, setRoundCompleted] = useState(false);

  // (#379) Preview/demo mode: track practiced word IDs to avoid repetition
  const practicedWordIdsRef = useRef<number[]>([]);

  // Preview/demo: track per-word correct/incorrect counts locally (not persisted).
  // Issue #711: classification is now count-based, mirroring the SQL function.
  const [previewWordCounts, setPreviewWordCounts] = useState<
    Record<number, { correct: number; incorrect: number }>
  >({});

  // Update local counts for preview/demo: increments correct or incorrect.
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

  // Computed: tier breakdown for preview/demo (live mode reads from API).
  const previewTierCounts = useMemo(
    () => aggregateTierCounts(previewWordCounts, proficiency.total_words),
    [previewWordCounts, proficiency.total_words],
  );

  // Computed: weighted preview proficiency (medium counts as 0.5).
  const previewProficiency = useMemo(
    () => weightedMastery(previewTierCounts) * 100,
    [previewTierCounts],
  );

  // Computed: 顯示用的熟練度（預覽模式和 demo 模式用本地計算，學生模式用 API 回傳）
  const displayProficiency =
    isPreviewMode || isDemoMode
      ? previewProficiency
      : proficiency.current_mastery;

  // Computed: tier counts shown in UI (live = API, preview/demo = local).
  const displayTierCounts = useMemo(() => {
    if (isPreviewMode || isDemoMode) {
      return previewTierCounts;
    }
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

  // Computed: 顯示用的已熟練單字數（同等於 master tier 數）
  const displayWordsMastered = displayTierCounts.master;

  // Timer
  const [timeLimit, setTimeLimit] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Audio ref
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Issue #437: 自適應排版 — 寬螢幕 + 有題目圖片 → 橫式（圖左、選項右）
  // 用 640px (Tailwind sm) 而非 768px，讓平板（含橫置）和手機橫置都保持橫式
  const [isWideViewport, setIsWideViewport] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 640px)").matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 640px)");
    const onChange = (e: MediaQueryListEvent) => setIsWideViewport(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Issue #437: 量測選項 grid 實際容器寬度，決定 4×1 / 2×2
  // 寬度足夠（4 個選項 + gap 都裝得下）→ 4×1；不夠 → 2×2
  // 用 callback ref，避免 loading=true 早退出時 useRef 抓不到 DOM 的時序 bug
  const [optionsGridWidth, setOptionsGridWidth] = useState(0);
  const optionsObserverRef = useRef<ResizeObserver | null>(null);
  const setOptionsGridRef = useCallback((node: HTMLDivElement | null) => {
    if (optionsObserverRef.current) {
      optionsObserverRef.current.disconnect();
      optionsObserverRef.current = null;
    }
    if (node && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setOptionsGridWidth(entry.contentRect.width);
        }
      });
      ro.observe(node);
      optionsObserverRef.current = ro;
    }
  }, []);

  // Start practice session
  const startPractice = useCallback(async () => {
    try {
      setLoading(true);

      // 根據模式選擇不同的 API
      // (#379) Preview/demo 模式帶 exclude_ids 避免每輪重複
      const excludeParam =
        (isPreviewMode || isDemoMode) && practicedWordIdsRef.current.length > 0
          ? `?exclude_ids=${practicedWordIdsRef.current.join(",")}`
          : "";

      const apiEndpoint = isDemoMode
        ? `/api/demo/assignments/${assignmentId}/preview/word-selection-start${excludeParam}`
        : isPreviewMode
          ? `/api/teachers/assignments/${assignmentId}/preview/word-selection-start${excludeParam}`
          : `/api/students/assignments/${assignmentId}/vocabulary/selection/start`;

      const data = await apiClient.get<{
        session_id: number | null;
        words: WordOption[];
        total_words: number;
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
        show_word: boolean;
        show_image: boolean;
        show_option_images?: boolean;
        play_audio: boolean;
        time_limit_per_question: number | null;
      }>(apiEndpoint);

      setWords(data.words || []);
      setSessionId(data.session_id);
      setIsPracticeMode(data.is_practice_mode ?? false);
      setShowWord(data.show_word ?? true);
      setShowImage(data.show_image ?? true);
      setShowOptionImages(data.show_option_images ?? false);
      setPlayAudio(data.play_audio ?? false);
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
        total_words: data.total_words || 0,
      });
      setCurrentIndex(0);
      setRoundCompleted(false);
      setSelectedAnswer(null);
      setShowResult(false);

      // (#379) Preview/demo 模式：累積已練習的單字 ID，避免下一輪重複
      if (isPreviewMode || isDemoMode) {
        const newWordIds = (data.words || []).map(
          (w: WordOption) => w.content_item_id,
        );
        // 如果後端回傳的單字與已練習清單有重疊，表示循環已重置
        const hasOverlap = newWordIds.some((id: number) =>
          practicedWordIdsRef.current.includes(id),
        );
        if (hasOverlap && practicedWordIdsRef.current.length > 0) {
          // 循環重置：僅保留本輪的單字 ID
          practicedWordIdsRef.current = [...newWordIds];
        } else {
          // 正常累積
          practicedWordIdsRef.current = [
            ...practicedWordIdsRef.current,
            ...newWordIds,
          ];
        }
      }
    } catch (error) {
      console.error("Error starting practice:", error);
      toast.error(
        t("wordSelection.toast.startFailed") || "Failed to start practice",
      );
    } finally {
      setLoading(false);
    }
  }, [assignmentId, isPreviewMode, isDemoMode, t]);

  // Fetch current proficiency
  const fetchProficiency = useCallback(async () => {
    // Skip in preview mode and demo mode - no proficiency tracking
    if (isPreviewMode || isDemoMode) return;

    try {
      const data = await apiClient.get<ProficiencyStatus>(
        `/api/students/assignments/${assignmentId}/vocabulary/selection/proficiency`,
      );
      setProficiency(data);

      // Note: Achievement check moved to round completed view
      // Dialog will only show after clicking "完成本輪", not during practice
    } catch (error) {
      console.error("Error fetching proficiency:", error);
    }
  }, [assignmentId, isPreviewMode, isDemoMode]);

  useEffect(() => {
    startPractice();
  }, [startPractice]);

  useEffect(() => {
    return () => {
      if (showAnswerTimeoutRef.current)
        clearTimeout(showAnswerTimeoutRef.current);
    };
  }, []);

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
  // Don't play when round is completed (to avoid extra playback on "Finish Round")
  useEffect(() => {
    if (
      playAudio &&
      words[currentIndex]?.audio_url &&
      !showResult &&
      !roundCompleted
    ) {
      playWordAudio();
    }
  }, [
    currentIndex,
    playAudio,
    playWordAudio,
    words,
    showResult,
    roundCompleted,
  ]);

  // Timer countdown effect
  useEffect(() => {
    // Clear existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Don't run timer if no time limit, showing result, or round completed
    if (!timeLimit || showResult || roundCompleted || loading) {
      return;
    }

    // Reset timer for new question
    setTimeRemaining(timeLimit);

    // Start countdown
    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null || prev <= 1) {
          // Time's up - clear timer
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

  // Handle timeout - auto-fail when time expires
  useEffect(() => {
    if (timeRemaining === 0 && !showResult && !submitting && words.length > 0) {
      // Time expired - trigger wrong answer
      handleTimeoutAnswer();
    }
  }, [timeRemaining, showResult, submitting, words.length]);

  // Handle timeout answer (separate from regular answer to avoid loops)
  const handleTimeoutAnswer = async () => {
    if (showResult || submitting) return;

    const currentWord = words[currentIndex];

    setSelectedAnswer(null); // No selection made
    setIsCorrect(false);
    setShowResult(true);
    // 答錯且老師開啟「顯示答案」時，跳過「再試一次」動畫避免遮擋揭示的正解
    if (showAnswer) {
      showAnswerTimeoutRef.current = setTimeout(
        () => handleOverlayComplete(),
        2000,
      );
    } else {
      setScoreOverlayOpen(true);
    }
    setSubmitting(true);

    // Skip API call in preview/demo mode, but track local counts so the
    // local tier breakdown matches what students would see.
    if (isPreviewMode || isDemoMode) {
      recordPreviewAnswer(currentWord.content_item_id, false);
      setSubmitting(false);
      return;
    }

    try {
      await apiClient.post(
        `/api/students/assignments/${assignmentId}/vocabulary/selection/answer`,
        {
          content_item_id: currentWord.content_item_id,
          selected_answer: "", // Empty answer for timeout
          is_correct: false,
          time_spent_seconds: timeLimit || 0,
          session_id: sessionId,
        },
      );

      // Fetch updated proficiency
      await fetchProficiency();
    } catch (error) {
      console.error("Error submitting timeout:", error);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle answer selection
  const handleSelectAnswer = async (answer: string) => {
    if (showResult || submitting) return;

    const currentWord = words[currentIndex];
    const correct = answer === currentWord.translation;

    setSelectedAnswer(answer);
    setIsCorrect(correct);
    setShowResult(true);
    // 答錯且老師開啟「顯示答案」時，跳過「再試一次」動畫避免遮擋揭示的正解
    if (!correct && showAnswer) {
      showAnswerTimeoutRef.current = setTimeout(
        () => handleOverlayComplete(),
        2000,
      );
    } else {
      setScoreOverlayOpen(true);
    }
    setSubmitting(true);

    // Skip API call in preview/demo mode, but track local counts so the
    // local tier breakdown matches what students would see.
    if (isPreviewMode || isDemoMode) {
      recordPreviewAnswer(currentWord.content_item_id, correct);
      setSubmitting(false);
      return;
    }

    try {
      await apiClient.post(
        `/api/students/assignments/${assignmentId}/vocabulary/selection/answer`,
        {
          content_item_id: currentWord.content_item_id,
          selected_answer: answer,
          is_correct: correct,
          time_spent_seconds: 0,
          session_id: sessionId,
        },
      );

      // Fetch updated proficiency
      await fetchProficiency();
    } catch (error) {
      console.error("Error submitting answer:", error);
      toast.error(
        t("wordSelection.toast.submitFailed") || "Failed to submit answer",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ScoreOverlay 動畫結束後自動跳下一題
  const handleOverlayComplete = () => {
    if (nextQuestionCalledRef.current) return;
    nextQuestionCalledRef.current = true;
    setTimeout(() => {
      nextQuestionCalledRef.current = false;
    }, 300);

    setScoreOverlayOpen(false);
    setSelectedAnswer(null);
    setShowResult(false);
    // Reset timer immediately to prevent timeout effect from triggering on next question
    if (timeLimit) {
      setTimeRemaining(timeLimit);
    }

    if (currentIndex < words.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setRoundCompleted(true);
    }
  };

  // Start next round
  const handleStartNextRound = () => {
    startPractice();
  };

  // Issue #460: Submit assignment — called when student confirms submission
  const handleSubmitAssignment = async () => {
    // 預覽模式和 demo 模式不需要呼叫 API
    if (isPreviewMode || isDemoMode) {
      toast.success(
        t("wordSelection.toast.completed") || "Assignment completed!",
      );
      setShowAchievementDialog(false);
      onComplete?.();
      return;
    }

    // 防止重複點擊
    if (completing) return;

    setCompleting(true);
    try {
      // 呼叫提交 API 來更新狀態為 GRADED 並記錄分數
      await apiClient.post(`/api/students/assignments/${assignmentId}/submit`);

      toast.success(
        t("wordSelection.toast.submitted") || "Assignment submitted!",
      );
      setIsPracticeMode(true); // Now in practice-only mode
      setShowAchievementDialog(false);
      setRoundCompleted(false);
      // Don't call onComplete — student can continue practicing
    } catch (error) {
      console.error("Error submitting assignment:", error);
      toast.error(
        t("wordSelection.toast.completeFailed") ||
          "Failed to submit assignment. Please try again.",
      );
      // 保持 dialog 開啟，讓使用者可以重試
    } finally {
      setCompleting(false);
    }
  };

  // Complete and go back to assignment list
  const handleCompleteAssignment = () => {
    onComplete?.();
  };

  // Continue practice after achievement
  const handleContinuePractice = () => {
    setShowAchievementDialog(false);
    startPractice();
  };

  // Loading state
  if (loading) {
    return (
      <Card className="p-8">
        <CardContent className="flex flex-col items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-4" />
          <p className="text-gray-600">
            {t("wordSelection.loading") || "Loading vocabulary items..."}
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
            {t("wordSelection.noItems") || "No vocabulary items found"}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Round completed view
  if (roundCompleted) {
    return (
      <Card className="p-8">
        <CardContent className="text-center space-y-6">
          <div className="flex justify-center">
            <CheckCircle className="h-16 w-16 text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800">
            {t("wordSelection.roundComplete") || "Round Complete!"}
          </h2>

          {/* Issue #460: Practice mode banner */}
          {isPracticeMode && (
            <div className="flex items-center gap-2 justify-center text-sm text-blue-600 bg-blue-50 rounded-lg px-4 py-2">
              <Info className="h-4 w-4" />
              <span>
                {t("wordSelection.practiceModeHint") ||
                  "Practice mode — your score will not be affected"}
              </span>
            </div>
          )}

          {/* Proficiency Progress */}
          <div className="space-y-2 max-w-md mx-auto">
            <div className="flex justify-between text-sm text-gray-600">
              <span>
                {t("wordSelection.currentProficiency") || "Proficiency"}
              </span>
              <span>
                {displayProficiency.toFixed(1)}% / {proficiency.target_mastery}%
              </span>
            </div>
            <Progress value={displayProficiency} max={100} className="h-3" />
          </div>

          <div className="text-gray-600">
            <p>
              {t("wordSelection.wordsMastered", {
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
            /* Already submitted — practice-only mode */
            <div className="flex gap-4 justify-center">
              <Button onClick={handleStartNextRound}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("wordSelection.continuePractice") || "Continue Practice"}
              </Button>
              <Button variant="outline" onClick={handleCompleteAssignment}>
                <CheckCircle className="h-4 w-4 mr-2" />
                {t("wordSelection.backToList") || "Back to List"}
              </Button>
            </div>
          ) : proficiency.achieved ? (
            /* Issue #460: Achieved target — ask student whether to submit */
            <div className="space-y-4">
              <div className="flex justify-center">
                <Trophy className="h-12 w-12 text-yellow-500" />
              </div>
              <p className="text-green-600 font-medium">
                {t("wordSelection.targetReached") ||
                  "Congratulations! You've reached the target proficiency!"}
              </p>
              <p className="text-gray-500 text-sm">
                {t("wordSelection.submitPrompt") ||
                  "Would you like to submit your assignment? You can continue practicing after submission, but your score will be locked."}
              </p>
              <div className="flex gap-4 justify-center">
                <Button
                  variant="outline"
                  onClick={handleContinuePractice}
                  disabled={completing}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t("wordSelection.keepPracticing") || "Keep Practicing"}
                </Button>
                <Button onClick={handleSubmitAssignment} disabled={completing}>
                  {completing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  {t("wordSelection.submitAssignment") || "Submit Assignment"}
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={handleStartNextRound}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t("wordSelection.nextRound") || "Start Next Round"}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const currentWord = words[currentIndex];

  // Issue #437: 寬螢幕 + 有題目圖片 → 橫式排版（圖左、選項右）
  const useHorizontal = showImage && !!currentWord?.image_url && isWideViewport;

  // Issue #437: 選項有圖時，若容器寬度足夠就排成 4×1（節省垂直空間）；不夠則 2×2
  // 600px 約等於 4 × 140px + 3 × 16px gap
  const useFourColOptions = showOptionImages && optionsGridWidth >= 600;

  return (
    <div className="space-y-6">
      {/* Issue #460: Practice mode banner */}
      {isPracticeMode && (
        <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 rounded-lg px-4 py-2">
          <BookOpen className="h-4 w-4" />
          <span>
            {t("wordSelection.practiceModeHeader") ||
              "Practice mode — your submitted score will not change"}
          </span>
        </div>
      )}

      {/* Header: 題號 + 進度條 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {t("wordSelection.wordSelection") || "Word Selection"}
            </Badge>
            <span className="text-sm text-gray-600">
              {t("wordSelection.questionProgress", {
                current: currentIndex + 1,
                total: words.length,
              }) || `第 ${currentIndex + 1}/${words.length} 題`}
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

      {/* Question content */}
      <div
        className={cn(
          "space-y-6",
          // Issue #437: 橫式（圖左、右欄文字+選項）— 不加 items-start，
          // 用預設 items-stretch 讓兩欄等高，圖片高度由右欄決定
          useHorizontal && "flex flex-row gap-6 space-y-0",
        )}
      >
        {/* Image */}
        {showImage && currentWord.image_url && (
          <div
            className={cn(
              "flex justify-center",
              // relative 配合 img absolute，讓圖片父層自然高度為 0、不貢獻 flex 高度
              useHorizontal && "w-1/2 shrink-0 relative",
            )}
          >
            <img
              src={currentWord.image_url}
              alt={currentWord.text}
              className={cn(
                "object-contain rounded-lg",
                useHorizontal ? "absolute inset-0 w-full h-full" : "max-h-48",
              )}
            />
          </div>
        )}

        {/* 右側欄（橫式時把文字/音檔/題目/Timer/選項都放這裡） */}
        <div className={cn("space-y-6", useHorizontal && "flex-1 min-w-0")}>
          {/* Word Text - hide when in audio mode */}
          {!playAudio && (
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-800 select-none">
                {currentWord.text}
              </h2>
            </div>
          )}

          {/* Audio Button - only show if playAudio setting is enabled */}
          {playAudio && currentWord.audio_url && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="lg"
                onClick={playWordAudio}
                className="gap-2"
              >
                <Volume2 className="h-5 w-5" />
                {t("wordSelection.playAudio") || "Play Audio"}
              </Button>
            </div>
          )}

          {/* Question */}
          <div className="text-center text-gray-600">
            {showWord
              ? t("wordSelection.selectTranslation") ||
                "Select the correct translation:"
              : t("wordSelection.selectTranslationAudio") ||
                "Listen and select the correct translation:"}
          </div>

          {/* Timer Display - stays visible when time is up to prevent visual jump */}
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
                  <span>{t("wordSelection.timeUp") || "Time's up!"}</span>
                ) : (
                  <>
                    <span>{timeRemaining}</span>
                    <span className="text-sm">
                      {t("wordSelection.seconds") || "s"}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Answer Options */}
          <div
            ref={setOptionsGridRef}
            className={cn(
              "grid gap-3 sm:gap-4",
              useFourColOptions ? "grid-cols-4" : "grid-cols-2 grid-rows-2",
            )}
            style={{ gridAutoRows: "1fr" }}
          >
            {currentWord.options.map((option, index) => {
              const optionText = option.text;
              const optionImage = option.image_url || null;
              const isSelected = selectedAnswer === optionText;
              const isCorrectAnswer = optionText === currentWord.translation;
              // 答對時揭示；答錯時只有老師開啟 showAnswer 才揭示（Issue #538）
              const showCorrect =
                showResult && isCorrectAnswer && (isCorrect || showAnswer);
              const showIncorrect =
                showResult && isSelected && !isCorrectAnswer;
              // 答錯後才揭示的正解需要打勾動畫引導注意
              const animateReveal = showCorrect && !isCorrect;
              // Issue #631: 選項圖片模式 — 有圖則顯示圖，沒圖 fallback 為文字
              const renderAsImage = showOptionImages && !!optionImage;

              // 四個選項各用不同淺色
              const optionColors = [
                "bg-blue-50 border-blue-200 hover:bg-blue-100 hover:border-blue-400",
                "bg-purple-50 border-purple-200 hover:bg-purple-100 hover:border-purple-400",
                "bg-amber-50 border-amber-200 hover:bg-amber-100 hover:border-amber-400",
                "bg-teal-50 border-teal-200 hover:bg-teal-100 hover:border-teal-400",
              ];

              return (
                <button
                  key={index}
                  className={cn(
                    "h-full min-h-16 py-3 px-4 text-base sm:text-lg font-medium",
                    "rounded-2xl border-2 shadow-md select-none relative",
                    "transition-all duration-200",
                    "whitespace-normal text-center break-words",
                    !showResult &&
                      "hover:shadow-lg hover:-translate-y-0.5 active:scale-95",
                    !showResult && optionColors[index % 4],
                    showCorrect &&
                      "bg-green-100 border-green-500 text-green-800 shadow-green-200",
                    showIncorrect &&
                      "bg-red-100 border-red-500 text-red-800 shadow-red-200",
                    isSelected &&
                      !showResult &&
                      "ring-2 ring-indigo-400 scale-95",
                    showResult &&
                      !showCorrect &&
                      !showIncorrect &&
                      "opacity-50",
                  )}
                  onClick={() => handleSelectAnswer(optionText)}
                  disabled={showResult || submitting}
                  aria-label={optionText}
                >
                  {(showCorrect || showIncorrect) && (
                    <span
                      className={cn(
                        "absolute top-2 left-2 z-10",
                        animateReveal &&
                          "animate-in zoom-in-50 fade-in duration-500",
                      )}
                    >
                      {showCorrect ? (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-600" />
                      )}
                    </span>
                  )}
                  {renderAsImage ? (
                    <div className="flex flex-col items-center gap-2">
                      <img
                        src={optionImage as string}
                        alt={optionText}
                        className="max-h-28 sm:max-h-36 w-full object-contain rounded-md"
                      />
                      <span>{optionText}</span>
                    </div>
                  ) : (
                    <span>{optionText}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 答對/答錯動畫 overlay → 動畫結束自動下一題 */}
      <ScoreOverlay
        open={scoreOverlayOpen}
        score={isCorrect ? 100 : 0}
        isError={!isCorrect}
        onComplete={handleOverlayComplete}
      />

      {/* Achievement Dialog */}
      <Dialog
        open={showAchievementDialog}
        onOpenChange={setShowAchievementDialog}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Trophy className="h-6 w-6 text-yellow-500" />
              {t("wordSelection.achievementTitle") || "Congratulations!"}
            </DialogTitle>
            <DialogDescription className="space-y-4 pt-4">
              <p className="text-lg">
                {t("wordSelection.achievementMessage", {
                  target: proficiency.target_mastery,
                }) ||
                  `You've reached the target proficiency of ${proficiency.target_mastery}%!`}
              </p>
              <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                <p>
                  {t("wordSelection.currentProficiency") ||
                    "Current Proficiency"}
                  :{" "}
                  <span className="font-bold text-blue-600">
                    {displayProficiency.toFixed(1)}%
                  </span>
                </p>
                <p>
                  {t("wordSelection.wordsMastered", {
                    mastered: displayWordsMastered,
                    total: proficiency.total_words,
                  }) ||
                    `Words Mastered: ${displayWordsMastered} / ${proficiency.total_words}`}
                </p>
              </div>
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
                ? t("wordSelection.continuePractice") || "Continue Practice"
                : t("wordSelection.keepPracticing") || "Keep Practicing"}
            </Button>
            {isPracticeMode ? (
              <Button onClick={handleCompleteAssignment}>
                <CheckCircle className="h-4 w-4 mr-2" />
                {t("wordSelection.backToList") || "Back to List"}
              </Button>
            ) : (
              <Button onClick={handleSubmitAssignment} disabled={completing}>
                {completing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                {t("wordSelection.submitAssignment") || "Submit Assignment"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
