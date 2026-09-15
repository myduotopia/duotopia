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
  practiceModeDescKey,
  practiceModeBadgeClass,
  QUIZ_PRACTICE_MODES,
  PRACTICE_MODE_REGISTRY,
  getModeConfig,
  listModesForDataset,
  listAllDispatchableModes,
  isDatasetDispatchable,
  DATASET_DISPATCH_STATUS,
  contentTypeToDataset,
  DEFAULT_MODE_BY_DATASET,
  DATASET_LABEL_KEY,
  datasetLabelKeysForMode,
  resolveScoreCategoryFE,
  applyModeDefaults,
  isAutoScoredMode,
  isGradableMode,
  type PracticeMode,
  type PracticeDataset,
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
  it("已知模式回傳對應的 practiceMode.<mode>.label key", () => {
    const cases: Record<PracticeMode, string> = {
      reading: "practiceMode.reading.label",
      rearrangement: "practiceMode.rearrangement.label",
      scenario_dialogue: "practiceMode.scenario_dialogue.label",
      word_reading: "practiceMode.word_reading.label",
      word_selection: "practiceMode.word_selection.label",
      word_selection_quiz: "practiceMode.word_selection_quiz.label",
      word_spelling: "practiceMode.word_spelling.label",
      word_spelling_quiz: "practiceMode.word_spelling_quiz.label",
      word_cloze: "practiceMode.word_cloze.label",
      word_cloze_quiz: "practiceMode.word_cloze_quiz.label",
      tug_of_war: "practiceMode.tug_of_war.label",
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

describe("practiceModeDescKey", () => {
  it("已知模式回傳對應的 practiceMode.<mode>.desc key", () => {
    (Object.keys(PRACTICE_MODE_REGISTRY) as PracticeMode[]).forEach((mode) => {
      expect(practiceModeDescKey(mode)).toBe(`practiceMode.${mode}.desc`);
    });
  });

  it("未知模式 / null 回空字串", () => {
    expect(practiceModeDescKey("unknown_mode")).toBe("");
    expect(practiceModeDescKey(null)).toBe("");
    expect(practiceModeDescKey(undefined)).toBe("");
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
  "scenario_dialogue",
];

describe("PRACTICE_MODE_REGISTRY", () => {
  it("涵蓋全部 PracticeMode，無遺漏", () => {
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

describe("listAllDispatchableModes（#1052：班級頁先選方式、空購物車時的 chip 列）", () => {
  it("列出例句集與單字集的全部模式，依 chip 順序、不重複", () => {
    const modes = listAllDispatchableModes();
    expect(modes).toEqual(listModesForDataset("vocabulary_set"));
    expect(new Set(modes).size).toBe(modes.length);
    for (const m of listModesForDataset("example_sentences")) {
      expect(modes).toContain(m);
    }
  });

  it("不含開發中的情境對話，也不含不經 dialog 派發的 tug_of_war", () => {
    const modes = listAllDispatchableModes();
    expect(modes).not.toContain("scenario_dialogue");
    expect(modes).not.toContain("tug_of_war");
  });

  it("不是空的 —— 空清單就是 #1052 的症狀", () => {
    expect(listAllDispatchableModes().length).toBeGreaterThan(0);
  });
});

describe("DATASET_DISPATCH_STATUS（派發開放與否的唯一開關）", () => {
  it("例句集、單字集已開放；情境對話開發中", () => {
    expect(isDatasetDispatchable("example_sentences")).toBe(true);
    expect(isDatasetDispatchable("vocabulary_set")).toBe(true);
    expect(DATASET_DISPATCH_STATUS.scenario_dialogue).toBe("in_development");
    expect(isDatasetDispatchable("scenario_dialogue")).toBe(false);
  });
});

describe("applyModeDefaults", () => {
  it("帶出 chip onClick 既有的 per-mode 預設", () => {
    // #878：reading 預設 20 秒（10/20/30 選單）
    expect(applyModeDefaults("reading")).toEqual({
      practice_mode: "reading",
      time_limit_per_question: 20,
    });
    expect(applyModeDefaults("word_reading")).toEqual({
      practice_mode: "word_reading",
      time_limit_per_question: 10,
    });
    // 無 onClick 覆寫者只帶 practice_mode
    expect(applyModeDefaults("rearrangement")).toEqual({
      practice_mode: "rearrangement",
    });
    // 完整覆寫（艾賓浩斯拼寫；#878：打字作答預設不限時 0）
    expect(applyModeDefaults("word_spelling")).toEqual({
      practice_mode: "word_spelling",
      time_limit_per_question: 0,
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
  // #1013：情境對話＝開口錄音作答，題目音檔只是提示素材，不該翻成聽力
  scenario_dialogue: { silent: "speaking", audio: "speaking" },
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

describe("情境對話的資料集與模式對應（#1031）", () => {
  it("SCENARIO_DIALOGUE 對應到自己的資料集，不再落到 null 或單字集", () => {
    expect(contentTypeToDataset("SCENARIO_DIALOGUE")).toBe("scenario_dialogue");
    expect(contentTypeToDataset("scenario_dialogue")).toBe("scenario_dialogue");
  });

  it("情境對話仍在開發中 → 派發 chip 列不給任何模式（#1052）", () => {
    // registry 仍保留 supportedDatasets 的對應（既有作業的顯示／批改要用），
    // 只是 DATASET_DISPATCH_STATUS 還沒開放，派發清單一律過濾掉
    expect(PRACTICE_MODE_REGISTRY.scenario_dialogue.supportedDatasets).toEqual([
      "scenario_dialogue",
    ]);
    expect(listModesForDataset("scenario_dialogue")).toEqual([]);
  });

  it("情境對話模式不會出現在例句集／單字集的模式清單裡", () => {
    for (const dataset of ["example_sentences", "vocabulary_set"] as const) {
      expect(listModesForDataset(dataset)).not.toContain("scenario_dialogue");
    }
  });

  it("計分類別恆為口說，不受 play_audio 影響（鏡射後端）", () => {
    expect(getScoreCategory("scenario_dialogue", false)).toBe("speaking");
    expect(getScoreCategory("scenario_dialogue", true)).toBe("speaking");
  });
});

describe("資料集查表（PR #1034 review round 3：二分法會選到不支援的模式）", () => {
  it("每個資料集的預設模式都必須是該資料集支援的模式", () => {
    const datasets: PracticeDataset[] = [
      "example_sentences",
      "vocabulary_set",
      "scenario_dialogue",
    ];
    datasets.forEach((dataset) => {
      const mode = DEFAULT_MODE_BY_DATASET[dataset];
      expect(
        PRACTICE_MODE_REGISTRY[mode].supportedDatasets,
        `${dataset} 的預設模式 ${mode} 不支援該資料集`,
      ).toContain(dataset);
    });
  });

  it("情境對話的預設模式就是情境對話（不是 rearrangement）", () => {
    expect(DEFAULT_MODE_BY_DATASET.scenario_dialogue).toBe("scenario_dialogue");
  });

  it("每個資料集都有自己的顯示名稱 key，不會互相張冠李戴", () => {
    const keys = Object.values(DATASET_LABEL_KEY);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DATASET_LABEL_KEY.scenario_dialogue).toContain("SCENARIO_DIALOGUE");
  });
});

describe("模式支援的資料集名稱（Issue #1033）", () => {
  /**
   * 「模式與型別不合」的提示原本寫死「目前只能選擇**單字集**」。
   *
   * 那句話在 #1033 之前是死碼（原生 disabled 吃掉了 click），一旦讓它真的出得來，
   * 內容就必須是對的 —— 否則老師會被指去做一件錯的事，比沒有提示更糟。
   *
   * 寫死單字集在這兩種情況會說謊：
   *   - 選了情境對話模式 → 該說「只能選情境對話」
   *   - 選了朗讀模式去點情境對話 → 該說「只能選例句集、單字集」
   */
  it("單字類模式只吃單字集", () => {
    expect(datasetLabelKeysForMode("word_reading")).toEqual([
      DATASET_LABEL_KEY.vocabulary_set,
    ]);
  });

  it("情境對話模式只吃情境對話 —— 不是單字集", () => {
    expect(datasetLabelKeysForMode("scenario_dialogue")).toEqual([
      DATASET_LABEL_KEY.scenario_dialogue,
    ]);
  });

  it("例句類模式吃例句集與單字集兩種", () => {
    expect(datasetLabelKeysForMode("reading")).toEqual([
      DATASET_LABEL_KEY.example_sentences,
      DATASET_LABEL_KEY.vocabulary_set,
    ]);
    expect(datasetLabelKeysForMode("rearrangement")).toEqual([
      DATASET_LABEL_KEY.example_sentences,
      DATASET_LABEL_KEY.vocabulary_set,
    ]);
  });

  it("每個模式都給得出至少一個資料集名稱", () => {
    // 新增模式時忘了填 supportedDatasets 會讓提示變成空字串
    for (const mode of Object.keys(PRACTICE_MODE_REGISTRY) as PracticeMode[]) {
      expect(datasetLabelKeysForMode(mode).length).toBeGreaterThan(0);
    }
  });
});
