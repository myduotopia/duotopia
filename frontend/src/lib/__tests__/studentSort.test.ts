import { describe, it, expect } from "vitest";
import { compareStudentsBySeat, sortStudentsBySeat } from "../studentSort";

describe("sortStudentsBySeat", () => {
  it("座號小到大排，而且是數字感知的（2 在 10 之前）", () => {
    const sorted = sortStudentsBySeat([
      { name: "Cara", student_number: "10" },
      { name: "Amy", student_number: "2" },
      { name: "Ben", student_number: "1" },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["Ben", "Amy", "Cara"]);
  });

  it("前綴 0 的座號也照數字排", () => {
    const sorted = sortStudentsBySeat([
      { name: "Cara", student_number: "010" },
      { name: "Amy", student_number: "002" },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["Amy", "Cara"]);
  });

  it("沒有座號的排在有座號的後面，彼此再依姓名", () => {
    const sorted = sortStudentsBySeat([
      { name: "Zoe" },
      { name: "Amy", student_number: "5" },
      { name: "Ben" },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["Amy", "Ben", "Zoe"]);
  });

  it("空字串與空白的座號等同沒有座號", () => {
    const sorted = sortStudentsBySeat([
      { name: "Zoe", student_number: "" },
      { name: "Ben", student_number: "   " },
      { name: "Amy", student_number: "7" },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["Amy", "Ben", "Zoe"]);
  });

  it("null 座號等同沒有座號", () => {
    const sorted = sortStudentsBySeat([
      { name: "Zoe", student_number: null },
      { name: "Amy", student_number: "7" },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["Amy", "Zoe"]);
  });

  it("座號撞號時退回姓名，排序才穩定", () => {
    const sorted = sortStudentsBySeat([
      { name: "Ben", student_number: "3" },
      { name: "Amy", student_number: "3" },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["Amy", "Ben"]);
  });

  it("不改動傳進來的陣列", () => {
    const input = [
      { name: "Cara", student_number: "10" },
      { name: "Amy", student_number: "2" },
    ];
    sortStudentsBySeat(input);
    expect(input.map((s) => s.name)).toEqual(["Cara", "Amy"]);
  });

  it("compareStudentsBySeat 可直接餵給 Array.prototype.sort", () => {
    const sorted = [{ name: "Zoe" }, { name: "Amy", student_number: "1" }].sort(
      compareStudentsBySeat,
    );
    expect(sorted[0].name).toBe("Amy");
  });
});
