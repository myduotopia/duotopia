/**
 * WordSpellingSample - 單字拼寫 Sample 頁面（純前端設計稿，不接 API）
 *
 * 用途：提供給工程師看的 UI 設計稿，所有互動邏輯用 mock 資料模擬。
 *       工程師可直接對照此頁面的行為來實作正式元件。
 *
 * === 資料來源 ===
 * 單字集（Vocabulary Set）— 老師建立的單字資料（text, partOfSpeech, translation, image_url, audio_url）
 *
 * === 老師可配置的設定（出作業時選擇） ===
 * - 作業模式：練習 / 考試
 * - 提示方式：詞性+翻譯 / 音檔播放
 * - 顯示圖片：是/否
 * - 顯示字母數：是（固定格子）/ 否（單一輸入區，不透露字母數量）
 * - 打亂題目：是/否（每次作答順序隨機）
 * - 考後顯示答案：是/否（僅考試模式）
 * - 考試時間：由老師設定（mock 10 分鐘）
 *
 * === 練習模式 ===
 * - 計分：艾賓浩斯熟悉度（與單字選擇共用邏輯）
 * - 答錯：清空答案格 → 灰字顯示正確答案（考試模式不顯示）
 * - 答對：觸發 ScoreOverlay 星星動畫 → 自動跳下一題
 * - 依序作答，不可跳題
 *
 * === 考試模式 ===
 * - 計分：每題 = 100/題數（小數第一位四捨五入），滿分不超過 100
 * - 答錯不顯示正確答案
 * - 可自由跳題（題號導航列），已作答題號變綠色
 * - 換題時自動儲存答案（老師端可同步查看學生作答狀況）
 * - 倒計時，時間到自動提交
 * - 提前提交需二次確認（提交後不可修改）
 * - 最後一題按送出 = 提交考卷
 *
 * === 輸入方式 ===
 * - 觸控裝置（手機/平板）：虛擬 QWERTY 鍵盤，防止手機輸入法提示答案
 * - 桌機：原生鍵盤（window keydown 全域監聽）
 * - 自動偵測：navigator.maxTouchPoints > 0（sample 頁用 checkbox 模擬）
 *
 * === 答案格互動規則 ===
 * - 字母填入第一個空格
 * - 點擊格中字母可移除，後方不補位
 * - 退格刪除最後一個有字母的格子
 * - 虛擬鍵盤支援 Shift 切換大小寫（預設小寫）
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Volume2,
  CheckCircle,
  SendHorizontal,
  Delete,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ScoreOverlay from "@/components/activities/shared/ScoreOverlay";

// ============ Mock Data ============
const MOCK_WORDS = [
  { id: 1, text: "apple", partOfSpeech: "n.", translation: "蘋果" },
  { id: 2, text: "banana", partOfSpeech: "n.", translation: "香蕉" },
  { id: 3, text: "cherry", partOfSpeech: "n.", translation: "櫻桃" },
  { id: 4, text: "grape", partOfSpeech: "n.", translation: "葡萄" },
  { id: 5, text: "lemon", partOfSpeech: "n.", translation: "檸檬" },
  { id: 6, text: "mango", partOfSpeech: "n.", translation: "芒果" },
  { id: 7, text: "orange", partOfSpeech: "n.", translation: "柳橙" },
  { id: 8, text: "peach", partOfSpeech: "n.", translation: "桃子" },
  { id: 9, text: "strawberry", partOfSpeech: "n.", translation: "草莓" },
  { id: 10, text: "watermelon", partOfSpeech: "n.", translation: "西瓜" },
  { id: 11, text: "pineapple", partOfSpeech: "n.", translation: "鳳梨" },
  { id: 12, text: "kiwi", partOfSpeech: "n.", translation: "奇異果" },
  { id: 13, text: "coconut", partOfSpeech: "n.", translation: "椰子" },
  { id: 14, text: "blueberry", partOfSpeech: "n.", translation: "藍莓" },
  { id: 15, text: "papaya", partOfSpeech: "n.", translation: "木瓜" },
];

// QWERTY 鍵盤排列
const KEYBOARD_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
];

// Mock 考試時間（秒）
const EXAM_TIME_LIMIT = 600; // 10 分鐘

// ============ Types ============
type HintMode = "translation" | "audio";
type AssignmentMode = "practice" | "exam";
type ViewMode = "mobile" | "desktop";

// ============ Component ============
export default function WordSpellingSample() {
  // === Sample 頁面控制（非正式功能，僅供切換預覽） ===
  const [viewMode, setViewMode] = useState<ViewMode>("mobile");
  // 正式版用 navigator.maxTouchPoints 自動偵測，sample 頁用 checkbox 模擬
  const [isTouchDevice, setIsTouchDevice] = useState(true);

  // === 老師設定（出作業時配置，學生端為接收端） ===
  const [hintMode, setHintMode] = useState<HintMode>("translation");
  const [assignmentMode, setAssignmentMode] =
    useState<AssignmentMode>("practice");
  const [showImage, setShowImage] = useState(true);
  // 不顯示時學生無法得知單字長度，增加拼寫難度
  const [showLetterCount, setShowLetterCount] = useState(true);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  // 考試結束後是否讓學生看到逐題答案對照
  const [showExamAnswers, setShowExamAnswers] = useState(true);

  // 題目順序（打亂或原序）
  const [wordOrder, setWordOrder] = useState<number[]>(
    MOCK_WORDS.map((_, i) => i),
  );

  // Quiz state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [slots, setSlots] = useState<(string | null)[]>([]);
  const [answered, setAnswered] = useState(false);
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [isUpperCase, setIsUpperCase] = useState(false);

  // Score overlay (practice mode only)
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayScore, setOverlayScore] = useState(0);
  const [overlayIsError, setOverlayIsError] = useState(false);

  // Practice mode stats
  const [correctCount, setCorrectCount] = useState(0);

  // === 考試模式狀態 ===
  // key = position index（題號位置），value = 學生輸入的答案字串
  // 換題時自動儲存，讓老師端可即時同步查看學生作答狀況
  const [examAnswers, setExamAnswers] = useState<Record<number, string>>({});
  const [examTimeRemaining, setExamTimeRemaining] = useState(EXAM_TIME_LIMIT);
  const [examSubmitted, setExamSubmitted] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [examStarted, setExamStarted] = useState(false);

  const isExamMode = assignmentMode === "exam";
  const currentWord = MOCK_WORDS[wordOrder[currentIndex]];

  // 打亂題目順序（Fisher-Yates shuffle），讓每位學生看到不同順序防止抄襲
  const shuffleOrder = useCallback(() => {
    if (shuffleQuestions) {
      const order = MOCK_WORDS.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      setWordOrder(order);
    } else {
      setWordOrder(MOCK_WORDS.map((_, i) => i));
    }
  }, [shuffleQuestions]);

  // 初始化答案格（切題或切模式時）
  useEffect(() => {
    if (isExamMode && examAnswers[currentIndex]) {
      // 考試模式：還原已作答的答案到 slots
      const savedAnswer = examAnswers[currentIndex];
      const newSlots = new Array(currentWord.text.length).fill(null);
      for (let i = 0; i < savedAnswer.length && i < newSlots.length; i++) {
        newSlots[i] = savedAnswer[i];
      }
      setSlots(newSlots);
    } else {
      setSlots(new Array(currentWord.text.length).fill(null));
    }
    setAnswered(false);
    setShowPlaceholder(false);
  }, [currentWord.text, currentIndex, isExamMode, examAnswers]);

  // 考試模式：切題時儲存目前答案
  const saveCurrentAnswer = useCallback(() => {
    if (!isExamMode || examSubmitted) return;
    const answer = slots.filter((s) => s !== null).join("");
    if (answer.length > 0) {
      setExamAnswers((prev) => ({ ...prev, [currentIndex]: answer }));
    }
  }, [isExamMode, examSubmitted, slots, currentIndex]);

  // 考試模式：跳到指定題目
  const goToQuestion = useCallback(
    (index: number) => {
      if (examSubmitted) return;
      saveCurrentAnswer();
      setCurrentIndex(index);
    },
    [examSubmitted, saveCurrentAnswer],
  );

  // 點擊虛擬鍵盤字母 → 填入第一個空格（不是最後面，是第一個 null 位置）
  const handleKeyPress = useCallback(
    (letter: string) => {
      if (answered || (isExamMode && examSubmitted)) return;
      setSlots((prev) => {
        const next = [...prev];
        const emptyIndex = next.indexOf(null);
        if (emptyIndex !== -1) {
          next[emptyIndex] = letter;
        }
        return next;
      });
    },
    [answered, isExamMode, examSubmitted],
  );

  // 點擊答案格中的字母 → 移除（後方字母不補位，空格留在原處）
  const handleSlotClick = useCallback(
    (index: number) => {
      if (answered || (isExamMode && examSubmitted)) return;
      setSlots((prev) => {
        if (prev[index] === null) return prev;
        const next = [...prev];
        next[index] = null;
        return next;
      });
    },
    [answered, isExamMode, examSubmitted],
  );

  // 退格
  const handleBackspace = useCallback(() => {
    if (answered || (isExamMode && examSubmitted)) return;
    setSlots((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i] !== null) {
          next[i] = null;
          break;
        }
      }
      return next;
    });
  }, [answered, isExamMode, examSubmitted]);

  // 練習模式：送出答案
  const handlePracticeSubmit = useCallback(() => {
    if (answered) return;
    const answer = slots.join("");
    const isCorrect = answer === currentWord.text.toLowerCase();

    if (isCorrect) {
      setAnswered(true);
      setCorrectCount((prev) => prev + 1);
      setOverlayScore(100);
      setOverlayIsError(false);
      setShowOverlay(true);
    } else {
      setSlots(new Array(currentWord.text.length).fill(null));
      setShowPlaceholder(true);
    }
  }, [answered, slots, currentWord.text]);

  // 考試模式：送出答案（儲存並跳下一題）
  const handleExamSubmit = useCallback(() => {
    if (examSubmitted) return;
    const answer = slots.filter((s) => s !== null).join("");
    if (answer.length > 0) {
      setExamAnswers((prev) => ({ ...prev, [currentIndex]: answer }));
    }

    // 最後一題按送出 → 彈出提交確認
    if (currentIndex === MOCK_WORDS.length - 1) {
      setShowSubmitConfirm(true);
      return;
    }

    // 直接跳到下一題
    setCurrentIndex(currentIndex + 1);
  }, [examSubmitted, slots, currentIndex, examAnswers]);

  const handleSubmit = isExamMode ? handleExamSubmit : handlePracticeSubmit;

  // Score overlay complete → next question (practice mode)
  const handleOverlayComplete = useCallback(() => {
    setShowOverlay(false);
    setAnswered(false);
    setShowPlaceholder(false);

    if (currentIndex < MOCK_WORDS.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setCurrentIndex(0);
      setCorrectCount(0);
    }
  }, [currentIndex]);

  // Mock audio play
  const handlePlayAudio = useCallback(() => {
    const utterance = new SpeechSynthesisUtterance(currentWord.text);
    utterance.lang = "en-US";
    utterance.rate = 0.8;
    speechSynthesis.speak(utterance);
  }, [currentWord.text]);

  // 模式 B：切換題目時自動播放音檔
  useEffect(() => {
    if (hintMode === "audio" && !showOverlay && !examSubmitted) {
      handlePlayAudio();
    }
  }, [currentIndex, hintMode, showOverlay, handlePlayAudio, examSubmitted]);

  // Desktop: 全域鍵盤事件監聽（不用 hidden input，因為 focus 管理在不同瀏覽器行為不一致）
  useEffect(() => {
    if (isTouchDevice) return;

    const handler = (e: KeyboardEvent) => {
      if (answered || showOverlay || (isExamMode && examSubmitted)) return;

      if (e.key === "Backspace") {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        handleKeyPress(e.key);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    isTouchDevice,
    answered,
    showOverlay,
    isExamMode,
    examSubmitted,
    handleBackspace,
    handleKeyPress,
    handleSubmit,
  ]);

  // 考試倒計時
  useEffect(() => {
    if (!isExamMode || !examStarted || examSubmitted) return;

    const timer = setInterval(() => {
      setExamTimeRemaining((prev) => {
        if (prev <= 1) {
          // 時間到，自動提交
          clearInterval(timer);
          handleExamFinish();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isExamMode, examStarted, examSubmitted]);

  // 考試完成（提交或時間到）
  const handleExamFinish = useCallback(() => {
    // 先儲存當前題目的答案
    const answer = slots.filter((s) => s !== null).join("");
    const finalAnswers = { ...examAnswers };
    if (answer.length > 0) {
      finalAnswers[currentIndex] = answer;
    }
    setExamAnswers(finalAnswers);
    setExamSubmitted(true);
    setShowSubmitConfirm(false);
  }, [slots, examAnswers, currentIndex]);

  // 考試計分：每題 = 100/題數（四捨五入到小數第一位），滿分不超過 100
  // examAnswers 的 key 是題號位置，需透過 wordOrder 對應到實際單字
  const examScore = useMemo(() => {
    if (!examSubmitted) return null;
    const pointsPerQuestion =
      Math.round((100 / MOCK_WORDS.length) * 10) / 10;
    let correct = 0;
    wordOrder.forEach((wordIdx, posIdx) => {
      const word = MOCK_WORDS[wordIdx];
      if (examAnswers[posIdx]?.toLowerCase() === word.text.toLowerCase()) {
        correct++;
      }
    });
    const rawScore = correct * pointsPerQuestion;
    return Math.min(100, Math.round(rawScore * 10) / 10);
  }, [examSubmitted, examAnswers, wordOrder]);

  // 考試已作答題數
  const examAnsweredCount = Object.keys(examAnswers).length;

  // 重置考試
  const resetExam = useCallback(() => {
    setExamAnswers({});
    setExamTimeRemaining(EXAM_TIME_LIMIT);
    setExamSubmitted(false);
    setExamStarted(false);
    setCurrentIndex(0);
    setSlots(new Array(MOCK_WORDS[0].text.length).fill(null));
  }, []);

  // 切換模式或打亂設定時重置
  useEffect(() => {
    setCurrentIndex(0);
    setCorrectCount(0);
    setAnswered(false);
    setShowPlaceholder(false);
    resetExam();
    shuffleOrder();
  }, [assignmentMode, shuffleQuestions]);

  // 格式化時間
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // 是否全部填滿
  const allFilled = slots.every((s) => s !== null);

  // Progress
  const progress = isExamMode
    ? (examAnsweredCount / MOCK_WORDS.length) * 100
    : (currentIndex / MOCK_WORDS.length) * 100;

  // 考試結果頁
  if (isExamMode && examSubmitted) {
    const pointsPerQuestion =
      Math.round((100 / MOCK_WORDS.length) * 10) / 10;
    return (
      <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
        <div className="max-w-2xl mx-auto">
          <Card className="p-8">
            <CardContent className="space-y-6">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-800 mb-2">
                  考試結果
                </h2>
                <p className="text-5xl font-bold text-blue-600 mb-4">
                  {examScore} 分
                </p>
                <p className="text-sm text-gray-500">
                  每題 {pointsPerQuestion} 分，共 {MOCK_WORDS.length} 題
                </p>
              </div>

              {/* 逐題結果（老師選擇是否顯示答案） */}
              {showExamAnswers && (
                <div className="space-y-2">
                  {wordOrder.map((wordIdx, posIdx) => {
                    const word = MOCK_WORDS[wordIdx];
                    const studentAnswer = examAnswers[posIdx] || "";
                    const isCorrect =
                      studentAnswer.toLowerCase() === word.text.toLowerCase();
                    return (
                      <div
                        key={posIdx}
                        className={cn(
                          "flex items-center justify-between px-4 py-2 rounded-lg text-sm",
                          isCorrect ? "bg-green-50" : "bg-red-50",
                        )}
                      >
                        <span className="font-medium">
                          {posIdx + 1}. {word.translation}
                        </span>
                        <div className="flex items-center gap-3">
                          {!isCorrect && (
                            <span className="text-red-500 line-through">
                              {studentAnswer || "(未作答)"}
                            </span>
                          )}
                          <span
                            className={cn(
                              "font-medium",
                              isCorrect ? "text-green-600" : "text-gray-600",
                            )}
                          >
                            {word.text}
                          </span>
                          {isCorrect ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!showExamAnswers && (
                <p className="text-center text-sm text-gray-500">
                  老師未開放檢視答案
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // 考試模式：開始前畫面
  if (isExamMode && !examStarted) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
        {renderHeader()}
        <div className="max-w-md mx-auto">
          <Card className="p-8">
            <CardContent className="text-center space-y-6">
              <h2 className="text-xl font-bold text-gray-800">單字拼寫考試</h2>
              <div className="space-y-2 text-sm text-gray-600">
                <p>共 {MOCK_WORDS.length} 題</p>
                <p>考試時間：{formatTime(EXAM_TIME_LIMIT)}</p>
                <p>
                  每題 {Math.round((100 / MOCK_WORDS.length) * 10) / 10} 分
                </p>
              </div>
              <Button
                size="lg"
                onClick={() => setExamStarted(true)}
              >
                開始考試
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // 設定面板（共用）
  function renderHeader() {
    return (
      <div className="max-w-4xl mx-auto mb-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">
          單字拼寫 — Sample
        </h1>
        <div className="flex flex-wrap gap-2 text-sm text-gray-500 mb-4">
          <Badge variant="outline">資料來源：單字集（Vocabulary Set）</Badge>
          <Badge variant="outline">作答模式：拼寫（Spelling）</Badge>
        </div>

        {/* View Mode Tabs */}
        <div className="flex gap-2 mb-4">
          <Button
            variant={viewMode === "mobile" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("mobile")}
          >
            手機版
          </Button>
          <Button
            variant={viewMode === "desktop" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("desktop")}
          >
            電腦版
          </Button>
        </div>

        {/* Teacher Settings */}
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">作業模式</label>
            <select
              value={assignmentMode}
              onChange={(e) =>
                setAssignmentMode(e.target.value as AssignmentMode)
              }
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white"
            >
              <option value="practice">練習</option>
              <option value="exam">考試</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">提示方式</label>
            <select
              value={hintMode}
              onChange={(e) => setHintMode(e.target.value as HintMode)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white"
            >
              <option value="translation">詞性 + 翻譯</option>
              <option value="audio">音檔播放</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showImage}
              onChange={(e) => {
                setShowImage(e.target.checked);
                e.target.blur();
              }}
              className="w-4 h-4 rounded border-gray-300"
            />
            顯示圖片
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showLetterCount}
              onChange={(e) => {
                setShowLetterCount(e.target.checked);
                e.target.blur();
              }}
              className="w-4 h-4 rounded border-gray-300"
            />
            顯示字母數
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={isTouchDevice}
              onChange={(e) => {
                setIsTouchDevice(e.target.checked);
                e.target.blur();
              }}
              className="w-4 h-4 rounded border-gray-300"
            />
            觸控裝置
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={shuffleQuestions}
              onChange={(e) => {
                setShuffleQuestions(e.target.checked);
                e.target.blur();
              }}
              className="w-4 h-4 rounded border-gray-300"
            />
            打亂題目
          </label>

          {assignmentMode === "exam" && (
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showExamAnswers}
                onChange={(e) => {
                  setShowExamAnswers(e.target.checked);
                  e.target.blur();
                }}
                className="w-4 h-4 rounded border-gray-300"
              />
              考後顯示答案
            </label>
          )}
        </div>
        <p className="text-xs text-gray-400">
          ※
          作業模式、提示方式、圖片、字母數由老師出作業時選擇；觸控裝置自動偵測
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      {renderHeader()}

      {/* Preview Container */}
      <div
        className={cn(
          "mx-auto",
          viewMode === "mobile" ? "max-w-sm" : "max-w-2xl",
        )}
      >
        {/* Header: Progress / Timer */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {isExamMode ? "單字拼寫考試" : "單字拼寫"}
            </Badge>
            <span className="text-sm text-gray-600">
              第 {currentIndex + 1}/{MOCK_WORDS.length} 題
            </span>
          </div>
          {isExamMode ? (
            <div
              className={cn(
                "flex items-center gap-1.5 text-sm font-medium",
                examTimeRemaining <= 60
                  ? "text-red-600"
                  : examTimeRemaining <= 180
                    ? "text-yellow-600"
                    : "text-gray-600",
              )}
            >
              <Clock className="h-4 w-4" />
              {formatTime(examTimeRemaining)}
            </div>
          ) : (
            <span className="text-sm text-gray-500">
              正確 {correctCount} / {MOCK_WORDS.length}
            </span>
          )}
        </div>
        <Progress value={progress} className="h-2 mb-4" />

        {/* Exam: Question Navigator（不換行，橫向卷軸） */}
        {isExamMode && (
          <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
            {MOCK_WORDS.map((_, idx) => {
              const hasAnswer = examAnswers[idx] !== undefined;
              const isCurrent = idx === currentIndex;
              return (
                <button
                  key={idx}
                  onClick={() => goToQuestion(idx)}
                  className={cn(
                    "w-8 h-8 shrink-0 rounded-lg text-xs font-medium transition-colors",
                    isCurrent
                      ? "bg-blue-500 text-white"
                      : hasAnswer
                        ? "bg-green-100 text-green-700 border border-green-300"
                        : "bg-white text-gray-500 border border-gray-300 hover:bg-gray-50",
                  )}
                >
                  {idx + 1}
                </button>
              );
            })}
            {/* 提交按鈕（題號列最後） */}
            {!examSubmitted && (
              <button
                onClick={() => {
                  saveCurrentAnswer();
                  setShowSubmitConfirm(true);
                }}
                className="shrink-0 px-3 h-8 rounded-lg text-xs font-medium bg-red-50 text-red-600 border border-red-300 hover:bg-red-100 transition-colors"
              >
                提交
              </button>
            )}
          </div>
        )}

        {/* Word Card */}
        <Card
          className={cn(
            "overflow-hidden",
            viewMode === "desktop" && "flex flex-row",
          )}
        >
          {/* Image Area */}
          {showImage && (
            <div
              className={cn(
                "flex items-center justify-center",
                viewMode === "mobile" ? "h-48 w-full" : "w-64 min-h-[200px]",
              )}
            >
              <span className="text-lg text-gray-400">
                {currentWord.text} 圖片
              </span>
            </div>
          )}

          {/* Content Area */}
          <CardContent
            className={cn("flex-1 p-6", viewMode === "desktop" && "p-8")}
          >
            {/* Hint Area */}
            <div className="mb-6">
              {hintMode === "translation" ? (
                <div className="text-center">
                  <span className="text-sm text-gray-400 mr-1">
                    {currentWord.partOfSpeech}
                  </span>
                  <span className="text-xl font-medium text-gray-700">
                    {currentWord.translation}
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-center">
                  <button
                    onClick={handlePlayAudio}
                    className="flex items-center justify-center w-12 h-12 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors"
                    aria-label="重播音檔"
                  >
                    <Volume2 className="h-6 w-6" />
                  </button>
                </div>
              )}
            </div>

            {/* Answer Area */}
            {showLetterCount ? (
              <div className="flex justify-center gap-1.5 mb-6">
                {slots.map((letter, index) => (
                  <button
                    key={index}
                    onClick={() => handleSlotClick(index)}
                    className={cn(
                      "w-9 h-11 border-2 rounded-lg flex items-center justify-center text-lg font-bold transition-all",
                      letter
                        ? "border-blue-400 bg-blue-50 text-blue-700 hover:border-red-300 hover:bg-red-50"
                        : showPlaceholder && !isExamMode
                          ? "border-gray-200 bg-white"
                          : "border-gray-300 bg-white",
                    )}
                    disabled={answered || (isExamMode && examSubmitted)}
                  >
                    {letter ||
                      (!isExamMode && showPlaceholder ? (
                        <span className="text-gray-300 italic">
                          {currentWord.text[index]}
                        </span>
                      ) : null)}
                  </button>
                ))}
              </div>
            ) : (
              <div
                className={cn(
                  "flex justify-center items-center gap-0.5 mb-6 min-h-[44px] border-2 rounded-lg px-3 py-2 cursor-pointer",
                  showPlaceholder && !isExamMode
                    ? "border-gray-200 bg-white"
                    : slots.some((s) => s !== null)
                      ? "border-blue-400 bg-blue-50"
                      : "border-gray-300 bg-white",
                )}
                onClick={() => {
                  if (!answered && !(isExamMode && examSubmitted)) {
                    const filledLetters = slots.filter((s) => s !== null);
                    if (filledLetters.length > 0) {
                      handleBackspace();
                    }
                  }
                }}
              >
                {slots.some((s) => s !== null) ? (
                  slots.map((letter, index) =>
                    letter ? (
                      <span
                        key={index}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSlotClick(index);
                        }}
                        className="text-lg font-bold text-blue-700 hover:text-red-500 cursor-pointer px-0.5"
                      >
                        {letter}
                      </span>
                    ) : null,
                  )
                ) : !isExamMode && showPlaceholder ? (
                  <span className="text-gray-300 italic text-lg">
                    {currentWord.text}
                  </span>
                ) : (
                  <span className="text-gray-300 text-lg">輸入答案...</span>
                )}
              </div>
            )}

            {/* Submit / Next Button */}
            <div className="flex justify-center gap-3 mb-4">
              <button
                onClick={handleSubmit}
                disabled={
                  !allFilled ||
                  answered ||
                  (isExamMode && examSubmitted)
                }
                className={cn(
                  "flex items-center justify-center w-10 h-10 rounded-full transition-colors",
                  answered
                    ? "bg-green-500 text-white"
                    : allFilled
                      ? "bg-blue-500 hover:bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-400",
                )}
                aria-label="送出"
              >
                {answered ? (
                  <CheckCircle className="h-5 w-5" />
                ) : (
                  <SendHorizontal className="h-5 w-5" />
                )}
              </button>
            </div>

            {/* Exam: Submit Exam Button — 只在最後一題顯示 */}
            {isExamMode &&
              !examSubmitted &&
              currentIndex === MOCK_WORDS.length - 1 && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      saveCurrentAnswer();
                      setShowSubmitConfirm(true);
                    }}
                    className="text-red-600 border-red-300 hover:bg-red-50"
                  >
                    提交考卷
                  </Button>
                </div>
              )}
          </CardContent>
        </Card>

        {/* Virtual Keyboard */}
        {isTouchDevice ? (
          <div className="mt-4 select-none">
            {KEYBOARD_ROWS.map((row, rowIndex) => (
              <div key={rowIndex} className="flex justify-center gap-1 mb-1">
                {rowIndex === 2 && (
                  <button
                    onClick={() => setIsUpperCase((prev) => !prev)}
                    className={cn(
                      "flex items-center justify-center rounded-lg font-medium transition-colors",
                      viewMode === "mobile"
                        ? "w-12 h-10 text-xs"
                        : "w-16 h-12 text-sm",
                      isUpperCase
                        ? "bg-blue-500 text-white border border-blue-500"
                        : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-100",
                    )}
                    aria-label="切換大小寫"
                  >
                    Shift
                  </button>
                )}
                {row.map((letter) => {
                  const displayLetter = isUpperCase
                    ? letter.toUpperCase()
                    : letter.toLowerCase();
                  return (
                    <button
                      key={letter}
                      onClick={() => handleKeyPress(displayLetter)}
                      disabled={answered || (isExamMode && examSubmitted)}
                      className={cn(
                        "flex items-center justify-center rounded-lg font-medium transition-colors",
                        viewMode === "mobile"
                          ? "w-8 h-10 text-sm"
                          : "w-11 h-12 text-base",
                        "bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 active:bg-gray-200",
                      )}
                    >
                      {displayLetter}
                    </button>
                  );
                })}
                {rowIndex === 2 && (
                  <button
                    onClick={handleBackspace}
                    disabled={answered || (isExamMode && examSubmitted)}
                    className={cn(
                      "flex items-center justify-center rounded-lg font-medium transition-colors",
                      viewMode === "mobile"
                        ? "w-12 h-10 text-sm"
                        : "w-16 h-12 text-base",
                      "bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 active:bg-gray-200",
                    )}
                    aria-label="退格"
                  >
                    <Delete className="h-5 w-5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {/* Dev Note */}
        <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          <p className="font-medium mb-1">開發備註</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>資料來源：單字集（text, partOfSpeech, translation, image_url, audio_url）</li>
            <li>老師設定：作業模式、提示方式、圖片、字母數、打亂題目、考後顯示答案</li>
            <li>作業模式：練習（艾賓浩斯）/ 考試（100分制，每題 = 100/題數 四捨五入）</li>
            <li>輸入方式：觸控裝置→虛擬鍵盤（防輸入法提示答案）；桌機→原生鍵盤</li>
            <li>練習：答錯→灰字顯示正確答案；答對→ScoreOverlay 動畫→自動下一題</li>
            <li>考試：不顯示答案、題號導航（已作答變色）、換題自動儲存、倒計時、時間到自動提交、提前提交需二次確認、最後一題 Enter = 提交</li>
            <li>打亂題目：Fisher-Yates shuffle，防止學生抄襲</li>
            <li>考試時間由老師設置（mock: {EXAM_TIME_LIMIT / 60} 分鐘）</li>
          </ul>
        </div>
      </div>

      {/* Score Overlay (practice mode only) */}
      {!isExamMode && (
        <ScoreOverlay
          open={showOverlay}
          score={overlayScore}
          isError={overlayIsError}
          onComplete={handleOverlayComplete}
        />
      )}

      {/* Exam: Submit Confirmation Dialog */}
      <Dialog open={showSubmitConfirm} onOpenChange={setShowSubmitConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              確認提交考卷
            </DialogTitle>
            <DialogDescription className="space-y-3 pt-4">
              <p>
                你已作答 {examAnsweredCount} / {MOCK_WORDS.length} 題。
              </p>
              {examAnsweredCount < MOCK_WORDS.length && (
                <p className="text-red-500 font-medium">
                  還有 {MOCK_WORDS.length - examAnsweredCount} 題未作答！
                </p>
              )}
              <p className="font-bold">提交後無法修改，確定要提交嗎？</p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowSubmitConfirm(false)}
            >
              繼續作答
            </Button>
            <Button
              variant="destructive"
              onClick={handleExamFinish}
            >
              確認提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
