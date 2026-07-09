/**
 * WordClozeQuizActivity — 單字克漏字·小考
 *
 * Issue #828：與艾賓浩斯版本 (WordClozeActivity) 並排存在。小考行為：
 *   - 一次拉回 content 全部題目，附 question_number
 *   - 上方題號 bar：可任意跳題、改答案
 *   - 末題顯示「提交」鈕；提交後 status=SUBMITTED 鎖定
 *   - 不更新 memory_strength；答案寫進 practice_answers (type=word_cloze_quiz)
 *   - 題目以 example_sentence 將 cloze_answer 挖空，學生填入正確變形
 *   - #844：手機/平板顯示 VirtualKeyboard（同艾賓浩斯版 WordClozeActivity），
 *     mobile 在卡片下方、tablet 在右側；inputMode=none 抑制系統鍵盤建議列
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Loader2, Send, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiClient } from "@/lib/api";
import { useQuizNavSlot } from "@/contexts/QuizNavSlotContext";
import { useInputDeviceMode } from "@/hooks/useInputDeviceMode";
import { useShortLandscape } from "./shared/useShortLandscape";
import { cn } from "@/lib/utils";
import CountdownRing from "./shared/CountdownRing";
import QuizAnswerInput, {
  type QuizAnswerInputHandle,
} from "./shared/QuizAnswerInput";
import ClozeBlankText from "./shared/ClozeBlankText";
import VirtualKeyboard from "./shared/VirtualKeyboard";
import CardNavArrow from "./shared/CardNavArrow";
import QuizReviewView, {
  type QuizReviewPayload,
  type QuizReviewWord,
} from "./shared/QuizReviewView";
import { useQuizTimer } from "./shared/useQuizTimer";
import {
  useQuizRevision,
  allCorrect,
  firstUnresolvedIndex,
  nextUnresolvedIndex,
} from "./shared/useQuizRevision";

interface QuizWord {
  content_item_id: number;
  text: string;
  translation: string;
  part_of_speech?: string | null;
  example_sentence: string;
  example_sentence_translation: string;
  example_sentence_audio_url?: string | null;
  cloze_answer: string;
  image_url?: string | null;
  audio_url?: string | null;
  question_number: number;
  prior_answer?: string | null;
  prior_is_correct?: boolean | null;
}

interface StartResponse {
  session_id: number;
  practice_mode: "word_cloze_quiz";
  words: QuizWord[];
  total_questions: number;
  show_translation: boolean;
  show_image: boolean;
  play_audio: boolean;
  show_answer: boolean;
  time_limit_per_question?: number | null;
  shuffle_questions: boolean;
  quiz_time_limit_seconds?: number | null;
  time_remaining_seconds?: number | null;
  // Issue #830: 退回後為 "RETURNED" → 進入訂正模式
  status?: string | null;
}

interface Props {
  assignmentId: number;
  isPreviewMode?: boolean;
  isDemoMode?: boolean;
  onComplete?: () => void;
  previewWords?: QuizWord[];
  previewSettings?: Partial<StartResponse>;
  // #830: 老師預覽時注入每張卡底部的「該題班級表現」%條（學生端不傳）。
  renderCardFooter?: (contentItemId: number) => ReactNode;
}

/**
 * Build a sentence with the cloze answer replaced by a visible blank.
 * Case-insensitive replace on the first occurrence keeps the original
 * casing visible elsewhere (e.g. proper nouns earlier in the sentence).
 */
const buildBlanked = (sentence: string, answer: string): string => {
  if (!sentence) return "";
  if (!answer) return sentence;
  const idx = sentence.toLowerCase().indexOf(answer.toLowerCase());
  if (idx < 0) return sentence;
  const before = sentence.slice(0, idx);
  const after = sentence.slice(idx + answer.length);
  return `${before}_____${after}`;
};

export default function WordClozeQuizActivity({
  assignmentId,
  isPreviewMode: _isPreviewMode = false,
  isDemoMode = false,
  onComplete,
  previewWords,
  previewSettings,
  renderCardFooter,
}: Props) {
  void _isPreviewMode;
  const { t } = useTranslation();
  const isLivePreview = !!previewWords;

  const [loading, setLoading] = useState(!isLivePreview);
  const [words, setWords] = useState<QuizWord[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [typedByItem, setTypedByItem] = useState<Record<number, string>>({});
  const [correctByItem, setCorrectByItem] = useState<
    Record<number, boolean | null>
  >({});
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  interface ClozeReviewWord extends QuizReviewWord {
    example_sentence: string;
    example_sentence_translation: string;
    part_of_speech?: string | null;
  }
  const [reviewData, setReviewData] =
    useState<QuizReviewPayload<ClozeReviewWord> | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [settings, setSettings] = useState({
    show_translation: true,
    play_audio: false,
    show_answer: false,
  });
  const [initialRemaining, setInitialRemaining] = useState<number | null>(null);
  const [timerTotal, setTimerTotal] = useState<number | null>(null);
  const completingRef = useRef(false);
  const navSlot = useQuizNavSlot();
  // #844：手機/平板顯示虛擬鍵盤（同艾賓浩斯版）；桌機用實體鍵盤
  const deviceMode = useInputDeviceMode();
  // #861 E: 手機橫放（矮）→ 題目與鍵盤共用一個捲軸，避免互搶高度
  const shortLandscape = useShortLandscape();
  // #861 E: 老師預覽也顯示虛擬鍵盤（即使桌機）以便示範
  const useVirtualKeyboard = isLivePreview || deviceMode !== "desktop";
  const quizInputRef = useRef<QuizAnswerInputHandle>(null);
  // Issue #830: 訂正模式（退回後）— 答錯揭示正解、強制全對才能提交
  const [quizStatus, setQuizStatus] = useState<string | null>(null);
  const { isRevision, revealByItem, recordResult } =
    useQuizRevision(quizStatus);

  // #844：虛擬鍵盤 handler（經 QuizAnswerInput ref 操作 focused slot，同艾賓浩斯版）。
  // 必須宣告在所有 early return 之前，否則違反 hooks 呼叫順序。
  const vkAppend = useCallback(
    (ch: string) => {
      const cw = words[currentIndex];
      // 訂正模式已答對的題鎖定，不接受鍵盤輸入
      if (isRevision && cw && correctByItem[cw.content_item_id] === true)
        return;
      quizInputRef.current?.appendChar(ch);
    },
    [words, currentIndex, correctByItem, isRevision],
  );
  const vkBackspace = useCallback(() => {
    const cw = words[currentIndex];
    if (isRevision && cw && correctByItem[cw.content_item_id] === true) return;
    quizInputRef.current?.backspace();
  }, [words, currentIndex, correctByItem, isRevision]);
  const vkEnter = useCallback(() => {
    // submit() 內部已檢查 disabled/submitting，並呼叫 QuizAnswerInput 的 onSubmit
    quizInputRef.current?.submit();
  }, []);

  useEffect(() => {
    if (isLivePreview) {
      setWords(previewWords || []);
      setSettings({
        show_translation: previewSettings?.show_translation ?? true,
        play_audio: previewSettings?.play_audio ?? false,
        show_answer: previewSettings?.show_answer ?? false,
      });
      setLoading(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const data = (await apiClient.get(
          `/api/students/assignments/${assignmentId}/vocabulary/cloze_quiz/start`,
        )) as StartResponse;
        if (cancelled) return;
        setWords(data.words);
        setSessionId(data.session_id);
        const initialTyped: Record<number, string> = {};
        const initialCorrect: Record<number, boolean | null> = {};
        data.words.forEach((w) => {
          if (w.prior_answer != null)
            initialTyped[w.content_item_id] = w.prior_answer;
          if (w.prior_is_correct != null)
            initialCorrect[w.content_item_id] = w.prior_is_correct;
        });
        setTypedByItem(initialTyped);
        setCorrectByItem(initialCorrect);
        setQuizStatus(data.status ?? null);
        // 訂正模式（退回後 RETURNED）：游標直接停在第一題錯題（略過已答對題）
        if (data.status === "RETURNED") {
          const firstWrong = firstUnresolvedIndex(data.words, initialCorrect);
          if (firstWrong >= 0) setCurrentIndex(firstWrong);
        }
        setSettings({
          show_translation: data.show_translation,
          play_audio: data.play_audio,
          show_answer: data.show_answer,
        });
        const remaining =
          data.time_remaining_seconds == null
            ? null
            : Math.max(0, data.time_remaining_seconds);
        setInitialRemaining(remaining);
        setTimerTotal(data.quiz_time_limit_seconds ?? remaining);
      } catch (err: unknown) {
        const code = (err as { detail?: { code?: string } })?.detail?.code;
        if (code === "QUIZ_ALREADY_SUBMITTED" || code === "QUIZ_CLOSED") {
          // Issue #835: 已收卷/已交 → 顯示批改結果
          setAlreadySubmitted(true);
        } else if (code === "QUIZ_NOT_OPENED") {
          // Issue #835: live 尚未開放，由 StudentActivityPageContent guard 導回
        } else {
          toast.error(t("wordCloze.toast.loadFailed") || "Failed to load quiz");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [assignmentId, isLivePreview, previewSettings, previewWords, t]);

  const currentWord = words[currentIndex];

  const playAudio = useCallback((url?: string | null) => {
    if (!url) return;
    const audio = new Audio(url);
    audio.play().catch(() => {});
  }, []);

  const persistItemAnswer = useCallback(
    async (
      itemId: number,
      typed: string,
    ): Promise<{ ok: boolean; isCorrect?: boolean }> => {
      if (isLivePreview || isDemoMode || sessionId == null) return { ok: true };
      const trimmed = typed.trim();
      if (!trimmed) return { ok: true };
      try {
        const data = (await apiClient.post(
          `/api/students/assignments/${assignmentId}/vocabulary/cloze_quiz/answer`,
          {
            content_item_id: itemId,
            typed_answer: trimmed,
            time_spent_seconds: 0,
            session_id: sessionId,
          },
        )) as { is_correct: boolean; correct_answer?: string };
        setCorrectByItem((m) => ({ ...m, [itemId]: data.is_correct }));
        // 訂正模式：答錯立即揭示正解，答對清除揭示
        recordResult(itemId, data.is_correct, data.correct_answer);
        return { ok: true, isCorrect: data.is_correct };
      } catch {
        return { ok: false };
      }
    },
    [assignmentId, isDemoMode, isLivePreview, sessionId, recordResult],
  );

  const persistAnswer = useCallback(async (): Promise<boolean> => {
    if (!currentWord) return true;
    const typed = typedByItem[currentWord.content_item_id] || "";
    if (!typed.trim()) return true;
    setSubmittingAnswer(true);
    const res = await persistItemAnswer(currentWord.content_item_id, typed);
    setSubmittingAnswer(false);
    if (!res.ok) {
      toast.error(t("wordCloze.toast.saveFailed") || "Failed to save answer");
    }
    return res.ok;
  }, [currentWord, persistItemAnswer, t, typedByItem]);

  const goTo = useCallback(
    async (idx: number) => {
      if (idx === currentIndex || idx < 0 || idx >= words.length) return;
      await persistAnswer();
      setCurrentIndex(idx);
    },
    [currentIndex, persistAnswer, words.length],
  );

  const handleSubmitAll = useCallback(async () => {
    if (isLivePreview) {
      // #861 D: 預覽提交 → 前端用目前打字作答組複盤，重用學生端 QuizReviewView。
      const norm = (s: string | null | undefined) =>
        (s ?? "").trim().toLowerCase();
      const reviewWords: ClozeReviewWord[] = words.map((w) => {
        const typed = (typedByItem[w.content_item_id] || "").trim();
        const isCorrect = !!typed && norm(typed) === norm(w.cloze_answer);
        return {
          content_item_id: w.content_item_id,
          question_number: w.question_number,
          is_correct: isCorrect,
          student_answer: typed || null,
          correct_answer: w.cloze_answer,
          example_sentence: w.example_sentence,
          example_sentence_translation: w.example_sentence_translation,
          part_of_speech: w.part_of_speech,
        };
      });
      const correctCount = reviewWords.filter((r) => r.is_correct).length;
      const total = reviewWords.length;
      setReviewData({
        practice_mode: "word_cloze_quiz",
        words: reviewWords,
        total_questions: total,
        correct_count: correctCount,
        score: total ? Math.round((correctCount / total) * 100) : 0,
        status: null,
        submitted_at: null,
      });
      setAlreadySubmitted(true);
      return;
    }
    if (isDemoMode) {
      onComplete?.();
      return;
    }
    if (sessionId == null) return;
    if (completingRef.current) return;
    completingRef.current = true;
    setCompleting(true);
    try {
      let persisted = await persistAnswer();
      if (!persisted) persisted = await persistAnswer();
      if (!persisted) {
        toast.warning(
          t("wordQuiz.toast.lastAnswerNotSaved") ||
            "最後一題答案儲存失敗，仍以已答題目計分提交",
        );
      }
      await apiClient.post(
        `/api/students/assignments/${assignmentId}/vocabulary/cloze_quiz/complete`,
        { session_id: sessionId },
      );
      toast.success(t("wordCloze.toast.completed") || "Quiz submitted");
      onComplete?.();
    } catch {
      toast.error(t("wordCloze.toast.submitFailed") || "Submit failed");
      completingRef.current = false;
    } finally {
      setCompleting(false);
    }
  }, [
    assignmentId,
    isDemoMode,
    isLivePreview,
    onComplete,
    persistAnswer,
    sessionId,
    t,
    words,
    typedByItem,
  ]);

  // Issue #830 訂正模式：送出當題答案 →
  //   答錯：留在原題看正解（強制改對）。
  //   答對：自動跳「下一題錯題」；若已無錯題（剛改對的是最後一題錯題）＝整卷提交。
  const handleRevisionCheck = useCallback(async () => {
    if (!currentWord) return;
    const itemId = currentWord.content_item_id;
    const typed = (typedByItem[itemId] || "").trim();
    if (!typed) return;
    setSubmittingAnswer(true);
    const res = await persistItemAnswer(itemId, typed);
    setSubmittingAnswer(false);
    if (!res.isCorrect) return;
    // setCorrectByItem 為非同步，先把當題視為已解決再找下一題錯題
    const resolved = { ...correctByItem, [itemId]: true };
    const next = nextUnresolvedIndex(words, resolved, currentIndex);
    if (next === -1) {
      await handleSubmitAll();
    } else {
      setCurrentIndex(next);
    }
  }, [
    currentWord,
    typedByItem,
    persistItemAnswer,
    correctByItem,
    words,
    currentIndex,
    handleSubmitAll,
  ]);

  const answeredCount = useMemo(
    () =>
      Object.values(typedByItem).filter((v) => v && v.trim().length > 0).length,
    [typedByItem],
  );

  const timeRemaining = useQuizTimer(
    initialRemaining,
    handleSubmitAll,
    alreadySubmitted,
  );

  // 同 spelling：用 ref guard 避免 setReviewLoading 觸發 useEffect 重跑造成 cancel 自己
  const reviewFetchedRef = useRef(false);
  useEffect(() => {
    if (!alreadySubmitted || isLivePreview || isDemoMode) return;
    if (reviewFetchedRef.current) return;
    reviewFetchedRef.current = true;
    let cancelled = false;
    const run = async () => {
      setReviewLoading(true);
      try {
        const data = (await apiClient.get(
          `/api/students/assignments/${assignmentId}/vocabulary/cloze_quiz/review`,
        )) as QuizReviewPayload<ClozeReviewWord>;
        if (!cancelled) setReviewData(data);
      } catch {
        if (!cancelled) {
          toast.error(
            t("wordQuiz.toast.reviewLoadFailed") || "載入複盤資料失敗",
          );
          reviewFetchedRef.current = false;
        }
      } finally {
        if (!cancelled) setReviewLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [alreadySubmitted, assignmentId, isDemoMode, isLivePreview, t]);

  // Auto-persist on typing pause (1s) — see WordSpellingQuizActivity for rationale.
  const lastPersistedRef = useRef<Record<number, string>>({});
  useEffect(() => {
    // 訂正模式不自動 persist：改答案由學生按「送出」明確觸發，才即時揭示正解
    if (
      !currentWord ||
      isLivePreview ||
      isDemoMode ||
      alreadySubmitted ||
      isRevision
    )
      return;
    const itemId = currentWord.content_item_id;
    const val = (typedByItem[itemId] || "").trim();
    if (!val) return;
    if (lastPersistedRef.current[itemId] === val) return;
    const handle = setTimeout(() => {
      lastPersistedRef.current[itemId] = val;
      persistItemAnswer(itemId, val);
    }, 1000);
    return () => clearTimeout(handle);
  }, [
    currentWord,
    typedByItem,
    isLivePreview,
    isDemoMode,
    alreadySubmitted,
    isRevision,
    persistItemAnswer,
  ]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (alreadySubmitted) {
    if (reviewLoading || !reviewData) {
      return (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      );
    }
    return (
      <QuizReviewView
        data={reviewData}
        renderQuestion={(w) => {
          const blanked = buildBlanked(w.example_sentence, w.correct_answer);
          return (
            <div className="text-center py-1 space-y-1">
              {w.part_of_speech && (
                <span className="inline-block text-xs text-gray-500">
                  ({w.part_of_speech})
                </span>
              )}
              <p className="quiz-question-font leading-relaxed text-gray-800 font-semibold tracking-wide">
                <ClozeBlankText text={blanked} />
              </p>
              {w.example_sentence_translation && (
                <p className="quiz-translation-font text-gray-500">
                  {w.example_sentence_translation}
                </p>
              )}
            </div>
          );
        }}
      />
    );
  }

  if (!currentWord) {
    return (
      <div className="text-center text-gray-500 py-12">
        {t("wordQuiz.empty") || "No questions available."}
      </div>
    );
  }

  const isLast = currentIndex === words.length - 1;
  const blanked = buildBlanked(
    currentWord.example_sentence,
    currentWord.cloze_answer,
  );
  // Issue #830 訂正模式 gating
  const currentCorrect = correctByItem[currentWord.content_item_id];
  const currentResolved = currentCorrect === true;
  const everyResolved = allCorrect(words, correctByItem);
  const currentReveal = revealByItem[currentWord.content_item_id];

  // 題號 bar — Page 提供 slot 時 portal 上去；否則 inline render（fallback）
  const navBar = (
    <>
      <span className="text-xs text-gray-500 mr-1 shrink-0">
        {t("wordQuiz.questionNav") || "題號"}
      </span>
      {/* #844：題號多時不換行，改水平捲動；標題／計數／計時器留在外面不被推走 */}
      <div className="flex gap-1 sm:gap-1.5 items-center overflow-x-auto min-w-0 flex-1 py-1">
        {words.map((w, idx) => {
          const answered = (typedByItem[w.content_item_id] || "").trim() !== "";
          const isCurrent = idx === currentIndex;
          return (
            <button
              key={w.content_item_id}
              type="button"
              onClick={() => goTo(idx)}
              className={cn(
                "h-8 min-w-8 shrink-0 inline-flex items-center justify-center rounded text-sm font-medium border transition",
                isCurrent
                  ? "bg-pink-500 text-white border-pink-500"
                  : !answered
                    ? "bg-white text-gray-500 border-gray-300 hover:border-pink-400"
                    : // #844 有答題=黃色，不洩漏正誤（含訂正模式）
                      "bg-yellow-100 text-yellow-800 border-yellow-400",
              )}
            >
              {idx + 1}
            </button>
          );
        })}
      </div>
      <span className="text-xs text-gray-400 ml-2 shrink-0">
        {answeredCount} / {words.length}
      </span>
      {timeRemaining !== null && timerTotal !== null && (
        <CountdownRing
          seconds={timeRemaining}
          total={timerTotal}
          size={56}
          longForm
        />
      )}
      {/* #861 D: 預覽模式在題號列右上角提供提交鈕（前端組複盤，提交後顯示正解）。 */}
      {isLivePreview && (
        <Button
          type="button"
          size="sm"
          onClick={handleSubmitAll}
          className="ml-2 shrink-0"
        >
          <Send className="h-4 w-4 mr-1" />
          {t("wordQuiz.submit") || "提交"}
        </Button>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-4 min-h-[calc(98dvh-14rem)] max-h-[98dvh]">
      {navSlot ? (
        createPortal(navBar, navSlot)
      ) : (
        <div className="flex gap-1 sm:gap-1.5 items-center">{navBar}</div>
      )}

      {/* #861 E: 鍵盤一律置於下方（移除平板右側窄欄）。手機橫放(shortLandscape)時
          外層整塊一起捲，題目與鍵盤共用一個捲軸、互不搶高度。 */}
      <div
        className={cn(
          "flex-1 min-h-0 flex flex-col gap-4",
          shortLandscape && "overflow-y-auto",
        )}
      >
        <div
          className={cn(
            "min-w-0 flex flex-col",
            !shortLandscape && "flex-1 min-h-0",
          )}
        >
          <Card
            className={cn(
              "relative flex flex-col border-0 shadow-none bg-transparent",
              !shortLandscape && "flex-1 min-h-0",
            )}
          >
            {/* #830: 上一題 / 下一題改為卡片左右兩側箭頭（對齊一般單字卡 WordCard） */}
            {currentIndex > 0 && (
              <CardNavArrow
                direction="prev"
                onClick={() => goTo(currentIndex - 1)}
              />
            )}
            {!isLast && (
              <CardNavArrow
                direction="next"
                disabled={submittingAnswer || (isRevision && !currentResolved)}
                onClick={() => goTo(currentIndex + 1)}
              />
            )}
            <CardContent
              className={cn(
                "flex flex-col gap-4 p-0",
                !shortLandscape && "flex-1 min-h-0",
              )}
            >
              <div
                className={cn(
                  "flex flex-col gap-4 px-10 sm:px-12",
                  !shortLandscape && "flex-1 min-h-0 overflow-y-auto",
                )}
              >
                <div className="text-sm text-gray-500">
                  {t("wordQuiz.questionLabel", {
                    current: currentWord.question_number,
                    total: words.length,
                  }) ||
                    `第 ${currentWord.question_number} / ${words.length} 題`}
                </div>

                {isRevision && (
                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {t("wordQuiz.revision.hint") ||
                      "訂正模式：答錯會顯示正解，全部改對才能提交"}
                  </div>
                )}

                {/* 樣式對齊 WordClozeActivity (艾賓浩斯版) */}
                {settings.play_audio &&
                  currentWord.example_sentence_audio_url && (
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() =>
                          playAudio(currentWord.example_sentence_audio_url)
                        }
                        aria-label={t("wordQuiz.playAudio") || "Play"}
                        className="inline-flex items-center justify-center transition-colors shrink-0 bg-transparent h-12 w-12 text-blue-500 hover:text-blue-600"
                      >
                        <Volume2 className="h-7 w-7" />
                      </button>
                    </div>
                  )}

                <div className="max-w-2xl mx-auto text-center py-2 space-y-2">
                  {currentWord.part_of_speech && (
                    <div className="flex justify-center">
                      <Badge
                        variant="secondary"
                        className="bg-gray-200 text-gray-700 hover:bg-gray-200 font-normal"
                      >
                        {currentWord.part_of_speech}
                      </Badge>
                    </div>
                  )}
                  <p className="quiz-question-font leading-relaxed text-gray-800 font-semibold px-4 tracking-wide">
                    <ClozeBlankText text={blanked} />
                  </p>
                  {settings.show_translation &&
                    currentWord.example_sentence_translation && (
                      <p className="quiz-translation-font text-gray-500">
                        {currentWord.example_sentence_translation}
                      </p>
                    )}
                </div>

                <QuizAnswerInput
                  ref={quizInputRef}
                  useVirtualKeyboard={useVirtualKeyboard}
                  value={typedByItem[currentWord.content_item_id] || ""}
                  expectedAnswer={currentWord.cloze_answer}
                  onChange={(next) =>
                    setTypedByItem((m) => ({
                      ...m,
                      [currentWord.content_item_id]: next,
                    }))
                  }
                  // 訂正：對答案；其餘：暫存/跳題。最後一題整卷送出改由頁面頂部「提交」負責，
                  // 故最後一題隱藏內嵌箭頭（hideSubmitButton），避免重複提交入口。
                  onSubmit={
                    isRevision
                      ? handleRevisionCheck
                      : isLast
                        ? () => persistAnswer()
                        : () => goTo(currentIndex + 1)
                  }
                  hideSubmitButton={isLast && !isRevision}
                  // 訂正模式已答對的題目鎖定唯讀，不可再改
                  disabled={isRevision && currentResolved}
                  submitting={submittingAnswer}
                  // #844：小考 input 一律中性色，不因正誤變色（防作弊；state 預設 neutral）
                  autoFocus
                />

                {isRevision && currentReveal && !currentResolved && (
                  <p className="text-center text-sm font-medium text-red-600">
                    {t("wordQuiz.revision.correctAnswer", {
                      answer: currentReveal,
                    }) || `正解：${currentReveal}`}
                  </p>
                )}
              </div>

              {/* Card footer 提交鈕：#844 一般作答（最後一題）改用內嵌箭頭送出，
              footer 只剩「訂正模式」顯示（全部改對才可點）。 */}
              {isRevision && (
                <div className="flex justify-center border-t pt-3 shrink-0">
                  <Button
                    type="button"
                    onClick={handleSubmitAll}
                    disabled={
                      completing ||
                      submittingAnswer ||
                      (isRevision && !everyResolved)
                    }
                  >
                    {completing ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    {t("wordQuiz.submit") || "提交"}
                  </Button>
                </div>
              )}

              {/* #830: 老師預覽時卡片最下方顯示該題班級表現 %條 */}
              {renderCardFooter?.(currentWord.content_item_id)}
            </CardContent>
          </Card>
        </div>
        {useVirtualKeyboard && (
          <div className="shrink-0 w-full max-w-3xl mx-auto">
            <VirtualKeyboard
              onKey={vkAppend}
              onBackspace={vkBackspace}
              onEnter={vkEnter}
            />
          </div>
        )}
      </div>
    </div>
  );
}
