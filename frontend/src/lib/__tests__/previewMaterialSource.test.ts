/**
 * 派發預覽到底用誰的教材（Issue #1136）。
 *
 * 預覽上方原本固定寫「預覽使用範例教材…」，但只要購物車裡有教材，預覽用的就是老師
 * 自己那份、設定也跟著左側即時變動 —— 那句話在最常見的情況下是錯的。情境對話讓矛盾
 * 更明顯：它沒有範例教材可借，沒選教材時畫面說「請先選擇教材」，上方卻說「使用範例
 * 教材」。
 *
 * 這個檔案守的是判定本身。
 */
import { describe, it, expect } from "vitest";
import { previewUsesSampleMaterial } from "../activityRegistry";
import { PRACTICE_MODE_REGISTRY, type PracticeMode } from "../practiceMode";

describe("previewUsesSampleMaterial", () => {
  it("購物車有教材時一律是老師自己的教材", () => {
    expect(previewUsesSampleMaterial("word_reading", 282)).toBe(false);
    expect(previewUsesSampleMaterial("reading", 7)).toBe(false);
    expect(previewUsesSampleMaterial("rearrangement", 7)).toBe(false);
    expect(previewUsesSampleMaterial("scenario_dialogue", 501)).toBe(false);
  });

  it("沒有教材時，單字／例句模式會借範例教材", () => {
    expect(previewUsesSampleMaterial("word_reading", undefined)).toBe(true);
    expect(previewUsesSampleMaterial("word_selection_quiz", undefined)).toBe(
      true,
    );
    expect(previewUsesSampleMaterial("reading", undefined)).toBe(true);
    expect(previewUsesSampleMaterial("rearrangement", undefined)).toBe(true);
  });

  /**
   * 情境對話沒有範例教材可借（`ScenarioDialoguePreview` 檔頭寫明理由：借範例單字集
   * 等於顯示一個永遠派不出去的畫面）。宣稱「使用範例教材」會與畫面上的
   * 「請先選擇要派發的情境對話教材」自相矛盾。
   */
  it("情境對話沒有範例可借，所以不會說自己在用範例教材", () => {
    expect(previewUsesSampleMaterial("scenario_dialogue", undefined)).toBe(
      false,
    );
    expect(previewUsesSampleMaterial("scenario_dialogue", null)).toBe(false);
  });

  /**
   * 回歸護欄：新增資料集時預設是「沒有範例教材」。寧可少說一句，也不要宣稱用了
   * 其實不存在的範例教材 —— 那正是這張單要修的錯誤方向。
   */
  it("每個模式都回得出答案，且不會對沒有範例的資料集說謊", () => {
    for (const mode of Object.keys(PRACTICE_MODE_REGISTRY) as PracticeMode[]) {
      const result = previewUsesSampleMaterial(mode, undefined);
      expect(typeof result).toBe("boolean");
      // 只吃自己專屬資料集、而我們沒有為它準備範例教材的模式，一律 false
      const datasets = PRACTICE_MODE_REGISTRY[mode].supportedDatasets;
      if (datasets.every((d) => d === "scenario_dialogue")) {
        expect(result).toBe(false);
      }
    }
  });
});
