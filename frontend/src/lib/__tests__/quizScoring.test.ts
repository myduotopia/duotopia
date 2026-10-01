/**
 * lib/quizScoring 單元測試（Issue #1092）
 *
 * 前端只用於派發／編輯時的試算，但數字必須與後端 utils/quiz_scoring.py 一致：
 * 案例與 backend/tests/unit/test_quiz_scoring.py 同一組（每題 4 分、正解
 * look forward to）。
 */
import { describe, it, expect } from "vitest";
import {
  QUIZ_SCORING_METHODS,
  editDistance,
  effectiveMethod,
  evaluateAnswer,
  joinAnswerSlots,
  questionDeduction,
  roundHalfUp1,
  splitAnswerSlots,
  toTypedWords,
  totalScore,
  type QuizScoringMethod,
} from "../quizScoring";

const CORRECT = "look forward to";
const PER_Q = 4; // 100 / 25 題

const ded = (
  method: QuizScoringMethod | null,
  answer: string[] | string,
  points: number | null = null,
  perQ = PER_Q,
  correct = CORRECT,
  caseSensitive = false,
) =>
  questionDeduction(
    method,
    points,
    perQ,
    evaluateAnswer(answer, correct, caseSensitive),
  );

describe("基礎", () => {
  it("五種方式與 null ＝ 整題計分", () => {
    expect(QUIZ_SCORING_METHODS).toEqual([
      "whole_question",
      "per_word",
      "per_word_lenient",
      "fixed_per_word",
      "fixed_per_letter",
    ]);
    expect(effectiveMethod(null)).toBe("whole_question");
    expect(effectiveMethod("per_word")).toBe("per_word");
  });

  it.each([
    ["forward", "forward", 0],
    ["forwerd", "forward", 1],
    ["forwad", "forward", 1],
    ["forwaard", "forward", 1],
    ["", "forward", 7],
    ["to", "", 2],
  ])("editDistance(%s, %s) = %d", (a, b, expected) => {
    expect(editDistance(a, b)).toBe(expected);
  });

  it("half-up 到小數一位", () => {
    expect(roundHalfUp1(0.25)).toBe(0.3);
    expect(roundHalfUp1(1.25)).toBe(1.3);
    expect(roundHalfUp1(2.65)).toBe(2.7);
    expect(roundHalfUp1(0.04)).toBe(0);
  });
});

describe("計畫驗算例（每題 4 分、look forward to）", () => {
  it("B 依單字比例", () => {
    expect(ded("per_word", ["look", "forwerd", "to"])).toBe(1.3);
    expect(ded("per_word", ["look", "forwerd", "too"])).toBe(2.7);
  });

  it("C 依單字比例＋拼字寬鬆", () => {
    expect(ded("per_word_lenient", ["look", "forwerd", "to"])).toBe(0.7);
    expect(ded("per_word_lenient", ["look", "forword", "too"])).toBe(1.3);
    expect(ded("per_word_lenient", ["look", "to", ""])).toBe(2.7);
  });

  it("D 每錯一個單字扣 1 分", () => {
    expect(ded("fixed_per_word", ["look", "forwerd", "too"], 1)).toBe(2);
  });

  it("E 每錯一個字母扣 0.5 分（差 3 個字母）", () => {
    expect(ded("fixed_per_letter", ["lok", "forwad", "t"], 0.5)).toBe(1.5);
  });
});

describe("共用規則", () => {
  it.each(QUIZ_SCORING_METHODS)("%s：全對扣 0", (method) => {
    expect(ded(method, ["look", "forward", "to"], 1)).toBe(0);
  });

  it.each(QUIZ_SCORING_METHODS)("%s：未作答扣 per_q", (method) => {
    const perQ = 100 / 3;
    expect(questionDeduction(method, 1, perQ, null)).toBe(perQ);
  });

  it.each(QUIZ_SCORING_METHODS)("%s：每格都空白 ＝ 未作答", (method) => {
    const perQ = 100 / 3;
    expect(ded(method, ["", "", ""], 1, perQ)).toBe(perQ);
    expect(ded(method, "", 1, perQ)).toBe(perQ);
  });

  it("上限 per_q，回原值不捨入", () => {
    const perQ = 100 / 7;
    expect(ded("fixed_per_word", ["a", "b", "c"], 10, perQ)).toBe(perQ);
    expect(ded("fixed_per_letter", ["lok", "forwad", "t"], 5, perQ)).toBe(perQ);
  });

  it("捨入後 ≥ per_q 視為全扣", () => {
    const perQ = 100 / 7;
    expect(
      questionDeduction(
        "fixed_per_letter",
        14.27,
        perQ,
        evaluateAnswer(["lok", "forward", "to"], CORRECT),
      ),
    ).toBe(perQ);
  });

  it("整題計分：有錯就全扣（null 亦同）", () => {
    expect(ded("whole_question", ["look", "forwerd", "to"])).toBe(PER_Q);
    expect(ded(null, ["look", "forwerd", "to"])).toBe(PER_Q);
  });

  it("單一單字題", () => {
    expect(ded("per_word", ["appel"], null, PER_Q, "apple")).toBe(PER_Q);
    expect(ded("per_word_lenient", ["appl"], null, PER_Q, "apple")).toBe(2);
    expect(ded("per_word_lenient", ["b"], null, PER_Q, "a")).toBe(PER_Q);
  });

  it("C：漏填的格子不給一半", () => {
    const ev = evaluateAnswer(["look", "forward", ""], CORRECT);
    expect(ev.perWordHalf).toEqual([false, false, false]);
    expect(ded("per_word_lenient", ["look", "forward", ""])).toBe(1.3);
  });

  it("大小寫開關", () => {
    expect(evaluateAnswer(["Apple"], "apple").isCorrect).toBe(true);
    const ev = evaluateAnswer(["Apple"], "apple", true);
    expect(ev.isCorrect).toBe(false);
    expect(ev.wrongLetters).toBe(1);
    expect(evaluateAnswer(" Apple ", "apple").isCorrect).toBe(true);
    expect(evaluateAnswer(" Apple ", "apple", true).isCorrect).toBe(false);
  });

  it("空格留在原位：B 只扣第 1 個單字", () => {
    const ev = evaluateAnswer(["", "forward", "to"], CORRECT);
    expect(ev.wrongWords).toBe(1);
    expect(ev.perWordDistance).toEqual([4, 0, 0]);
    expect(ded("per_word", ["", "forward", "to"])).toBe(1.3);
    expect(ded("fixed_per_letter", ["", "forward", "to"], 0.5)).toBe(2);
  });

  it("格數不足補空格", () => {
    const ev = evaluateAnswer(["look"], CORRECT);
    expect(ev.wrongWords).toBe(2);
    expect(ev.wrongLetters).toBe(9);
  });

  it("多打的字併入最後一格", () => {
    const ev = evaluateAnswer(["look", "forward", "to", "it"], CORRECT);
    expect(ev.isCorrect).toBe(false);
    expect(ev.wrongWords).toBe(1);
    expect(ev.perWordDistance).toEqual([0, 0, 3]);
    expect(
      evaluateAnswer(["look", "forward", "to", ""], CORRECT).isCorrect,
    ).toBe(true);
  });

  it.each([
    ["apple", "apple"],
    ["Apple ", "apple"],
    ["  look forward to", "look forward to"],
    ["look  forward to", "look forward to"],
    ["look forward", "look forward to"],
    ["", "apple"],
    ["apple", ""],
    ["", ""],
  ])("整串比對與 #828 相同：%j vs %j", (typed, correct) => {
    const expected =
      typed.trim().toLowerCase() === correct.trim().toLowerCase();
    expect(evaluateAnswer(typed, correct).isCorrect).toBe(expected);
  });
});

describe("總分", () => {
  it("只有 0 / per_q 時與 #1045 公式相同", () => {
    for (let n = 1; n <= 60; n++) {
      const perQ = 100 / n;
      for (let wrong = 0; wrong <= n; wrong++) {
        const deductions = [
          ...Array(wrong).fill(perQ),
          ...Array(n - wrong).fill(0),
        ];
        const legacy = Math.round(Math.max(0, 100 - wrong * perQ) * 10) / 10;
        expect(totalScore(perQ, deductions)).toBe(legacy === 0 ? 0 : legacy);
      }
    }
  });

  it("含部分扣分", () => {
    expect(totalScore(4, [1.3, 0.7, 4, 0])).toBe(94);
    const perQ = 100 / 3;
    expect(totalScore(perQ, [perQ, 2.7, 0])).toBe(64);
  });

  it("下限 0", () => {
    expect(totalScore(50, [50, 50])).toBe(0);
  });
});

describe("輸入格切格（QuizAnswerInput / typed_words）", () => {
  it("空格留在原位", () => {
    expect(splitAnswerSlots(" forward to", 3)).toEqual(["", "forward", "to"]);
    expect(splitAnswerSlots("look", 3)).toEqual(["look", "", ""]);
    expect(joinAnswerSlots(["", "forward", "to"])).toBe(" forward to");
    expect(joinAnswerSlots(["look", "", ""])).toBe("look");
    expect(joinAnswerSlots(["look", "", "to"])).toBe("look  to");
  });

  it("toTypedWords 補齊到正解單字數", () => {
    expect(toTypedWords("look  to", CORRECT)).toEqual(["look", "", "to"]);
    expect(toTypedWords("", CORRECT)).toEqual(["", "", ""]);
    expect(toTypedWords("apple", "apple")).toEqual(["apple"]);
  });
});
