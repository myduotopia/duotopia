import { describe, expect, it } from "vitest";

import {
  AWAITING_GRADING_STATUSES,
  findNextUngradedStudent,
} from "./nextStudent";

const s = (student_id: number, status: string) => ({ student_id, status });

describe("findNextUngradedStudent (#1088)", () => {
  it("exports the platform definition of awaiting grading", () => {
    expect([...AWAITING_GRADING_STATUSES].sort()).toEqual([
      "RESUBMITTED",
      "SUBMITTED",
    ]);
  });

  it("returns the next awaiting student after the current one", () => {
    const list = [s(1, "GRADED"), s(2, "SUBMITTED"), s(3, "SUBMITTED")];
    expect(findNextUngradedStudent(list, 2)?.student_id).toBe(3);
  });

  it("wraps around to the top when nothing is left below", () => {
    const list = [s(1, "RESUBMITTED"), s(2, "GRADED"), s(3, "SUBMITTED")];
    expect(findNextUngradedStudent(list, 3)?.student_id).toBe(1);
  });

  it("skips GRADED / IN_PROGRESS / NOT_STARTED / NOT_ASSIGNED", () => {
    const list = [
      s(1, "SUBMITTED"),
      s(2, "GRADED"),
      s(3, "IN_PROGRESS"),
      s(4, "NOT_STARTED"),
      s(5, "NOT_ASSIGNED"),
      s(6, "RESUBMITTED"),
    ];
    expect(findNextUngradedStudent(list, 1)?.student_id).toBe(6);
  });

  it("returns null when no other student is awaiting grading", () => {
    const list = [s(1, "GRADED"), s(2, "SUBMITTED"), s(3, "IN_PROGRESS")];
    // 目前學生本人即使仍是 SUBMITTED 也要跳過
    expect(findNextUngradedStudent(list, 2)).toBeNull();
    expect(findNextUngradedStudent([], 2)).toBeNull();
  });

  it("starts from the top when the current student is not in the list", () => {
    const list = [s(1, "GRADED"), s(2, "SUBMITTED"), s(3, "SUBMITTED")];
    expect(findNextUngradedStudent(list, 99)?.student_id).toBe(2);
    expect(findNextUngradedStudent(list, null)?.student_id).toBe(2);
  });
});
