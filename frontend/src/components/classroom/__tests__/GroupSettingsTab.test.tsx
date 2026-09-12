import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { GroupSettingsTab } from "../GroupSettingsTab";
import type { StudentGroup } from "@/lib/studentGroup";

const mockGetClassroomGroups = vi.fn();
const mockCreateClassroomGroup = vi.fn();
const mockUpdateClassroomGroup = vi.fn();
const mockDeleteClassroomGroup = vi.fn();
const mockReorderClassroomGroups = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    getClassroomGroups: (...a: unknown[]) => mockGetClassroomGroups(...a),
    createClassroomGroup: (...a: unknown[]) => mockCreateClassroomGroup(...a),
    updateClassroomGroup: (...a: unknown[]) => mockUpdateClassroomGroup(...a),
    deleteClassroomGroup: (...a: unknown[]) => mockDeleteClassroomGroup(...a),
    reorderClassroomGroups: (...a: unknown[]) =>
      mockReorderClassroomGroups(...a),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// i18n：直接回 key，斷言時才不會綁在中文字串上。
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && "count" in opts) return `${key}:${opts.count}`;
      if (opts && "number" in opts) return `${key}:${opts.number}`;
      return key;
    },
  }),
}));

const STUDENTS = [
  { id: 1, name: "Amy", student_number: "01" },
  { id: 2, name: "Ben", student_number: "02" },
  { id: 3, name: "Cara", student_number: "03" },
];

function group(overrides: Partial<StudentGroup> = {}): StudentGroup {
  return {
    id: 10,
    classroom_id: 5,
    name: "第一組",
    color: "amber",
    leader_student_id: null,
    sort_order: 0,
    members: [],
    ...overrides,
  };
}

function renderTab(props = {}) {
  return render(
    <GroupSettingsTab classroomId={5} students={STUDENTS} {...props} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClassroomGroups.mockResolvedValue([]);
});

describe("GroupSettingsTab", () => {
  it("載入時抓取該班級的分組", async () => {
    renderTab();
    await waitFor(() => expect(mockGetClassroomGroups).toHaveBeenCalledWith(5));
  });

  it("沒有選中組別時，名冊的學生不可點選", async () => {
    mockGetClassroomGroups.mockResolvedValue([group()]);
    renderTab();

    const amy = await screen.findByRole("button", { name: /Amy/ });
    expect(amy).toBeDisabled();
  });

  it("勾選學生後送出的是整包成員，索引即 sort_order", async () => {
    mockGetClassroomGroups.mockResolvedValue([group()]);
    mockUpdateClassroomGroup.mockImplementation(async (_id, payload) =>
      group({
        members: payload.member_student_ids.map((sid: number, i: number) => ({
          student_id: sid,
          name: String(sid),
          student_number: null,
          sort_order: i,
        })),
      }),
    );
    renderTab();

    fireEvent.click(await screen.findByText("第一組"));
    fireEvent.click(screen.getByRole("button", { name: /Amy/ }));

    await waitFor(() => expect(mockUpdateClassroomGroup).toHaveBeenCalled());
    const [, payload] = mockUpdateClassroomGroup.mock.calls[0];
    expect(payload.member_student_ids).toEqual([1]);
  });

  it("連續勾選多位學生時，寫入是序列化的而非同時併發", async () => {
    mockGetClassroomGroups.mockResolvedValue([group()]);
    let inFlight = 0;
    let maxInFlight = 0;
    mockUpdateClassroomGroup.mockImplementation(async (_id, payload) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return group({
        members: payload.member_student_ids.map((sid: number, i: number) => ({
          student_id: sid,
          name: String(sid),
          student_number: null,
          sort_order: i,
        })),
      });
    });

    renderTab();
    fireEvent.click(await screen.findByText("第一組"));
    fireEvent.click(screen.getByRole("button", { name: /Amy/ }));
    fireEvent.click(screen.getByRole("button", { name: /Ben/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cara/ }));

    await waitFor(() =>
      expect(screen.getByText("classroomDetail.groups.saved")).toBeTruthy(),
    );
    expect(maxInFlight).toBe(1);

    // 佇列會合併：同一組排隊中的草稿被後來的覆寫，所以呼叫次數少於點擊次數，
    // 而最後一次送出的一定是最新的完整成員名單。
    const calls = mockUpdateClassroomGroup.mock.calls;
    expect(calls[calls.length - 1][1].member_student_ids).toEqual([1, 2, 3]);
  });

  it("移除的學生剛好是組長時，一併把組長清掉", async () => {
    mockGetClassroomGroups.mockResolvedValue([
      group({
        leader_student_id: 1,
        members: [
          {
            student_id: 1,
            name: "Amy",
            student_number: "01",
            sort_order: 0,
          },
        ],
      }),
    ]);
    mockUpdateClassroomGroup.mockResolvedValue(group());
    renderTab();

    fireEvent.click(await screen.findByText("第一組"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "classroomDetail.groups.removeMember",
      }),
    );

    await waitFor(() => expect(mockUpdateClassroomGroup).toHaveBeenCalled());
    const [, payload] = mockUpdateClassroomGroup.mock.calls[0];
    expect(payload.member_student_ids).toEqual([]);
    expect(payload.leader_student_id).toBeNull();
  });

  it("新增組別時跳過已被用掉的預設編號", async () => {
    // 已經有「第 1 組」，所以新的一組必須是「第 2 組」而不是再撞一次 —— 組別
    // 是按下按鈕當下就建立的，老師沒機會先改名避開 409。
    mockGetClassroomGroups.mockResolvedValue([
      group({ id: 10, name: "classroomDetail.groups.defaultName:1" }),
    ]);
    mockCreateClassroomGroup.mockResolvedValue(group({ id: 11 }));
    renderTab();

    fireEvent.click(
      await screen.findByRole("button", {
        name: /classroomDetail.groups.addGroup/,
      }),
    );

    await waitFor(() => expect(mockCreateClassroomGroup).toHaveBeenCalled());
    const [, payload] = mockCreateClassroomGroup.mock.calls[0];
    expect(payload.name).toBe("classroomDetail.groups.defaultName:2");
    expect(payload.member_student_ids).toEqual([]);
    expect(payload.leader_student_id).toBeNull();
  });

  it("defaultName 漏了 number 佔位符時不會無限迴圈", async () => {
    // 佔位符沒被代入的話名稱永遠不變，沒有上限就會把分頁卡死。
    mockGetClassroomGroups.mockResolvedValue([
      group({ id: 10, name: "classroomDetail.groups.defaultName:1" }),
      group({ id: 11, name: "classroomDetail.groups.defaultName:2" }),
      group({ id: 12, name: "classroomDetail.groups.defaultName:3" }),
    ]);
    mockCreateClassroomGroup.mockResolvedValue(group({ id: 13 }));
    renderTab();

    fireEvent.click(
      await screen.findByRole("button", {
        name: /classroomDetail.groups.addGroup/,
      }),
    );

    await waitFor(() => expect(mockCreateClassroomGroup).toHaveBeenCalled());
    expect(mockCreateClassroomGroup.mock.calls[0][1].name).toBe(
      "classroomDetail.groups.defaultName:4",
    );
  });
});
