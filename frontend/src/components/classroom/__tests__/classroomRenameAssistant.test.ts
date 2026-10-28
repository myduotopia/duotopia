import { describe, it, expect } from "vitest";
import { makeBatchEditRows } from "../batchEditClassrooms";
import {
  AI_HISTORY_TURNS,
  buildAiHistory,
  describeAiChange,
  mapAiChanges,
  toAiRequestClassrooms,
  type AssistantHistoryMessage,
} from "../classroomRenameAssistant";

const rows = makeBatchEditRows<string>([
  { id: "11", name: "八年12班", grade: null },
  { id: "12", name: "七年3班", grade: 7 },
]);

describe("toAiRequestClassrooms", () => {
  it("sends the table's current values with numeric ids", () => {
    const edited = [{ ...rows[0], name: "x".repeat(120) }, rows[1]];
    expect(toAiRequestClassrooms(edited)).toEqual([
      { id: 11, name: "x".repeat(100), grade: null },
      { id: 12, name: "七年3班", grade: 7 },
    ]);
  });
});

describe("buildAiHistory", () => {
  it("keeps only the last 10 turns and skips error notes", () => {
    const messages: AssistantHistoryMessage[] = [];
    for (let i = 0; i < 12; i++) {
      messages.push({ role: "user", content: `u${i}` });
      messages.push({ role: "assistant", content: `a${i}` });
    }
    messages.push({
      role: "assistant",
      content: "AI unavailable",
      error: true,
    });
    const history = buildAiHistory(messages);
    expect(history).toHaveLength(AI_HISTORY_TURNS * 2);
    expect(history[0]).toEqual({ role: "user", content: "u2" });
    expect(history[history.length - 1]).toEqual({
      role: "assistant",
      content: "a11",
    });
  });

  it("drops empty assistant messages", () => {
    expect(
      buildAiHistory([
        { role: "user", content: "hi" },
        { role: "assistant", content: "  " },
      ]),
    ).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("mapAiChanges", () => {
  it("maps numeric ids back to table ids and drops unknown or empty changes", () => {
    expect(
      mapAiChanges(rows, [
        { id: 11, name: "12", grade: 8 },
        { id: 99, name: "nope" },
        { id: 12 },
      ]),
    ).toEqual([{ id: "11", name: "12", grade: 8 }]);
  });
});

describe("describeAiChange", () => {
  it("describes name and grade before → after", () => {
    expect(
      describeAiChange(rows[0], { id: "11", name: "12", grade: 8 }),
    ).toEqual({
      fromName: "八年12班",
      toName: "12",
      nameChanged: true,
      fromGrade: null,
      toGrade: 8,
      gradeChanged: true,
    });
  });

  it("marks unchanged fields", () => {
    const d = describeAiChange(rows[1], { id: "12", name: " 七年3班 " });
    expect(d.nameChanged).toBe(false);
    expect(d.gradeChanged).toBe(false);
  });
});
