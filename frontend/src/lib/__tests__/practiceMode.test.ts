/**
 * practiceMode helpers 單元測試（Issue #830）
 *
 * 鎖住 practice_mode → 標籤/顏色/小考判定的單一真相來源，避免 #830 之前
 * 「非 word_selection 的單字模式被誤標成單字朗讀」的漂移再發生。
 */
import { describe, it, expect } from "vitest";
import {
  isQuizMode,
  practiceModeLabelKey,
  practiceModeBadgeClass,
  QUIZ_PRACTICE_MODES,
  type PracticeMode,
} from "../practiceMode";

describe("isQuizMode", () => {
  it("為三種 *_quiz 模式回 true", () => {
    expect(isQuizMode("word_selection_quiz")).toBe(true);
    expect(isQuizMode("word_spelling_quiz")).toBe(true);
    expect(isQuizMode("word_cloze_quiz")).toBe(true);
  });

  it("為非小考的 base 模式回 false", () => {
    expect(isQuizMode("word_selection")).toBe(false);
    expect(isQuizMode("word_spelling")).toBe(false);
    expect(isQuizMode("word_cloze")).toBe(false);
    expect(isQuizMode("reading")).toBe(false);
    expect(isQuizMode("rearrangement")).toBe(false);
  });

  it("為 null / undefined / 空字串回 false（不丟錯）", () => {
    expect(isQuizMode(null)).toBe(false);
    expect(isQuizMode(undefined)).toBe(false);
    expect(isQuizMode("")).toBe(false);
  });
});

describe("QUIZ_PRACTICE_MODES", () => {
  it("剛好包含三種小考模式且都被 isQuizMode 認可", () => {
    expect(QUIZ_PRACTICE_MODES).toEqual([
      "word_selection_quiz",
      "word_spelling_quiz",
      "word_cloze_quiz",
    ]);
    QUIZ_PRACTICE_MODES.forEach((m) => expect(isQuizMode(m)).toBe(true));
  });
});

describe("practiceModeLabelKey", () => {
  it("已知模式回傳對應的 classroomDetail.contentTypes.* key", () => {
    const cases: Record<PracticeMode, string> = {
      reading: "classroomDetail.contentTypes.SPEAKING",
      rearrangement: "classroomDetail.contentTypes.REARRANGEMENT",
      word_reading: "classroomDetail.contentTypes.WORD_READING",
      word_selection: "classroomDetail.contentTypes.WORD_SELECTION",
      word_selection_quiz: "classroomDetail.contentTypes.WORD_SELECTION_QUIZ",
      word_spelling: "classroomDetail.contentTypes.WORD_SPELLING",
      word_spelling_quiz: "classroomDetail.contentTypes.WORD_SPELLING_QUIZ",
      word_cloze: "classroomDetail.contentTypes.WORD_CLOZE",
      word_cloze_quiz: "classroomDetail.contentTypes.WORD_CLOZE_QUIZ",
      tug_of_war: "classroomDetail.contentTypes.TUG_OF_WAR",
    };
    (Object.keys(cases) as PracticeMode[]).forEach((mode) => {
      expect(practiceModeLabelKey(mode)).toBe(cases[mode]);
    });
  });

  it("未知模式 / null 回空字串（讓呼叫端自行 fallback）", () => {
    expect(practiceModeLabelKey("unknown_mode")).toBe("");
    expect(practiceModeLabelKey(null)).toBe("");
    expect(practiceModeLabelKey(undefined)).toBe("");
  });
});

describe("practiceModeBadgeClass", () => {
  it("小考沿用其 base 模式的 badge 顏色", () => {
    expect(practiceModeBadgeClass("word_selection_quiz")).toBe(
      practiceModeBadgeClass("word_selection"),
    );
    expect(practiceModeBadgeClass("word_spelling_quiz")).toBe(
      practiceModeBadgeClass("word_spelling"),
    );
    expect(practiceModeBadgeClass("word_cloze_quiz")).toBe(
      practiceModeBadgeClass("word_cloze"),
    );
  });

  it("已知模式回非空且非預設灰色", () => {
    const def = practiceModeBadgeClass("unknown");
    expect(practiceModeBadgeClass("reading")).not.toBe(def);
    expect(practiceModeBadgeClass("reading")).toContain("blue");
  });

  it("未知模式 / null 回預設中性灰", () => {
    const def = practiceModeBadgeClass("unknown");
    expect(def).toContain("gray");
    expect(practiceModeBadgeClass(null)).toBe(def);
    expect(practiceModeBadgeClass(undefined)).toBe(def);
  });
});
