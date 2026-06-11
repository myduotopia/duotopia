/**
 * WordSpellingQuizActivity — 單字拼寫·小考
 *
 * Issue #828：與艾賓浩斯版本 (WordSpellingActivity) 並排存在，不共用元件以
 * 避免雙模式狀態機。小考行為：
 *   - 一次拉回 content 全部題目，附 question_number
 *   - 上方題號 bar：可任意跳題、改答案
 *   - 末題顯示「提交」鈕；提交後 status=SUBMITTED 鎖定，重開作業會 409
 *   - 不更新 memory_strength；答案寫進 practice_answers (type=word_spelling_quiz)
 *
 * 此元件同被學生作答頁與派發 sheet preview 共用（透過 previewWords 注入）。
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
import { cn } from "@/lib/utils";
import CountdownRing from "./shared/CountdownRing";
import QuizAnswerInput from "./shared/QuizAnswerInput";
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
  audio_url?: string | null;
  image_url?: string | null;
  question_number: number;
  prior_answer?: string | null;
  prior_is_correct?: boolean | null;
}

interface StartResponse {
  session_id: number;
  practice_mode: "word_spelling_quiz";
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

export default function WordSpellingQuizActivity({
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
  // typedByItem 暫存學生在每題的答案（key = content_item_id）
  const [typedByItem, setTypedByItem] = useState<Record<number, string>>({});
  // Tracks correctness per item so the number bar can show right/wrong colors.
  const [correctByItem, setCorrectByItem] = useState<
    Record<number, boolean | null>
  >({});
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  // Issue #828 polish: 提交後改顯示題目+答案複盤，而非鎖卡
  interface SpellingReviewWord extends QuizReviewWord {
    text: string;
    translation: string;
    part_of_speech?: string | null;
    audio_url?: string | null;
    image_url?: string | null;
  }
  const [reviewData, setReviewData] =
    useState<QuizReviewPayload<SpellingReviewWord> | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [settings, setSettings] = useState({
    show_translation: true,
    show_image: true,
    play_audio: false,
    show_answer: false,
  });
  // Issue #828: 整卷限時 — initialRemaining 給 useQuizTimer，timerTotal 給 CountdownRing 動畫
  const [initialRemaining, setInitialRemaining] = useState<number | null>(null);
  const [timerTotal, setTimerTotal] = useState<number | null>(null);
  // 防止 handleSubmitAll 因 useEffect 重觸 / timer expire 重複進入後端 complete
  const completingRef = useRef(false);
  const navSlot = useQuizNavSlot();
  // Issue #830: 訂正模式（退回後）— 答錯揭示正解、強制全對才能提交
  const [quizStatus, setQuizStatus] = useState<string | null>(null);
  const { isRevision, revealByItem, recordResult } =
    useQuizRevision(quizStatus);

  // --------------------------------------------------------------------
  // Load quiz (or preview)
  // --------------------------------------------------------------------
  useEffect(() => {
    if (isLivePreview) {
      setWords(previewWords || []);
      setSettings({
        show_translation: previewSettings?.show_translation ?? true,
        show_image: previewSettings?.show_image ?? true,
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
          `/api/students/assignments/${assignmentId}/vocabulary/spelling_quiz/start`,
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
          show_image: data.show_image,
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
        if (code === "QUIZ_ALREADY_SUBMITTED") {
          setAlreadySubmitted(true);
        } else {
          toast.error(
            t("wordSpelling.toast.loadFailed") || "Failed to load quiz",
          );
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

  // --------------------------------------------------------------------
  // Submit / persist answer per question
  // --------------------------------------------------------------------
  // Persist a specific item's answer. Returns true on success / no-op,
  // false if the backend POST failed — caller decides whether to retry.
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
          `/api/students/assignments/${assignmentId}/vocabulary/spelling_quiz/answer`,
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

  // 學生切題 / 提交時用。失敗會 toast，並回傳 false 讓 caller 決定重試。
  const persistAnswer = useCallback(async (): Promise<boolean> => {
    if (!currentWord) return true;
    const typed = typedByItem[currentWord.content_item_id] || "";
    if (!typed.trim()) return true;
    setSubmittingAnswer(true);
    const res = await persistItemAnswer(currentWord.content_item_id, typed);
    setSubmittingAnswer(false);
    if (!res.ok) {
      toast.error(
        t("wordSpelling.toast.saveFailed") || "Failed to save answer",
      );
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
    if (isLivePreview || isDemoMode) {
      onComplete?.();
      return;
    }
    if (sessionId == null) return;
    if (completingRef.current) return; // 避免 timer 重複觸發
    completingRef.current = true;
    setCompleting(true);
    try {
      // 確保最後一題答案進 DB：先試一次，失敗 retry 一次；都失敗仍照常 complete
      // 但提示學生（避免靜默失敗）。已答對的題目早已 persist，不會被影響。
      let persisted = await persistAnswer();
      if (!persisted) persisted = await persistAnswer();
      if (!persisted) {
        toast.warning(
          t("wordQuiz.toast.lastAnswerNotSaved") ||
            "最後一題答案儲存失敗，仍以已答題目計分提交",
        );
      }
      await apiClient.post(
        `/api/students/assignments/${assignmentId}/vocabulary/spelling_quiz/complete`,
        { session_id: sessionId },
      );
      toast.success(t("wordSpelling.toast.completed") || "Quiz submitted");
      onComplete?.();
    } catch {
      toast.error(t("wordSpelling.toast.submitFailed") || "Submit failed");
      completingRef.current = false; // 讓使用者再點一次「提交」
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

  // Issue #828: 整卷倒數 — 透過 useQuizTimer 把 onExpire 收進 ref，
  // 避免 typedByItem 連續變動把 setTimeout 一直 reset 導致倒數凍結。
  const timeRemaining = useQuizTimer(
    initialRemaining,
    handleSubmitAll,
    alreadySubmitted,
  );

  // Issue #828 polish: SUBMITTED 時 fetch 複盤資料
  // ⚠️ 用 ref 做 fetched guard：若把 reviewLoading 放進 deps，setReviewLoading(true)
  // 會觸發 useEffect 重跑、cleanup 把 cancelled 設 true → in-flight fetch 回來時
  // setReviewData 被跳過 → 永遠卡 loading。
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
          `/api/students/assignments/${assignmentId}/vocabulary/spelling_quiz/review`,
        )) as QuizReviewPayload<SpellingReviewWord>;
        if (!cancelled) setReviewData(data);
      } catch {
        if (!cancelled) {
          toast.error(
            t("wordQuiz.toast.reviewLoadFailed") || "載入複盤資料失敗",
          );
          reviewFetchedRef.current = false; // 允許重試（若 useEffect 再次觸發）
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

  // Issue #828: 學生只打字、未送出、未切題時自動 persist，避免
  // 「時間到才提交但網路抖一下答案沒進 DB」的場景。
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

  // --------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------
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
        renderQuestion={(w) => (
          <div className="text-center py-2 space-y-1">
            {w.image_url && (
              <img
                src={w.image_url}
                alt=""
                className="mx-auto max-h-32 object-contain"
              />
            )}
            <h3 className="text-2xl font-bold text-gray-800 tracking-wide">
              {w.translation || w.text}
            </h3>
            {w.part_of_speech && (
              <span className="inline-block text-xs text-gray-500">
                ({w.part_of_speech})
              </span>
            )}
          </div>
        )}
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
  // Issue #830 訂正模式 gating
  const currentCorrect = correctByItem[currentWord.content_item_id];
  const currentResolved = currentCorrect === true;
  const everyResolved = allCorrect(words, correctByItem);
  const currentReveal = revealByItem[currentWord.content_item_id];
  const showCorrectness = settings.show_answer || isRevision;

  // 題號 bar — Page 提供 slot 時 portal 上去；否則 inline render（fallback）
  const navBar = (
    <>
      <span className="text-xs text-gray-500 mr-1">
        {t("wordQuiz.questionNav") || "題號"}
      </span>
      {words.map((w, idx) => {
        const answered = (typedByItem[w.content_item_id] || "").trim() !== "";
        const isCurrent = idx === currentIndex;
        const priorCorrect = correctByItem[w.content_item_id];
        return (
          <button
            key={w.content_item_id}
            type="button"
            onClick={() => goTo(idx)}
            className={cn(
              "h-7 min-w-[28px] px-2 rounded text-xs font-medium border transition",
              isCurrent
                ? "bg-amber-500 text-white border-amber-500"
                : !answered
                  ? "bg-white text-gray-500 border-gray-300 hover:border-amber-400"
                  : showCorrectness && priorCorrect === true
                    ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                    : showCorrectness && priorCorrect === false
                      ? "bg-rose-50 text-rose-700 border-rose-300"
                      : "bg-amber-50 text-amber-700 border-amber-300",
            )}
          >
            {idx + 1}
          </button>
        );
      })}
      <span className="text-xs text-gray-400 ml-auto">
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
    </>
  );

  return (
    <div className="flex flex-col gap-4 min-h-[calc(98dvh-14rem)] max-h-[98dvh]">
      {navSlot ? (
        createPortal(navBar, navSlot)
      ) : (
        <div className="flex flex-wrap gap-1 sm:gap-1.5 items-center">
          {navBar}
        </div>
      )}

      <Card className="relative flex-1 min-h-0 flex flex-col border-0 shadow-none bg-transparent">
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
        <CardContent className="flex-1 min-h-0 flex flex-col gap-4 p-0">
          <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto px-10 sm:px-12">
            <div className="text-sm text-gray-500">
              {t("wordQuiz.questionLabel", {
                current: currentWord.question_number,
                total: words.length,
              }) || `第 ${currentWord.question_number} / ${words.length} 題`}
            </div>

            {isRevision && (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {t("wordQuiz.revision.hint") ||
                  "訂正模式：答錯會顯示正解，全部改對才能提交"}
              </div>
            )}

            {settings.show_image && currentWord.image_url && (
              <img
                src={currentWord.image_url}
                alt=""
                className="mx-auto max-h-40 object-contain"
              />
            )}

            {/* 樣式對齊 WordSpellingActivity (艾賓浩斯版) */}
            {settings.play_audio && currentWord.audio_url && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => playAudio(currentWord.audio_url)}
                  aria-label={t("wordQuiz.playAudio") || "Play"}
                  className="inline-flex items-center justify-center transition-colors shrink-0 bg-transparent h-12 w-12 text-blue-500 hover:text-blue-600"
                >
                  <Volume2 className="h-7 w-7" />
                </button>
              </div>
            )}

            {settings.show_translation && currentWord.translation && (
              <div className="text-center py-3 space-y-1">
                <h2 className="text-3xl md:text-4xl font-bold text-gray-800 tracking-wide">
                  {currentWord.translation}
                </h2>
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
              </div>
            )}

            <QuizAnswerInput
              value={typedByItem[currentWord.content_item_id] || ""}
              expectedAnswer={currentWord.text}
              onChange={(next) =>
                setTypedByItem((m) => ({
                  ...m,
                  [currentWord.content_item_id]: next,
                }))
              }
              // 訂正模式：Enter/Send 即送出當題對答案；一般模式只暫存/跳題，
              // 整卷送出統一由下方「提交」鈕觸發。
              onSubmit={
                isRevision
                  ? handleRevisionCheck
                  : isLast
                    ? () => persistAnswer()
                    : () => goTo(currentIndex + 1)
              }
              // 最後一題（非訂正）隱藏卡片上的 inline 送出鈕 —
              // 整卷送出由下方「提交」鈕負責，避免兩顆按鈕重複
              hideSubmitButton={isLast && !isRevision}
              // 訂正模式已答對的題目鎖定唯讀，不可再改
              disabled={isRevision && currentResolved}
              submitting={submittingAnswer}
              state={
                showCorrectness && currentCorrect === true
                  ? "correct"
                  : showCorrectness && currentCorrect === false
                    ? "wrong"
                    : "neutral"
              }
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

          {/* Card footer: 只剩提交鈕（prev/next 已移到卡片左右兩側）#830。
              一般模式僅最後一題顯示；訂正模式全程顯示，唯有全部改對才可點擊。 */}
          {(isRevision || isLast) && (
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
  );
}
