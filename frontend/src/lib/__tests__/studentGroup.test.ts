import { describe, it, expect } from "vitest";
import {
  buildStudentGroupIndex,
  isGroupColor,
  toggleGroupInSelection,
  type StudentGroup,
} from "../studentGroup";

function group(overrides: Partial<StudentGroup> = {}): StudentGroup {
  return {
    id: 1,
    classroom_id: 5,
    name: "第一組",
    color: "amber",
    leader_student_id: null,
    sort_order: 0,
    members: [],
    ...overrides,
  };
}

function member(student_id: number, sort_order: number) {
  return {
    student_id,
    name: `S${student_id}`,
    student_number: null,
    sort_order,
  };
}

describe("buildStudentGroupIndex", () => {
  it("把組別→成員翻轉成學生→組別，序號是給人看的 1 起算", () => {
    const index = buildStudentGroupIndex([
      group({ members: [member(1, 0), member(2, 1)] }),
    ]);
    expect(index.get(1)?.[0].order).toBe(1);
    expect(index.get(2)?.[0].order).toBe(2);
  });

  it("一個學生可以屬於多組，每組各有自己的序號", () => {
    const index = buildStudentGroupIndex([
      group({ id: 1, name: "英文組", sort_order: 0, members: [member(7, 0)] }),
      group({
        id: 2,
        name: "打掃組",
        sort_order: 1,
        members: [member(9, 0), member(7, 1)],
      }),
    ]);
    const memberships = index.get(7) ?? [];
    expect(memberships.map((m) => m.groupName)).toEqual(["英文組", "打掃組"]);
    expect(memberships.map((m) => m.order)).toEqual([1, 2]);
  });

  it("組別依 sort_order 排，所以同一列的徽章順序是穩定的", () => {
    const index = buildStudentGroupIndex([
      group({ id: 2, name: "B", sort_order: 1, members: [member(1, 0)] }),
      group({ id: 1, name: "A", sort_order: 0, members: [member(1, 0)] }),
    ]);
    expect(index.get(1)?.map((m) => m.groupName)).toEqual(["A", "B"]);
  });

  it("只有該組的組長會被標成 leader", () => {
    const index = buildStudentGroupIndex([
      group({
        id: 1,
        leader_student_id: 2,
        members: [member(1, 0), member(2, 1)],
      }),
    ]);
    expect(index.get(1)?.[0].isLeader).toBe(false);
    expect(index.get(2)?.[0].isLeader).toBe(true);
  });

  it("成員的 sort_order 亂序時仍依 sort_order 決定序號", () => {
    const index = buildStudentGroupIndex([
      group({ members: [member(1, 2), member(2, 0), member(3, 1)] }),
    ]);
    expect(index.get(2)?.[0].order).toBe(1);
    expect(index.get(3)?.[0].order).toBe(2);
    expect(index.get(1)?.[0].order).toBe(3);
  });

  it("沒有任何組別時回傳空 index", () => {
    expect(buildStudentGroupIndex([]).size).toBe(0);
  });
});

describe("toggleGroupInSelection", () => {
  it("整組未全選時是加入聯集，不會清掉已勾選的其他學生", () => {
    expect(toggleGroupInSelection([99], [1, 2])).toEqual([99, 1, 2]);
  });

  it("整組都已選時才整組移除，其他學生留著", () => {
    expect(toggleGroupInSelection([99, 1, 2], [1, 2])).toEqual([99]);
  });

  it("取消過其中一位後再點一次是補齊，不是清空", () => {
    // 老師點了整組 → 取消 2（請假）→ 再點 chip 應該把 2 補回來
    const afterUntick = [1, 3];
    expect(toggleGroupInSelection(afterUntick, [1, 2, 3]).sort()).toEqual([
      1, 2, 3,
    ]);
  });

  it("同一位學生屬於兩組時不會被加進去兩次", () => {
    expect(toggleGroupInSelection([1], [1, 2])).toEqual([1, 2]);
  });

  it("空組別不動現有勾選", () => {
    const selected = [1, 2];
    expect(toggleGroupInSelection(selected, [])).toBe(selected);
  });

  it("不改動傳進來的陣列", () => {
    const selected = [1, 2];
    toggleGroupInSelection(selected, [3]);
    expect(selected).toEqual([1, 2]);
  });
});

describe("isGroupColor", () => {
  it("只認可色票裡的 key", () => {
    expect(isGroupColor("amber")).toBe(true);
    expect(isGroupColor("#ff0000")).toBe(false);
    expect(isGroupColor(null)).toBe(false);
    expect(isGroupColor(undefined)).toBe(false);
  });
});
