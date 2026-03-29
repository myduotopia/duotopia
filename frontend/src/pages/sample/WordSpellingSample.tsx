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
 * - 提示方式：詞性+翻譯 / 音檔播放 / 選擇
 * - 顯示詞性與翻譯（音檔模式專屬）：是/否 — 預設否，讓學生只靠聽力作答
 * - 選項數量（選擇模式專屬）：2 / 3 / 4 個 — 1 個正確答案 + N-1 個同組干擾詞
 * - 顯示圖片：是/否
 * - 顯示字母數：是（固定格子）/ 否（單一輸入區，不透露字母數量）
 * - 打亂題目：是/否（每次作答順序隨機）
 * - 考後顯示答案：是/否（僅考試模式）
 * - 考試時間：單一 type="time" input（HH:MM），最多 02:00；超過上限自動截為 02:00
 *
 * === 列印 PDF ===
 * - 標題列旁有「列印」按鈕，點擊後右側滑出 PrintPdfSheet
 * - Sheet 內可重選條件並即時預覽 A4 學習單，可下載 PDF
 * - 每頁 Footer：Duotopia logo（左）+ 頁碼（右）
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
 * - 觸控裝置（手機/平板）：自動偵測 navigator.maxTouchPoints > 0 → 顯示虛擬 QWERTY 鍵盤
 * - 老師可開啟「強制顯示虛擬鍵盤」→ 非觸控裝置也顯示（投影機演示等情境）
 * - isTouchDevice = forceVirtualKeyboard || matchMedia("(pointer: coarse)").matches
 * - 桌機且未強制：原生鍵盤（window keydown 全域監聽）
 * - 選擇模式 / 手寫模式下不顯示虛擬鍵盤，亦不監聽鍵盤事件
 *
 * === 輸入方式：手寫 ===
 * - 老師可選「輸入方式：手寫」→ 顯示 HandwritingCanvas，隱藏鍵盤
 * - 使用 Chrome Handwriting Recognition API（chrome://flags/#handwriting-recognition-web-platform-api）
 * - 手寫模式與鍵盤模式完全互斥
 * - 辨識完整單字後整詞填入答案格，可重寫或清除
 * - 不支援的瀏覽器顯示提示訊息
 *
 * === 提示方式：選擇 ===
 * - 顯示詞性 + 翻譯，學生從 2–4 個單字選項中點選正確拼寫
 * - 選項 = 1 個正確答案 + (N-1) 個同組隨機干擾詞，每題重新隨機排列
 * - 練習：點選即判斷，答對/錯均觸發 ScoreOverlay → 自動下一題
 * - 考試：點選儲存但不鎖定，可改答案；自由換題；最後提交
 *
 * === 答案格互動規則 ===
 * - 字母填入第一個空格（null 位置）
 * - 點擊格中字母可移除，後方不補位
 * - 退格刪除最後一個有字母的格子
 * - 虛擬鍵盤支援 Shift 切換大小寫（預設小寫）
 *
 * === 輸入格數量設計 ===
 * - slots 陣列長度固定為 MAX_ANSWER_LENGTH，但渲染與鍵盤輸入視 showLetterCount 而異：
 *   - showLetterCount=true：只渲染並填入當前答案字母數（currentWord.text.length）的格子
 *   - showLetterCount=false：單一文字框，不限格數，仍受 MAX_ANSWER_LENGTH 上限
 * - 送出條件：至少輸入一個字母（hasInput），不要求填滿全部格子
 * - 答案比對：slots.filter(Boolean).join("") 比對 currentWord.text
 * - 答錯 placeholder：只顯示對應 index 有字母的格子（超出答案長度的格子留空）
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
  Delete,
  Clock,
  AlertTriangle,
  Printer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ScoreOverlay from "@/components/activities/shared/ScoreOverlay";
import {
  ActivitySettingsPanel,
  type AssignmentMode,
} from "@/components/activities/shared/ActivitySettingsPanel";
import { WordActivityCard } from "@/components/activities/shared/WordActivityCard";
import { MultipleChoiceOptions } from "@/components/activities/shared/MultipleChoiceOptions";
import { HandwritingCanvas } from "@/components/activities/shared/HandwritingCanvas";
import { DrawingCanvas } from "@/components/activities/shared/DrawingCanvas";
import {
  PrintPdfSheet,
  type PrintQuestion,
} from "@/components/activities/shared/PrintPdfSheet";

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
// 考試時間上限（秒）
const MAX_EXAM_SECONDS = 2 * 3600; // 2 小時

// 本組單字中最長的 text 字母數，作為輸入格上限
// 避免因格子數不同而洩露各題答案長度
const MAX_ANSWER_LENGTH = Math.max(...MOCK_WORDS.map((w) => w.text.length));

// ============ Types ============
type HintMode = "translation" | "audio" | "choice";
// AssignmentMode imported from ActivitySettingsPanel
type ViewMode = "mobile" | "desktop";

// ============ Component ============
export default function WordSpellingSample() {
  // === Sample 頁面控制（非正式功能，僅供切換預覽） ===
  const [viewMode, setViewMode] = useState<ViewMode>("mobile");

  // === 老師設定：是否強制顯示虛擬鍵盤（供非觸控裝置也能使用，例如投影機演示）===
  // 正式版：isTouchDevice = forceVirtualKeyboard || navigator.maxTouchPoints > 0
  // 觸控裝置自動開啟虛擬鍵盤，不需老師額外勾選；此設定僅影響桌機/非觸控裝置
  const [forceVirtualKeyboard, setForceVirtualKeyboard] = useState(false);
  // (pointer: coarse) 偵測主要指標裝置是否為觸控（手指），比 maxTouchPoints 更準確
  // Windows 桌機即使支援觸控 API，maxTouchPoints 也可能 > 0，但 pointer 仍為 fine
  const isTouchDevice =
    forceVirtualKeyboard || window.matchMedia("(pointer: coarse)").matches;

  // === 老師設定（出作業時配置，學生端為接收端） ===
  const [hintMode, setHintMode] = useState<HintMode>("translation");
  const [assignmentMode, setAssignmentMode] =
    useState<AssignmentMode>("practice");
  const [showImage, setShowImage] = useState(true);
  // 音檔模式下是否同時顯示詞性與翻譯（audio 模式專屬設定）
  const [showTranslationInAudio, setShowTranslationInAudio] = useState(false);
  // 不顯示時學生無法得知單字長度，增加拼寫難度
  const [showLetterCount, setShowLetterCount] = useState(true);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  // 選擇題模式：選項數量（2-4）
  const [choiceCount, setChoiceCount] = useState(4);
  // 輸入方式：鍵盤（虛擬/原生）或手寫（Chrome Handwriting API）
  const [inputMethod, setInputMethod] = useState<
    "keyboard" | "handwriting" | "drawing"
  >("keyboard");
  // 考試結束後是否讓學生看到逐題答案對照
  const [showExamAnswers, setShowExamAnswers] = useState(true);

  // 每題限時（null = 不限時，單位：秒）
  const [questionTimeLimit, setQuestionTimeLimit] = useState<number | null>(10);
  const [questionTimeRemaining, setQuestionTimeRemaining] =
    useState<number>(10);

  // 列印 PDF sheet 開關
  const [printSheetOpen, setPrintSheetOpen] = useState(false);

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
  // 選擇題模式：目前已選選項（考試模式可改選；練習模式點選即判斷）
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

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
  // 老師設定考試時間，格式 "HH:MM"，最多 "02:00"
  const [examTimeValue, setExamTimeValue] = useState("00:10");
  // 將 "HH:MM" 轉為秒數，超過上限自動截斷，最少 60 秒
  const examTimeLimit = (() => {
    const [h, m] = examTimeValue.split(":").map(Number);
    return Math.min(Math.max((h * 60 + m) * 60, 60), MAX_EXAM_SECONDS);
  })();
  const [examTimeRemaining, setExamTimeRemaining] = useState(examTimeLimit);
  const [examSubmitted, setExamSubmitted] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [examStarted, setExamStarted] = useState(false);

  // 老師修改考試時間時，若考試尚未開始則即時更新倒計時顯示
  useEffect(() => {
    if (!examStarted) setExamTimeRemaining(examTimeLimit);
  }, [examTimeLimit, examStarted]);

  const isExamMode = assignmentMode === "exam";
  const currentWord = MOCK_WORDS[wordOrder[currentIndex]];

  // 選擇題選項：1 個正確答案 + (choiceCount-1) 個隨機干擾詞，每題重新隨機
  const choiceOptions = useMemo(() => {
    if (hintMode !== "choice") return [];
    const correct = currentWord.text;
    const others = MOCK_WORDS.filter(
      (_, i) => i !== wordOrder[currentIndex],
    ).map((w) => w.text);
    // Shuffle distractors
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    const all = [correct, ...others.slice(0, choiceCount - 1)];
    // Shuffle all options
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintMode, currentIndex, wordOrder, choiceCount]);

  // 列印 PDF 題目列表（依 wordOrder 排序）
  const printQuestions = useMemo<PrintQuestion[]>(
    () =>
      wordOrder.map((idx, i) => {
        const w = MOCK_WORDS[idx];
        return {
          index: i + 1,
          correctAnswer: w.text,
          translation: w.translation,
          partOfSpeech: w.partOfSpeech,
          answerLength: w.text.length,
        };
      }),
    [wordOrder],
  );

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
    if (hintMode === "choice") {
      setSlots(new Array(MAX_ANSWER_LENGTH).fill(null));
      // 考試模式：還原已選選項
      setSelectedOption(
        isExamMode ? (examAnswers[currentIndex] ?? null) : null,
      );
    } else if (isExamMode && examAnswers[currentIndex]) {
      // 考試模式：還原已作答的答案到 slots
      const savedAnswer = examAnswers[currentIndex];
      const newSlots = new Array(MAX_ANSWER_LENGTH).fill(null);
      for (let i = 0; i < savedAnswer.length && i < newSlots.length; i++) {
        newSlots[i] = savedAnswer[i];
      }
      setSlots(newSlots);
      setSelectedOption(null);
    } else {
      setSlots(new Array(MAX_ANSWER_LENGTH).fill(null));
      setSelectedOption(null);
    }
    setAnswered(false);
    setShowPlaceholder(false);
  }, [currentWord.text, currentIndex, isExamMode, hintMode, examAnswers]);

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
      // showLetterCount 模式下，只填入到實際答案字母數的格子
      const maxSlots = showLetterCount
        ? currentWord.text.length
        : MAX_ANSWER_LENGTH;
      setSlots((prev) => {
        const next = [...prev];
        const emptyIndex = next.findIndex((s, i) => s === null && i < maxSlots);
        if (emptyIndex !== -1) {
          next[emptyIndex] = letter;
        }
        return next;
      });
    },
    [
      answered,
      isExamMode,
      examSubmitted,
      showLetterCount,
      currentWord.text.length,
    ],
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
    const answer = slots.filter(Boolean).join("");
    const isCorrect = answer === currentWord.text.toLowerCase();

    if (isCorrect) {
      setAnswered(true);
      setCorrectCount((prev) => prev + 1);
      setOverlayScore(100);
      setOverlayIsError(false);
      setShowOverlay(true);
    } else {
      setSlots(new Array(MAX_ANSWER_LENGTH).fill(null));
      setShowPlaceholder(true);
    }
  }, [answered, slots, currentWord.text]);

  // 選擇題模式：點選選項（練習 = 即時判斷；考試 = 儲存可改選）
  const handleChoiceSelect = useCallback(
    (option: string) => {
      setSelectedOption(option);
      if (isExamMode) {
        setExamAnswers((prev) => ({ ...prev, [currentIndex]: option }));
      } else {
        // 練習：即時判斷
        const isCorrect =
          option.toLowerCase() === currentWord.text.toLowerCase();
        setAnswered(true);
        if (isCorrect) {
          setCorrectCount((prev) => prev + 1);
          setOverlayScore(100);
          setOverlayIsError(false);
        } else {
          setOverlayScore(0);
          setOverlayIsError(true);
        }
        setShowOverlay(true);
      }
    },
    [isExamMode, currentIndex, currentWord.text],
  );

  // 手寫模式：辨識結果填入 slots（整詞一次填入）
  const handleWordInput = useCallback(
    (word: string) => {
      if (answered || (isExamMode && examSubmitted)) return;
      const limit = showLetterCount
        ? currentWord.text.length
        : MAX_ANSWER_LENGTH;
      const newSlots = new Array(MAX_ANSWER_LENGTH).fill(null);
      for (let i = 0; i < word.length && i < limit; i++) {
        newSlots[i] = word[i];
      }
      setSlots(newSlots);
    },
    [
      answered,
      isExamMode,
      examSubmitted,
      showLetterCount,
      currentWord.text.length,
    ],
  );

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
    if (
      isTouchDevice ||
      hintMode === "choice" ||
      inputMethod === "handwriting" ||
      inputMethod === "drawing"
    )
      return;

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
    hintMode,
    inputMethod,
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
    const pointsPerQuestion = Math.round((100 / MOCK_WORDS.length) * 10) / 10;
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

  // 每題倒計時
  useEffect(() => {
    if (questionTimeLimit === null) return;
    if (
      answered ||
      (isExamMode && !examStarted) ||
      (isExamMode && examSubmitted)
    )
      return;
    setQuestionTimeRemaining(questionTimeLimit);
    const interval = setInterval(() => {
      setQuestionTimeRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    const timeout = setTimeout(() => {
      // 時間到：練習模式直接跳下一題；考試模式儲存並跳下一題
      setCurrentIndex((idx) => {
        if (idx < MOCK_WORDS.length - 1) return idx + 1;
        if (!isExamMode) setCorrectCount(0);
        return 0;
      });
    }, questionTimeLimit * 1000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentIndex,
    questionTimeLimit,
    answered,
    isExamMode,
    examStarted,
    examSubmitted,
  ]);

  // 重置考試
  const resetExam = useCallback(() => {
    setExamAnswers({});
    setExamTimeRemaining(examTimeLimit);
    setExamSubmitted(false);
    setExamStarted(false);
    setCurrentIndex(0);
    setSlots(new Array(MAX_ANSWER_LENGTH).fill(null));
    setSelectedOption(null);
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
  // 格式化秒數為 HH:MM:SS（倒計時）或 HH:MM（設定顯示）
  // 保持與設定 input 相同的 HH:MM 前綴，避免「1:00」同時代表1小時或1分
  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  // 是否全部填滿
  // 格子數固定為 MAX_ANSWER_LENGTH，不要求填滿，只要有輸入即可送出
  const hasInput = slots.some((s) => s !== null);

  // Progress
  const progress = isExamMode
    ? (examAnsweredCount / MOCK_WORDS.length) * 100
    : (currentIndex / MOCK_WORDS.length) * 100;

  // 考試結果頁
  if (isExamMode && examSubmitted) {
    const pointsPerQuestion = Math.round((100 / MOCK_WORDS.length) * 10) / 10;
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
                <p>考試時間：{formatTime(examTimeLimit)}</p>
                <p>每題 {Math.round((100 / MOCK_WORDS.length) * 10) / 10} 分</p>
              </div>
              <Button size="lg" onClick={() => setExamStarted(true)}>
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
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-gray-800">
            單字拼寫 — Sample
          </h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPrintSheetOpen(true)}
          >
            <Printer className="h-4 w-4 mr-1.5" />
            列印
          </Button>
        </div>
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
        <ActivitySettingsPanel
          assignmentMode={assignmentMode}
          onAssignmentModeChange={setAssignmentMode}
          hintMode={hintMode}
          hintModeOptions={[
            { value: "translation", label: "詞性 + 翻譯" },
            { value: "audio", label: "音檔播放" },
            { value: "choice", label: "選擇" },
          ]}
          onHintModeChange={(mode) => {
            setHintMode(mode as HintMode);
            // 選擇題模式不支援手寫與作畫，切換時重置輸入方式
            if (mode === "choice") setInputMethod("keyboard");
          }}
          choiceCount={choiceCount}
          onChoiceCountChange={setChoiceCount}
          choiceCountVisible={hintMode === "choice"}
          showImage={showImage}
          onShowImageChange={setShowImage}
          extraHintSettings={
            hintMode === "audio" ? (
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showTranslationInAudio}
                  onChange={(e) => {
                    setShowTranslationInAudio(e.target.checked);
                    e.target.blur();
                  }}
                  className="w-4 h-4 rounded border-gray-300"
                />
                顯示詞性與翻譯
              </label>
            ) : null
          }
          showLetterCount={showLetterCount}
          onShowLetterCountChange={setShowLetterCount}
          showLetterCountVisible={hintMode !== "choice"}
          inputMethod={inputMethod}
          onInputMethodChange={(v) => {
            setInputMethod(v);
            if (v === "drawing") setShowImage(false);
          }}
          inputMethodVisible={hintMode !== "choice"}
          forceVirtualKeyboard={forceVirtualKeyboard}
          onForceVirtualKeyboardChange={setForceVirtualKeyboard}
          shuffleQuestions={shuffleQuestions}
          onShuffleQuestionsChange={setShuffleQuestions}
          questionTimeLimit={questionTimeLimit}
          onQuestionTimeLimitChange={setQuestionTimeLimit}
          examTimeValue={examTimeValue}
          onExamTimeValueChange={setExamTimeValue}
          showExamAnswers={showExamAnswers}
          onShowExamAnswersChange={setShowExamAnswers}
        />
        <p className="text-xs text-gray-400">
          ※ 作業模式、提示方式、圖片、字母數由老師出作業時選擇；考試時間最多 2
          小時；觸控裝置自動偵測虛擬鍵盤，老師可強制開啟
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      {renderHeader()}

      {/* Preview Container */}
      <div
        className={cn("mx-auto", viewMode === "mobile" ? "max-w-sm" : "w-full")}
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
          <div className="flex items-center gap-3">
            {questionTimeLimit !== null && (
              <span
                className={cn(
                  "flex items-center gap-1 text-sm font-medium tabular-nums",
                  questionTimeRemaining <= 3
                    ? "text-red-600"
                    : questionTimeRemaining <=
                        Math.ceil(questionTimeLimit * 0.4)
                      ? "text-yellow-600"
                      : "text-gray-500",
                )}
              >
                <Clock className="h-3.5 w-3.5" />
                {questionTimeRemaining}s
              </span>
            )}
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
              questionTimeLimit === null && (
                <span className="text-sm text-gray-500">
                  正確 {correctCount} / {MOCK_WORDS.length}
                </span>
              )
            )}
          </div>
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
        <WordActivityCard
          viewMode={viewMode}
          hintArea={
            hintMode === "choice" || hintMode === "translation" ? (
              // 詞性 + 翻譯（translation 模式 & choice 模式共用）
              <div className="text-center">
                <span className="text-sm text-gray-400 mr-1">
                  {currentWord.partOfSpeech}
                </span>
                <span className="text-xl font-medium text-gray-700">
                  {currentWord.translation}
                </span>
                {inputMethod === "drawing" && (
                  <div className="mt-3 text-3xl font-bold tracking-widest text-blue-600">
                    {currentWord.text}
                  </div>
                )}
              </div>
            ) : (
              // audio 模式
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={handlePlayAudio}
                  className="flex items-center justify-center w-12 h-12 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors"
                  aria-label="重播音檔"
                >
                  <Volume2 className="h-6 w-6" />
                </button>
                {showTranslationInAudio && (
                  <div className="text-center">
                    <span className="text-sm text-gray-400 mr-1">
                      {currentWord.partOfSpeech}
                    </span>
                    <span className="text-xl font-medium text-gray-700">
                      {currentWord.translation}
                    </span>
                  </div>
                )}
                {inputMethod === "drawing" && (
                  <div className="mt-1 text-3xl font-bold tracking-widest text-blue-600">
                    {currentWord.text}
                  </div>
                )}
              </div>
            )
          }
          showImage={inputMethod === "drawing" ? false : showImage}
          slots={slots}
          answerLength={currentWord.text.length}
          showLetterCount={showLetterCount}
          answered={answered}
          isExamMode={isExamMode}
          examSubmitted={examSubmitted}
          showPlaceholder={showPlaceholder}
          placeholderChar={(i) => currentWord.text[i]}
          placeholderText={
            showPlaceholder && !isExamMode ? currentWord.text : undefined
          }
          onSlotClick={handleSlotClick}
          onBackspace={handleBackspace}
          hasInput={hasInput}
          onSubmit={handleSubmit}
          isLastQuestion={currentIndex === MOCK_WORDS.length - 1}
          onExamFinish={() => {
            saveCurrentAnswer();
            setShowSubmitConfirm(true);
          }}
          choiceArea={
            inputMethod === "drawing" ? (
              // 作畫模式：隱藏輸入格，練習模式顯示「下一題」按鈕
              !isExamMode ? (
                <div className="flex justify-center">
                  <Button
                    size="sm"
                    onClick={() => {
                      if (currentIndex < MOCK_WORDS.length - 1) {
                        setCurrentIndex((p) => p + 1);
                      } else {
                        setCurrentIndex(0);
                        setCorrectCount(0);
                      }
                    }}
                  >
                    下一題
                  </Button>
                </div>
              ) : (
                <></>
              )
            ) : hintMode === "choice" ? (
              <MultipleChoiceOptions
                options={choiceOptions}
                selectedOption={selectedOption}
                correctAnswer={currentWord.text}
                answered={answered}
                isExamMode={isExamMode}
                examSubmitted={examSubmitted}
                onSelect={handleChoiceSelect}
              />
            ) : undefined
          }
        />

        {/* Virtual Keyboard — 選擇題模式、手寫模式、作畫模式不顯示 */}
        {isTouchDevice &&
        hintMode !== "choice" &&
        inputMethod !== "handwriting" &&
        inputMethod !== "drawing" ? (
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

        {/* Handwriting Canvas — 手寫模式且非選擇題時顯示 */}
        {inputMethod === "handwriting" && hintMode !== "choice" && (
          <HandwritingCanvas
            onResult={handleWordInput}
            onClear={() => setSlots(new Array(MAX_ANSWER_LENGTH).fill(null))}
            isDisabled={answered || (isExamMode && examSubmitted)}
            viewMode={viewMode}
          />
        )}

        {/* Drawing Canvas — 作畫輸入方式時顯示 */}
        {inputMethod === "drawing" && hintMode !== "choice" && (
          <DrawingCanvas
            isDisabled={answered || (isExamMode && examSubmitted)}
            viewMode={viewMode}
          />
        )}

        {/* Dev Note */}
        <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          <p className="font-medium mb-1">開發備註</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>
              資料來源：單字集（text, partOfSpeech, translation, image_url,
              audio_url）
            </li>
            <li>
              老師設定：作業模式、提示方式、圖片、字母數、打亂題目、考後顯示答案
            </li>
            <li>
              作業模式：練習（艾賓浩斯）/ 考試（100分制，每題 = 100/題數
              四捨五入）
            </li>
            <li>
              輸入方式：觸控裝置→虛擬鍵盤（防輸入法提示答案）；桌機→原生鍵盤
            </li>
            <li>
              練習：答錯→灰字顯示正確答案；答對→ScoreOverlay 動畫→自動下一題
            </li>
            <li>
              考試：不顯示答案、題號導航（已作答變色）、換題自動儲存、倒計時、時間到自動提交、提前提交需二次確認、最後一題
              Enter = 提交
            </li>
            <li>打亂題目：Fisher-Yates shuffle，防止學生抄襲</li>
            <li>考試時間由老師設置（目前：{formatTime(examTimeLimit)}）</li>
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

      {/* 列印 PDF Sheet */}
      <PrintPdfSheet
        open={printSheetOpen}
        onOpenChange={setPrintSheetOpen}
        activityType="spelling"
        title="單字測驗"
        questions={printQuestions}
        hintMode={hintMode}
        hintModeOptions={[
          { value: "translation", label: "詞性 + 翻譯" },
          { value: "audio", label: "音檔播放" },
          { value: "choice", label: "選擇" },
        ]}
        choiceCount={choiceCount}
        answerPool={MOCK_WORDS.map((w) => w.text)}
        showImage={showImage}
        showLetterCount={showLetterCount}
        shuffleQuestions={shuffleQuestions}
      />

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
            <Button variant="destructive" onClick={handleExamFinish}>
              確認提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
