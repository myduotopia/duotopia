/**
 * WordSelectionQuizActivity — 單字選擇·小考
 *
 * Issue #828：與艾賓浩斯版本 (WordSelectionActivity) 並排存在。小考行為：
 *   - 一次拉回 content 全部題目，附 question_number；每題附 4 個選項
 *   - 上方題號 bar：可任意跳題、改答案
 *   - 末題顯示「提交」鈕；提交後 status=SUBMITTED 鎖定
 *   - 不更新 memory_strength；答案寫進 practice_answers (type=word_selection_quiz)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import CountdownRing from "./shared/CountdownRing";
import QuizReviewView, {
  type QuizReviewPayload,
  type QuizReviewWord,
} from "./shared/QuizReviewView";
import { useQuizTimer } from "./shared/useQuizTimer";

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
}

interface StartResponse {
  session_id: number;
  practice_mode: "word_selection_quiz";
  words: QuizWord[];
  total_questions: number;
  show_word: boolean;
  show_image: boolean;
  show_option_images: boolean;
  play_audio: boolean;
  show_answer: boolean;
  time_limit_per_question?: number | null;
  shuffle_questions: boolean;
  quiz_time_limit_seconds?: number | null;
  time_remaining_seconds?: number | null;
}

interface Props {
  assignmentId: number;
  isPreviewMode?: boolean;
  isDemoMode?: boolean;
  onComplete?: () => void;
  previewWords?: QuizWord[];
  previewSettings?: Partial<StartResponse>;
}

export default function WordSelectionQuizActivity({
  assignmentId,
  isPreviewMode: _isPreviewMode = false,
  isDemoMode = false,
  onComplete,
  previewWords,
  previewSettings,
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
    play_audio: false,
    show_answer: false,
  });
  const [initialRemaining, setInitialRemaining] = useState<number | null>(null);
  const [timerTotal, setTimerTotal] = useState<number | null>(null);
  const completingRef = useRef(false);

  useEffect(() => {
    if (isLivePreview) {
      setWords(previewWords || []);
      setSettings({
        show_word: previewSettings?.show_word ?? true,
        show_image: previewSettings?.show_image ?? true,
        show_option_images: previewSettings?.show_option_images ?? false,
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
        setSettings({
          show_word: data.show_word,
          show_image: data.show_image,
          show_option_images: data.show_option_images,
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
  }, [assignmentId, isLivePreview, previewSettings, previewWords, t]);

  const currentWord = words[currentIndex];

  const playAudio = useCallback((url?: string | null) => {
    if (!url) return;
    const audio = new Audio(url);
    audio.play().catch(() => {});
  }, []);

  const persistSelection = useCallback(
    async (selected: string) => {
      if (!currentWord || isLivePreview || isDemoMode || sessionId == null)
        return;
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
      } catch {
        toast.error(
          t("wordSelection.toast.saveFailed") || "Failed to save answer",
        );
      } finally {
        setSubmittingAnswer(false);
      }
    },
    [assignmentId, currentWord, isDemoMode, isLivePreview, sessionId, t],
  );

  const choose = useCallback(
    async (text: string) => {
      if (!currentWord) return;
      setSelectedByItem((m) => ({
        ...m,
        [currentWord.content_item_id]: text,
      }));
      await persistSelection(text);
    },
    [currentWord, persistSelection],
  );

  const goTo = useCallback(
    (idx: number) => {
      if (idx === currentIndex || idx < 0 || idx >= words.length) return;
      setCurrentIndex(idx);
    },
    [currentIndex, words.length],
  );

  const handleSubmitAll = useCallback(async () => {
    if (isLivePreview || isDemoMode) {
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
  }, [assignmentId, isDemoMode, isLivePreview, onComplete, sessionId, t]);

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

  return (
    <div className="flex flex-col gap-4 min-h-[calc(100dvh-8rem)]">
      <div className="flex flex-wrap gap-1 sm:gap-1.5 items-center">
        <span className="text-xs text-gray-500 mr-1">
          {t("wordQuiz.questionNav") || "題號"}
        </span>
        {words.map((w, idx) => {
          const answered =
            (selectedByItem[w.content_item_id] || "").trim() !== "";
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
                  ? "bg-emerald-500 text-white border-emerald-500"
                  : !answered
                    ? "bg-white text-gray-500 border-gray-300 hover:border-emerald-400"
                    : settings.show_answer && priorCorrect === true
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                      : settings.show_answer && priorCorrect === false
                        ? "bg-rose-50 text-rose-700 border-rose-300"
                        : "bg-emerald-50 text-emerald-700 border-emerald-300",
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
      </div>

      <Card className="p-4 flex-1 min-h-0 flex flex-col">
        <CardContent className="flex-1 min-h-0 flex flex-col gap-6 p-0">
          <div className="text-sm text-gray-500">
            {t("wordQuiz.questionLabel", {
              current: currentWord.question_number,
              total: words.length,
            }) || `第 ${currentWord.question_number} / ${words.length} 題`}
          </div>

          {settings.show_image && currentWord.image_url && (
            <img
              src={currentWord.image_url}
              alt=""
              className="mx-auto max-h-[35vh] w-auto object-contain shrink-0"
            />
          )}

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

          {/* 樣式對齊 WordSelectionActivity (艾賓浩斯版)：text-3xl font-bold
              show_image=true → 顯示翻譯（題目為圖+翻譯，避免英文選項秒解）；否則顯示英文題 */}
          {!settings.play_audio && (
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-800 select-none">
                {settings.show_image
                  ? currentWord.translation
                  : currentWord.text}
              </h2>
            </div>
          )}

          <div
            // 寬螢幕（lg ≥ 1024px，平板橫放/桌機）→ 1×4；窄螢幕（手機直立/平板直立）→ 2×2
            className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-1 min-h-0"
            style={{ gridAutoRows: "1fr" }}
          >
            {currentWord.options.map((opt) => {
              const isSelected = selectedForCurrent === opt.text;
              const renderAsImage =
                settings.show_option_images && !!opt.image_url;
              return (
                <button
                  key={opt.text}
                  type="button"
                  disabled={submittingAnswer}
                  onClick={() => choose(opt.text)}
                  className={cn(
                    "h-full min-h-[5rem] py-3 px-3 sm:py-4 sm:px-4 rounded-lg border text-base transition",
                    "flex flex-col items-center justify-center gap-1 overflow-hidden",
                    isSelected
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-gray-200 hover:border-emerald-400",
                  )}
                >
                  {renderAsImage && opt.image_url ? (
                    <div className="flex flex-col items-center justify-center gap-1 w-full min-h-0 flex-1">
                      <img
                        src={opt.image_url}
                        alt={opt.text}
                        className="flex-1 min-h-0 w-full object-contain"
                      />
                      <span className="shrink-0 text-sm leading-tight break-words line-clamp-2">
                        {opt.text}
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm sm:text-base leading-tight break-words line-clamp-3">
                      {opt.text}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2 justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={currentIndex === 0 || submittingAnswer}
          onClick={() => goTo(currentIndex - 1)}
        >
          {t("wordQuiz.prev") || "上一題"}
        </Button>
        {isLast ? (
          <Button
            type="button"
            onClick={handleSubmitAll}
            disabled={completing || submittingAnswer}
          >
            {completing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {t("wordQuiz.submit") || "提交"}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => goTo(currentIndex + 1)}
            disabled={submittingAnswer}
          >
            {t("wordQuiz.next") || "下一題"}
          </Button>
        )}
      </div>
    </div>
  );
}
