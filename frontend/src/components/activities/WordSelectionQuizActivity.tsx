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
 *   - #844 長選項（任一選項 ≥5 詞）拿足寬度：有題目圖關閉橫式改圖在上、選項單欄；
 *     無題目圖則固定 2×2（不升 4 欄）。字級用 fit-to-box（撐大／縮到塞得下／不裁字）
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
import { useQuizNavSlot } from "@/contexts/QuizNavSlotContext";
import { cn } from "@/lib/utils";
import CountdownRing from "./shared/CountdownRing";
import CardNavArrow from "./shared/CardNavArrow";
import WordSelectionOptionButton from "./shared/WordSelectionOptionButton";
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
  const showQuestionImage = settings.show_image && !!currentWord.image_url;
  // Issue #844: 任一非圖片選項 ≥5 詞（≥4 空格）→ 視為長選項。長選項一律單欄
  // 拿全寬（窄螢幕、或圖在上時），讓長句有整列寬度好換行、字級不被擠小。
  const hasLongOption =
    !settings.show_option_images &&
    (currentWord.options ?? []).some(
      (o) => (o.text?.trim().split(/\s+/).length ?? 0) >= 5,
    );
  // Issue #844: 任一非圖片選項字元數 >5 → 手機版（窄螢幕）由 2×2 改單欄，避免擠；
  // sm 以上維持 2×2 / 4 欄。與 hasLongOption（≥5 詞）獨立。
  const hasOver5CharOption =
    !settings.show_option_images &&
    (currentWord.options ?? []).some((o) => (o.text?.trim().length ?? 0) > 5);
  // 直式優先；題目有圖 + 矮橫螢幕（手機橫放）才走橫式（圖左、選項右）。
  // #844：長選項時關閉橫式 → 圖回到上方，下方選項拿全寬單欄。
  const useHorizontal =
    showQuestionImage && isShortLandscape && !hasLongOption;
  // Issue #830 訂正模式 gating + 揭示
  const currentCorrect = correctByItem[currentWord.content_item_id];
  const currentResolved = currentCorrect === true;
  const everyResolved = allCorrect(words, correctByItem);
  const showCorrectness = settings.show_answer || isRevision;
  // 訂正模式下已作答（對或錯）→ 揭示選項正解（參考艾賓浩斯）
  const revealCurrent =
    isRevision && (currentCorrect === true || currentCorrect === false);

  // 題號 bar：Page 提供 slot 時 portal 上去；否則 inline render（fallback）
  const navBar = (
    <>
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
                  : showCorrectness && priorCorrect === true
                    ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                    : showCorrectness && priorCorrect === false
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
            {settings.show_image && currentWord.image_url && (
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
                      : "max-h-[clamp(8rem,38vh,22rem)] w-auto",
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

              {/* show_image=true → 顯示翻譯（圖+翻譯，避免英文選項秒解）；否則顯示英文題 */}
              {!settings.play_audio && (
                <div className="text-center py-4 sm:py-6">
                  <h2 className="text-[clamp(2rem,9vh,6rem)] font-bold text-gray-800 select-none">
                    {settings.show_image
                      ? currentWord.translation
                      : currentWord.text}
                  </h2>
                </div>
              )}

              <div
                className={cn(
                  "grid gap-3 sm:gap-4 flex-1 min-h-0",
                  // #844 版面矩陣（有無題目圖 × 是否長選項）：
                  // - 圖左 + 短選項：右側單欄 grid-cols-1
                  // - 長選項 + 有題目圖：圖在上、選項單欄拿全寬 grid-cols-1
                  // - 長選項 + 無題目圖：2×2（grid-cols-2，不升 4 欄，長文字才有寬度）
                  // - 短選項但字元 >5：手機單欄、sm 2×2、寬螢幕 1×4
                  // - 短選項（一般）：窄螢幕 2×2、寬螢幕 1×4
                  useHorizontal
                    ? "grid-cols-1"
                    : hasLongOption
                      ? showQuestionImage
                        ? "grid-cols-1"
                        : "grid-cols-2"
                      : hasOver5CharOption
                        ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
                        : "grid-cols-2 lg:grid-cols-4",
                )}
                // #844：列高鎖 minmax(0,1fr) 不被文字撐大 → fit-to-box 有固定框可量、不爆版
                style={{ gridAutoRows: "minmax(0, 1fr)" }}
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
