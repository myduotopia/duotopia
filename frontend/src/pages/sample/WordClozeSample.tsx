/**
 * WordClozeSample - 單字克漏字 Sample 頁面（純前端設計稿，不接 API）
 *
 * 用途：提供給工程師看的 UI 設計稿，所有互動邏輯用 mock 資料模擬。
 *       工程師可直接對照此頁面的行為來實作正式元件。
 *
 * === 資料來源 ===
 * 單字集（Vocabulary Set）— 老師建立的單字資料，使用英文例句欄位
 * 每筆資料包含：text（單字）, partOfSpeech, translation, exampleSentence, answer
 * - answer = 單字在例句中的實際字形（可能是變形，如 apples、watching）
 * - 老師建立例句時，目標單字不可縮寫（系統以 case-insensitive substring match 找出空格位置）
 *
 * === 老師可配置的設定（與單字拼寫完全相同） ===
 * - 作業模式：練習 / 考試
 * - 提示方式：字庫模式 / 音檔播放 / 選擇（詳見下方說明）
 * - 選項數量（選擇模式專屬）：2 / 3 / 4 個 — 1 個正確答案 + N-1 個同組干擾詞
 * - 顯示圖片：是/否
 * - 顯示句子翻譯（字庫/選擇模式）：是/否 — 顯示 exampleTranslation 輔助理解句意
 * - 顯示字母數：是（固定格子）/ 否（單一輸入區）— 字庫模式下隱藏（選字不需要格子提示）
 * - 打亂題目：是/否（每次作答順序隨機）
 * - 考後顯示答案：是/否（僅考試模式）
 * - 考試時間：單一 type="text" input（格式 HH:MM），onBlur 驗證；最多 02:00，最少 00:01；
 *   輸入非法格式自動還原為 00:10
 *
 * === 提示方式：字庫模式 ===
 * - 每題顯示 10 個單字 chip：1 個正確答案 + 9 個從其他題目隨機抽取的干擾詞
 * - 可選顯示句子翻譯（showSentenceTranslation），顯示於 chip 列下方
 * - 每次換題重新隨機抽取並打亂順序
 * - 字庫模式下答錯不顯示正確答案（避免字庫 + 提示雙重洩題）
 * - 字庫模式下「顯示字母數」隱藏（選字不需要格子提示）
 *
 * === 提示方式：音檔播放 ===
 * - 播放完整例句音檔（非單字發音），讓學生透過聆聽句子填入空格
 * - 支援速度切換：0.5x / 0.75x / 1.0x / 1.5x / 2.0x（dropdown 選單）
 * - 換題時自動播放
 * - 實作細節：cancel() 後需 setTimeout(50ms) 再 speak()，
 *   否則高速（2.0x）時 cancel 尚未清除就 speak 會導致語音截斷
 *
 * === 題目顯示：克漏字挖空 ===
 * - 例句中 answer 的位置替換為固定寬度實線（不透露字母數）
 * - buildClozeparts() 以 case-insensitive regex 切出 before / after 兩段
 *
 * === 練習模式 ===
 * - 計分：艾賓浩斯熟悉度（與單字選擇共用邏輯）
 * - 答錯：清空答案格；字庫模式不顯示答案，其他模式灰字顯示正確答案
 * - 答對：觸發 ScoreOverlay 星星動畫（open prop）→ 動畫結束後自動跳下一題
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
 * - 結果頁顯示逐題完整例句並標示正確答案位置
 *
 * === 提示方式：選擇 ===
 * - 顯示克漏字句子，學生從 2–4 個單字選項中點選正確填入詞
 * - 選項 = 1 個正確答案（answer）+ (N-1) 個同組隨機干擾詞，每題重新隨機排列
 * - 選擇模式下「顯示字母數」隱藏、不顯示虛擬鍵盤
 * - 練習：點選即判斷，答對/錯均觸發 ScoreOverlay → 自動下一題
 * - 考試：點選儲存但不鎖定，可改答案；自由換題；最後提交
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
 * === 答案格互動規則（同單字拼寫） ===
 * - 字母填入第一個空格（null 位置）
 * - 點擊格中字母可移除，後方不補位
 * - 退格刪除最後一個有字母的格子
 * - 虛擬鍵盤支援 Shift 切換大小寫（預設小寫）
 *
 * === 克漏字特有邏輯 ===
 * - 答案比對：case-insensitive 比對 answer（非 text）
 * - 計分歸屬：寫作 + 閱讀（單字拼寫是寫作 + 字彙量）
 *
 * === 輸入格數量設計 ===
 * - slots 陣列長度固定為 MAX_ANSWER_LENGTH，但渲染與鍵盤輸入視 showLetterCount/hintMode 而異：
 *   - showLetterCount=true 且 hintMode≠"wordbank"：只渲染並填入 currentAnswer.length 格
 *   - 其他情況：單一文字框，不限格數，受 MAX_ANSWER_LENGTH 上限
 * - 字庫模式強制 showLetterCount=false（切換時設定 + render 雙重防禦）
 * - 初始 showLetterCount=false，對齊預設 hintMode="wordbank"
 * - 送出條件：至少輸入一個字母（hasInput），不要求填滿全部格子
 * - 答案比對：slots.filter(Boolean).join("") 比對 currentAnswer
 *
 * === 列印 PDF ===
 * - 標題列旁有「列印」按鈕，點擊後右側滑出 PrintPdfSheet
 * - Sheet 內可重選條件並即時預覽 A4 學習單，可下載 PDF
 * - 每頁 Footer：Duotopia logo（左）+ 頁碼（右）
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
import {
  PrintPdfSheet,
  type PrintQuestion,
} from "@/components/activities/shared/PrintPdfSheet";

// ============ Mock Data ============
// answer = 例句中實際出現的字形（老師填入時不縮寫）
const MOCK_WORDS = [
  {
    id: 1,
    text: "apple",
    partOfSpeech: "n.",
    translation: "蘋果",
    exampleSentence: "There are a lot of green apples in the basket.",
    exampleTranslation: "籃子裡有很多青蘋果。",
    answer: "apples",
  },
  {
    id: 2,
    text: "banana",
    partOfSpeech: "n.",
    translation: "香蕉",
    exampleSentence: "She likes to eat bananas every morning.",
    exampleTranslation: "她喜歡每天早上吃香蕉。",
    answer: "bananas",
  },
  {
    id: 3,
    text: "cherry",
    partOfSpeech: "n.",
    translation: "櫻桃",
    exampleSentence: "The cherries on this cake look delicious.",
    exampleTranslation: "這個蛋糕上的櫻桃看起來很好吃。",
    answer: "cherries",
  },
  {
    id: 4,
    text: "grape",
    partOfSpeech: "n.",
    translation: "葡萄",
    exampleSentence: "He picked some grapes from the vine.",
    exampleTranslation: "他從葡萄藤上摘了一些葡萄。",
    answer: "grapes",
  },
  {
    id: 5,
    text: "lemon",
    partOfSpeech: "n.",
    translation: "檸檬",
    exampleSentence: "She squeezed a lemon into the glass of water.",
    exampleTranslation: "她把一顆檸檬擠進水杯裡。",
    answer: "lemon",
  },
  {
    id: 6,
    text: "mango",
    partOfSpeech: "n.",
    translation: "芒果",
    exampleSentence: "The mangoes at the market looked very fresh.",
    exampleTranslation: "市場裡的芒果看起來非常新鮮。",
    answer: "mangoes",
  },
  {
    id: 7,
    text: "orange",
    partOfSpeech: "n.",
    translation: "柳橙",
    exampleSentence: "I drink a glass of orange juice every day.",
    exampleTranslation: "我每天喝一杯柳橙汁。",
    answer: "orange",
  },
  {
    id: 8,
    text: "peach",
    partOfSpeech: "n.",
    translation: "桃子",
    exampleSentence: "The peaches in the garden are ripe and sweet.",
    exampleTranslation: "花園裡的桃子成熟又甜美。",
    answer: "peaches",
  },
  {
    id: 9,
    text: "strawberry",
    partOfSpeech: "n.",
    translation: "草莓",
    exampleSentence: "We picked strawberries on the farm last weekend.",
    exampleTranslation: "我們上週末在農場採了草莓。",
    answer: "strawberries",
  },
  {
    id: 10,
    text: "watermelon",
    partOfSpeech: "n.",
    translation: "西瓜",
    exampleSentence: "We cut open a big watermelon at the picnic.",
    exampleTranslation: "我們在野餐時切開了一顆大西瓜。",
    answer: "watermelon",
  },
  {
    id: 11,
    text: "pineapple",
    partOfSpeech: "n.",
    translation: "鳳梨",
    exampleSentence: "She put pineapple chunks on top of the pizza.",
    exampleTranslation: "她把鳳梨塊放在披薩上面。",
    answer: "pineapple",
  },
  {
    id: 12,
    text: "kiwi",
    partOfSpeech: "n.",
    translation: "奇異果",
    exampleSentence: "He sliced the kiwi and placed it on the plate.",
    exampleTranslation: "他把奇異果切片後放在盤子上。",
    answer: "kiwi",
  },
  {
    id: 13,
    text: "coconut",
    partOfSpeech: "n.",
    translation: "椰子",
    exampleSentence: "They drank coconut water straight from the shell.",
    exampleTranslation: "他們直接從椰殼裡喝椰子水。",
    answer: "coconut",
  },
  {
    id: 14,
    text: "blueberry",
    partOfSpeech: "n.",
    translation: "藍莓",
    exampleSentence: "She added blueberries to her yogurt for breakfast.",
    exampleTranslation: "她早餐在優格裡加了藍莓。",
    answer: "blueberries",
  },
  {
    id: 15,
    text: "papaya",
    partOfSpeech: "n.",
    translation: "木瓜",
    exampleSentence: "The papaya on the table smells very sweet.",
    exampleTranslation: "桌上的木瓜聞起來非常香甜。",
    answer: "papaya",
  },
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

// 本組單字中最長的 answer 字母數，作為輸入格上限
// 避免因格子數不同而洩露各題答案長度
const MAX_ANSWER_LENGTH = Math.max(...MOCK_WORDS.map((w) => w.answer.length));

// ============ Types ============
type HintMode = "wordbank" | "audio" | "choice";
// AssignmentMode imported from ActivitySettingsPanel
type ViewMode = "mobile" | "desktop";

// ============ Helper ============
/**
 * 將例句中的 answer 替換為底線，回傳 { before, blank, after }
 * 使用 case-insensitive 比對，保留原始標點（answer 前後）
 */
function buildClozeparts(sentence: string, answer: string) {
  const regex = new RegExp(`(${answer})`, "i");
  const match = sentence.match(regex);
  if (!match || match.index === undefined) {
    return { before: sentence, blank: answer, after: "" };
  }
  const before = sentence.slice(0, match.index);
  const after = sentence.slice(match.index + match[0].length);
  return { before, blank: match[0], after };
}

// ============ Component ============
export default function WordClozeSample() {
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

  // 音檔播放速度
  const AUDIO_RATES = [0.5, 0.75, 1.0, 1.5, 2.0];
  const [audioRate, setAudioRate] = useState(1.0);

  // === 老師設定（出作業時配置，學生端為接收端） ===
  const [hintMode, setHintMode] = useState<HintMode>("wordbank");
  const [assignmentMode, setAssignmentMode] =
    useState<AssignmentMode>("practice");
  const [showImage, setShowImage] = useState(true);
  // 字庫/選擇模式下是否同時顯示句子翻譯
  const [showSentenceTranslation, setShowSentenceTranslation] = useState(false);
  // 不顯示時學生無法得知答案長度，增加克漏字難度
  // 預設 false：字庫模式（預設 hintMode）下必須關閉，初始值對齊預設 hintMode
  const [showLetterCount, setShowLetterCount] = useState(false);
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
  const currentAnswer = currentWord.answer;

  // 選擇題選項：1 個正確答案 + (choiceCount-1) 個隨機干擾詞，每題重新隨機
  const choiceOptions = useMemo(() => {
    if (hintMode !== "choice") return [];
    const correct = currentAnswer;
    const others = MOCK_WORDS.filter(
      (_, i) => i !== wordOrder[currentIndex],
    ).map((w) => w.answer);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    const all = [correct, ...others.slice(0, choiceCount - 1)];
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintMode, currentIndex, wordOrder, choiceCount]);

  // 列印 PDF 題目列表（依 wordOrder 排序，空格以 "______" 表示）
  const printQuestions = useMemo<PrintQuestion[]>(
    () =>
      wordOrder.map((idx, i) => {
        const w = MOCK_WORDS[idx];
        const { before, after } = buildClozeparts(w.exampleSentence, w.answer);
        return {
          index: i + 1,
          correctAnswer: w.answer,
          sentence: `${before}______${after}`,
          sentenceTranslation: w.exampleTranslation,
          answerLength: w.answer.length,
        };
      }),
    [wordOrder],
  );

  // 字庫模式：1 個正確答案 + 9 個從其他題目隨機抽取的單字，全部打亂
  const [wordBank, setWordBank] = useState<string[]>([]);

  useEffect(() => {
    const others = MOCK_WORDS.filter(
      (_, i) => i !== wordOrder[currentIndex],
    ).map((w) => w.answer);
    // Fisher-Yates shuffle 後取前 9 個
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    const bank = [currentAnswer, ...others.slice(0, 9)];
    // 打亂字庫順序
    for (let i = bank.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bank[i], bank[j]] = [bank[j], bank[i]];
    }
    setWordBank(bank);
  }, [currentIndex, wordOrder, currentAnswer]);

  // 打亂題目順序（Fisher-Yates shuffle）
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
  // 答案格長度依 answer 決定（非 text）
  useEffect(() => {
    if (hintMode === "choice") {
      setSlots(new Array(MAX_ANSWER_LENGTH).fill(null));
      setSelectedOption(
        isExamMode ? (examAnswers[currentIndex] ?? null) : null,
      );
    } else if (isExamMode && examAnswers[currentIndex]) {
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
  }, [currentAnswer, currentIndex, isExamMode, hintMode, examAnswers]);

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

  // 點擊虛擬鍵盤字母 → 填入第一個空格
  const handleKeyPress = useCallback(
    (letter: string) => {
      if (answered || (isExamMode && examSubmitted)) return;
      // showLetterCount 模式下，只填入到實際答案字母數的格子
      const maxSlots = showLetterCount
        ? currentAnswer.length
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
      currentAnswer.length,
    ],
  );

  // 點擊答案格中的字母 → 移除（後方字母不補位）
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

  // 選擇題模式：點選選項（練習 = 即時判斷；考試 = 儲存可改選）
  const handleChoiceSelect = useCallback(
    (option: string) => {
      setSelectedOption(option);
      if (isExamMode) {
        setExamAnswers((prev) => ({ ...prev, [currentIndex]: option }));
      } else {
        const isCorrect = option.toLowerCase() === currentAnswer.toLowerCase();
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
    [isExamMode, currentIndex, currentAnswer],
  );

  // 手寫模式：辨識結果填入 slots（整詞一次填入）
  const handleWordInput = useCallback(
    (word: string) => {
      if (answered || (isExamMode && examSubmitted)) return;
      const limit = showLetterCount ? currentAnswer.length : MAX_ANSWER_LENGTH;
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
      currentAnswer.length,
    ],
  );

  // 練習模式：送出答案
  // 比對 answer（句中字形），case-insensitive
  const handlePracticeSubmit = useCallback(() => {
    if (answered) return;
    const input = slots.filter(Boolean).join("");
    const isCorrect = input.toLowerCase() === currentAnswer.toLowerCase();

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
  }, [answered, slots, currentAnswer]);

  // 考試模式：送出答案（儲存並跳下一題）
  const handleExamSubmit = useCallback(() => {
    if (examSubmitted) return;
    const answer = slots.filter((s) => s !== null).join("");
    if (answer.length > 0) {
      setExamAnswers((prev) => ({ ...prev, [currentIndex]: answer }));
    }

    if (currentIndex === MOCK_WORDS.length - 1) {
      setShowSubmitConfirm(true);
      return;
    }

    setCurrentIndex(currentIndex + 1);
  }, [examSubmitted, slots, currentIndex]);

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

  // Mock audio play（播放完整例句，速度由 audioRate 控制）
  // cancel() 是非同步清除，需等瀏覽器處理完畢再 speak，否則高速時會被截斷
  const handlePlayAudio = useCallback(() => {
    speechSynthesis.cancel();
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(
        currentWord.exampleSentence,
      );
      utterance.lang = "en-US";
      utterance.rate = audioRate;
      speechSynthesis.speak(utterance);
    }, 50);
  }, [currentWord.exampleSentence, audioRate]);

  // 音檔模式：切換題目時自動播放整個例句
  useEffect(() => {
    if (hintMode === "audio" && !showOverlay && !examSubmitted) {
      handlePlayAudio();
    }
  }, [currentIndex, hintMode, showOverlay, handlePlayAudio, examSubmitted]);

  // Desktop: 全域鍵盤事件監聽
  useEffect(() => {
    if (isTouchDevice || hintMode === "choice" || inputMethod === "handwriting")
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
    const answer = slots.filter((s) => s !== null).join("");
    const finalAnswers = { ...examAnswers };
    if (answer.length > 0) {
      finalAnswers[currentIndex] = answer;
    }
    setExamAnswers(finalAnswers);
    setExamSubmitted(true);
    setShowSubmitConfirm(false);
  }, [slots, examAnswers, currentIndex]);

  // 考試計分
  const examScore = useMemo(() => {
    if (!examSubmitted) return null;
    const pointsPerQuestion = Math.round((100 / MOCK_WORDS.length) * 10) / 10;
    let correct = 0;
    wordOrder.forEach((wordIdx, posIdx) => {
      const word = MOCK_WORDS[wordIdx];
      if (examAnswers[posIdx]?.toLowerCase() === word.answer.toLowerCase()) {
        correct++;
      }
    });
    const rawScore = correct * pointsPerQuestion;
    return Math.min(100, Math.round(rawScore * 10) / 10);
  }, [examSubmitted, examAnswers, wordOrder]);

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

  // 格子數固定為 MAX_ANSWER_LENGTH，不要求填滿，只要有輸入即可送出
  const hasInput = slots.some((s) => s !== null);

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

              {/* 逐題結果 */}
              {showExamAnswers && (
                <div className="space-y-2">
                  {wordOrder.map((wordIdx, posIdx) => {
                    const word = MOCK_WORDS[wordIdx];
                    const studentAnswer = examAnswers[posIdx] || "";
                    const isCorrect =
                      studentAnswer.toLowerCase() === word.answer.toLowerCase();
                    // 在例句中標示答案位置
                    const { before, after } = buildClozeparts(
                      word.exampleSentence,
                      word.answer,
                    );
                    return (
                      <div
                        key={posIdx}
                        className={cn(
                          "px-4 py-3 rounded-lg text-sm",
                          isCorrect ? "bg-green-50" : "bg-red-50",
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-gray-700">
                            {posIdx + 1}. {word.partOfSpeech} {word.translation}
                          </span>
                          <div className="flex items-center gap-2">
                            {!isCorrect && (
                              <span className="text-red-500 line-through text-xs">
                                {studentAnswer || "(未作答)"}
                              </span>
                            )}
                            <span
                              className={cn(
                                "font-medium",
                                isCorrect ? "text-green-600" : "text-gray-600",
                              )}
                            >
                              {word.answer}
                            </span>
                            {isCorrect ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-red-500" />
                            )}
                          </div>
                        </div>
                        {/* 完整例句 */}
                        <p className="text-xs text-gray-500">
                          {before}
                          <span
                            className={cn(
                              "font-semibold",
                              isCorrect ? "text-green-600" : "text-red-500",
                            )}
                          >
                            {word.answer}
                          </span>
                          {after}
                        </p>
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

              <div className="flex justify-center">
                <Button onClick={resetExam}>重新考試</Button>
              </div>
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
              <h2 className="text-xl font-bold text-gray-800">
                單字克漏字考試
              </h2>
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
            單字克漏字 — Sample
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
          <Badge variant="outline">作答模式：克漏字（Cloze）</Badge>
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
            { value: "wordbank", label: "字庫模式" },
            { value: "audio", label: "音檔播放" },
            { value: "choice", label: "選擇" },
          ]}
          onHintModeChange={(mode) => {
            setHintMode(mode as HintMode);
            if (mode === "wordbank" || mode === "choice")
              setShowLetterCount(false);
            // 選擇題模式不支援手寫，切換時重置輸入方式
            if (mode === "choice") setInputMethod("keyboard");
          }}
          choiceCount={choiceCount}
          onChoiceCountChange={setChoiceCount}
          choiceCountVisible={hintMode === "choice"}
          showImage={showImage}
          onShowImageChange={setShowImage}
          extraHintSettings={
            hintMode === "wordbank" || hintMode === "choice" ? (
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showSentenceTranslation}
                  onChange={(e) => {
                    setShowSentenceTranslation(e.target.checked);
                    e.target.blur();
                  }}
                  className="w-4 h-4 rounded border-gray-300"
                />
                顯示句子翻譯
              </label>
            ) : null
          }
          showLetterCount={showLetterCount}
          onShowLetterCountChange={setShowLetterCount}
          showLetterCountVisible={
            hintMode !== "wordbank" && hintMode !== "choice"
          }
          inputMethod={inputMethod}
          onInputMethodChange={setInputMethod}
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
          ※ 作業模式、提示方式、字母數由老師出作業時選擇；考試時間最多 2
          小時；字庫模式顯示 1 個正確答案 + 9
          個隨機干擾詞；觸控裝置自動偵測虛擬鍵盤，老師可強制開啟
        </p>
      </div>
    );
  }

  // 克漏字句子顯示
  const { before, after } = buildClozeparts(
    currentWord.exampleSentence,
    currentAnswer,
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      {renderHeader()}

      {/* ScoreOverlay */}
      <ScoreOverlay
        open={showOverlay}
        score={overlayScore}
        isError={overlayIsError}
        onComplete={handleOverlayComplete}
      />

      {/* 列印 PDF Sheet */}
      <PrintPdfSheet
        open={printSheetOpen}
        onOpenChange={setPrintSheetOpen}
        activityType="cloze"
        title="單字克漏字測驗"
        questions={printQuestions}
        hintMode={hintMode}
        showSentenceTranslation={showSentenceTranslation}
        hintModeOptions={[
          { value: "wordbank", label: "字庫模式" },
          { value: "audio", label: "音檔播放" },
          { value: "choice", label: "選擇" },
        ]}
        choiceCount={choiceCount}
        answerPool={MOCK_WORDS.map((w) => w.answer)}
        showImage={showImage}
        showLetterCount={showLetterCount}
        shuffleQuestions={shuffleQuestions}
      />

      {/* Submit Confirm Dialog */}
      <Dialog open={showSubmitConfirm} onOpenChange={setShowSubmitConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確認提交考卷？</DialogTitle>
            <DialogDescription>
              已作答 {examAnsweredCount} / {MOCK_WORDS.length}{" "}
              題。提交後無法修改。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSubmitConfirm(false)}
            >
              繼續作答
            </Button>
            <Button onClick={handleExamFinish}>確認提交</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Container */}
      <div
        className={cn("mx-auto", viewMode === "mobile" ? "max-w-sm" : "w-full")}
      >
        {/* Header: Progress / Timer */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {isExamMode ? "單字克漏字考試" : "單字克漏字"}
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

        {/* Exam: Question Navigator */}
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

        {/* Question Card */}
        <WordActivityCard
          viewMode={viewMode}
          showImage={showImage}
          hintArea={
            hintMode === "wordbank" ? (
              <div className="flex flex-wrap justify-center gap-2">
                {wordBank.map((word, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 rounded-full border border-gray-300 bg-white text-sm text-gray-700"
                  >
                    {word}
                  </span>
                ))}
              </div>
            ) : hintMode === "choice" ? null : ( // 選擇模式：hintArea 留空（克漏字句子在 questionDisplay，選項在 choiceArea）
              // audio 模式
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={handlePlayAudio}
                  className="flex items-center justify-center w-12 h-12 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors"
                  aria-label="重播音檔"
                >
                  <Volume2 className="h-6 w-6" />
                </button>
                <select
                  value={audioRate}
                  onChange={(e) => setAudioRate(Number(e.target.value))}
                  className="border border-gray-300 rounded-md px-2 py-1 text-xs bg-white text-gray-600"
                >
                  {AUDIO_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}x
                    </option>
                  ))}
                </select>
              </div>
            )
          }
          questionDisplay={
            <>
              {/* 克漏字句子 */}
              <div className="p-4 bg-gray-50 rounded-xl text-center leading-relaxed">
                <span className="text-base text-gray-700">{before}</span>
                <span className="inline-block w-16 border-b-2 border-blue-500 mx-1 align-bottom" />
                <span className="text-base text-gray-700">{after}</span>
              </div>
              {/* 字庫/選擇模式下可選顯示句子翻譯 */}
              {(hintMode === "wordbank" || hintMode === "choice") &&
                showSentenceTranslation && (
                  <p className="text-sm text-gray-500 text-center mt-3">
                    {currentWord.exampleTranslation}
                  </p>
                )}
            </>
          }
          slots={slots}
          answerLength={currentAnswer.length}
          showLetterCount={showLetterCount && hintMode !== "wordbank"}
          answered={answered}
          isExamMode={isExamMode}
          examSubmitted={examSubmitted}
          showPlaceholder={showPlaceholder}
          placeholderChar={(i) =>
            hintMode !== "wordbank" && hintMode !== "choice"
              ? currentAnswer[i]
              : undefined
          }
          placeholderText={
            showPlaceholder &&
            !isExamMode &&
            hintMode !== "wordbank" &&
            hintMode !== "choice"
              ? currentAnswer
              : undefined
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
            hintMode === "choice" ? (
              <MultipleChoiceOptions
                options={choiceOptions}
                selectedOption={selectedOption}
                correctAnswer={currentAnswer}
                answered={answered}
                isExamMode={isExamMode}
                examSubmitted={examSubmitted}
                onSelect={handleChoiceSelect}
              />
            ) : undefined
          }
        />

        {/* Virtual Keyboard — 選擇題模式與手寫模式不顯示 */}
        {isTouchDevice &&
        hintMode !== "choice" &&
        inputMethod !== "handwriting" ? (
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
                      className={cn(
                        "flex items-center justify-center rounded-lg font-medium bg-white border border-gray-300 text-gray-800 hover:bg-gray-100 active:bg-gray-200 transition-colors",
                        viewMode === "mobile"
                          ? "w-8 h-10 text-sm"
                          : "w-10 h-12 text-base",
                      )}
                    >
                      {displayLetter}
                    </button>
                  );
                })}
                {rowIndex === 2 && (
                  <button
                    onClick={handleBackspace}
                    className={cn(
                      "flex items-center justify-center rounded-lg bg-gray-100 border border-gray-300 text-gray-600 hover:bg-gray-200 transition-colors",
                      viewMode === "mobile" ? "w-12 h-10" : "w-16 h-12",
                    )}
                    aria-label="退格"
                  >
                    <Delete className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : inputMethod !== "handwriting" ? (
          <p className="mt-4 text-center text-xs text-gray-400">
            桌機模式：使用鍵盤輸入，Enter 送出，Backspace 退格
          </p>
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
      </div>
    </div>
  );
}
