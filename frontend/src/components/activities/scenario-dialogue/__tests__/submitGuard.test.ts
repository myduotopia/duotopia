/**
 * 送出前的「答完了嗎」判定（Issue #1140 A 項）。
 *
 * 作業頁原本的逐題檢查對情境對話是失效的（錄音在 adapters 裡上傳，不回寫
 * `activities` state），所以學生可以把每一題都略過再送出 —— 夥伴 staging 測試後列為
 * 最該先補的一項。
 */
import { describe, it, expect } from "vitest";
import { unansweredQuestionNumbers } from "../submitGuard";

describe("unansweredQuestionNumbers", () => {
  it("全部答過回空陣列", () => {
    expect(unansweredQuestionNumbers(3, [true, true, true])).toEqual([]);
  });

  it("回沒答過的題號（1 起算，給人看的）", () => {
    expect(unansweredQuestionNumbers(4, [true, false, true, false])).toEqual([
      2, 4,
    ]);
  });

  it("全部略過就是全部題號", () => {
    expect(unansweredQuestionNumbers(3, [false, false, false])).toEqual([
      1, 2, 3,
    ]);
  });

  /**
   * 元件還沒回報、或只回報到一半時，缺的一律算「沒答」。寧可多提醒一次，也不要讓
   * 學生以為自己答完了 —— 反過來設計的話，進度回報一出問題就會靜靜放行。
   */
  it("回報比題數短：缺的算沒答", () => {
    expect(unansweredQuestionNumbers(3, [true])).toEqual([2, 3]);
    expect(unansweredQuestionNumbers(3, [])).toEqual([1, 2, 3]);
  });

  it("回報比題數長：多的忽略", () => {
    expect(unansweredQuestionNumbers(2, [true, true, true])).toEqual([]);
  });

  it("沒有題目就沒有未完成", () => {
    expect(unansweredQuestionNumbers(0, [])).toEqual([]);
  });
});
