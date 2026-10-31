/**
 * 情境對話派發的 per-environment 開關。
 *
 * 團隊要在 staging 驗「派發 → 學生作答 → 批改」整條線，但 production 還不能開。
 * 與 `ENABLE_SCENARIO_DIALOGUE`（建立教材入口）**分開** —— #1052 的註解寫明兩者
 * 各管各的，我們也確實曾處在「建得了、派不了」的狀態。
 *
 * 兩種狀態都測：只測關閉的話，「開了之後其實壞掉」會等到 staging 才發現。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/** 把 flag 設成指定值後重新載入整條依賴鏈（practiceMode 讀的是模組層級常數）。 */
async function loadWithDispatch(enabled: boolean) {
  vi.resetModules();
  vi.doMock("@/config/featureFlags", async (importOriginal) => {
    const actual =
      await importOriginal<typeof import("@/config/featureFlags")>();
    return { ...actual, ENABLE_SCENARIO_DIALOGUE_DISPATCH: enabled };
  });
  const practiceMode = await import("@/lib/practiceMode");
  const assignable = await import("@/lib/assignableContentType");
  const dispatchable = await import("@/lib/dispatchableContent");
  return { ...practiceMode, ...assignable, ...dispatchable };
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.doUnmock("@/config/featureFlags");
});

describe("開關關閉（production 現況）", () => {
  it("情境對話不可派發", async () => {
    const m = await loadWithDispatch(false);
    expect(m.isDatasetDispatchable("scenario_dialogue")).toBe(false);
    expect(m.isAssignableContentType("SCENARIO_DIALOGUE")).toBe(false);
    expect(m.listModesForDataset("scenario_dialogue")).toEqual([]);
  });

  it("任何模式配情境對話內容都走不下去", async () => {
    const m = await loadWithDispatch(false);
    for (const mode of m.listAllDispatchableModes()) {
      expect(m.canUseModeForContentTypes(mode, ["SCENARIO_DIALOGUE"])).toBe(
        false,
      );
    }
  });
});

describe("開關打開（staging / develop）", () => {
  /**
   * 夥伴 staging 回報：班級頁派發情境對話可以，**教材卡派發不行**。
   *
   * 根因是派發對話框開啟時把 practice_mode 寫死成 word_selection，而購物車同一個
   * render 已經裝進預選內容；「切換模式時清除不相容項目」的 effect 隨即把情境對話
   * 請出購物車 —— 老師還沒看到畫面，內容就不見了。班級頁沒事是因為那條路徑購物車
   * 一開始是空的（先選模式、再選教材）。
   */
  it("帶著情境對話內容開啟時，初始模式要是情境對話（不是 word_selection）", async () => {
    const m = await loadWithDispatch(true);
    expect(m.initialModeForContentTypes(["SCENARIO_DIALOGUE"])).toBe(
      "scenario_dialogue",
    );
  });

  it("情境對話內容在情境對話模式下留得住購物車", async () => {
    const m = await loadWithDispatch(true);
    expect(
      m.isContentTypeUsableForMode("scenario_dialogue", "SCENARIO_DIALOGUE"),
    ).toBe(true);
    // 反向：單字模式留不住它（清理本身是對的，錯的是初始模式）
    expect(
      m.isContentTypeUsableForMode("word_selection", "SCENARIO_DIALOGUE"),
    ).toBe(false);
  });

  it("情境對話可派發", async () => {
    const m = await loadWithDispatch(true);
    expect(m.isDatasetDispatchable("scenario_dialogue")).toBe(true);
    expect(m.isAssignableContentType("SCENARIO_DIALOGUE")).toBe(true);
  });

  it("**只給情境對話這一種模式** —— 單字／例句模式不該出現", async () => {
    const m = await loadWithDispatch(true);
    // 這就是夥伴回報的核心：情境對話內容的模式清單不該有單字選擇
    expect(m.listModesForDataset("scenario_dialogue")).toEqual([
      "scenario_dialogue",
    ]);
  });

  it("情境對話內容只配得上情境對話模式", async () => {
    const m = await loadWithDispatch(true);
    expect(
      m.canUseModeForContentTypes("scenario_dialogue", ["SCENARIO_DIALOGUE"]),
    ).toBe(true);
    expect(
      m.canUseModeForContentTypes("word_selection", ["SCENARIO_DIALOGUE"]),
    ).toBe(false);
    expect(m.canUseModeForContentTypes("reading", ["SCENARIO_DIALOGUE"])).toBe(
      false,
    );
  });

  it("情境對話不能和別的題型混在同一份作業", async () => {
    const m = await loadWithDispatch(true);
    // 資料集、作答方式、批改 Panel 都是獨立的，混不得
    expect(
      m.canUseModeForContentTypes("scenario_dialogue", [
        "SCENARIO_DIALOGUE",
        "VOCABULARY_SET",
      ]),
    ).toBe(false);
  });

  it("例句集／單字集完全不受影響", async () => {
    const m = await loadWithDispatch(true);
    expect(m.isAssignableContentType("VOCABULARY_SET")).toBe(true);
    expect(m.listModesForDataset("vocabulary_set")).not.toContain(
      "scenario_dialogue",
    );
    expect(m.listModesForDataset("example_sentences")).not.toContain(
      "scenario_dialogue",
    );
  });
});

describe("開關本身：未設定＝不可派發", () => {
  async function flagWithEnv(value: string | undefined) {
    vi.resetModules();
    vi.doUnmock("@/config/featureFlags");
    vi.stubEnv("VITE_ENABLE_SCENARIO_DIALOGUE_DISPATCH", value);
    const mod = await import("@/config/featureFlags");
    return mod.ENABLE_SCENARIO_DIALOGUE_DISPATCH;
  }

  it.each([undefined, "", "ture", "false"])(
    "%s → 關閉（漏設或拼錯都落到隱藏那邊）",
    async (value) => {
      expect(await flagWithEnv(value)).toBe(false);
    },
  );

  it.each(["true", "TRUE"])("%s → 開啟", async (value) => {
    expect(await flagWithEnv(value)).toBe(true);
  });
});
