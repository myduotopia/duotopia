import { describe, it, expect } from "vitest";
import {
  CLASSROOM_NAME_MAX_LENGTH,
  applyBatchEditChanges,
  batchEditRowNameError,
  buildBatchEditItems,
  isBatchEditRowAiChanged,
  isBatchEditRowChanged,
  makeBatchEditRows,
  setAllBatchEditGrades,
  validateClassroomName,
} from "../batchEditClassrooms";

const classrooms = [
  { id: 1, name: "八年12班", grade: null },
  { id: 2, name: "3", grade: 7 },
  { id: 3, name: "忠班", grade: 5, is_active: false },
];

describe("makeBatchEditRows", () => {
  it("keeps the original values and the inactive flag", () => {
    const rows = makeBatchEditRows(classrooms);
    expect(rows.map((r) => [r.id, r.name, r.grade, r.inactive])).toEqual([
      [1, "八年12班", null, false],
      [2, "3", 7, false],
      [3, "忠班", 5, true],
    ]);
    expect(rows.every((r) => !isBatchEditRowChanged(r))).toBe(true);
  });
});

describe("buildBatchEditItems", () => {
  it("sends only changed rows and only their changed fields", () => {
    let rows = makeBatchEditRows(classrooms);
    rows = applyBatchEditChanges(
      rows,
      [
        { id: 1, name: " 12 ", grade: 8 },
        { id: 2, grade: 7 }, // 同原值，不算變動
        { id: 3, name: "忠班" }, // 同原值
      ],
      "manual",
    );
    expect(buildBatchEditItems(rows)).toEqual([
      { id: 1, name: "12", grade: 8 },
    ]);
  });

  it("treats a name changed back to the original (ignoring spaces) as unchanged", () => {
    let rows = makeBatchEditRows(classrooms);
    rows = applyBatchEditChanges(rows, [{ id: 2, name: "4" }], "manual");
    expect(isBatchEditRowChanged(rows[1])).toBe(true);
    rows = applyBatchEditChanges(rows, [{ id: 2, name: " 3 " }], "manual");
    expect(isBatchEditRowChanged(rows[1])).toBe(false);
    expect(buildBatchEditItems(rows)).toEqual([]);
  });

  it("allows a rename-only save for a row that stays unset", () => {
    let rows = makeBatchEditRows(classrooms);
    rows = applyBatchEditChanges(rows, [{ id: 1, name: "12" }], "manual");
    expect(buildBatchEditItems(rows)).toEqual([{ id: 1, name: "12" }]);
  });
});

describe("applyBatchEditChanges", () => {
  it("ignores unknown ids and invalid grades (grade cannot be cleared)", () => {
    const rows = makeBatchEditRows(classrooms);
    const next = applyBatchEditChanges(
      rows,
      [
        { id: 99, name: "ghost" },
        { id: 2, grade: 13 },
        { id: 3, grade: 0 },
      ],
      "ai",
    );
    expect(buildBatchEditItems(next)).toEqual([]);
  });

  it("uses the last change for a repeated id and records the source", () => {
    const rows = makeBatchEditRows(classrooms);
    const next = applyBatchEditChanges(
      rows,
      [
        { id: 2, name: "A" },
        { id: 2, name: "B" },
      ],
      "ai",
    );
    expect(next[1].name).toBe("B");
    expect(isBatchEditRowAiChanged(next[1])).toBe(true);
    // 人工再改後換成人工標記
    const manual = applyBatchEditChanges(
      next,
      [{ id: 2, name: "C" }],
      "manual",
    );
    expect(isBatchEditRowAiChanged(manual[1])).toBe(false);
    expect(isBatchEditRowChanged(manual[1])).toBe(true);
  });
});

describe("setAllBatchEditGrades", () => {
  it("sets every row's grade, including unset ones, without touching names", () => {
    const rows = setAllBatchEditGrades(makeBatchEditRows(classrooms), 7);
    expect(rows.map((r) => [r.name, r.grade])).toEqual([
      ["八年12班", 7],
      ["3", 7],
      ["忠班", 7],
    ]);
    expect(buildBatchEditItems(rows)).toEqual([
      { id: 1, grade: 7 },
      { id: 3, grade: 7 },
    ]);
  });
});

describe("name validation", () => {
  it("requires 1–100 characters after trimming", () => {
    expect(validateClassroomName("")).toBe("required");
    expect(validateClassroomName("   ")).toBe("required");
    expect(validateClassroomName("a".repeat(CLASSROOM_NAME_MAX_LENGTH))).toBe(
      null,
    );
    expect(
      validateClassroomName("a".repeat(CLASSROOM_NAME_MAX_LENGTH + 1)),
    ).toBe("tooLong");
  });

  it("only checks rows whose name changed", () => {
    const rows = makeBatchEditRows([{ id: 1, name: "  ", grade: 3 }]);
    expect(batchEditRowNameError(rows[0])).toBe(null);
    const edited = applyBatchEditChanges(rows, [{ id: 1, name: "" }], "manual");
    // 去空白後與原值相同（都是空字串）→ 不算變動、不擋
    expect(batchEditRowNameError(edited[0])).toBe(null);
    const cleared = applyBatchEditChanges(
      makeBatchEditRows([{ id: 1, name: "A", grade: 3 }]),
      [{ id: 1, name: " " }],
      "manual",
    );
    expect(batchEditRowNameError(cleared[0])).toBe("required");
  });
});
