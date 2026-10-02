import { describe, it, expect } from "vitest";
import {
  GRADE_FILTER_ALL,
  GRADE_FILTER_UNSET,
  GRADE_OPTIONS,
  computeGradeAdjust,
  isValidGrade,
  matchesGradeFilter,
} from "../classroomGrade";

describe("GRADE_OPTIONS", () => {
  it("lists grades 1 through 12", () => {
    expect(GRADE_OPTIONS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe("isValidGrade", () => {
  it("accepts integers 1–12 only", () => {
    expect(isValidGrade(1)).toBe(true);
    expect(isValidGrade(12)).toBe(true);
    expect(isValidGrade(0)).toBe(false);
    expect(isValidGrade(13)).toBe(false);
    expect(isValidGrade(3.5)).toBe(false);
    expect(isValidGrade(null)).toBe(false);
    expect(isValidGrade(undefined)).toBe(false);
    expect(isValidGrade("3")).toBe(false);
  });
});

describe("matchesGradeFilter", () => {
  it("matches everything for 'all'", () => {
    expect(matchesGradeFilter(3, GRADE_FILTER_ALL)).toBe(true);
    expect(matchesGradeFilter(null, GRADE_FILTER_ALL)).toBe(true);
  });

  it("matches only missing grades for 'unset'", () => {
    expect(matchesGradeFilter(null, GRADE_FILTER_UNSET)).toBe(true);
    expect(matchesGradeFilter(undefined, GRADE_FILTER_UNSET)).toBe(true);
    expect(matchesGradeFilter(3, GRADE_FILTER_UNSET)).toBe(false);
  });

  it("matches the exact grade for a numeric filter", () => {
    expect(matchesGradeFilter(3, "3")).toBe(true);
    expect(matchesGradeFilter(4, "3")).toBe(false);
    expect(matchesGradeFilter(null, "3")).toBe(false);
  });
});

describe("computeGradeAdjust", () => {
  it("moves every classroom up one grade", () => {
    const result = computeGradeAdjust(
      [
        { id: 1, name: "A", grade: 3 },
        { id: 2, name: "B", grade: 11 },
      ],
      "up",
    );
    expect(result.changes).toEqual([
      { id: 1, name: "A", from: 3, to: 4 },
      { id: 2, name: "B", from: 11, to: 12 },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("moves every classroom down one grade", () => {
    const result = computeGradeAdjust(
      [
        { id: 1, name: "A", grade: 3 },
        { id: 2, name: "B", grade: 2 },
      ],
      "down",
    );
    expect(result.changes).toEqual([
      { id: 1, name: "A", from: 3, to: 2 },
      { id: 2, name: "B", from: 2, to: 1 },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("skips grade 12 when moving up", () => {
    const result = computeGradeAdjust([{ id: 1, name: "A", grade: 12 }], "up");
    expect(result.changes).toEqual([]);
    expect(result.skipped).toEqual([{ id: 1, name: "A", reason: "max" }]);
  });

  it("skips grade 1 when moving down", () => {
    const result = computeGradeAdjust([{ id: 1, name: "A", grade: 1 }], "down");
    expect(result.changes).toEqual([]);
    expect(result.skipped).toEqual([{ id: 1, name: "A", reason: "min" }]);
  });

  it("skips classrooms without a grade in either direction", () => {
    const input = [
      { id: 1, name: "A", grade: null },
      { id: 2, name: "B" },
    ];
    for (const direction of ["up", "down"] as const) {
      const result = computeGradeAdjust(input, direction);
      expect(result.changes).toEqual([]);
      expect(result.skipped).toEqual([
        { id: 1, name: "A", reason: "unset" },
        { id: 2, name: "B", reason: "unset" },
      ]);
    }
  });

  it("splits a mixed selection and keeps input order", () => {
    const result = computeGradeAdjust(
      [
        { id: "s-1", name: "A", grade: 5 },
        { id: "s-2", name: "B", grade: 12 },
        { id: "s-3", name: "C", grade: null },
        { id: "s-4", name: "D", grade: 1 },
      ],
      "up",
    );
    expect(result.changes).toEqual([
      { id: "s-1", name: "A", from: 5, to: 6 },
      { id: "s-4", name: "D", from: 1, to: 2 },
    ]);
    expect(result.skipped).toEqual([
      { id: "s-2", name: "B", reason: "max" },
      { id: "s-3", name: "C", reason: "unset" },
    ]);
  });
});
