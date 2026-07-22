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
 * - Adaptive layout:
 *   (a) Question image: horizontal (image left, options right) on wide
 *       viewport (≥640px); vertical on narrow viewport.
 *   (b) Option images mode: options grid switches to 4×1 when its
 *       container is wide enough (~600px) to fit four images, else 2×2.
 *   (c) #844 欄數固定（不依字長翻轉，避免間距忽近忽遠）：手機單欄、平板 2×2、
 *       桌機 4 欄；圖左 landscape 維持單欄。長選項（≥5 詞）另把題目圖移到上方。
 *       字級用 useShrinkToFit fit-to-box（字少撐大、字多縮到塞得下、不裁字）。
 *
 * show_image 模式（看圖選英文）：
 * - 題目隱藏英文，改顯示翻譯提示 + 圖片
 * - 4 個選項顯示英文（後端依 show_image 切換 distractors 語言）
 * - 答案比對使用後端傳的 correct_text（fallback: 依 showImage flag 決定 text/translation）
 * - 不顯示文字提示語（畫面已直覺）
 *
 * ⚠️ 此元件同時被學生作答頁與派發 sheet 預覽共用。
 *    改動前必讀：docs/design/preview-architecture.md
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
  Trophy,
  RefreshCw,
  Send,
  BookOpen,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api";
import { withDemoOverrides } from "@/lib/demoOverrides";
import ScoreOverlay from "./shared/ScoreOverlay";
import CountdownRing from "./shared/CountdownRing";
import WordSelectionOptionButton from "./shared/WordSelectionOptionButton";
import ClozeBlankText from "./shared/ClozeBlankText";
import { buildBlankedSentence } from "@/lib/cloze";
import { useShortLandscape } from "./shared/useShortLandscape";
import { aggregateTierCounts, weightedMastery } from "./wordFamiliarity";

interface OptionEntry {
  text: string;
  image_url?: string | null;
}

interface WordOption {
  content_item_id: number;
  text: string;
  translation: string;
  // 後端依 show_image 決定的「正解文字」(true=英文 / false=翻譯)
  // 舊版本後端不會回傳此欄位 → 前端 fallback 到 translation
  correct_text?: string;
  audio_url?: string;
  image_url?: string;
  memory_strength: number;
  options: OptionEntry[];
  // Issue #860: 顯示例句（答案挖空）。blanked_sentence 由後端算好；
  // 老師派發預覽等只有原始教材的路徑沒有此欄位，前端才自行挖空。
  example_sentence?: string | null;
  cloze_answer?: string | null;
  blanked_sentence?: string | null;
  // Issue #967: 例句題型 + 播放音檔時，改播例句音檔（非單字音檔）。
  example_sentence_audio_url?: string | null;
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
  // Issue #800: backend signals every word reached T5 and was therefore
  // excluded from the candidate pool. Frontend shows the "全部精熟" panel
  // instead of the generic "no items" empty state.
  all_mastered?: boolean;
}

interface WordSelectionActivityProps {
  assignmentId: number;
  isPreviewMode?: boolean;
  isDemoMode?: boolean; // Demo mode - uses public demo API endpoints
  initialPracticeMode?: boolean; // True when assignment is already GRADED (re-practice)
  showAnswer?: boolean; // 答錯後是否揭示正確答案
  onComplete?: () => void;
  // Issue #752: dialog 內即時預覽 — 跳過 API fetch，直接吃 props
  previewWords?: WordOption[];
  previewSettings?: {
    show_image?: boolean;
    show_option_images?: boolean;
    show_example_sentence?: boolean;
    play_audio?: boolean;
    target_proficiency?: number;
    time_limit_per_question?: number | null;
  };
}

// 樣式常數 & 共用 hook 抽到 shared/，與 WordSelectionQuizActivity 共用

export default function WordSelectionActivity({
  assignmentId,
  isPreviewMode = false,
  isDemoMode = false,
  initialPracticeMode = false,
  showAnswer = false,
  onComplete,
  previewWords,
  previewSettings,
}: WordSelectionActivityProps) {
  const isLivePreview = !!previewWords;
  const { t } = useTranslation();
  // Note: Using apiClient which auto-detects token (student or teacher)

  // State — 預覽模式 items 從 props 來，不需要 loading
  const [loading, setLoading] = useState(!isLivePreview);
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
  const [showImage, setShowImage] = useState(true);
  const [showOptionImages, setShowOptionImages] = useState(false);
  const [showExampleSentence, setShowExampleSentence] = useState(false);
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

  // Practice-only mode: assignment already submitted, score locked
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
    isPreviewMode || isDemoMode || isLivePreview
      ? previewProficiency
      : proficiency.current_mastery;

  // Computed: tier counts shown in UI (live = API, preview/demo = local).
  const displayTierCounts = useMemo(() => {
    if (isPreviewMode || isDemoMode || isLivePreview) {
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
  }, [
    isPreviewMode,
    isDemoMode,
    isLivePreview,
    previewTierCounts,
    proficiency,
  ]);

  // Computed: 顯示用的已熟練單字數（同等於 master tier 數）
  const displayWordsMastered = displayTierCounts.master;

  // Timer
  const [timeLimit, setTimeLimit] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Audio ref
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 直式優先：圖在上、選項在下；只在「橫向 + 視窗高度不足」(手機橫放) 才退回橫式
  const isShortLandscape = useShortLandscape();

  // show_image 模式下正解為英文 (word.text)，否則為翻譯。優先信任後端傳的
  // correct_text；舊版後端未回傳時依 showImage flag fallback。
  const getExpectedAnswer = useCallback(
    (word: WordOption) =>
      word.correct_text ?? (showImage ? word.text : word.translation),
    [showImage],
  );

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
        ? withDemoOverrides(
            `/api/demo/assignments/${assignmentId}/preview/word-selection-start${excludeParam}`,
          )
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
        all_mastered?: boolean;
        achieved: boolean;
        is_practice_mode?: boolean;
        show_image: boolean;
        show_option_images?: boolean;
        show_example_sentence?: boolean;
        play_audio: boolean;
        time_limit_per_question: number | null;
      }>(apiEndpoint);

      setWords(data.words || []);
      setSessionId(data.session_id);
      setIsPracticeMode(data.is_practice_mode ?? false);
      setShowImage(data.show_image ?? true);
      setShowOptionImages(data.show_option_images ?? false);
      setShowExampleSentence(data.show_example_sentence ?? false);
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
        all_mastered: data.all_mastered ?? false,
      });
      setCurrentIndex(0);
      setRoundCompleted(false);
      setSelectedAnswer(null);
      setShowResult(false);

      // (#379) Preview/demo 模式：累積已練習的單字 ID，避免下一輪重複
      if (isPreviewMode || isDemoMode || isLivePreview) {
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
    if (isPreviewMode || isDemoMode || isLivePreview) return;

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
    if (isLivePreview && previewWords) {
      setWords(previewWords);
      setSessionId(null);
      setIsPracticeMode(false);
      setShowImage(previewSettings?.show_image ?? true);
      setShowOptionImages(previewSettings?.show_option_images ?? false);
      setShowExampleSentence(previewSettings?.show_example_sentence ?? false);
      setPlayAudio(previewSettings?.play_audio ?? false);
      setTimeLimit(previewSettings?.time_limit_per_question || null);
      setTimeRemaining(previewSettings?.time_limit_per_question || null);
      setProficiency({
        current_mastery: 0,
        target_mastery: previewSettings?.target_proficiency ?? 80,
        achieved: false,
        words_mastered: 0,
        total_words: previewWords.length,
      });
      setCurrentIndex(0);
      setRoundCompleted(false);
      setSelectedAnswer(null);
      setShowResult(false);
      setLoading(false);
      return;
    }
    startPractice();
  }, [startPractice, isLivePreview, previewWords, previewSettings]);

  useEffect(() => {
    return () => {
      if (showAnswerTimeoutRef.current)
        clearTimeout(showAnswerTimeoutRef.current);
    };
  }, []);

  // Issue #967: 例句題型時改播例句音檔（非單字音檔）。
  const resolveAudioUrl = useCallback(
    (word?: WordOption) =>
      showExampleSentence ? word?.example_sentence_audio_url : word?.audio_url,
    [showExampleSentence],
  );

  // Play audio for current word
  const playWordAudio = useCallback(() => {
    const url = resolveAudioUrl(words[currentIndex]);
    if (url) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      audioRef.current = new Audio(url);
      audioRef.current.play().catch(console.error);
    }
  }, [words, currentIndex, resolveAudioUrl]);

  // Auto-play audio when word changes if play_audio is enabled
  // Don't play when round is completed (to avoid extra playback on "Finish Round")
  useEffect(() => {
    if (
      playAudio &&
      resolveAudioUrl(words[currentIndex]) &&
      !showResult &&
      !roundCompleted
    ) {
      playWordAudio();
    }
  }, [
    currentIndex,
    playAudio,
    playWordAudio,
    resolveAudioUrl,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (isPreviewMode || isDemoMode || isLivePreview) {
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
    const expected = getExpectedAnswer(currentWord);
    const correct = answer === expected;

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
    if (isPreviewMode || isDemoMode || isLivePreview) {
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

  const handleSubmitAssignment = async () => {
    // 預覽模式和 demo 模式不需要呼叫 API
    if (isPreviewMode || isDemoMode || isLivePreview) {
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
    // Issue #800: distinguish "全部精熟" (every word reached T5, none to
    // practice) from a genuinely empty assignment.
    if (proficiency.all_mastered) {
      return (
        <Card className="p-8">
          <CardContent className="text-center space-y-4">
            <div className="flex justify-center">
              <Trophy className="h-16 w-16 text-yellow-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800">
              {t("wordSelection.allMastered") || "全部精熟！"}
            </h2>
            <p className="text-gray-600">
              {t("wordSelection.allMasteredHint") ||
                "這份作業的單字你已經全部精熟，不需再練。"}
            </p>
            {!isPracticeMode && (
              <div className="flex justify-center">
                <Button onClick={handleSubmitAssignment} disabled={completing}>
                  {completing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  {t("wordSelection.submitAssignment") || "Submit Assignment"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      );
    }
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

          {/* Practice mode banner */}
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
            /* Achieved target — ask student whether to submit */
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
  // Issue #860: 「顯示例句」是附加提示 —— 題目呈現方式維持顯示單字／播放音檔，
  // 額外在選項上方顯示把目標單字挖空的例句。挖空句優先用後端算好的；只有派發預覽
  // （只有原始教材）才前端自行挖。挖不出空時為空字串 → 該卡不顯示例句，
  // 絕不顯示未挖空原句（會洩漏答案）。
  const blankedText =
    showExampleSentence && currentWord
      ? currentWord.blanked_sentence ||
        buildBlankedSentence(
          currentWord.example_sentence,
          currentWord.cloze_answer,
          currentWord.text,
        )
      : "";
  // #967: 例句題型「例句即題目」，不顯示單字圖片（圖片＝答案，會直接洩漏）。
  const showQuestionImage =
    showImage && !showExampleSentence && !!currentWord?.image_url;

  // Issue #844: 任一非圖片選項 ≥5 詞（≥4 空格）→ 視為長選項。長選項一律單欄
  // 拿全寬（窄螢幕、或圖在上時），讓長句有整列寬度好換行、字級不被擠小。
  const hasLongOption =
    !showOptionImages &&
    (currentWord?.options ?? []).some(
      (o) => (o.text?.trim().split(/\s+/).length ?? 0) >= 5,
    );

  // 直式優先：題目有圖且視窗矮（橫向手機）才退回橫式（圖左、選項右）。
  // #844：長選項時關閉橫式 → 圖回到上方，下方選項拿全寬單欄。
  const useHorizontal = showQuestionImage && isShortLandscape && !hasLongOption;

  return (
    <div className="flex flex-col gap-6 min-h-[calc(100dvh-8rem)]">
      {/* Practice mode banner */}
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
          "relative flex-1 min-h-0",
          // 直式：內容垂直分配（圖→文字→選項），選項區拿剩餘高度
          // 橫式：圖左、右欄文字+選項，items-stretch 讓兩欄等高
          useHorizontal ? "flex flex-row gap-6" : "flex flex-col gap-6",
        )}
      >
        {/* Issue #716: countdown ring anchored top-right of the question card */}
        {timeLimit && timeRemaining !== null && (
          <CountdownRing
            key={currentIndex}
            seconds={timeRemaining}
            total={timeLimit}
            className="absolute top-0 right-0 z-10"
          />
        )}
        {/* Image */}
        {showQuestionImage && (
          <div
            className={cn(
              "flex justify-center shrink-0",
              // 橫式：圖佔左半欄；relative 配合 img absolute、min-h-48 防塌
              // 直式：圖跟視窗高度連動，max-h-[40vh] 讓選項區拿到剩下的空間
              useHorizontal && "w-1/2 relative min-h-48",
            )}
          >
            <img
              src={currentWord.image_url ?? undefined}
              alt={currentWord.text}
              className={cn(
                "object-contain rounded-lg",
                useHorizontal
                  ? "absolute inset-0 w-full h-full"
                  : "max-h-[clamp(8rem,38vh,22rem)] w-auto",
              )}
            />
          </div>
        )}

        {/* 內容欄（橫式時是右側欄；直式時直接展開文字/音檔/選項） */}
        <div
          className={cn(
            "flex-1 min-h-0 flex flex-col gap-6",
            useHorizontal && "min-w-0",
          )}
        >
          {/* Word Text — show_image 模式時隱藏英文（避免答案太明顯），改顯示翻譯提示
              即使老師勾了 show_image 但實際沒附圖，仍套用此規則 — 否則英文題目+英文選項會秒解。
              #967：例句題型時題目改為挖空例句（見下方），這裡不顯示單字/翻譯。 */}
          {!playAudio && !showExampleSentence && (
            <div className="text-center py-4 sm:py-6">
              <h2 className="text-[clamp(26px,9vh,30px)] font-bold text-gray-800 select-none">
                {showImage ? currentWord.translation : currentWord.text}
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

          {/* Issue #860 / #967: 例句題型 —— 挖空例句「就是題目」，放題目位置、
              不加外框底色（只有挖空單字有框，由 ClozeBlankText 提供）。挖不出空時
              blankedText 為空 → 該卡不顯示，絕不顯示未挖空原句（會洩漏答案）。 */}
          {blankedText && (
            <div className="text-center py-4 sm:py-6">
              <p className="text-[clamp(18px,4.5vh,22px)] font-medium text-gray-700 leading-relaxed select-none">
                <ClozeBlankText text={blankedText} />
              </p>
            </div>
          )}

          {/* Answer Options */}
          <div
            className={cn(
              "grid gap-2 flex-1 min-h-0",
              // #844 欄數固定（不依字長翻轉，避免間距忽近忽遠）：
              // 手機單欄、平板 2×2、桌機 4 欄；圖左 landscape 維持單欄。
              // 圖片位置另由 hasLongOption 控制（長選項時圖移到上方）。
              useHorizontal
                ? "grid-cols-1"
                : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
            )}
            // #844：列高鎖 minmax(4rem,1fr)（min ≥ 按鈕 min-h），按鈕不溢出列、
            // 選項上下間距固定 8px（gap-2）每題一致；max 仍 1fr 故不爆版、fit-to-box 有界
            style={{ gridAutoRows: "minmax(4rem, 1fr)" }}
          >
            {currentWord.options.map((option, index) => {
              const optionText = option.text;
              const optionImage = option.image_url || null;
              const isSelected = selectedAnswer === optionText;
              const expectedAnswer = getExpectedAnswer(currentWord);
              const isCorrectAnswer = optionText === expectedAnswer;
              // 答對時揭示；答錯時只有老師開啟 showAnswer 才揭示（Issue #538）
              const showCorrect =
                showResult && isCorrectAnswer && (isCorrect || showAnswer);
              const showIncorrect =
                showResult && isSelected && !isCorrectAnswer;
              // 答錯後才揭示的正解需要打勾動畫引導注意
              const animateReveal = showCorrect && !isCorrect;
              // 選項圖片模式 — 有圖則顯示圖，沒圖 fallback 為文字。
              // #967: 例句題型選項一律英文（不渲染圖片），即使舊資料同時開了
              // showOptionImages（#955 曾允許並存，現已互斥）。
              const renderAsImage =
                showOptionImages && !showExampleSentence && !!optionImage;

              return (
                <WordSelectionOptionButton
                  key={index}
                  text={optionText}
                  imageUrl={optionImage}
                  showAsImage={renderAsImage}
                  colorIndex={index}
                  isSelected={isSelected}
                  disabled={showResult || submitting}
                  onClick={() => handleSelectAnswer(optionText)}
                  showResult={showResult}
                  showCorrect={showCorrect}
                  showIncorrect={showIncorrect}
                  animateReveal={animateReveal}
                />
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
