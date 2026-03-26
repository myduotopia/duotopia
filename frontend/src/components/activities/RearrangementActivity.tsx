/**
 * RearrangementActivity - 例句重組練習組件
 *
 * 功能：
 * - 顯示打散的單字，學生依序點選組成正確句子
 * - 即時計分：每個單字 floor(100/字數) 分
 * - 錯誤限制：<=10字 3次, 11-25字 5次
 * - 可選音檔播放（聽力模式）
 * - 計時功能
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Volume2, Clock, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import ScoreOverlay from "./shared/ScoreOverlay";

export interface RearrangementQuestion {
  content_item_id: number;
  shuffled_words: string[];
  word_count: number;
  max_errors: number;
  time_limit: number;
  play_audio: boolean;
  audio_url?: string;
  translation?: string;
  original_text?: string; // 正確答案（用於顯示答案功能）
  // 進度恢復欄位（重整頁面時使用）
  progress_status?: string | null; // "COMPLETED" / "IN_PROGRESS" / null
  progress_score?: number | null;
  progress_error_count?: number | null;
}

interface RearrangementActivityProps {
  studentAssignmentId: number;
  onComplete?: (totalScore: number, totalQuestions: number) => void;
  isPreviewMode?: boolean;
  isDemoMode?: boolean; // Demo mode - uses public demo API endpoints
  showAnswer?: boolean; // 答題結束後是否顯示正確答案
  isPracticeMode?: boolean; // 練習模式：已提交的作業，不計分，可重新練習
  // 受控導航 props（由父組件控制題目切換）
  currentQuestionIndex?: number;
  onQuestionIndexChange?: (index: number) => void;
  onQuestionsLoaded?: (
    questions: RearrangementQuestion[],
    questionStates: Map<number, RearrangementQuestionState>,
  ) => void;
  onQuestionStateChange?: (
    questionStates: Map<number, RearrangementQuestionState>,
  ) => void;
}

export interface RearrangementQuestionState {
  selectedWords: string[]; // 已選擇的單字（按順序）
  remainingWords: string[]; // 剩餘可選的單字
  errorCount: number;
  expectedScore: number;
  completed: boolean;
  challengeFailed: boolean;
  timeRemaining: number;
  hasSeenAnswer: boolean; // 是否已看過答案（用於計算重試後滿分）
  maxScore: number; // 該題滿分（初始 100，看過答案後變 60）
}

// 內部使用的別名
type QuestionState = RearrangementQuestionState;

const RearrangementActivity: React.FC<RearrangementActivityProps> = ({
  studentAssignmentId,
  onComplete,
  isPreviewMode = false,
  isDemoMode = false,
  showAnswer = false,
  isPracticeMode = false,
  currentQuestionIndex: controlledIndex,
  onQuestionIndexChange,
  onQuestionsLoaded,
  onQuestionStateChange,
}) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<RearrangementQuestion[]>([]);
  const [internalQuestionIndex, setInternalQuestionIndex] = useState(0);
  const [questionStates, setQuestionStates] = useState<
    Map<number, QuestionState>
  >(new Map());
  // 🚀 移除 submitting 狀態 - 驗證現在是即時的，不需要 loading 狀態
  const [scoreCategory, setScoreCategory] = useState<string>("writing");
  const [totalScore, setTotalScore] = useState(0);
  const totalScoreRef = useRef(0);
  const [, setCompletedQuestions] = useState(0);
  // 追蹤第一題音檔是否因瀏覽器限制而無法自動播放
  const [showAudioPrompt, setShowAudioPrompt] = useState(false);
  // 音檔播放速度
  const [playbackRate, setPlaybackRate] = useState(1.0);
  // 結果 Modal 開關狀態
  const [resultModalOpen, setResultModalOpen] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 用 ref 存儲 questions，確保 handleTimeout 能同步獲取到最新數據
  const questionsRef = useRef<RearrangementQuestion[]>([]);
  // 用 ref 存儲 questionStates，確保 timer callback 能獲取最新狀態
  const questionStatesRef = useRef(questionStates);
  // 累積每題的選字歷程，key = content_item_id
  const selectionsRef = useRef<
    Map<
      number,
      Array<{
        position: number;
        selected: string;
        correct: string;
        is_correct: boolean;
        timestamp: string;
      }>
    >
  >(new Map());

  // 使用受控或內部索引
  const currentQuestionIndex = controlledIndex ?? internalQuestionIndex;
  const setCurrentQuestionIndex = (index: number) => {
    if (onQuestionIndexChange) {
      onQuestionIndexChange(index);
    } else {
      setInternalQuestionIndex(index);
    }
  };

  // 同步 questionStatesRef，確保 timer callback 能獲取最新狀態
  useEffect(() => {
    questionStatesRef.current = questionStates;
  }, [questionStates]);

  // 通知父組件題目狀態變更
  useEffect(() => {
    if (onQuestionStateChange && questionStates.size > 0) {
      onQuestionStateChange(questionStates);
    }
  }, [questionStates, onQuestionStateChange]);

  // 追蹤是否已播放第一題音檔
  const hasPlayedFirstAudioRef = useRef(false);

  // 載入題目
  const lastLoadedAssignmentRef = useRef<number | null>(null);
  useEffect(() => {
    if (lastLoadedAssignmentRef.current === studentAssignmentId) return;
    lastLoadedAssignmentRef.current = studentAssignmentId;
    hasPlayedFirstAudioRef.current = false; // 重置狀態
    loadQuestions();
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [studentAssignmentId]);

  // 第一題音檔自動播放（題目載入完成後）
  useEffect(() => {
    if (questions.length > 0 && !hasPlayedFirstAudioRef.current && !loading) {
      const firstQuestion = questions[0];
      if (firstQuestion.play_audio && firstQuestion.audio_url) {
        // 延遲播放，確保 UI 渲染完成
        const timer = setTimeout(async () => {
          try {
            await playAudioAsync(firstQuestion.audio_url!);
            hasPlayedFirstAudioRef.current = true;
            setShowAudioPrompt(false);
          } catch (error) {
            // 瀏覽器阻擋自動播放，顯示提示讓用戶點擊
            if (error instanceof Error && error.name === "NotAllowedError") {
              setShowAudioPrompt(true);
            }
            hasPlayedFirstAudioRef.current = true;
          }
        }, 500);
        return () => clearTimeout(timer);
      }
      hasPlayedFirstAudioRef.current = true;
    }
  }, [questions, loading]);

  const loadQuestions = async () => {
    try {
      setLoading(true);
      // 根據模式選擇不同的 API
      const apiUrl = isDemoMode
        ? `/api/demo/assignments/${studentAssignmentId}/preview/rearrangement-questions`
        : isPreviewMode
          ? `/api/teachers/assignments/${studentAssignmentId}/preview/rearrangement-questions`
          : `/api/students/assignments/${studentAssignmentId}/rearrangement-questions`;

      const response = await apiClient.get<{
        student_assignment_id: number;
        practice_mode: string;
        score_category: string;
        questions: RearrangementQuestion[];
        total_questions: number;
      }>(apiUrl);

      setQuestions(response.questions);
      questionsRef.current = response.questions; // 同步設置 ref，確保 handleTimeout 能立即獲取
      setScoreCategory(response.score_category || "writing");

      // 初始化每題狀態（含進度恢復）
      const initialStates = new Map<number, QuestionState>();
      let restoredTotalScore = 0;
      let restoredCompletedCount = 0;

      response.questions.forEach((q) => {
        if (q.progress_status === "COMPLETED") {
          // 已完成的題目：恢復為完成狀態
          const correctWords = q.original_text?.trim().split(/\s+/) || [];
          initialStates.set(q.content_item_id, {
            selectedWords: correctWords,
            remainingWords: [],
            errorCount: q.progress_error_count || 0,
            expectedScore: q.progress_score || 0,
            completed: true,
            challengeFailed: false,
            timeRemaining: 0,
            hasSeenAnswer: false,
            maxScore: 100,
          });
          restoredTotalScore += q.progress_score || 0;
          restoredCompletedCount += 1;
        } else {
          // 未完成的題目：初始化為空白狀態
          initialStates.set(q.content_item_id, {
            selectedWords: [],
            remainingWords: [...q.shuffled_words],
            errorCount: 0,
            expectedScore: 100,
            completed: false,
            challengeFailed: false,
            timeRemaining: q.time_limit,
            hasSeenAnswer: false,
            maxScore: 100,
          });
        }
      });

      setQuestionStates(initialStates);

      // 恢復分數和已完成數
      if (restoredTotalScore > 0) {
        setTotalScore(restoredTotalScore);
        totalScoreRef.current = restoredTotalScore;
      }
      if (restoredCompletedCount > 0) {
        setCompletedQuestions(restoredCompletedCount);
      }

      // 通知父組件題目已載入
      if (onQuestionsLoaded) {
        onQuestionsLoaded(response.questions, initialStates);
      }

      // 找到第一個未完成的題目
      let firstIncompleteIndex = 0;
      for (let i = 0; i < response.questions.length; i++) {
        const state = initialStates.get(response.questions[i].content_item_id);
        if (state && !state.completed) {
          firstIncompleteIndex = i;
          break;
        }
      }

      // 如果全部完成
      if (restoredCompletedCount === response.questions.length) {
        if (!isPracticeMode && onComplete) {
          onComplete(restoredTotalScore, response.questions.length);
        }
        // 練習模式：不觸發 onComplete，停在第一題讓學生自由練習
      } else {
        // 跳到第一個未完成的題目
        if (firstIncompleteIndex > 0) {
          setCurrentQuestionIndex(firstIncompleteIndex);
        }

        // 開始計時（音檔播放由 useEffect 處理，避免重複播放）
        const targetQuestion = response.questions[firstIncompleteIndex];
        if (targetQuestion.time_limit > 0) {
          startTimer(targetQuestion.content_item_id);
        }
      }
    } catch (error) {
      console.error("Failed to load rearrangement questions:", error);
      toast.error(t("rearrangement.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const startTimer = (contentItemId: number) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    // 找到當前題目，檢查是否為不限時模式
    const currentQuestion = questionsRef.current.find(
      (q) => q.content_item_id === contentItemId,
    );

    // 如果 time_limit 為 0，表示不限時，不啟動計時器
    if (currentQuestion && currentQuestion.time_limit === 0) {
      return;
    }

    timerRef.current = setInterval(() => {
      const prev = questionStatesRef.current;
      const state = prev.get(contentItemId);
      if (state && !state.completed && !state.challengeFailed) {
        const newTime = state.timeRemaining - 1;
        if (newTime <= 0) {
          // 時間到，自動完成（在 updater 外呼叫，避免 side effect）
          handleTimeout(contentItemId);
          return;
        }
        setQuestionStates((prev) => {
          const newStates = new Map(prev);
          const s = newStates.get(contentItemId);
          if (s) {
            newStates.set(contentItemId, {
              ...s,
              timeRemaining: newTime,
            });
          }
          return newStates;
        });
      }
    }, 1000);
  };

  const handleTimeout = async (contentItemId: number) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    // 取得目前狀態（使用 ref 確保從 timer callback 呼叫時能獲取最新值）
    const currentState = questionStatesRef.current.get(contentItemId);

    // 找到當前題目（使用 ref 確保第一題 timeout 時也能正確獲取）
    const currentQuestion = questionsRef.current.find(
      (q) => q.content_item_id === contentItemId,
    );

    // ✅ 時間到計分邏輯（最終版 + maxScore 上限）
    // - 首次作答且完全沒作答 (correct = 0 && error = 0 && !hasSeenAnswer) → 0 分（無保底）
    // - 重試後（hasSeenAnswer=true）不管有沒動作 → 都有保底分（因為之前已有作答）
    // - 有作答（不管完成多少）→ max(計算分數, 保底分)
    const correctWordCount = currentState?.selectedWords.length || 0;
    const errorCount = currentState?.errorCount || 0;
    const currentExpectedScore = currentState?.expectedScore || 100;
    const currentMaxScore = currentState?.maxScore || 100;
    const hasSeenAnswer = currentState?.hasSeenAnswer || false;
    const totalWordCount =
      currentQuestion?.word_count ||
      currentQuestion?.shuffled_words.length ||
      1;
    const pointsPerWord = Math.floor(100 / totalWordCount);
    const minimumScore = pointsPerWord; // 保底分始終為 floor(100/N)
    const unansweredWords = totalWordCount - correctWordCount;

    let actualScore: number;
    // 首次作答且完全沒作答 → 0 分（唯一沒有保底的情況）
    if (correctWordCount === 0 && errorCount === 0 && !hasSeenAnswer) {
      actualScore = 0;
    } else {
      // 有作答 或 重試後 → 預期分數 - 未答數 × 每字分數，有保底分
      const unansweredPenalty = unansweredWords * pointsPerWord;
      const calculatedScore = Math.max(
        0,
        currentExpectedScore - unansweredPenalty,
      );
      // 套用 maxScore 上限，再套用保底分
      const cappedScore = Math.min(currentMaxScore, calculatedScore);
      actualScore = Math.max(cappedScore, minimumScore); // ✅ 套用保底分
    }

    // 判斷是否已完成全部單字
    const isFullyCompleted = correctWordCount >= totalWordCount;

    if (isFullyCompleted) {
      // 邊界情況：時間到但剛好完成全部 → 正常完成流程
      setQuestionStates((prev) => {
        const newStates = new Map(prev);
        const stateInMap = newStates.get(contentItemId);
        if (stateInMap) {
          newStates.set(contentItemId, {
            ...stateInMap,
            completed: true,
            timeRemaining: 0,
            expectedScore: actualScore,
          });
        }
        return newStates;
      });

      setTotalScore((prev) => {
        totalScoreRef.current = prev + actualScore;
        return prev + actualScore;
      });
      setCompletedQuestions((prev) => prev + 1);
      setResultModalOpen(true);

      // 呼叫 API 儲存完成分數
      if (!isPreviewMode && !isDemoMode && !isPracticeMode) {
        try {
          await apiClient.post(
            `/api/students/assignments/${studentAssignmentId}/rearrangement-complete`,
            {
              content_item_id: contentItemId,
              timeout: true,
              expected_score: actualScore,
              error_count: errorCount,
              selections:
                selectionsRef.current.get(contentItemId) || [],
            },
          );
        } catch (error) {
          console.error("Failed to save timeout completion:", error);
          toast.warning(t("rearrangement.messages.saveFailed"));
        }
      } else if (isDemoMode) {
        try {
          await apiClient.post(
            `/api/demo/assignments/${studentAssignmentId}/preview/rearrangement-complete`,
            {
              content_item_id: contentItemId,
              timeout: true,
              expected_score: actualScore,
              error_count: errorCount,
            },
          );
        } catch (error) {
          console.error("Failed to save demo timeout completion:", error);
        }
      }
    } else {
      // 時間到但未完成 → 視為 challengeFailed，允許重試，滿分從 60 開始
      setQuestionStates((prev) => {
        const newStates = new Map(prev);
        const stateInMap = newStates.get(contentItemId);
        if (stateInMap) {
          newStates.set(contentItemId, {
            ...stateInMap,
            completed: false,
            challengeFailed: true,
            timeRemaining: 0,
            expectedScore: actualScore,
            hasSeenAnswer: true,
            maxScore: 60,
          });
        }
        return newStates;
      });

      // 不加入 totalScore、不增加 completedQuestions（學生需要重試）
      setResultModalOpen(true); // 觸發錯誤 Overlay → 自動重試
    }
  };

  const handleWordSelect = async (word: string) => {
    const currentQuestion = questions[currentQuestionIndex];
    const currentState = questionStates.get(currentQuestion.content_item_id);

    if (
      !currentState ||
      currentState.completed ||
      currentState.challengeFailed
    ) {
      return;
    }

    // 🚀 前端驗證：使用 original_text 做本地驗證，不需要呼叫 API
    const correctWords =
      currentQuestion.original_text?.trim().split(/\s+/) || [];
    const currentPosition = currentState.selectedWords.length;
    const correctWord = correctWords[currentPosition] || "";
    const isCorrect = word.trim() === correctWord.trim();

    // 記錄選字歷程
    const itemId = currentQuestion.content_item_id;
    const prevSelections = selectionsRef.current.get(itemId) || [];
    prevSelections.push({
      position: currentPosition,
      selected: word.trim(),
      correct: correctWord.trim(),
      is_correct: isCorrect,
      timestamp: new Date().toISOString(),
    });
    selectionsRef.current.set(itemId, prevSelections);

    // 計算新的錯誤次數
    const newErrorCount = isCorrect
      ? currentState.errorCount
      : currentState.errorCount + 1;

    // 計算分數（完整版 v2 計分邏輯）
    const wordCount = currentQuestion.word_count || correctWords.length;
    const maxErrors = currentQuestion.max_errors || (wordCount <= 10 ? 3 : 5);
    const pointsPerWord = Math.floor(100 / wordCount);
    const minimumScore = pointsPerWord; // 保底分始終為 floor(100/N)

    // 計算基礎分數（100 為基準，不受 maxScore 影響）
    const baseScore = Math.max(0, 100 - newErrorCount * pointsPerWord);

    // 取得當前 maxScore（看過答案後為 60，否則為 100）
    const currentMaxScore = currentState.maxScore;

    // 套用 maxScore 上限，再套用保底分
    const cappedScore = Math.min(currentMaxScore, baseScore);

    // 計算正確單字數和完成狀態
    const newCorrectWordCount = isCorrect
      ? currentPosition + 1
      : currentPosition;
    const isCompleted = newCorrectWordCount >= wordCount;
    const isChallengeFailed = newErrorCount >= maxErrors;

    // ✅ 完成時：套用保底分
    // 保底分 = floor(100 / 該題單字數) = pointsPerWord
    const finalScore = isCompleted
      ? Math.max(cappedScore, minimumScore)
      : cappedScore;

    // 更新狀態
    let newSelectedWords = [...currentState.selectedWords];
    let newRemainingWords = [...currentState.remainingWords];

    if (isCorrect) {
      // 正確：加入已選擇列表，從剩餘移除
      newSelectedWords.push(word);
      const firstIndex = currentState.remainingWords.indexOf(word);
      if (firstIndex !== -1) {
        newRemainingWords = [...currentState.remainingWords];
        newRemainingWords.splice(firstIndex, 1);
      }
    }

    // 當錯誤過多且 showAnswer=true 時，設定 hasSeenAnswer 和 maxScore
    const newHasSeenAnswer =
      isChallengeFailed && showAnswer ? true : currentState.hasSeenAnswer;
    const newMaxScore =
      isChallengeFailed && showAnswer ? 60 : currentState.maxScore;

    setQuestionStates((prev) => {
      const newStates = new Map(prev);
      newStates.set(currentQuestion.content_item_id, {
        ...currentState,
        selectedWords: newSelectedWords,
        remainingWords: newRemainingWords,
        errorCount: newErrorCount,
        expectedScore: finalScore, // 使用 finalScore（含保底分）
        completed: isCompleted,
        challengeFailed: isChallengeFailed,
        hasSeenAnswer: newHasSeenAnswer,
        maxScore: newMaxScore,
      });
      return newStates;
    });

    // 顯示回饋
    if (!isCorrect) {
      toast.error(t("rearrangement.messages.incorrectSimple"));
    }

    // 檢查是否完成或失敗 → 打開結果 Modal
    if (isCompleted) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      setTotalScore((prev) => {
        totalScoreRef.current = prev + finalScore;
        return prev + finalScore;
      });
      setCompletedQuestions((prev) => prev + 1);
      setResultModalOpen(true); // 打開結果 Modal

      // 學生模式：完成時呼叫 API 儲存分數（練習模式不存）
      if (!isPreviewMode && !isDemoMode && !isPracticeMode) {
        try {
          await apiClient.post(
            `/api/students/assignments/${studentAssignmentId}/rearrangement-complete`,
            {
              content_item_id: currentQuestion.content_item_id,
              expected_score: finalScore,
              error_count: newErrorCount,
              selections:
                selectionsRef.current.get(currentQuestion.content_item_id) ||
                [],
            },
          );
        } catch (error) {
          console.error("Failed to save completion:", error);
          toast.warning(t("rearrangement.messages.saveFailed"));
        }
      } else if (isDemoMode) {
        // Demo 模式：呼叫 demo API
        try {
          await apiClient.post(
            `/api/demo/assignments/${studentAssignmentId}/preview/rearrangement-complete`,
            {
              content_item_id: currentQuestion.content_item_id,
              expected_score: finalScore,
              error_count: newErrorCount,
            },
          );
        } catch (error) {
          console.error("Failed to save demo completion:", error);
          toast.warning(t("rearrangement.messages.saveFailed"));
        }
      }
    } else if (isChallengeFailed) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      setResultModalOpen(true); // 打開結果 Modal
    }
  };

  const handleRetry = async () => {
    const currentQuestion = questions[currentQuestionIndex];
    setResultModalOpen(false); // 關閉結果 Modal

    // 🚀 重置狀態（本地操作，不需要 API）
    // 保留 hasSeenAnswer 和 maxScore（一旦看過答案就永不重置）
    setQuestionStates((prev) => {
      const newStates = new Map(prev);
      const prevState = prev.get(currentQuestion.content_item_id);
      newStates.set(currentQuestion.content_item_id, {
        selectedWords: [],
        remainingWords: [...currentQuestion.shuffled_words],
        errorCount: 0,
        expectedScore: prevState?.maxScore || 100, // 使用 maxScore 而非固定 100
        completed: false,
        challengeFailed: false,
        timeRemaining: currentQuestion.time_limit,
        hasSeenAnswer: prevState?.hasSeenAnswer || false, // 保留
        maxScore: prevState?.maxScore || 100, // 保留
      });
      return newStates;
    });

    // 重置該題的選字歷程（新一輪重試）
    selectionsRef.current.set(currentQuestion.content_item_id, []);

    // 重新開始計時
    startTimer(currentQuestion.content_item_id);
    toast.info(t("rearrangement.messages.retryStarted"));

    // 學生模式：通知後端重試（用於記錄 retry_count）
    if (!isPreviewMode && !isDemoMode && !isPracticeMode) {
      try {
        await apiClient.post(
          `/api/students/assignments/${studentAssignmentId}/rearrangement-retry`,
          {
            content_item_id: currentQuestion.content_item_id,
          },
        );
      } catch (error) {
        console.error("Failed to record retry:", error);
        // 不影響 UI，靜默失敗
      }
    } else if (isDemoMode) {
      // Demo 模式：呼叫 demo API
      try {
        await apiClient.post(
          `/api/demo/assignments/${studentAssignmentId}/preview/rearrangement-retry`,
          {
            content_item_id: currentQuestion.content_item_id,
          },
        );
      } catch (error) {
        console.error("Failed to record demo retry:", error);
        // 不影響 UI，靜默失敗
      }
    }
  };

  // 練習模式：重置已完成題目，讓學生可以重新練習（不呼叫 API）
  const handlePracticeReset = () => {
    const currentQuestion = questions[currentQuestionIndex];

    // 清除可能正在運行的計時器，避免舊計時器繼續運行
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    setQuestionStates((prev) => {
      const newStates = new Map(prev);
      newStates.set(currentQuestion.content_item_id, {
        selectedWords: [],
        remainingWords: [...currentQuestion.shuffled_words],
        errorCount: 0,
        expectedScore: 100,
        completed: false,
        challengeFailed: false,
        timeRemaining: currentQuestion.time_limit,
        hasSeenAnswer: false,
        maxScore: 100,
      });
      return newStates;
    });

    if (currentQuestion.time_limit > 0) {
      startTimer(currentQuestion.content_item_id);
    }
  };

  // 處理受控索引變更（當父組件改變 currentQuestionIndex 時）
  const prevControlledIndexRef = useRef<number | undefined>(controlledIndex);
  useEffect(() => {
    // 只有在 controlledIndex 真正改變時才處理
    if (
      controlledIndex !== undefined &&
      controlledIndex !== prevControlledIndexRef.current &&
      questions.length > 0
    ) {
      const targetIndex = controlledIndex;
      if (targetIndex < 0 || targetIndex >= questions.length) return;

      // 判斷是否是初始載入（從 undefined 變成 0）
      const isInitialLoad =
        prevControlledIndexRef.current === undefined && targetIndex === 0;

      // 停止當前計時器
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      const targetQuestion = questions[targetIndex];
      const targetState = questionStates.get(targetQuestion.content_item_id);

      // 如果目標題目尚未完成，啟動計時器
      if (
        targetState &&
        !targetState.completed &&
        !targetState.challengeFailed
      ) {
        startTimer(targetQuestion.content_item_id);
      }

      // 播放音檔（如果需要）
      // 跳過初始載入時的第一題（由 useEffect 處理）
      // 跳過已完成的題目（不自動播放）
      if (
        targetQuestion.play_audio &&
        targetQuestion.audio_url &&
        !isInitialLoad &&
        targetState &&
        !targetState.completed &&
        !targetState.challengeFailed
      ) {
        playAudio(targetQuestion.audio_url);
      }

      prevControlledIndexRef.current = controlledIndex;
    }
  }, [controlledIndex, questions, questionStates]);

  // ScoreOverlay onComplete callbacks
  const handleOverlayComplete = () => handleNextQuestion();
  const handleErrorOverlayComplete = () => handleRetry();

  // 防止 onComplete + onClick 重複觸發
  const nextQuestionCalledRef = useRef(false);

  const handleNextQuestion = () => {
    if (nextQuestionCalledRef.current) return;
    nextQuestionCalledRef.current = true;
    // 下次 resultModalOpen 時重置
    setTimeout(() => {
      nextQuestionCalledRef.current = false;
    }, 300);

    setResultModalOpen(false); // 關閉結果 overlay

    // 練習模式：直接跳到下一題（不管完成狀態）
    if (isPracticeMode) {
      const nextIndex = (currentQuestionIndex + 1) % questions.length;
      setCurrentQuestionIndex(nextIndex);
      return;
    }

    // 一般模式：找到下一個尚未完成的題目
    let nextIndex = -1;

    // 先從當前題目之後找
    for (let i = currentQuestionIndex + 1; i < questions.length; i++) {
      const state = questionStates.get(questions[i].content_item_id);
      if (state && !state.completed && !state.challengeFailed) {
        nextIndex = i;
        break;
      }
    }

    // 如果後面沒有，從頭開始找（到當前題目為止）
    if (nextIndex === -1) {
      for (let i = 0; i < currentQuestionIndex; i++) {
        const state = questionStates.get(questions[i].content_item_id);
        if (state && !state.completed && !state.challengeFailed) {
          nextIndex = i;
          break;
        }
      }
    }

    if (nextIndex !== -1) {
      // 找到下一個未完成的題目
      setCurrentQuestionIndex(nextIndex);
      startTimer(questions[nextIndex].content_item_id);

      // 播放音檔（如果需要）
      if (questions[nextIndex].play_audio && questions[nextIndex].audio_url) {
        playAudio(questions[nextIndex].audio_url!);
      }
    } else {
      // 所有題目都已完成
      if (!isPracticeMode && onComplete) {
        onComplete(totalScoreRef.current, questions.length);
      }
      if (!isPracticeMode) {
        // 計算平均分數（總分 / 題數，四捨五入到小數點一位）
        const averageScore =
          Math.round((totalScoreRef.current / questions.length) * 10) / 10;
        toast.success(
          t("rearrangement.messages.allComplete", {
            score: averageScore,
          }),
        );
      }
    }
  };

  // 確保 challengeFailed 時 modal 一定顯示（防止快速重試+亂點的 state batching race condition）
  useEffect(() => {
    if (questions.length === 0) return;
    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion) return;
    const currentState = questionStates.get(currentQuestion.content_item_id);
    if (
      currentState?.challengeFailed &&
      !currentState.completed &&
      !resultModalOpen
    ) {
      setResultModalOpen(true);
    }
  }, [questionStates, currentQuestionIndex, questions, resultModalOpen]);

  // 異步播放音檔（返回 Promise，可以捕捉錯誤）
  const playAudioAsync = useCallback(
    async (url: string): Promise<void> => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      audioRef.current = new Audio(url);
      audioRef.current.playbackRate = playbackRate;
      await audioRef.current.play();
    },
    [playbackRate],
  );

  // 同步播放音檔（忽略錯誤）
  const playAudio = useCallback(
    (url: string) => {
      playAudioAsync(url).catch((e) => {
        console.error("Failed to play audio:", e);
      });
    },
    [playAudioAsync],
  );

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Loading 狀態
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600 mb-4" />
        <p className="text-gray-600">{t("rearrangement.loading")}</p>
      </div>
    );
  }

  // 沒有題目
  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <p className="text-gray-600 mb-4">{t("rearrangement.noQuestions")}</p>
      </div>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];
  const currentState = questionStates.get(currentQuestion.content_item_id);

  if (!currentState) {
    return null;
  }

  const isUnlimited = currentQuestion.time_limit === 0;
  const isLowTime = !isUnlimited && currentState.timeRemaining <= 10;
  const progressPercent =
    ((currentQuestionIndex + (currentState.completed ? 1 : 0)) /
      questions.length) *
    100;

  return (
    <div className="rearrangement-activity space-y-4">
      {/* 進度與統計 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <Badge variant="outline">
            {t("rearrangement.progress", {
              current: currentQuestionIndex + 1,
              total: questions.length,
            })}
          </Badge>
          <Badge
            variant="secondary"
            className={cn(
              scoreCategory === "listening" && "bg-purple-100 text-purple-800",
              scoreCategory === "writing" && "bg-green-100 text-green-800",
              scoreCategory === "speaking" && "bg-blue-100 text-blue-800",
            )}
          >
            {scoreCategory === "listening" &&
              t("rearrangement.scoreCategories.listening")}
            {scoreCategory === "writing" &&
              t("rearrangement.scoreCategories.writing")}
            {scoreCategory === "speaking" &&
              t("rearrangement.scoreCategories.speaking")}
          </Badge>
        </div>
        <div className="text-sm text-gray-600">
          {t("rearrangement.totalScore")}:{" "}
          <span className="font-bold text-blue-600">
            {Math.round(totalScore)}
          </span>
        </div>
      </div>

      <Progress value={progressPercent} className="h-2" />

      {/* 音檔自動播放被阻擋時顯示的提示 */}
      {showAudioPrompt &&
        currentQuestion.play_audio &&
        currentQuestion.audio_url && (
          <div className="mt-4 p-4 bg-purple-50 border-2 border-purple-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Volume2 className="h-5 w-5 text-purple-600" />
                <span className="text-purple-800 font-medium">
                  {t("rearrangement.audioPrompt")}
                </span>
              </div>
              <Button
                variant="default"
                size="sm"
                className="bg-purple-600 hover:bg-purple-700"
                onClick={() => {
                  playAudio(currentQuestion.audio_url!);
                  setShowAudioPrompt(false);
                }}
              >
                <Volume2 className="h-4 w-4 mr-1" />
                {t("rearrangement.playAudio")}
              </Button>
            </div>
          </div>
        )}

      {/* 題目卡片 */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">
              {t("rearrangement.questionTitle", {
                number: currentQuestionIndex + 1,
              })}
            </CardTitle>
            <div className="flex items-center gap-3">
              {/* 計時器 - 不限時模式顯示 "不限時"，有限時模式顯示倒數 */}
              <div
                className={cn(
                  "flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium",
                  isUnlimited
                    ? "bg-green-100 text-green-700"
                    : isLowTime
                      ? "bg-red-100 text-red-700 animate-pulse"
                      : "bg-gray-100 text-gray-700",
                )}
              >
                <Clock className="h-4 w-4" />
                {isUnlimited
                  ? t("rearrangement.unlimited")
                  : formatTime(currentState.timeRemaining)}
              </div>

              {/* 音檔按鈕與語速選單 - 已完成的題目不能播放 */}
              {currentQuestion.play_audio && currentQuestion.audio_url && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => playAudio(currentQuestion.audio_url!)}
                    disabled={
                      currentState.completed || currentState.challengeFailed
                    }
                    title={
                      currentState.completed || currentState.challengeFailed
                        ? t("rearrangement.audioDisabledCompleted")
                        : undefined
                    }
                  >
                    <Volume2 className="h-4 w-4 mr-1" />
                    {t("rearrangement.playAudio")}
                  </Button>
                  {/* 語速選單 */}
                  <select
                    value={playbackRate}
                    onChange={(e) =>
                      setPlaybackRate(parseFloat(e.target.value))
                    }
                    className="text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-800 dark:text-gray-200"
                    title={t("rearrangement.playbackRate")}
                    disabled={
                      currentState.completed || currentState.challengeFailed
                    }
                  >
                    <option value={0.5}>0.5x</option>
                    <option value={0.75}>0.75x</option>
                    <option value={1}>1x</option>
                    <option value={1.25}>1.25x</option>
                    <option value={1.5}>1.5x</option>
                    <option value={2}>2.0x</option>
                  </select>
                </div>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* 翻譯提示（如果有且不是聽力模式） */}
          {currentQuestion.translation && !currentQuestion.play_audio && (
            <div className="p-3 bg-blue-50 rounded-lg text-blue-800 text-sm">
              <span className="font-medium">{t("rearrangement.hint")}:</span>{" "}
              {currentQuestion.translation}
            </div>
          )}

          {/* 錯誤計數 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {Array.from({ length: currentQuestion.max_errors }).map(
                (_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "w-3 h-3 rounded-full",
                      i < currentState.errorCount
                        ? "bg-red-500"
                        : "bg-gray-200",
                    )}
                  />
                ),
              )}
              <span className="text-sm text-gray-500 ml-2">
                {t("rearrangement.errorsRemaining", {
                  remaining:
                    currentQuestion.max_errors - currentState.errorCount,
                })}
              </span>
            </div>
            <div className="text-sm">
              {t("rearrangement.expectedScore")}:{" "}
              <span className="font-bold">
                {Math.round(currentState.expectedScore)}
              </span>
            </div>
          </div>

          {/* 已選擇的單字（句子構建區） */}
          <div className="min-h-[48px] sm:min-h-[60px] p-2 sm:p-4 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            {currentState.selectedWords.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {currentState.selectedWords.map((word, index) => (
                  <span
                    key={index}
                    className="px-3 py-1.5 bg-green-100 text-green-800 rounded-md font-medium"
                  >
                    {word}
                  </span>
                ))}
                {!currentState.completed && !currentState.challengeFailed && (
                  <span className="px-3 py-1.5 bg-blue-100 text-blue-800 rounded-md animate-pulse">
                    ?
                  </span>
                )}
              </div>
            ) : (
              <p className="text-gray-400 text-center">
                {t("rearrangement.selectWordsHint")}
              </p>
            )}
          </div>

          {/* 可選單字區 */}
          {!currentState.completed && !currentState.challengeFailed && (
            <div className="flex flex-wrap gap-2 justify-center">
              {currentState.remainingWords.map((word, index) => (
                <Button
                  key={`${word}-${index}`}
                  variant="outline"
                  size="lg"
                  onClick={() => handleWordSelect(word)}
                  className="text-lg sm:text-lg text-base font-medium hover:bg-blue-50 hover:border-blue-400 px-3 py-1.5 sm:px-4 sm:py-2"
                >
                  {word}
                </Button>
              ))}
            </div>
          )}

          {/* 練習模式：已完成題目顯示重新練習按鈕 */}
          {isPracticeMode && currentState.completed && (
            <div className="flex justify-center py-4">
              <Button variant="outline" size="lg" onClick={handlePracticeReset}>
                <RotateCcw className="h-4 w-4 mr-2" />
                {t("rearrangement.buttons.practiceAgain")}
              </Button>
            </div>
          )}

          {/* 答對結果：ScoreOverlay */}
          <ScoreOverlay
            open={resultModalOpen && currentState.completed}
            score={currentState.expectedScore}
            isError={false}
            onComplete={handleOverlayComplete}
          />

          {/* 錯誤結果：ScoreOverlay */}
          <ScoreOverlay
            open={
              resultModalOpen &&
              !currentState.completed &&
              currentState.challengeFailed
            }
            score={currentState.expectedScore}
            isError={true}
            showAnswer={showAnswer}
            answerText={currentQuestion.original_text}
            onComplete={handleErrorOverlayComplete}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default RearrangementActivity;
