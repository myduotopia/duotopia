import { describe, it, expect } from "vitest";
import {
  CEFR_LEVELS,
  LEVEL_ORDER,
  getLevelBadgeClass,
  getLevelLabel,
  getLevelSortValue,
  normalizeLevel,
} from "../classroomLevel";

describe("CEFR_LEVELS", () => {
  it("lists Pre-A then A1…C2 with backend values", () => {
    expect(CEFR_LEVELS.map((l) => l.value)).toEqual([
      "preA",
      "A1",
      "A2",
      "B1",
      "B2",
      "C1",
      "C2",
    ]);
    expect(CEFR_LEVELS[0].label).toBe("Pre-A");
  });

  it("LEVEL_ORDER follows the CEFR_LEVELS order", () => {
    CEFR_LEVELS.forEach((l, i) => {
      expect(LEVEL_ORDER[l.value]).toBe(i);
    });
  });
});

describe("normalizeLevel", () => {
  it("accepts the various Pre-A spellings", () => {
    expect(normalizeLevel("preA")).toBe("preA");
    expect(normalizeLevel("PREA")).toBe("preA");
    expect(normalizeLevel("PRE_A")).toBe("preA");
    expect(normalizeLevel("pre-a")).toBe("preA");
  });

  it("is case-insensitive for A1–C2 and trims whitespace", () => {
    expect(normalizeLevel("a1")).toBe("A1");
    expect(normalizeLevel(" b2 ")).toBe("B2");
    expect(normalizeLevel("C2")).toBe("C2");
  });

  it("returns null for empty or unknown values", () => {
    expect(normalizeLevel(undefined)).toBeNull();
    expect(normalizeLevel(null)).toBeNull();
    expect(normalizeLevel("")).toBeNull();
    expect(normalizeLevel("D1")).toBeNull();
  });
});

describe("getLevelSortValue", () => {
  it("orders Pre-A < A1 < … < C2 and puts unknown last", () => {
    const sorted = ["C2", "a1", "PREA", "B1", "xx", undefined].sort(
      (a, b) => getLevelSortValue(a) - getLevelSortValue(b),
    );
    expect(sorted.slice(0, 4)).toEqual(["PREA", "a1", "B1", "C2"]);
    expect(getLevelSortValue("xx")).toBeGreaterThan(getLevelSortValue("C2"));
    expect(getLevelSortValue(undefined)).toBeGreaterThan(
      getLevelSortValue("C2"),
    );
  });
});

describe("getLevelLabel", () => {
  it("shows Pre-A for any Pre-A spelling", () => {
    expect(getLevelLabel("preA")).toBe("Pre-A");
    expect(getLevelLabel("PREA")).toBe("Pre-A");
  });

  it("normalises A1–C2 and defaults blank to A1", () => {
    expect(getLevelLabel("b1")).toBe("B1");
    expect(getLevelLabel(undefined)).toBe("A1");
    expect(getLevelLabel("")).toBe("A1");
  });

  it("keeps unknown values as-is", () => {
    expect(getLevelLabel("Custom")).toBe("Custom");
  });
});

describe("getLevelBadgeClass", () => {
  it("returns per-level colours with dark-mode classes", () => {
    expect(getLevelBadgeClass("A1")).toContain("bg-green-100");
    expect(getLevelBadgeClass("a2")).toContain("bg-blue-100");
    expect(getLevelBadgeClass("C2")).toContain("dark:");
  });

  it("treats blank as A1 and unknown as neutral gray", () => {
    expect(getLevelBadgeClass(undefined)).toBe(getLevelBadgeClass("A1"));
    expect(getLevelBadgeClass("zzz")).toContain("bg-gray-100");
    expect(getLevelBadgeClass("PREA")).toContain("bg-gray-100");
  });
});
