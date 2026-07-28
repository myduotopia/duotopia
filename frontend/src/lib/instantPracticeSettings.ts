/**
 * Shared builder for the advanced-settings ("進階設定") panel initial values.
 *
 * Used by both the teacher instant-practice preview (#854) and the public demo
 * page (#923) so the panel is seeded identically from a preview/demo response.
 */
import {
  clampPerQuestionTime,
  clampQuizTime,
  type PracticeModeSettings,
} from "@/components/assignment/practiceModeSettings";

/** Fields (all optional) a preview/demo response provides to seed the panel. */
export interface InstantPracticeSettingsInput {
  time_limit_per_question?: number;
  quiz_time_limit_seconds?: number | null;
  is_live_quiz?: boolean;
  shuffle_questions?: boolean;
  show_answer?: boolean;
  play_audio?: boolean;
  target_proficiency?: number | null;
  show_translation?: boolean;
  show_word?: boolean;
  show_image?: boolean;
  show_option_images?: boolean;
  show_example_sentence?: boolean;
}

/** Build panel initial values from a response (missing fields → sane defaults). */
export function buildInstantPracticeSettings(
  d: InstantPracticeSettingsInput,
): PracticeModeSettings {
  return {
    time_limit_per_question: clampPerQuestionTime(d.time_limit_per_question),
    quiz_time_limit_seconds: clampQuizTime(d.quiz_time_limit_seconds),
    is_live_quiz: Boolean(d.is_live_quiz),
    shuffle_questions: Boolean(d.shuffle_questions),
    show_answer: Boolean(d.show_answer),
    play_audio: Boolean(d.play_audio),
    target_proficiency: d.target_proficiency ?? 80,
    show_translation: d.show_translation ?? true,
    show_word: d.show_word ?? true,
    show_image: d.show_image ?? true,
    show_option_images: Boolean(d.show_option_images),
    show_example_sentence: Boolean(d.show_example_sentence),
  };
}
