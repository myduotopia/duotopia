/**
 * 作業清單的類型標籤 — 情境對話顯示「未知類型」。
 *
 * 根因是**同一份手寫對照表被複製三份**（作業清單徽章、作業詳情 sheet、詳情頁內文），
 * 三份都只列舉了 VOCABULARY_SET / EXAMPLE_SENTENCES 與四個 legacy 型別，
 * `SCENARIO_DIALOGUE` 不在任何分支 → 一路掉到「未知類型」。
 *
 * 這跟 #1030／#1033／#1034 是同一個病：**手寫列舉，新增題型時漏掉**。
 * 所以這次不是補一個 case，而是改成**以 practice_mode 查 registry** —— 未來新增
 * 任何模式都自動有標籤，不必回來改這裡。
 */
import { describe, it, expect } from "vitest";

import { assignmentTypeBadge } from "../assignmentTypeLabel";
import { PRACTICE_MODE_REGISTRY, type PracticeMode } from "../practiceMode";

/** 測試用：t 回傳 key 本身，斷言就看 key。 */
const t = (key: string) => key;

describe("情境對話（這次回報的 bug）", () => {
  it("不再顯示「未知類型」", () => {
    const badge = assignmentTypeBadge(
      "SCENARIO_DIALOGUE",
      "scenario_dialogue",
      t,
    );
    expect(badge.label).not.toContain("unknownType");
  });

  it("顯示的是情境對話的標籤", () => {
    const badge = assignmentTypeBadge(
      "SCENARIO_DIALOGUE",
      "scenario_dialogue",
      t,
    );
    expect(badge.label).toBe("practiceMode.scenario_dialogue.label");
  });

  it("徽章配色用 registry 的，不是灰色的 unknown", () => {
    const badge = assignmentTypeBadge(
      "SCENARIO_DIALOGUE",
      "scenario_dialogue",
      t,
    );
    expect(badge.className).toBe(
      PRACTICE_MODE_REGISTRY.scenario_dialogue.badgeClass,
    );
  });
});

describe("既有行為不能變", () => {
  it("單字集依 practice_mode 顯示", () => {
    expect(
      assignmentTypeBadge("VOCABULARY_SET", "word_spelling", t).label,
    ).toBe("practiceMode.word_spelling.label");
  });

  it("單字集沒有 practice_mode 時退回單字朗讀", () => {
    expect(assignmentTypeBadge("VOCABULARY_SET", null, t).label).toBe(
      "practiceMode.word_reading.label",
    );
  });

  it("SENTENCE_MAKING（單字集的 legacy 名稱）同上", () => {
    expect(assignmentTypeBadge("SENTENCE_MAKING", "word_cloze", t).label).toBe(
      "practiceMode.word_cloze.label",
    );
  });

  it("例句集的重組與朗讀分得出來", () => {
    expect(
      assignmentTypeBadge("EXAMPLE_SENTENCES", "rearrangement", t).label,
    ).toBe("practiceMode.rearrangement.label");
    expect(assignmentTypeBadge("EXAMPLE_SENTENCES", "reading", t).label).toBe(
      "practiceMode.reading.label",
    );
  });

  it("READING_ASSESSMENT（例句集的 legacy 名稱）同上", () => {
    expect(
      assignmentTypeBadge("READING_ASSESSMENT", "rearrangement", t).label,
    ).toBe("practiceMode.rearrangement.label");
  });

  it("legacy 型別仍有自己的標籤", () => {
    expect(assignmentTypeBadge("SPEAKING_PRACTICE", null, t).label).toBe(
      "classroomDetail.contentTypes.speakingPractice",
    );
    expect(assignmentTypeBadge("LISTENING_CLOZE", null, t).label).toBe(
      "classroomDetail.contentTypes.listeningCloze",
    );
  });

  it("真的認不得的才顯示未知類型", () => {
    expect(assignmentTypeBadge("SOMETHING_NEW", null, t).label).toBe(
      "classroomDetail.labels.unknownType",
    );
    expect(assignmentTypeBadge(null, null, t).label).toBe(
      "classroomDetail.labels.unknownType",
    );
  });
});

describe("未來新增的模式自動有標籤（不必回來改這裡）", () => {
  it("registry 裡每個模式都給得出非 unknown 的標籤", () => {
    for (const mode of Object.keys(PRACTICE_MODE_REGISTRY) as PracticeMode[]) {
      const badge = assignmentTypeBadge(null, mode, t);
      expect(badge.label).not.toBe("classroomDetail.labels.unknownType");
    }
  });

  it("content_type 認不得但 practice_mode 認得 → 用 practice_mode", () => {
    // 這正是情境對話撞到的情況的一般化
    expect(assignmentTypeBadge("WHATEVER", "word_selection", t).label).toBe(
      "practiceMode.word_selection.label",
    );
  });
});
