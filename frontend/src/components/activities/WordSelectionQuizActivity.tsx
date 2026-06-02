/**
 * WordSelectionQuizActivity — 單字選擇·小考
 *
 * Issue #828：與艾賓浩斯版本 (WordSelectionActivity) 並排存在。小考行為：
 *   - 一次拉回 content 全部題目，附 question_number；每題附 4 個選項
 *   - 上方題號 bar：可任意跳題、改答案
 *   - 末題顯示「提交」鈕；提交後 status=SUBMITTED 鎖定
 *   - 不更新 memory_strength；答案寫進 practice_answers (type=word_selection_quiz)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Send, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";

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
  const [settings, setSettings] = useState({
    show_word: true,
    show_image: true,
    show_option_images: false,
    play_audio: false,
  });

  useEffect(() => {
    if (isLivePreview) {
      setWords(previewWords || []);
      setSettings({
        show_word: previewSettings?.show_word ?? true,
        show_image: previewSettings?.show_image ?? true,
        show_option_images: previewSettings?.show_option_images ?? false,
        play_audio: previewSettings?.play_audio ?? false,
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
        });
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
      const isCorrect =
        selected.trim().toLowerCase() ===
        currentWord.correct_text.trim().toLowerCase();
      setSubmittingAnswer(true);
      try {
        await apiClient.post(
          `/api/students/assignments/${assignmentId}/vocabulary/selection_quiz/answer`,
          {
            content_item_id: currentWord.content_item_id,
            selected_answer: selected,
            is_correct: isCorrect,
            time_spent_seconds: 0,
            session_id: sessionId,
          },
        );
        setCorrectByItem((m) => ({
          ...m,
          [currentWord.content_item_id]: isCorrect,
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (alreadySubmitted) {
    return (
      <Card className="p-6">
        <CardContent className="text-center text-gray-700 space-y-2">
          <p className="text-lg font-semibold">
            {t("wordQuiz.locked.title") || "本次小考已提交"}
          </p>
          <p className="text-sm text-gray-500">
            {t("wordQuiz.locked.desc") || "等待老師退回後才能訂正。"}
          </p>
        </CardContent>
      </Card>
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
    <div className="space-y-4">
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
                    : priorCorrect === true
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                      : priorCorrect === false
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
      </div>

      <Card className="p-4">
        <CardContent className="space-y-4 p-0">
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
              className="mx-auto max-h-40 object-contain"
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

          {settings.show_word && (
            <div className="text-center text-lg font-medium text-gray-800">
              {currentWord.text}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {currentWord.options.map((opt) => {
              const isSelected = selectedForCurrent === opt.text;
              return (
                <button
                  key={opt.text}
                  type="button"
                  disabled={submittingAnswer}
                  onClick={() => choose(opt.text)}
                  className={cn(
                    "flex-1 p-3 rounded-lg border text-sm transition",
                    isSelected
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-gray-200 hover:border-emerald-400",
                  )}
                >
                  {settings.show_option_images && opt.image_url ? (
                    <img
                      src={opt.image_url}
                      alt={opt.text}
                      className="mx-auto max-h-24 object-contain"
                    />
                  ) : (
                    opt.text
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
