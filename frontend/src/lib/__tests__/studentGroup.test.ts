import { describe, it, expect } from "vitest";
import {
  buildOrderOptions,
  buildStudentGroupIndex,
  createScope,
  EMPTY_SCOPE,
  isGroupColor,
  resolveStudentScope,
  type StudentGroup,
  type StudentScope,
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

describe("resolveStudentScope", () => {
  // 第一組 A B C D、第二組 D E F G —— D 同時屬於兩組，正是踩到 bug 的組合。
  const A = 1;
  const B = 2;
  const C = 3;
  const D = 4;
  const E = 5;
  const F = 6;
  const G = 7;
  const ALL = [A, B, C, D, E, F, G];
  const GROUPS = [
    group({
      id: 1,
      name: "第一組",
      sort_order: 0,
      members: [member(A, 0), member(B, 1), member(C, 2), member(D, 3)],
    }),
    group({
      id: 2,
      name: "第二組",
      sort_order: 1,
      members: [member(D, 0), member(E, 1), member(F, 2), member(G, 3)],
    }),
  ];

  function scope(overrides: Partial<StudentScope>): StudentScope {
    return { ...EMPTY_SCOPE, ...overrides };
  }

  it("選兩組後取消其中一組，重疊的成員仍被留下的那組涵蓋", () => {
    // 這是 issue #1046 回報的 bug：選第一組 → 選第二組 → 取消第二組，
    // D 同時在第一組裡，不可以跟著第二組一起被拿掉。
    const both = scope({ mode: "groups", groupIds: [1, 2] });
    expect(resolveStudentScope(both, ALL, GROUPS)).toEqual([
      A,
      B,
      C,
      D,
      E,
      F,
      G,
    ]);

    const onlyFirst = scope({ mode: "groups", groupIds: [1] });
    expect(resolveStudentScope(onlyFirst, ALL, GROUPS)).toEqual([A, B, C, D]);
  });

  it("兩組的聯集裡重疊成員只出現一次", () => {
    const both = scope({ mode: "groups", groupIds: [1, 2] });
    const result = resolveStudentScope(both, ALL, GROUPS);
    expect(result.filter((id) => id === D)).toHaveLength(1);
  });

  it("all 模式就是全班", () => {
    expect(resolveStudentScope(scope({ mode: "all" }), ALL, GROUPS)).toEqual(
      ALL,
    );
  });

  it("manual 模式基底為空，只剩手動勾選的人", () => {
    const s = scope({ mode: "manual", included: [B, E] });
    expect(resolveStudentScope(s, ALL, GROUPS)).toEqual([B, E]);
  });

  it("orders 模式跨組別取該序位的學生", () => {
    // 第 1 號＝第一組的 A 與第二組的 D
    const s = scope({ mode: "orders", orders: [1] });
    expect(resolveStudentScope(s, ALL, GROUPS)).toEqual([A, D]);
  });

  it("orders 模式可複選多個序位", () => {
    const s = scope({ mode: "orders", orders: [1, 4] });
    // 第 1 號：A、D；第 4 號：D、G
    expect(resolveStudentScope(s, ALL, GROUPS)).toEqual([A, D, G]);
  });

  it("excluded 會從結果扣掉", () => {
    const s = scope({ mode: "groups", groupIds: [1], excluded: [D] });
    expect(resolveStudentScope(s, ALL, GROUPS)).toEqual([A, B, C]);
  });

  it("included 會加進基底之外的人", () => {
    const s = scope({ mode: "groups", groupIds: [1], included: [G] });
    expect(resolveStudentScope(s, ALL, GROUPS)).toEqual([A, B, C, D, G]);
  });

  it("已離班的組員不會被算進來", () => {
    const withoutD = ALL.filter((id) => id !== D);
    const s = scope({ mode: "groups", groupIds: [1] });
    expect(resolveStudentScope(s, withoutD, GROUPS)).toEqual([A, B, C]);
  });

  it("回傳順序跟著傳進來的名冊順序，不是組別順序", () => {
    const reversed = [...ALL].reverse();
    const s = scope({ mode: "groups", groupIds: [1] });
    expect(resolveStudentScope(s, reversed, GROUPS)).toEqual([D, C, B, A]);
  });

  it("沒勾任何組別時結果為空", () => {
    const s = scope({ mode: "groups", groupIds: [] });
    expect(resolveStudentScope(s, ALL, GROUPS)).toEqual([]);
  });

  it("createScope 產生的 scope 沒有殘留的手動微調", () => {
    const s = createScope("all");
    expect(s.included).toEqual([]);
    expect(s.excluded).toEqual([]);
    expect(s.groupIds).toEqual([]);
    expect(s.orders).toEqual([]);
  });
});

describe("buildOrderOptions", () => {
  it("列出所有出現過的序位與各序位人數（跨組別）", () => {
    const options = buildOrderOptions([
      group({ id: 1, sort_order: 0, members: [member(1, 0), member(2, 1)] }),
      group({ id: 2, sort_order: 1, members: [member(3, 0)] }),
    ]);
    expect(options).toEqual([
      { order: 1, count: 2 },
      { order: 2, count: 1 },
    ]);
  });

  it("同一位學生在兩組都排第 1 時只算一個人", () => {
    const options = buildOrderOptions([
      group({ id: 1, sort_order: 0, members: [member(7, 0)] }),
      group({ id: 2, sort_order: 1, members: [member(7, 0)] }),
    ]);
    expect(options).toEqual([{ order: 1, count: 1 }]);
  });

  it("沒有組別時回傳空清單", () => {
    expect(buildOrderOptions([])).toEqual([]);
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
