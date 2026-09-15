/**
 * #1045 V11：前端預設扣分總和須與後端 compute_quiz_score 一致
 * （後端 pytest test_compute_quiz_score_exact_per_question 用同一組案例）。
 */
import { describe, expect, it } from "vitest";

import {
  defaultDeduction,
  initialDeductions,
  perQuestionDeduction,
  round1,
  scoreFromDeductions,
} from "../quizDeductions";

function itemsFor(total: number, correct: number) {
  return Array.from({ length: total }, (_, i) => ({
    content_item_id: i + 1,
    is_correct: i < correct,
  }));
}

describe("quizDeductions (#1045 V11)", () => {
  it.each([
    [30, 0, 0],
    [30, 29, 96.7],
    [7, 6, 85.7],
    [3, 0, 0],
    [3, 3, 100],
  ])(
    "%i items, %i correct → default score %f (matches backend)",
    (total, correct, expected) => {
      const deductions = initialDeductions(itemsFor(total, correct), total);
      expect(scoreFromDeductions(deductions)).toBe(expected);
    },
  );

  it("per-question deduction is not pre-rounded", () => {
    expect(perQuestionDeduction(30)).toBe(100 / 30);
    expect(defaultDeduction(false, 7)).toBe(100 / 7);
    expect(defaultDeduction(true, 7)).toBe(0);
    expect(perQuestionDeduction(0)).toBe(0);
  });

  it("saved deduction takes priority over the default", () => {
    const deductions = initialDeductions(
      [
        { content_item_id: 1, is_correct: false, deduction: 1.5 },
        { content_item_id: 2, is_correct: true, deduction: null },
      ],
      2,
    );
    expect(deductions).toEqual({ 1: 1.5, 2: 0 });
    expect(scoreFromDeductions(deductions)).toBe(98.5);
  });

  it("treats a 2-decimal stored default (100/30 → 3.33) as the exact default", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      content_item_id: i + 1,
      is_correct: false,
      deduction: 3.33,
    }));
    const deductions = initialDeductions(items, 30);
    expect(deductions[1]).toBe(100 / 30);
    expect(scoreFromDeductions(deductions)).toBe(0);
  });

  it("clamps at 0 and normalises -0", () => {
    expect(scoreFromDeductions({ 1: 80, 2: 80 })).toBe(0);
    expect(Object.is(round1(-0.00001), 0)).toBe(true);
  });
});
