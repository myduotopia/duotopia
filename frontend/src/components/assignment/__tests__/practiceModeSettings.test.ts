/**
 * practiceModeSettings 純邏輯單元測試（#878 Stage 3）
 *
 * 鎖住條件設定的耦合行為（互斥 / patch / 選中態 / 音檔鎖答案 / score 推導），
 * 這些原本散在 AssignmentDialog 各 onChange，收斂後須與舊行為逐項一致（#846 根治）。
 */
import { describe, it, expect } from "vitest";
import type { SettingSpec } from "@/lib/practiceMode";
import {
  applySettingChange,
  clampPerQuestionTime,
  clampQuizTime,
  isSegmentedOptionActive,
  isShowAnswerLockedByAudio,
  segmentedScoreCategory,
  type PracticeModeSettings,
} from "../practiceModeSettings";

const base: PracticeModeSettings = {
  time_limit_per_question: 30,
  quiz_time_limit_seconds: 0,
  shuffle_questions: false,
  show_answer: false,
  play_audio: false,
  target_proficiency: 80,
  show_translation: true,
  show_word: true,
  show_image: true,
  show_option_images: false,
};

const SHOW_IMAGE: SettingSpec = {
  kind: "toggle",
  key: "show_image",
  excludes: ["show_option_images"],
};
const SHOW_OPTION_IMAGES: SettingSpec = {
  kind: "toggle",
  key: "show_option_images",
  excludes: ["show_image"],
};
const SHUFFLE: SettingSpec = { kind: "toggle", key: "shuffle_questions" };

const DISPLAY_TEXT: SettingSpec = {
  kind: "segmented",
  key: "show_translation",
  options: [
    { value: true, labelKey: "x", patch: { play_audio: false } },
    {
      value: false,
      labelKey: "y",
      patch: { play_audio: true, show_answer: true },
    },
  ],
};
const PLAY_AUDIO: SettingSpec = {
  kind: "segmented",
  key: "play_audio",
  scoreHint: true,
  options: [
    { value: true, labelKey: "yes" },
    { value: false, labelKey: "no" },
  ],
};

describe("applySettingChange — toggle 互斥（excludes）", () => {
  it("開 show_image → 連動關 show_option_images", () => {
    const next = applySettingChange(
      { ...base, show_image: false, show_option_images: true },
      SHOW_IMAGE,
      true,
    );
    expect(next.show_image).toBe(true);
    expect(next.show_option_images).toBe(false);
  });

  it("開 show_option_images → 連動關 show_image", () => {
    const next = applySettingChange(
      { ...base, show_image: true, show_option_images: false },
      SHOW_OPTION_IMAGES,
      true,
    );
    expect(next.show_option_images).toBe(true);
    expect(next.show_image).toBe(false);
  });

  it("關閉（false）不連動重設另一邊", () => {
    const next = applySettingChange(
      { ...base, show_image: true, show_option_images: true },
      SHOW_IMAGE,
      false,
    );
    expect(next.show_image).toBe(false);
    expect(next.show_option_images).toBe(true); // 不動
  });

  it("無 excludes 的 toggle 只改自己", () => {
    const next = applySettingChange(base, SHUFFLE, true);
    expect(next.shuffle_questions).toBe(true);
    expect(next.show_image).toBe(base.show_image);
  });

  it("不 mutate 入參", () => {
    const input = { ...base, show_option_images: true };
    applySettingChange(input, SHOW_IMAGE, true);
    expect(input.show_image).toBe(true);
    expect(input.show_option_images).toBe(true);
  });
});

describe("applySettingChange — segmented patch（一鍵設多個 key）", () => {
  it("選「播放音檔」→ show_translation=false + play_audio=true + show_answer=true", () => {
    const next = applySettingChange(base, DISPLAY_TEXT, false);
    expect(next.show_translation).toBe(false);
    expect(next.play_audio).toBe(true);
    expect(next.show_answer).toBe(true);
  });

  it("選「顯示翻譯」→ show_translation=true + play_audio=false（不動 show_answer）", () => {
    const next = applySettingChange(
      { ...base, play_audio: true, show_answer: true },
      DISPLAY_TEXT,
      true,
    );
    expect(next.show_translation).toBe(true);
    expect(next.play_audio).toBe(false);
    expect(next.show_answer).toBe(true); // patch 未含 → 保留
  });
});

describe("isSegmentedOptionActive — 主 key + patch 全相符才算選中", () => {
  const optWord =
    DISPLAY_TEXT.kind === "segmented" ? DISPLAY_TEXT.options[0] : null;
  const optAudio =
    DISPLAY_TEXT.kind === "segmented" ? DISPLAY_TEXT.options[1] : null;

  it("顯示翻譯態：show_translation=true ∧ play_audio=false → 第一顆選中、第二顆未選", () => {
    const v = { ...base, show_translation: true, play_audio: false };
    expect(isSegmentedOptionActive(v, DISPLAY_TEXT as never, optWord!)).toBe(
      true,
    );
    expect(isSegmentedOptionActive(v, DISPLAY_TEXT as never, optAudio!)).toBe(
      false,
    );
  });

  it("播放音檔態：show_translation=false ∧ play_audio=true → 第二顆選中", () => {
    const v = {
      ...base,
      show_translation: false,
      play_audio: true,
      show_answer: true,
    };
    expect(isSegmentedOptionActive(v, DISPLAY_TEXT as never, optAudio!)).toBe(
      true,
    );
  });
});

describe("isShowAnswerLockedByAudio — 拼寫/克漏字 + 播放音檔時鎖定", () => {
  it("word_spelling / word_cloze（含小考）+ play_audio → true", () => {
    const v = { ...base, play_audio: true };
    expect(isShowAnswerLockedByAudio("word_spelling", v)).toBe(true);
    expect(isShowAnswerLockedByAudio("word_cloze", v)).toBe(true);
    expect(isShowAnswerLockedByAudio("word_spelling_quiz", v)).toBe(true);
    expect(isShowAnswerLockedByAudio("word_cloze_quiz", v)).toBe(true);
  });

  it("無播放音檔、或非拼寫/克漏字 → false", () => {
    expect(
      isShowAnswerLockedByAudio("word_spelling", {
        ...base,
        play_audio: false,
      }),
    ).toBe(false);
    expect(
      isShowAnswerLockedByAudio("word_selection", {
        ...base,
        play_audio: true,
      }),
    ).toBe(false);
  });
});

describe("segmentedScoreCategory — 播放音檔 segmented 由規則推導", () => {
  const yes = PLAY_AUDIO.kind === "segmented" ? PLAY_AUDIO.options[0] : null;
  const no = PLAY_AUDIO.kind === "segmented" ? PLAY_AUDIO.options[1] : null;

  it("rearrangement：有音檔→聽力、無音檔→閱讀（修正舊硬寫「寫作」）", () => {
    expect(
      segmentedScoreCategory("rearrangement", PLAY_AUDIO as never, yes!, base),
    ).toBe("listening");
    expect(
      segmentedScoreCategory("rearrangement", PLAY_AUDIO as never, no!, base),
    ).toBe("reading");
  });
});

describe("clampPerQuestionTime / clampQuizTime — API 時間值夾到合法選項（#879 review）", () => {
  it("合法值原樣保留", () => {
    expect(clampPerQuestionTime(20)).toBe(20);
    expect(clampQuizTime(300)).toBe(300);
  });

  it("非選項值夾到最近的合法選項", () => {
    expect(clampPerQuestionTime(15)).toBe(10); // 15 → 10 與 20 等距，reduce 嚴格小於保留先到的 10
    expect(clampPerQuestionTime(13)).toBe(10);
    expect(clampPerQuestionTime(26)).toBe(30);
    expect(clampQuizTime(200)).toBe(180);
    expect(clampQuizTime(2000)).toBe(1800);
  });

  it("非數字 / null / undefined → fallback", () => {
    expect(clampPerQuestionTime(undefined)).toBe(30);
    expect(clampPerQuestionTime(null)).toBe(30);
    expect(clampPerQuestionTime("abc")).toBe(30);
    expect(clampQuizTime(undefined)).toBe(0);
  });
});
