import { describe, it, expect } from "vitest";
import {
  detectLang,
  exampleContainsWord,
  deriveClozeAnswer,
} from "../magicPasteHelpers";

describe("detectLang", () => {
  it("classifies by script", () => {
    expect(detectLang("蘋果")).toBe("chinese");
    expect(detectLang("apple")).toBe("english");
    expect(detectLang("りんご")).toBe("japanese");
    expect(detectLang("사과")).toBe("korean");
  });
  it("empty → '', symbols → chinese fallback", () => {
    expect(detectLang("")).toBe("");
    expect(detectLang("   ")).toBe("");
    expect(detectLang("123")).toBe("chinese");
  });
  it("English definition (monolingual dictionary) → english", () => {
    expect(
      detectLang("Something that has an adverse effect can be harmful."),
    ).toBe("english");
  });
});

describe("exampleContainsWord", () => {
  it("exact word present", () => {
    expect(exampleContainsWord("apple", "I eat an apple.")).toBe(true);
  });
  it("inflections match", () => {
    expect(exampleContainsWord("run", "She is running fast.")).toBe(true);
    expect(exampleContainsWord("cat", "Two cats sat there.")).toBe(true);
    expect(exampleContainsWord("happy", "He is happier now.")).toBe(true);
    expect(exampleContainsWord("study", "She studies daily.")).toBe(true);
  });
  it("unrelated same-prefix word does NOT match (cat vs category)", () => {
    expect(exampleContainsWord("cat", "This is a category of items.")).toBe(
      false,
    );
    expect(exampleContainsWord("read", "I feel real joy.")).toBe(false);
  });
  it("word absent → false", () => {
    expect(exampleContainsWord("run", "She swims fast.")).toBe(false);
  });
  it("phrase uses substring match", () => {
    expect(exampleContainsWord("wet skin", "Frogs have wet skin.")).toBe(true);
    expect(exampleContainsWord("wet skin", "Frogs are amphibians.")).toBe(
      false,
    );
  });
});

describe("deriveClozeAnswer", () => {
  it("returns the whole-word match preserving original case", () => {
    expect(
      deriveClozeAnswer("amphibians", "Amphibians live on land and water."),
    ).toBe("Amphibians");
  });
  it("no whole-word match (inflection) → empty", () => {
    expect(deriveClozeAnswer("run", "She is running.")).toBe("");
  });
  it("empty inputs → empty", () => {
    expect(deriveClozeAnswer("", "hi")).toBe("");
    expect(deriveClozeAnswer("hi", "")).toBe("");
  });
});
