import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api";
import {
  GRADE_FILTER_ALL,
  GRADE_FILTER_UNSET,
  GRADE_OPTIONS,
  batchGradeErrorMessageKey,
  computeGradeAdjust,
  formatClassroomDisplayName,
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

describe("batchGradeErrorMessageKey", () => {
  it("maps a 403 ApiError to the permission message", () => {
    expect(batchGradeErrorMessageKey(new ApiError(403, "Forbidden"))).toBe(
      "classroomGrade.messages.forbidden",
    );
  });

  it("maps other ApiError statuses to the generic failure", () => {
    for (const status of [400, 404, 422, 500]) {
      expect(batchGradeErrorMessageKey(new ApiError(status, "error"))).toBe(
        "classroomGrade.messages.saveFailed",
      );
    }
  });

  it("maps a plain Error to the generic failure", () => {
    expect(batchGradeErrorMessageKey(new Error("network"))).toBe(
      "classroomGrade.messages.saveFailed",
    );
  });

  it("maps non-error values to the generic failure", () => {
    for (const value of [undefined, null, "403", { status: 403 }]) {
      expect(batchGradeErrorMessageKey(value)).toBe(
        "classroomGrade.messages.saveFailed",
      );
    }
  });
});

describe("formatClassroomDisplayName", () => {
  const templates: Record<string, Record<string, string>> = {
    zh: { "classroomGrade.displayName": "{{grade}}年{{name}}班" },
    en: { "classroomGrade.displayName": "Grade {{grade}} Class {{name}}" },
  };
  const makeT =
    (lang: "zh" | "en") =>
    (key: string, options?: Record<string, unknown>): string => {
      const template = templates[lang][key] ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
        String(options?.[k] ?? ""),
      );
    };
  const zhT = makeT("zh");
  const enT = makeT("en");

  it("combines grade and name (zh)", () => {
    expect(formatClassroomDisplayName(zhT, { name: "12", grade: 8 })).toBe(
      "8年12班",
    );
    expect(formatClassroomDisplayName(zhT, { name: "A", grade: 9 })).toBe(
      "9年A班",
    );
  });

  it("combines grade and name (en)", () => {
    expect(formatClassroomDisplayName(enT, { name: "12", grade: 8 })).toBe(
      "Grade 8 Class 12",
    );
  });

  it("trims the name before combining", () => {
    expect(formatClassroomDisplayName(zhT, { name: " 12 ", grade: 8 })).toBe(
      "8年12班",
    );
  });

  it("returns the raw name when grade is missing or invalid", () => {
    expect(formatClassroomDisplayName(zhT, { name: "12" })).toBe("12");
    expect(formatClassroomDisplayName(zhT, { name: "12", grade: null })).toBe(
      "12",
    );
    expect(formatClassroomDisplayName(zhT, { name: "12", grade: 0 })).toBe(
      "12",
    );
    expect(formatClassroomDisplayName(zhT, { name: "12", grade: 13 })).toBe(
      "12",
    );
    expect(formatClassroomDisplayName(enT, { name: "12", grade: 2.5 })).toBe(
      "12",
    );
  });

  it("returns the raw name when it already contains 年 or 班", () => {
    expect(
      formatClassroomDisplayName(zhT, { name: "三年甲班", grade: 3 }),
    ).toBe("三年甲班");
    expect(formatClassroomDisplayName(zhT, { name: "8年級", grade: 8 })).toBe(
      "8年級",
    );
    expect(formatClassroomDisplayName(enT, { name: "資優班", grade: 5 })).toBe(
      "資優班",
    );
  });

  it("returns the raw name when it already contains Grade or Class (case-insensitive)", () => {
    expect(
      formatClassroomDisplayName(enT, { name: "Grade 8 A", grade: 8 }),
    ).toBe("Grade 8 A");
    expect(formatClassroomDisplayName(zhT, { name: "class B", grade: 4 })).toBe(
      "class B",
    );
    expect(
      formatClassroomDisplayName(enT, { name: "ClassRoom 1", grade: 4 }),
    ).toBe("ClassRoom 1");
  });

  it("returns the raw name when it is blank", () => {
    expect(formatClassroomDisplayName(zhT, { name: "  ", grade: 8 })).toBe(
      "  ",
    );
  });
});
