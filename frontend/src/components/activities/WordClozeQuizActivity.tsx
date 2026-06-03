/**
 * WordClozeQuizActivity — 單字克漏字·小考
 *
 * Issue #828：與艾賓浩斯版本 (WordClozeActivity) 並排存在。小考行為：
 *   - 一次拉回 content 全部題目，附 question_number
 *   - 上方題號 bar：可任意跳題、改答案
 *   - 末題顯示「提交」鈕；提交後 status=SUBMITTED 鎖定
 *   - 不更新 memory_strength；答案寫進 practice_answers (type=word_cloze_quiz)
 *   - 題目以 example_sentence 將 cloze_answer 挖空，學生填入正確變形
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import CountdownRing from "./shared/CountdownRing";
import QuizAnswerInput from "./shared/QuizAnswerInput";
import QuizReviewView, {
  type QuizReviewPayload,
  type QuizReviewWord,
} from "./shared/QuizReviewView";
import { useQuizTimer } from "./shared/useQuizTimer";

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
}

interface Props {
  assignmentId: number;
  isPreviewMode?: boolean;
  isDemoMode?: boolean;
  onComplete?: () => void;
  previewWords?: QuizWord[];
  previewSettings?: Partial<StartResponse>;
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
        if (code === "QUIZ_ALREADY_SUBMITTED") {
          setAlreadySubmitted(true);
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
    async (itemId: number, typed: string): Promise<boolean> => {
      if (isLivePreview || isDemoMode || sessionId == null) return true;
      const trimmed = typed.trim();
      if (!trimmed) return true;
      try {
        const data = (await apiClient.post(
          `/api/students/assignments/${assignmentId}/vocabulary/cloze_quiz/answer`,
          {
            content_item_id: itemId,
            typed_answer: trimmed,
            time_spent_seconds: 0,
            session_id: sessionId,
          },
        )) as { is_correct: boolean };
        setCorrectByItem((m) => ({ ...m, [itemId]: data.is_correct }));
        return true;
      } catch {
        return false;
      }
    },
    [assignmentId, isDemoMode, isLivePreview, sessionId],
  );

  const persistAnswer = useCallback(async (): Promise<boolean> => {
    if (!currentWord) return true;
    const typed = typedByItem[currentWord.content_item_id] || "";
    if (!typed.trim()) return true;
    setSubmittingAnswer(true);
    const ok = await persistItemAnswer(currentWord.content_item_id, typed);
    setSubmittingAnswer(false);
    if (!ok) {
      toast.error(t("wordCloze.toast.saveFailed") || "Failed to save answer");
    }
    return ok;
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

  useEffect(() => {
    if (!alreadySubmitted || isLivePreview || isDemoMode) return;
    if (reviewData || reviewLoading) return;
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
        }
      } finally {
        if (!cancelled) setReviewLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    alreadySubmitted,
    assignmentId,
    isDemoMode,
    isLivePreview,
    reviewData,
    reviewLoading,
    t,
  ]);

  // Auto-persist on typing pause (1s) — see WordSpellingQuizActivity for rationale.
  const lastPersistedRef = useRef<Record<number, string>>({});
  useEffect(() => {
    if (!currentWord || isLivePreview || isDemoMode || alreadySubmitted) return;
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
              <p className="text-lg leading-relaxed text-gray-800 font-semibold tracking-wide">
                {blanked}
              </p>
              {w.example_sentence_translation && (
                <p className="text-sm text-gray-500">
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 sm:gap-1.5 items-center">
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
                  ? "bg-pink-500 text-white border-pink-500"
                  : !answered
                    ? "bg-white text-gray-500 border-gray-300 hover:border-pink-400"
                    : settings.show_answer && priorCorrect === true
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                      : settings.show_answer && priorCorrect === false
                        ? "bg-rose-50 text-rose-700 border-rose-300"
                        : "bg-pink-50 text-pink-700 border-pink-300",
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

      <Card className="p-4">
        <CardContent className="space-y-4 p-0">
          <div className="text-sm text-gray-500">
            {t("wordQuiz.questionLabel", {
              current: currentWord.question_number,
              total: words.length,
            }) || `第 ${currentWord.question_number} / ${words.length} 題`}
          </div>

          {/* 樣式對齊 WordClozeActivity (艾賓浩斯版) */}
          {settings.play_audio && currentWord.example_sentence_audio_url && (
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
            <p className="text-lg md:text-xl leading-relaxed text-gray-800 font-semibold px-4 tracking-wide">
              {blanked}
            </p>
            {settings.show_translation &&
              currentWord.example_sentence_translation && (
                <p className="text-sm text-gray-500">
                  {currentWord.example_sentence_translation}
                </p>
              )}
          </div>

          <QuizAnswerInput
            value={typedByItem[currentWord.content_item_id] || ""}
            expectedAnswer={currentWord.cloze_answer}
            onChange={(next) =>
              setTypedByItem((m) => ({
                ...m,
                [currentWord.content_item_id]: next,
              }))
            }
            // 最後一題的 inline Send 只暫存答案，不送出整卷；整卷送出統一由
            // 下方「提交」鈕觸發，避免學生按 Enter 不小心收卷。
            onSubmit={
              isLast ? () => persistAnswer() : () => goTo(currentIndex + 1)
            }
            submitting={submittingAnswer}
            state={
              settings.show_answer &&
              correctByItem[currentWord.content_item_id] === true
                ? "correct"
                : settings.show_answer &&
                    correctByItem[currentWord.content_item_id] === false
                  ? "wrong"
                  : "neutral"
            }
            autoFocus
          />
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
