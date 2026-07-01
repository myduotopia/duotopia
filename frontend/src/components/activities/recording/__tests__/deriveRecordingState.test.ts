import { describe, it, expect } from "vitest";
import { deriveRecordingState } from "../deriveRecordingState";

const base = {
  isRecording: false,
  hasRecordingUrl: false,
  hasAssessment: false,
};

describe("deriveRecordingState", () => {
  it("idle when nothing recorded", () => {
    expect(deriveRecordingState(base).state).toBe("idle");
  });

  it("recording takes top priority", () => {
    expect(
      deriveRecordingState({
        ...base,
        isRecording: true,
        hasRecordingUrl: true,
        hasAssessment: true,
      }).state,
    ).toBe("recording");
  });

  it("recorded when has recording but no assessment", () => {
    expect(
      deriveRecordingState({ ...base, hasRecordingUrl: true }).state,
    ).toBe("recorded");
  });

  it("assessed when assessment exists (even with recording)", () => {
    expect(
      deriveRecordingState({
        ...base,
        hasRecordingUrl: true,
        hasAssessment: true,
      }).state,
    ).toBe("assessed");
  });

  it("assessed wins even if hasRecordingUrl somehow false", () => {
    expect(
      deriveRecordingState({ ...base, hasAssessment: true }).state,
    ).toBe("assessed");
  });

  it("isCorrection true only for RETURNED status", () => {
    expect(deriveRecordingState(base).isCorrection).toBe(false);
    expect(
      deriveRecordingState({ ...base, assignmentStatus: "IN_PROGRESS" })
        .isCorrection,
    ).toBe(false);
    expect(
      deriveRecordingState({ ...base, assignmentStatus: "RETURNED" })
        .isCorrection,
    ).toBe(true);
  });
});
