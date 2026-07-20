/**
 * WordSelectionQuizActivity — 單字選擇·小考
 *
 * Issue #828：與艾賓浩斯版本 (WordSelectionActivity) 並排存在。小考行為：
 *   - 一次拉回 content 全部題目，附 question_number；每題附 4 個選項
 *   - 上方題號 bar：可任意跳題、改答案
 *   - 末題顯示「提交」鈕；提交後 status=SUBMITTED 鎖定
 *   - 不更新 memory_strength；答案寫進 practice_answers (type=word_selection_quiz)
 *   - 單字卡樣式對齊艾賓浩斯版：共用 shared/WordSelectionOptionButton
 *     （4 色循環、border-2/rounded-2xl/shadow、字級用 cqh+cqw min() 自適應、ring 選中態）
 *     + useShortLandscape 走橫式排版（圖左、選項右 2×2）
 *   - #844 欄數固定（不依字長翻轉）：手機單欄、平板 2×2、桌機 4 欄；長選項另把題目圖移到上方。
 *     字級用 fit-to-box（撐大／縮／不裁字）
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

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiClient } from "@/lib/api";
import { withDemoOverrides } from "@/lib/demoOverrides";
import { useQuizNavSlot } from "@/contexts/QuizNavSlotContext";
import { cn } from "@/lib/utils";
import CountdownRing from "./shared/CountdownRing";
import CardNavArrow from "./shared/CardNavArrow";
import WordSelectionOptionButton from "./shared/WordSelectionOptionButton";
import ClozeBlankText from "./shared/ClozeBlankText";
import { buildBlankedSentence } from "@/lib/cloze";
import { useShortLandscape } from "./shared/useShortLandscape";
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

interface QuizOption {
  text: string;
  image_url?: string | null;
}

interface QuizWord {
  content_item_id: number;
  text: string;
  translation: string;
  correct_text: string;
  audio_url?: string | null;
  image_url?: string | null;
  options: QuizOption[];
  question_number: number;
  prior_answer?: string | null;
  prior_is_correct?: boolean | null;
  // Issue #860: 顯示例句（答案挖空）用。blanked_sentence 由後端算好；
  // 老師派發預覽等只有原始教材的路徑沒有此欄位，前端才自行挖空。
  example_sentence?: string | null;
  cloze_answer?: string | null;
  blanked_sentence?: string | null;
}

interface StartResponse {
  session_id: number;
  practice_mode: "word_selection_quiz";
  words: QuizWord[];
  total_questions: number;
  show_word: boolean;
  show_image: boolean;
  show_option_images: boolean;
  show_example_sentence: boolean;
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

export default function WordSelectionQuizActivity({
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
  const [selectedByItem, setSelectedByItem] = useState<Record<number, string>>(
    {},
  );
  const [correctByItem, setCorrectByItem] = useState<
    Record<number, boolean | null>
  >({});
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  interface SelectionReviewWord extends QuizReviewWord {
    text: string;
    translation: string;
    options: { text: string; image_url?: string | null }[];
    image_url?: string | null;
  }
  const [reviewData, setReviewData] =
    useState<QuizReviewPayload<SelectionReviewWord> | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [settings, setSettings] = useState({
    show_word: true,
    show_image: true,
    show_option_images: false,
    show_example_sentence: false,
    play_audio: false,
    show_answer: false,
  });
  const [initialRemaining, setInitialRemaining] = useState<number | null>(null);
  const [timerTotal, setTimerTotal] = useState<number | null>(null);
  const completingRef = useRef(false);
  // 必須放在 early return 之前，否則違反 Rules of Hooks
  const isShortLandscape = useShortLandscape();
  const navSlot = useQuizNavSlot();
  // Issue #830: 訂正模式（退回後）— 答錯揭示正解、強制全對才能提交
  const [quizStatus, setQuizStatus] = useState<string | null>(null);
  const { isRevision } = useQuizRevision(quizStatus);

  useEffect(() => {
    if (isLivePreview) {
      setWords(previewWords || []);
      setSettings({
        show_word: previewSettings?.show_word ?? true,
        show_image: previewSettings?.show_image ?? true,
        show_option_images: previewSettings?.show_option_images ?? false,
        show_example_sentence: previewSettings?.show_example_sentence ?? false,
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
        if (isDemoMode) {
          // #923: public demo mirrors the teacher-preview quiz-start (正解/選項,
          // non-live). No session / prior answers; answer & complete are
          // short-circuited elsewhere so nothing is persisted.
          const demo = (await apiClient.get(
            withDemoOverrides(
              `/api/demo/assignments/${assignmentId}/preview/selection-quiz-start`,
            ),
          )) as StartResponse;
          if (cancelled) return;
          setWords(demo.words);
          setSessionId(null);
          setQuizStatus(null);
          setSettings({
            show_word: demo.show_word,
            show_image: demo.show_image,
            show_option_images: demo.show_option_images,
            show_example_sentence: demo.show_example_sentence ?? false,
            play_audio: demo.play_audio,
            show_answer: demo.show_answer,
          });
          setInitialRemaining(null);
          setTimerTotal(demo.quiz_time_limit_seconds ?? null);
          return;
        }
        const data = (await apiClient.get(
          `/api/students/assignments/${assignmentId}/vocabulary/selection_quiz/start`,
        )) as StartResponse;
        if (cancelled) return;
        setWords(data.words);
        setSessionId(data.session_id);
        const initialSel: Record<number, string> = {};
        const initialCorrect: Record<number, boolean | null> = {};
        data.words.forEach((w) => {
          if (w.prior_answer != null)
            initialSel[w.content_item_id] = w.prior_answer;
          if (w.prior_is_correct != null)
            initialCorrect[w.content_item_id] = w.prior_is_correct;
        });
        setSelectedByItem(initialSel);
        setCorrectByItem(initialCorrect);
        setQuizStatus(data.status ?? null);
        // 訂正模式（退回後 RETURNED）：游標直接停在第一題錯題（略過已答對題）
        if (data.status === "RETURNED") {
          const firstWrong = firstUnresolvedIndex(data.words, initialCorrect);
          if (firstWrong >= 0) setCurrentIndex(firstWrong);
        }
        setSettings({
          show_word: data.show_word,
          show_image: data.show_image,
          show_option_images: data.show_option_images,
          show_example_sentence: data.show_example_sentence ?? false,
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
          toast.error(
            t("wordSelection.toast.loadFailed") || "Failed to load quiz",
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
  }, [
    assignmentId,
    isDemoMode,
    isLivePreview,
    previewSettings,
    previewWords,
    t,
  ]);

  const currentWord = words[currentIndex];

  const playAudio = useCallback((url?: string | null) => {
    if (!url) return;
    const audio = new Audio(url);
    audio.play().catch(() => {});
  }, []);

  const persistSelection = useCallback(
    async (selected: string): Promise<boolean | undefined> => {
      if (!currentWord || isLivePreview || isDemoMode || sessionId == null)
        return undefined;
      setSubmittingAnswer(true);
      try {
        // correctness is decided server-side; trust the response, never compute
        // & send is_correct from the client (would let a student fake 100%).
        const resp = (await apiClient.post(
          `/api/students/assignments/${assignmentId}/vocabulary/selection_quiz/answer`,
          {
            content_item_id: currentWord.content_item_id,
            selected_answer: selected,
            time_spent_seconds: 0,
            session_id: sessionId,
          },
        )) as { is_correct?: boolean };
        setCorrectByItem((m) => ({
          ...m,
          [currentWord.content_item_id]: resp?.is_correct ?? null,
        }));
        return resp?.is_correct ?? undefined;
      } catch {
        toast.error(
          t("wordSelection.toast.saveFailed") || "Failed to save answer",
        );
        return undefined;
      } finally {
        setSubmittingAnswer(false);
      }
    },
    [assignmentId, currentWord, isDemoMode, isLivePreview, sessionId, t],
  );

  const goTo = useCallback(
    (idx: number) => {
      if (idx === currentIndex || idx < 0 || idx >= words.length) return;
      setCurrentIndex(idx);
    },
    [currentIndex, words.length],
  );

  const handleSubmitAll = useCallback(async () => {
    if (isLivePreview) {
      // #861 D: 預覽提交 → 前端用目前作答組複盤資料，重用學生端 QuizReviewView，
      // 樣式與學生小考後的正解畫面完全一致（不打學生 API）。
      const norm = (s: string | null | undefined) =>
        (s ?? "").trim().toLowerCase();
      const reviewWords: SelectionReviewWord[] = words.map((w) => {
        const picked = selectedByItem[w.content_item_id] ?? null;
        const isCorrect = !!picked && norm(picked) === norm(w.correct_text);
        return {
          content_item_id: w.content_item_id,
          question_number: w.question_number,
          is_correct: isCorrect,
          student_answer: picked,
          correct_answer: w.correct_text,
          text: w.text,
          translation: w.translation,
          options: w.options,
          image_url: w.image_url ?? null,
        };
      });
      const correctCount = reviewWords.filter((w) => w.is_correct).length;
      const total = reviewWords.length;
      setReviewData({
        practice_mode: "word_selection_quiz",
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
      await apiClient.post(
        `/api/students/assignments/${assignmentId}/vocabulary/selection_quiz/complete`,
        { session_id: sessionId },
      );
      toast.success(t("wordSelection.toast.completed") || "Quiz submitted");
      onComplete?.();
    } catch {
      toast.error(t("wordSelection.toast.submitFailed") || "Submit failed");
      completingRef.current = false;
    } finally {
      setCompleting(false);
    }
  }, [
    assignmentId,
    isDemoMode,
    isLivePreview,
    onComplete,
    sessionId,
    t,
    words,
    selectedByItem,
  ]);

  // Issue #830 訂正模式：選對選項 → 自動跳「下一題錯題」；若已無錯題（剛改對的是
  // 最後一題錯題）＝整卷提交；選錯則留在原題、選項即時揭示正解（強制改對）。
  const choose = useCallback(
    async (text: string) => {
      if (!currentWord) return;
      const itemId = currentWord.content_item_id;
      // 訂正模式：已答對的題目鎖定，不可改選
      if (isRevision && correctByItem[itemId] === true) return;
      setSelectedByItem((m) => ({ ...m, [itemId]: text }));
      const isCorrect = await persistSelection(text);
      if (!isRevision || !isCorrect) return;
      // setCorrectByItem 為非同步，先把當題視為已解決再找下一題錯題
      const resolved = { ...correctByItem, [itemId]: true };
      const next = nextUnresolvedIndex(words, resolved, currentIndex);
      if (next === -1) {
        await handleSubmitAll();
      } else {
        setCurrentIndex(next);
      }
    },
    [
      currentWord,
      persistSelection,
      isRevision,
      correctByItem,
      words,
      currentIndex,
      handleSubmitAll,
    ],
  );

  const answeredCount = useMemo(
    () =>
      Object.values(selectedByItem).filter((v) => v && v.trim().length > 0)
        .length,
    [selectedByItem],
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
          `/api/students/assignments/${assignmentId}/vocabulary/selection_quiz/review`,
        )) as QuizReviewPayload<SelectionReviewWord>;
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
          <div className="space-y-2">
            <div className="text-center">
              {w.image_url && (
                <img
                  src={w.image_url}
                  alt=""
                  className="mx-auto max-h-24 object-contain"
                />
              )}
              <h3 className="text-2xl font-bold text-gray-800 select-none">
                {w.text}
              </h3>
              {w.translation && (
                <span className="text-sm text-gray-500">{w.translation}</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {w.options.map((opt) => {
                const isCorrectOption =
                  opt.text.trim().toLowerCase() ===
                  w.correct_answer.trim().toLowerCase();
                const isStudentPick =
                  w.student_answer != null &&
                  opt.text.trim().toLowerCase() ===
                    w.student_answer.trim().toLowerCase();
                return (
                  <div
                    key={opt.text}
                    className={cn(
                      "p-2 rounded border text-sm",
                      isCorrectOption
                        ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                        : isStudentPick
                          ? "border-rose-400 bg-rose-50 text-rose-800"
                          : "border-gray-200 text-gray-500",
                    )}
                  >
                    {opt.text}
                    {isCorrectOption && " ✓"}
                    {isStudentPick && !isCorrectOption && " ✗"}
                  </div>
                );
              })}
            </div>
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
  const selectedForCurrent = selectedByItem[currentWord.content_item_id];
  // Issue #860: 例句挖空題的題目是句子，不顯示圖片（即使 show_image 為 true）
  const showQuestionImage =
    settings.show_image &&
    !settings.show_example_sentence &&
    !!currentWord.image_url;
  // Issue #844: 任一非圖片選項 ≥5 詞（≥4 空格）→ 視為長選項。長選項一律單欄
  // 拿全寬（窄螢幕、或圖在上時），讓長句有整列寬度好換行、字級不被擠小。
  const hasLongOption =
    !settings.show_option_images &&
    (currentWord.options ?? []).some(
      (o) => (o.text?.trim().split(/\s+/).length ?? 0) >= 5,
    );
  // 直式優先；題目有圖 + 矮橫螢幕（手機橫放）才走橫式（圖左、選項右）。
  // #844：長選項時關閉橫式 → 圖回到上方，下方選項拿全寬單欄。
  const useHorizontal = showQuestionImage && isShortLandscape && !hasLongOption;
  // Issue #830 訂正模式 gating + 揭示
  const currentCorrect = correctByItem[currentWord.content_item_id];
  const currentResolved = currentCorrect === true;
  const everyResolved = allCorrect(words, correctByItem);
  // 訂正模式下已作答（對或錯）→ 揭示選項正解（參考艾賓浩斯）
  const revealCurrent =
    isRevision && (currentCorrect === true || currentCorrect === false);

  // 題號 bar：Page 提供 slot 時 portal 上去；否則 inline render（fallback）
  const navBar = (
    <>
      <span className="text-xs text-gray-500 mr-1 shrink-0">
        {t("wordQuiz.questionNav") || "題號"}
      </span>
      {/* #844：題號多時不換行，改水平捲動；標題／計數／計時器留在外面不被推走 */}
      <div className="flex gap-1 sm:gap-1.5 items-center overflow-x-auto min-w-0 flex-1 py-1">
        {words.map((w, idx) => {
          const answered =
            (selectedByItem[w.content_item_id] || "").trim() !== "";
          const isCurrent = idx === currentIndex;
          return (
            <button
              key={w.content_item_id}
              type="button"
              onClick={() => goTo(idx)}
              className={cn(
                "h-8 min-w-8 shrink-0 inline-flex items-center justify-center rounded text-sm font-medium border transition",
                isCurrent
                  ? "bg-emerald-500 text-white border-emerald-500"
                  : !answered
                    ? "bg-white text-gray-500 border-gray-300 hover:border-emerald-400"
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
      {/* #861 D: 預覽模式在題號列右上角提供提交鈕（前端組複盤，提交後顯示正解）。
          學生端正常作答的提交鈕屬 #844 範疇，這裡僅 isLivePreview 顯示。 */}
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
    <div className="flex flex-col gap-4 pb-6 sm:pb-8 min-h-[calc(100dvh-14rem)] max-h-[100dvh]">
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
        <CardContent className="flex-1 min-h-0 flex flex-col gap-3 px-10 sm:px-12 py-0">
          <div className="text-sm text-gray-500 shrink-0">
            {t("wordQuiz.questionLabel", {
              current: currentWord.question_number,
              total: words.length,
            }) || `第 ${currentWord.question_number} / ${words.length} 題`}
          </div>

          {isRevision && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 shrink-0">
              {t("wordQuiz.revision.hint") ||
                "訂正模式：答錯會顯示正解，全部改對才能提交"}
            </div>
          )}

          {/* 內容區：直式（圖→文→選項垂直）或橫式（圖左、文字+選項右）— 對齊艾賓浩斯版 */}
          <div
            className={cn(
              "flex-1 min-h-0",
              useHorizontal ? "flex flex-row gap-6" : "flex flex-col gap-6",
            )}
          >
            {settings.show_image &&
              !settings.show_example_sentence &&
              currentWord.image_url && (
                <div
                  className={cn(
                    "flex justify-center shrink-0",
                    useHorizontal && "w-1/2 relative min-h-48",
                  )}
                >
                  <img
                    src={currentWord.image_url}
                    alt=""
                    className={cn(
                      "object-contain rounded-lg",
                      useHorizontal
                        ? "absolute inset-0 w-full h-full"
                        : "max-h-[clamp(8rem,30vh,22rem)] w-auto",
                    )}
                  />
                </div>
              )}

            <div
              className={cn(
                "flex-1 min-h-0 flex flex-col gap-6",
                useHorizontal && "min-w-0",
              )}
            >
              {settings.play_audio && currentWord.audio_url && (
                <div className="flex justify-center">
                  <Button
                    type="button"
                    size="lg"
                    variant="outline"
                    onClick={() => playAudio(currentWord.audio_url)}
                  >
                    <Volume2 className="h-5 w-5 mr-2" />
                    {t("wordQuiz.playAudio") || "Play"}
                  </Button>
                </div>
              )}

              {/* Issue #860: 例句挖空題 → 顯示挖空後的英文例句（選項為英文單字） */}
              {settings.show_example_sentence ? (
                <div className="text-center py-4 sm:py-6">
                  <h2 className="text-[clamp(22px,7vh,28px)] font-bold text-gray-800 leading-relaxed select-none">
                    <ClozeBlankText
                      text={
                        currentWord.blanked_sentence ||
                        buildBlankedSentence(
                          currentWord.example_sentence,
                          currentWord.cloze_answer,
                          currentWord.text,
                        )
                      }
                    />
                  </h2>
                </div>
              ) : (
                /* show_image=true → 顯示翻譯（圖+翻譯，避免英文選項秒解）；否則顯示英文題 */
                !settings.play_audio && (
                  <div className="text-center py-4 sm:py-6">
                    <h2 className="text-[clamp(26px,9vh,30px)] font-bold text-gray-800 select-none">
                      {settings.show_image
                        ? currentWord.translation
                        : currentWord.text}
                    </h2>
                  </div>
                )
              )}

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
                {currentWord.options.map((opt, index) => {
                  const isSelected = selectedForCurrent === opt.text;
                  const renderAsImage =
                    settings.show_option_images && !!opt.image_url;
                  // 訂正模式作答後揭示：正解綠勾、學生答錯紅叉（參考艾賓浩斯）
                  const isCorrectOption =
                    opt.text.trim().toLowerCase() ===
                    currentWord.correct_text.trim().toLowerCase();
                  return (
                    <WordSelectionOptionButton
                      key={opt.text}
                      text={opt.text}
                      imageUrl={opt.image_url}
                      showAsImage={renderAsImage}
                      colorIndex={index}
                      isSelected={isSelected}
                      // 已答對鎖定；答錯時仍可改選正解
                      disabled={submittingAnswer || currentResolved}
                      showResult={revealCurrent}
                      showCorrect={revealCurrent && isCorrectOption}
                      showIncorrect={
                        revealCurrent && isSelected && !isCorrectOption
                      }
                      onClick={() => choose(opt.text)}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Card footer 提交鈕：#844 一般作答的最後一題改放題號列，
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
  );
}
