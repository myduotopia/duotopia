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
  PRACTICE_MODE_REGISTRY,
  getModeConfig,
  listModesForDataset,
  resolveScoreCategoryFE,
  applyModeDefaults,
  isAutoScoredMode,
  isGradableMode,
  type PracticeMode,
} from "../practiceMode";
import {
  getScoreCategory,
  type ScoreCategory,
} from "../../utils/scoreCategory";

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

// ============================================================================
// #878 Stage 1 — registry 收斂 + 規則化 scoreCategory
// ============================================================================

const ALL_MODES: PracticeMode[] = [
  "reading",
  "rearrangement",
  "word_reading",
  "word_selection",
  "word_selection_quiz",
  "word_spelling",
  "word_spelling_quiz",
  "word_cloze",
  "word_cloze_quiz",
  "tug_of_war",
];

describe("PRACTICE_MODE_REGISTRY", () => {
  it("涵蓋全部 10 個 PracticeMode，無遺漏", () => {
    expect(Object.keys(PRACTICE_MODE_REGISTRY).sort()).toEqual(
      [...ALL_MODES].sort(),
    );
  });

  it("小考的 baseMode 指向其 base 模式、isQuiz 為 true", () => {
    expect(PRACTICE_MODE_REGISTRY.word_selection_quiz.baseMode).toBe(
      "word_selection",
    );
    expect(PRACTICE_MODE_REGISTRY.word_spelling_quiz.baseMode).toBe(
      "word_spelling",
    );
    expect(PRACTICE_MODE_REGISTRY.word_cloze_quiz.baseMode).toBe("word_cloze");
    QUIZ_PRACTICE_MODES.forEach((m) =>
      expect(PRACTICE_MODE_REGISTRY[m].isQuiz).toBe(true),
    );
  });

  it("getModeConfig：已知回 config、未知/null 回 undefined", () => {
    expect(getModeConfig("reading")).toBe(PRACTICE_MODE_REGISTRY.reading);
    expect(getModeConfig("unknown_mode")).toBeUndefined();
    expect(getModeConfig(null)).toBeUndefined();
    expect(getModeConfig(undefined)).toBeUndefined();
  });
});

describe("listModesForDataset", () => {
  it("例句集只給非 word_ 模式（reading / rearrangement）", () => {
    expect(listModesForDataset("example_sentences")).toEqual([
      "reading",
      "rearrangement",
    ]);
  });

  it("單字集給全部 9 個可派發模式（依 chip 順序，排除 tug_of_war）", () => {
    expect(listModesForDataset("vocabulary_set")).toEqual([
      "reading",
      "rearrangement",
      "word_reading",
      "word_selection",
      "word_selection_quiz",
      "word_spelling",
      "word_spelling_quiz",
      "word_cloze",
      "word_cloze_quiz",
    ]);
  });
});

describe("applyModeDefaults", () => {
  it("帶出 chip onClick 既有的 per-mode 預設", () => {
    expect(applyModeDefaults("reading")).toEqual({
      practice_mode: "reading",
      time_limit_per_question: 30,
    });
    expect(applyModeDefaults("word_reading")).toEqual({
      practice_mode: "word_reading",
      time_limit_per_question: 10,
    });
    // 無 onClick 覆寫者只帶 practice_mode
    expect(applyModeDefaults("rearrangement")).toEqual({
      practice_mode: "rearrangement",
    });
    // 完整覆寫（艾賓浩斯拼寫）
    expect(applyModeDefaults("word_spelling")).toEqual({
      practice_mode: "word_spelling",
      time_limit_per_question: 30,
      show_translation: true,
      play_audio: false,
      show_answer: false,
      target_proficiency: 80,
      shuffle_questions: false,
    });
    // 小考無 target_proficiency
    expect(applyModeDefaults("word_spelling_quiz")).not.toHaveProperty(
      "target_proficiency",
    );
  });
});

describe("isAutoScoredMode（registry 推導，行為不變）", () => {
  it("朗讀類（reading / word_reading）非自動計分", () => {
    expect(isAutoScoredMode("reading")).toBe(false);
    expect(isAutoScoredMode("word_reading")).toBe(false);
  });
  it("其餘 base 模式 + 三種小考 + tug_of_war 皆自動計分", () => {
    [
      "rearrangement",
      "word_selection",
      "word_spelling",
      "word_cloze",
      "tug_of_war",
      "word_selection_quiz",
      "word_spelling_quiz",
      "word_cloze_quiz",
    ].forEach((m) => expect(isAutoScoredMode(m)).toBe(true));
  });
  it("未知 *_quiz 字串維持舊行為（true）、其他未知 / null 回 false", () => {
    expect(isAutoScoredMode("future_quiz")).toBe(true);
    expect(isAutoScoredMode("future_mode")).toBe(false);
    expect(isAutoScoredMode(null)).toBe(false);
  });
});

describe("isGradableMode（= reading / word_reading / rearrangement）", () => {
  it("僅三個可點進批改的模式回 true", () => {
    expect(isGradableMode("reading")).toBe(true);
    expect(isGradableMode("word_reading")).toBe(true);
    expect(isGradableMode("rearrangement")).toBe(true);
  });
  it("其餘 / 未知 / null 回 false", () => {
    expect(isGradableMode("word_selection")).toBe(false);
    expect(isGradableMode("word_cloze_quiz")).toBe(false);
    expect(isGradableMode("unknown")).toBe(false);
    expect(isGradableMode(null)).toBe(false);
  });
});

/**
 * 後端 `resolve_score_category` 對照表（backend/tests/unit/test_score_category.py 同步）。
 * 每組 (mode, play_audio) 都鎖死，確保前端規則與後端逐格等價。
 */
const SCORE_TABLE: Record<
  PracticeMode,
  { silent: ScoreCategory; audio: ScoreCategory }
> = {
  reading: { silent: "speaking", audio: "speaking" },
  word_reading: { silent: "speaking", audio: "speaking" },
  // #878：克漏字＝打字填空 → 套通則（無音檔 writing、有音檔 listening）
  word_cloze: { silent: "writing", audio: "listening" },
  word_cloze_quiz: { silent: "writing", audio: "listening" },
  rearrangement: { silent: "reading", audio: "listening" },
  // #878：word_selection(_quiz) 無音檔由 writing 改為 reading
  word_selection: { silent: "reading", audio: "listening" },
  word_selection_quiz: { silent: "reading", audio: "listening" },
  word_spelling: { silent: "writing", audio: "listening" },
  word_spelling_quiz: { silent: "writing", audio: "listening" },
  tug_of_war: { silent: "writing", audio: "listening" },
};

describe("resolveScoreCategoryFE（鏡射後端 resolve_score_category）", () => {
  it("每組 (mode, play_audio) 與後端對照表逐格相等", () => {
    ALL_MODES.forEach((mode) => {
      expect(resolveScoreCategoryFE(mode, false)).toBe(
        SCORE_TABLE[mode].silent,
      );
      expect(resolveScoreCategoryFE(mode, true)).toBe(SCORE_TABLE[mode].audio);
    });
  });

  it("邊界：未知 / 空 / null mode 走一般規則（writing / listening）", () => {
    expect(resolveScoreCategoryFE(null, false)).toBe("writing");
    expect(resolveScoreCategoryFE(null, true)).toBe("listening");
    expect(resolveScoreCategoryFE("", false)).toBe("writing");
    expect(resolveScoreCategoryFE("future_mode", true)).toBe("listening");
  });

  it("邊界：大小寫正規化、null audio 視為關閉", () => {
    expect(resolveScoreCategoryFE("WORD_READING", true)).toBe("speaking");
    expect(resolveScoreCategoryFE("rearrangement", null)).toBe("reading");
  });
});

describe("resolveScoreCategoryFE === getScoreCategory（兩實作不漂移）", () => {
  it("全模式 × play_audio 矩陣 + 邊界值皆相等", () => {
    const audioValues = [false, true, null, undefined];
    ALL_MODES.forEach((mode) => {
      audioValues.forEach((audio) => {
        expect(resolveScoreCategoryFE(mode, audio)).toBe(
          getScoreCategory(mode, audio),
        );
      });
    });
    // 邊界 mode 也比對
    ["", null, undefined, "WORD_READING", "future_mode"].forEach((mode) => {
      [false, true].forEach((audio) => {
        expect(resolveScoreCategoryFE(mode, audio)).toBe(
          getScoreCategory(mode, audio),
        );
      });
    });
  });
});
