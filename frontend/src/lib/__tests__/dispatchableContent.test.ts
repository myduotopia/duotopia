/**
 * 不可派發的內容不能走完派發流程。
 *
 * 夥伴在 staging 回報：情境對話的教材按派發，練習模式那一步會出現單字選擇等模式。
 * 追下去發現比「清單顯示錯」嚴重 —— **可以真的派出一份學生打不開的作業**：
 *
 * 1. 教材卡／樹狀圖按派發時不檢查可派發性，內容照樣進購物車；
 * 2. 有預選內容時「選擇內容」那一步被整個跳過 —— 而 #1030／#1033 的反灰守衛就在那一步；
 * 3. 模式清單 `listModesForDataset("scenario_dialogue")` 回 `[]`（#1052 標為開發中），
 *    但 `formData.practice_mode` 仍停在開啟時的預設 `word_selection`；
 * 4. 第 1 步的 `canProceed()` 只檢查「有沒有選模式」→ 放行；
 * 5. 後端 `_collect_contents_missing_examples` 對非單字集型別直接 continue → 不驗。
 *
 * 結果：情境對話內容被派成「單字選擇」作業。
 *
 * 這個檔案守的是**規則本身**：選中的模式一定要在該內容實際可用的清單裡。
 */
import { describe, it, expect } from "vitest";

import { isAssignableContentType } from "../assignableContentType";
import {
  contentTypeToDataset,
  listAllDispatchableModes,
  listModesForDataset,
  type PracticeMode,
} from "../practiceMode";
import { canUseModeForContentTypes } from "../dispatchableContent";

describe("情境對話目前不可派發（#1052 標為開發中）", () => {
  it("可派發白名單排除情境對話", () => {
    expect(isAssignableContentType("SCENARIO_DIALOGUE")).toBe(false);
  });

  it("它的模式清單是空的 —— 沒有任何模式可選", () => {
    expect(listModesForDataset("scenario_dialogue")).toEqual([]);
  });

  it("全域可派發清單也不含情境對話模式", () => {
    expect(listAllDispatchableModes()).not.toContain("scenario_dialogue");
  });
});

describe("canUseModeForContentTypes —— 擋住「模式不在該內容清單裡」", () => {
  it("情境對話內容配任何模式都不行（清單是空的）", () => {
    for (const mode of listAllDispatchableModes()) {
      expect(canUseModeForContentTypes(mode, ["SCENARIO_DIALOGUE"])).toBe(
        false,
      );
    }
  });

  it("這就是夥伴回報的那一組：情境對話 + 單字選擇", () => {
    expect(
      canUseModeForContentTypes("word_selection", ["SCENARIO_DIALOGUE"]),
    ).toBe(false);
  });

  it("單字集配單字模式可以", () => {
    expect(canUseModeForContentTypes("word_reading", ["VOCABULARY_SET"])).toBe(
      true,
    );
  });

  it("例句集配朗讀可以，配單字拼寫不行", () => {
    expect(canUseModeForContentTypes("reading", ["EXAMPLE_SENTENCES"])).toBe(
      true,
    );
    expect(
      canUseModeForContentTypes("word_spelling", ["EXAMPLE_SENTENCES"]),
    ).toBe(false);
  });

  it("購物車是空的（先選方式、後選教材）→ 不介入，交給選內容那步擋", () => {
    for (const mode of listAllDispatchableModes()) {
      expect(canUseModeForContentTypes(mode, [])).toBe(true);
    }
  });

  it("沒選模式 → 不能往下走", () => {
    expect(canUseModeForContentTypes("", ["VOCABULARY_SET"])).toBe(false);
  });

  it("混合型別時，模式要三者皆可用才算數", () => {
    // 例句集 + 單字集 都吃 reading
    expect(
      canUseModeForContentTypes("reading", [
        "EXAMPLE_SENTENCES",
        "VOCABULARY_SET",
      ]),
    ).toBe(true);
    // word_spelling 只吃單字集 → 混到例句集就不行
    expect(
      canUseModeForContentTypes("word_spelling", [
        "EXAMPLE_SENTENCES",
        "VOCABULARY_SET",
      ]),
    ).toBe(false);
  });

  it("未知型別一律擋下（白名單語意）", () => {
    expect(contentTypeToDataset("MULTIPLE_CHOICE")).toBeNull();
    for (const mode of listAllDispatchableModes()) {
      expect(canUseModeForContentTypes(mode, ["MULTIPLE_CHOICE"])).toBe(false);
    }
  });

  it("未來任何新資料集只要標成開發中，這道守衛就自動生效", () => {
    // 規則取自 listModesForDataset（唯一來源 DATASET_DISPATCH_STATUS），
    // 不是在這裡列舉型別 —— 新增資料集不必回來改這個函式
    const modes = listAllDispatchableModes();
    expect(modes.length).toBeGreaterThan(0);
    for (const mode of modes) {
      expect(
        canUseModeForContentTypes(mode as PracticeMode, ["SCENARIO_DIALOGUE"]),
      ).toBe(false);
    }
  });
});
