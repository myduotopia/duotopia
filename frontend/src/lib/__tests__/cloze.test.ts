/**
 * lib/cloze 單元測試（Issue #860）
 *
 * 這裡鎖住的是「前端挖空必須與後端 utils/cloze.py 同語意」。兩個實際踩到的坑：
 *   1. 前綴變化形（apple → apples）用單純 indexOf 會只挖掉 5 個字元，殘留 "s" 洩漏答案
 *   2. 教材沒設 cloze_answer（範例教材／舊資料）時，若不 fallback 到單字本身，
 *      會整句連答案一起顯示（老師派發預覽實際發生過）
 */
import { describe, it, expect } from "vitest";
import { buildBlank, findClozeMatch, buildBlankedSentence } from "../cloze";

describe("buildBlank — 一個字一個底線（不洩漏字母數）", () => {
  it("單字 → 一格", () => {
    expect(buildBlank("cake")).toBe("_");
  });

  it("片語 → 一字一格", () => {
    expect(buildBlank("two pieces of cake")).toBe("_ _ _ _");
    expect(buildBlank("take pictures")).toBe("_ _");
  });

  it("空字串 → 仍給一格", () => {
    expect(buildBlank("")).toBe("_");
  });
});

describe("findClozeMatch — 鏡射後端比對策略", () => {
  it("整字比對（大小寫不敏感）", () => {
    expect(findClozeMatch("apple", "I eat an Apple.")).toEqual([
      9,
      14,
      "Apple",
    ]);
  });

  it("片語整字比對", () => {
    const m = findClozeMatch("take pictures", "I love to take pictures here.");
    expect(m?.[2]).toBe("take pictures");
  });

  it("單字前綴比對抓完整變化形（apple → apples）", () => {
    const m = findClozeMatch("apple", "I have two apples.");
    expect(m?.[2]).toBe("apples"); // 必須整個 apples，不能只抓 apple
  });

  it("片語不做前綴比對", () => {
    expect(findClozeMatch("take picture", "I take pictures.")).toBeNull();
  });

  it("不做子字串誤命中（cat 不該命中 concatenate）", () => {
    expect(findClozeMatch("cat", "Please concatenate them.")).toBeNull();
  });

  it("空值 → null", () => {
    expect(findClozeMatch("", "abc")).toBeNull();
    expect(findClozeMatch("abc", "")).toBeNull();
    expect(findClozeMatch(null, "abc")).toBeNull();
  });
});

describe("buildBlankedSentence", () => {
  it("變化形整個挖掉，不殘留字尾（回歸：曾出現 'I have two ____s.'）", () => {
    expect(buildBlankedSentence("I have two apples.", "apple")).toBe(
      "I have two _.",
    );
  });

  it("片語挖成一字一格", () => {
    expect(
      buildBlankedSentence(
        "I love to take pictures of landscapes.",
        "take pictures",
      ),
    ).toBe("I love to _ _ of landscapes.");
  });

  it("沒有 cloze_answer 時 fallback 到單字本身（回歸：範例教材整句不挖空）", () => {
    expect(
      buildBlankedSentence(
        "I love to take pictures of landscapes.",
        null,
        "take pictures",
      ),
    ).toBe("I love to _ _ of landscapes.");
  });

  it("cloze_answer 在句中找不到時，也會 fallback 到單字本身", () => {
    expect(buildBlankedSentence("I have two apples.", "banana", "apple")).toBe(
      "I have two _.",
    );
  });

  it("都找不到 → fail closed 回空字串（絕不可退回原句，原句含答案）", () => {
    // 退回原句等於把答案印在題目上；呼叫端拿到空字串會退回一般題型呈現。
    expect(buildBlankedSentence("I have two apples.", "xyz", "qqq")).toBe("");
  });

  it("空句子 → 空字串", () => {
    expect(buildBlankedSentence("", "apple")).toBe("");
  });
});
