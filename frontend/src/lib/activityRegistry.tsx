/**
 * activityRegistry — practice_mode → 渲染元件的單一真相源（#854 Stage 4 / B2）
 *
 * 背景：原本有兩條各自手寫的 ternary 鏈在決定「某 practice_mode 該渲染哪個元件」——
 * 派發 dialog 即時預覽（router #2，AssignmentDialog）與學生/老師預覽/即刻練習/demo
 * 共用的 renderActivityContent（router #1，StudentActivityPageContent）。兩條鏈會漂移
 * （#846 根因）。此檔把「mode → 元件 + 設定形狀」集中，讓各 router 只保留薄 dispatch。
 *
 * 注意：兩 router 渲染的是「不同元件集」（router #2 用 contentId 驅動的 *Preview；
 * router #1 用真實 *Activity，quiz 在 preview 用 *QuizPreview 包裝），所以這裡按用途
 * 分開匯出，不是「一個 mode 一顆元件」。
 *
 * B2-a（本檔目前範圍）：派發 dialog 即時預覽（router #2）。各模式 props 形狀不一致，
 * 故 entry 為 render 函式（逐字鏡射 AssignmentDialog 原本的 props）。
 * B2-b（後續）：router #1 的 word/quiz 分支。
 */
import type { ReactNode } from "react";
import type { PracticeMode } from "@/lib/practiceMode";
import WordReadingPreview from "@/components/activities/WordReadingPreview";
import WordSelectionPreview from "@/components/activities/WordSelectionPreview";
import WordSpellingPreview from "@/components/activities/WordSpellingPreview";
import WordClozeContextPreview from "@/components/activities/WordClozeContextPreview";
import WordSelectionQuizPreview from "@/components/activities/WordSelectionQuizPreview";
import WordSpellingQuizPreview from "@/components/activities/WordSpellingQuizPreview";
import WordClozeQuizPreview from "@/components/activities/WordClozeQuizPreview";
import RearrangementPreview from "@/components/activities/RearrangementPreview";
import ReadingPreview from "@/components/activities/ReadingPreview";

/** 派發預覽用的設定子集（鏡射 AssignmentDialog 的 formData 相關欄位/型別）。 */
export interface DispatchPreviewSettings {
  time_limit_per_question: 0 | 10 | 20 | 30 | 40;
  show_image: boolean;
  show_translation: boolean;
  show_word: boolean;
  show_option_images: boolean;
  play_audio: boolean;
  show_answer: boolean;
  target_proficiency: number;
  shuffle_questions: boolean;
}

export interface DispatchPreviewCtx {
  /** 購物車第一筆 content（可能 undefined）。 */
  contentId?: number;
  /** 單字集模式無 content 時的 fallback contentId（PREVIEW_VOCAB_CONTENT_ID）。 */
  vocabFallbackContentId: number;
  settings: DispatchPreviewSettings;
}

/**
 * 派發 dialog 即時預覽（router #2）：practice_mode → 預覽元件 render。
 * 逐字鏡射 AssignmentDialog 原 ternary 的 props（word_* 用 contentId ?? fallback；
 * reading/rearrangement 用 contentId 不 fallback）。未列入者 = 該模式無預覽（走 fallback）。
 */
export const DISPATCH_PREVIEW: Partial<
  Record<PracticeMode, (ctx: DispatchPreviewCtx) => ReactNode>
> = {
  word_reading: ({ contentId, vocabFallbackContentId, settings }) => (
    <WordReadingPreview
      contentId={contentId ?? vocabFallbackContentId}
      settings={{
        time_limit_per_question: settings.time_limit_per_question,
        show_image: settings.show_image,
        show_translation: settings.show_translation,
        shuffle_questions: settings.shuffle_questions,
      }}
    />
  ),
  word_selection_quiz: ({ contentId, vocabFallbackContentId, settings }) => (
    <WordSelectionQuizPreview
      contentId={contentId ?? vocabFallbackContentId}
      settings={{
        show_word: settings.show_word,
        show_image: settings.show_image,
        show_option_images: settings.show_option_images,
        play_audio: settings.play_audio,
        show_answer: settings.show_answer,
        time_limit_per_question: settings.time_limit_per_question,
        shuffle_questions: settings.shuffle_questions,
      }}
    />
  ),
  word_selection: ({ contentId, vocabFallbackContentId, settings }) => (
    <WordSelectionPreview
      contentId={contentId ?? vocabFallbackContentId}
      settings={{
        show_image: settings.show_image,
        show_option_images: settings.show_option_images,
        play_audio: settings.play_audio,
        target_proficiency: settings.target_proficiency,
        time_limit_per_question: settings.time_limit_per_question,
        shuffle_questions: settings.shuffle_questions,
      }}
    />
  ),
  word_spelling_quiz: ({ contentId, vocabFallbackContentId, settings }) => (
    <WordSpellingQuizPreview
      contentId={contentId ?? vocabFallbackContentId}
      settings={{
        show_translation: settings.show_translation,
        show_image: settings.show_image,
        play_audio: settings.play_audio,
        show_answer: settings.show_answer,
        time_limit_per_question: settings.time_limit_per_question,
        shuffle_questions: settings.shuffle_questions,
      }}
    />
  ),
  word_spelling: ({ contentId, vocabFallbackContentId, settings }) => (
    <WordSpellingPreview
      contentId={contentId ?? vocabFallbackContentId}
      settings={{
        show_translation: settings.show_translation,
        show_image: settings.show_image,
        play_audio: settings.play_audio,
        show_answer: settings.show_answer,
        target_proficiency: settings.target_proficiency,
        time_limit_per_question: settings.time_limit_per_question,
        shuffle_questions: settings.shuffle_questions,
      }}
    />
  ),
  word_cloze_quiz: ({ contentId, vocabFallbackContentId, settings }) => (
    <WordClozeQuizPreview
      contentId={contentId ?? vocabFallbackContentId}
      settings={{
        show_translation: settings.show_translation,
        play_audio: settings.play_audio,
        show_answer: settings.show_answer,
        time_limit_per_question: settings.time_limit_per_question,
        shuffle_questions: settings.shuffle_questions,
      }}
    />
  ),
  word_cloze: ({ contentId, vocabFallbackContentId, settings }) => (
    <WordClozeContextPreview
      contentId={contentId ?? vocabFallbackContentId}
      settings={{
        show_translation: settings.show_translation,
        play_audio: settings.play_audio,
        show_answer: settings.show_answer,
        target_proficiency: settings.target_proficiency,
        time_limit_per_question: settings.time_limit_per_question,
        shuffle_questions: settings.shuffle_questions,
      }}
    />
  ),
  rearrangement: ({ contentId, settings }) => (
    <RearrangementPreview
      contentId={contentId}
      shuffleQuestions={settings.shuffle_questions}
      timeLimitPerQuestion={settings.time_limit_per_question}
      playAudio={settings.play_audio}
    />
  ),
  reading: ({ contentId, settings }) => (
    <ReadingPreview
      contentId={contentId}
      shuffleQuestions={settings.shuffle_questions}
      timeLimitPerQuestion={settings.time_limit_per_question}
    />
  ),
};
