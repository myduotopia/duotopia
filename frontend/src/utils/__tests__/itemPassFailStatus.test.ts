import { describe, it, expect } from "vitest";
import { getItemPassFailStatus } from "../itemPassFailStatus";

describe("getItemPassFailStatus", () => {
  describe("teacher_passed === true (老師打勾)", () => {
    it("always passed regardless of state / score", () => {
      expect(
        getItemPassFailStatus({
          teacherPassed: true,
          aiScore: 30,
          assignmentStatus: "RETURNED",
        }),
      ).toEqual({ passed: true, failed: false });

      expect(
        getItemPassFailStatus({
          teacherPassed: true,
          aiScore: null,
          assignmentStatus: "IN_PROGRESS",
        }),
      ).toEqual({ passed: true, failed: false });
    });
  });

  describe("teacher_passed === false (老師打叉，要求訂正)", () => {
    it("always failed regardless of state / score", () => {
      expect(
        getItemPassFailStatus({
          teacherPassed: false,
          aiScore: 95,
          assignmentStatus: "RETURNED",
        }),
      ).toEqual({ passed: false, failed: true });

      expect(
        getItemPassFailStatus({
          teacherPassed: false,
          aiScore: null,
          assignmentStatus: "IN_PROGRESS",
        }),
      ).toEqual({ passed: false, failed: true });
    });
  });

  describe("teacher_passed === null in RETURNED mode (核心修法)", () => {
    it("does NOT auto-pass via AI score >= 60", () => {
      expect(
        getItemPassFailStatus({
          teacherPassed: null,
          aiScore: 95,
          assignmentStatus: "RETURNED",
        }),
      ).toEqual({ passed: false, failed: false });
    });

    it("does NOT auto-fail via AI score < 60 either (yellow / pending)", () => {
      expect(
        getItemPassFailStatus({
          teacherPassed: null,
          aiScore: 30,
          assignmentStatus: "RETURNED",
        }),
      ).toEqual({ passed: false, failed: false });
    });

    it("undefined teacherPassed treated same as null", () => {
      expect(
        getItemPassFailStatus({
          teacherPassed: undefined,
          aiScore: 95,
          assignmentStatus: "RETURNED",
        }),
      ).toEqual({ passed: false, failed: false });
    });
  });

  describe("teacher_passed === null in RESUBMITTED mode (第二次訂正週期)", () => {
    it("does NOT auto-pass via AI score >= 60", () => {
      expect(
        getItemPassFailStatus({
          teacherPassed: null,
          aiScore: 95,
          assignmentStatus: "RESUBMITTED",
        }),
      ).toEqual({ passed: false, failed: false });
    });

    it("does NOT auto-fail via AI score < 60 either (yellow / pending)", () => {
      expect(
        getItemPassFailStatus({
          teacherPassed: null,
          aiScore: 30,
          assignmentStatus: "RESUBMITTED",
        }),
      ).toEqual({ passed: false, failed: false });
    });

    it("undefined teacherPassed treated same as null", () => {
      expect(
        getItemPassFailStatus({
          teacherPassed: undefined,
          aiScore: 80,
          assignmentStatus: "RESUBMITTED",
        }),
      ).toEqual({ passed: false, failed: false });
    });

    it("AI score 59 (just below threshold) → still neither (no AI fallback)", () => {
      expect(
        getItemPassFailStatus({
          teacherPassed: null,
          aiScore: 59,
          assignmentStatus: "RESUBMITTED",
        }),
      ).toEqual({ passed: false, failed: false });
    });
  });

  describe("teacher_passed === null in non-RETURNED mode (AI fallback)", () => {
    it("AI score >= 60 → passed (self-feedback)", () => {
      expect(
        getItemPassFailStatus({
          teacherPassed: null,
          aiScore: 60,
          assignmentStatus: "IN_PROGRESS",
        }),
      ).toEqual({ passed: true, failed: false });
    });

    it("AI score < 60 → failed", () => {
      expect(
        getItemPassFailStatus({
          teacherPassed: null,
          aiScore: 59,
          assignmentStatus: "SUBMITTED",
        }),
      ).toEqual({ passed: false, failed: true });
    });

    it("no AI score → neither (待分析)", () => {
      expect(
        getItemPassFailStatus({
          teacherPassed: null,
          aiScore: null,
          assignmentStatus: "IN_PROGRESS",
        }),
      ).toEqual({ passed: false, failed: false });
    });

    it("AI score === 60 (boundary) → passed", () => {
      expect(
        getItemPassFailStatus({
          teacherPassed: null,
          aiScore: 60,
          assignmentStatus: "GRADED",
        }),
      ).toEqual({ passed: true, failed: false });
    });
  });
});
