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
import {
  PRACTICE_MODE_REGISTRY,
  type PracticeDataset,
  type PracticeMode,
} from "@/lib/practiceMode";
import WordReadingPreview from "@/components/activities/WordReadingPreview";
import WordSelectionPreview from "@/components/activities/WordSelectionPreview";
import WordSpellingPreview from "@/components/activities/WordSpellingPreview";
import WordClozeContextPreview from "@/components/activities/WordClozeContextPreview";
import WordSelectionQuizPreview from "@/components/activities/WordSelectionQuizPreview";
import WordSpellingQuizPreview from "@/components/activities/WordSpellingQuizPreview";
import WordClozeQuizPreview from "@/components/activities/WordClozeQuizPreview";
import RearrangementPreview from "@/components/activities/RearrangementPreview";
import ReadingPreview from "@/components/activities/ReadingPreview";
import ScenarioDialoguePreview from "@/components/activities/ScenarioDialoguePreview";

/**
 * 我們為哪些資料集準備了「沒選教材時可以借來預覽」的範例教材。
 *
 * * `vocabulary_set` —— `PREVIEW_VOCAB_CONTENT_ID` 那份示範單字集（word_* 的 fallback）
 * * `example_sentences` —— `/api/demo/config` 的 demo 作業（reading / rearrangement 的 ByDemo）
 *
 * **新增資料集預設不在此列**，而這是刻意的：寧可少說一句，也不要對老師宣稱預覽用了
 * 一份其實不存在的範例教材。情境對話就是這樣 —— 它只吃自己的資料集，借範例單字集
 * 等於顯示一個永遠派不出去的畫面（見 `ScenarioDialoguePreview` 檔頭），所以沒選教材
 * 時它顯示的是「請先選擇教材」，不是範例內容。
 */
const DATASETS_WITH_SAMPLE_MATERIAL: ReadonlySet<PracticeDataset> =
  new Set<PracticeDataset>(["vocabulary_set", "example_sentences"]);

/**
 * 這次預覽顯示的是「範例教材」還是「老師自己選的教材」（Issue #1136）。
 *
 * 所有 wrapper 的規則一致：**拿得到 `contentId` 就用那份真實教材**，拿不到才退回
 * 範例。預覽上方的標題與免責說明要照這個結果走 —— 原本不分情況都寫「預覽使用範例
 * 教材、設定不會跟著變動」，但購物車有教材時兩句話都是錯的。
 *
 * 放在這個檔案是因為「哪個模式用哪個 wrapper」就登記在隔壁的 `DISPATCH_PREVIEW`，
 * 兩者要一起看、一起改。
 */
export function previewUsesSampleMaterial(
  mode: PracticeMode,
  contentId: number | null | undefined,
): boolean {
  if (contentId != null) return false;
  return PRACTICE_MODE_REGISTRY[mode].supportedDatasets.some((dataset) =>
    DATASETS_WITH_SAMPLE_MATERIAL.has(dataset),
  );
}

/** 派發預覽用的設定子集（鏡射 AssignmentDialog 的 formData 相關欄位/型別）。 */
export interface DispatchPreviewSettings {
  time_limit_per_question: 0 | 10 | 20 | 30 | 40;
  show_image: boolean;
  show_translation: boolean;
  show_word: boolean;
  show_option_images: boolean;
  show_example_sentence: boolean;
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
        show_example_sentence: settings.show_example_sentence,
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
        show_example_sentence: settings.show_example_sentence,
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
        show_image: settings.show_image,
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
        show_image: settings.show_image,
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
      showTranslation={settings.show_translation}
    />
  ),
  // 刻意不吃 vocabFallbackContentId：情境對話只吃自己的資料集，借示範單字集來預覽
  // 等於顯示一個永遠派不出去的畫面（見 ScenarioDialoguePreview 檔頭）。
  scenario_dialogue: ({ contentId, settings }) => (
    <ScenarioDialoguePreview
      contentId={contentId}
      timeLimitPerQuestion={settings.time_limit_per_question}
      showTranslation={settings.show_translation}
    />
  ),
};
