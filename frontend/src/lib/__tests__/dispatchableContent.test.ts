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
import {
  canUseModeForContentTypes,
  initialModeForContentTypes,
  isContentTypeUsableForMode,
} from "../dispatchableContent";

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

/**
 * 夥伴 staging 回報第二輪：從班級頁派發情境對話可以成功，**從教材卡派發會失敗**。
 *
 * 根因不在守衛，在派發對話框開啟時的初始狀態：`practice_mode` 一律 reset 成寫死的
 * `word_selection`，而購物車在同一個 render 就已經裝進預選內容。接著那段「切換模式
 * 時清除不相容項目」的 effect 看到 word 模式，就把非單字集的內容整批請出購物車 ——
 * 老師還沒看到畫面，內容就已經不見了，而且沒有任何提示。
 *
 * 單字集之所以沒事，正是因為它剛好是那段清理留下來的那一種。
 */
describe("initialModeForContentTypes — 帶著內容開啟時的初始模式", () => {
  it("例句集推導出例句集的預設模式", () => {
    expect(initialModeForContentTypes(["EXAMPLE_SENTENCES"])).toBe(
      "rearrangement",
    );
    expect(initialModeForContentTypes(["READING_ASSESSMENT"])).toBe(
      "rearrangement",
    );
  });

  it("單字集推導出單字集的預設模式", () => {
    expect(initialModeForContentTypes(["VOCABULARY_SET"])).toBe("word_reading");
    expect(initialModeForContentTypes(["SENTENCE_MAKING"])).toBe(
      "word_reading",
    );
  });

  it("空購物車回 null —— 班級頁是先選方式再選教材，不要幫他決定", () => {
    expect(initialModeForContentTypes([])).toBeNull();
  });

  it("未知型別回 null（白名單語意）", () => {
    expect(initialModeForContentTypes(["NO_SUCH_TYPE"])).toBeNull();
    expect(initialModeForContentTypes([null])).toBeNull();
  });

  it("混型別回 null —— 挑誰都是錯的，交給守衛擋", () => {
    expect(
      initialModeForContentTypes(["VOCABULARY_SET", "EXAMPLE_SENTENCES"]),
    ).toBeNull();
  });

  /**
   * 旗標關著時（例如 production）情境對話本來就派不出去，這裡不要幫忙選一個
   * 派不出去的模式 —— 那會讓第 1 步的守衛與初始值互相矛盾。
   */
  it("資料集目前不可派發時回 null（測試環境旗標是關的）", () => {
    expect(initialModeForContentTypes(["SCENARIO_DIALOGUE"])).toBeNull();
  });

  /**
   * 回歸護欄：推導出來的模式必須通過第 1 步的守衛。兩者若對不上，老師會看到
   * 一個已經選好、卻按不動「下一步」的畫面。
   */
  it("推導出的模式一定過得了 canUseModeForContentTypes", () => {
    for (const type of [
      "VOCABULARY_SET",
      "SENTENCE_MAKING",
      "EXAMPLE_SENTENCES",
      "READING_ASSESSMENT",
      "SCENARIO_DIALOGUE",
    ]) {
      const mode = initialModeForContentTypes([type]);
      if (mode === null) continue; // 不可派發的資料集，本來就該被前面擋下
      expect(canUseModeForContentTypes(mode, [type])).toBe(true);
    }
  });
});

describe("isContentTypeUsableForMode — 切換模式時該留下哪些內容", () => {
  it("單字模式留得住單字集，留不住例句集與情境對話", () => {
    expect(isContentTypeUsableForMode("word_selection", "VOCABULARY_SET")).toBe(
      true,
    );
    expect(
      isContentTypeUsableForMode("word_selection", "EXAMPLE_SENTENCES"),
    ).toBe(false);
    expect(
      isContentTypeUsableForMode("word_selection", "SCENARIO_DIALOGUE"),
    ).toBe(false);
  });

  it("例句朗讀兩種資料集都留得住（單字集用例句欄位）", () => {
    expect(isContentTypeUsableForMode("reading", "EXAMPLE_SENTENCES")).toBe(
      true,
    );
    expect(isContentTypeUsableForMode("reading", "VOCABULARY_SET")).toBe(true);
  });

  it("未知型別一律留不住（白名單語意）", () => {
    expect(isContentTypeUsableForMode("word_reading", "NO_SUCH_TYPE")).toBe(
      false,
    );
    expect(isContentTypeUsableForMode("word_reading", undefined)).toBe(false);
  });

  it("與 canUseModeForContentTypes 同源：單筆結果要能組合成整批結果", () => {
    const types = ["VOCABULARY_SET", "EXAMPLE_SENTENCES"];
    for (const mode of ["word_reading", "reading"] as const) {
      expect(canUseModeForContentTypes(mode, types)).toBe(
        types.every((t) => isContentTypeUsableForMode(mode, t)),
      );
    }
  });
});
