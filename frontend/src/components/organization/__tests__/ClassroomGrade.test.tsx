/**
 * 機構後台班級年級（#1097）：ClassroomListTable 年級欄／勾選欄、
 * CreateClassroomDialog 與 EditClassroomDialog 的年級必填與 i18n。
 *
 * react-i18next 的 mock 直接讀 zh-TW translation.json，確保轉成 i18n 後
 * 中文畫面與原本寫死的文字一字不差。
 *
 * SchoolClassroomsPage 本身用 raw fetch + auth store + router 載入資料，
 * 這裡不測頁面層的篩選／批次調整接線。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClassroomListTable, type Classroom } from "../ClassroomListTable";
import { CreateClassroomDialog } from "../CreateClassroomDialog";
import { EditClassroomDialog } from "../EditClassroomDialog";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";

vi.mock("react-i18next", async () => {
  const zh = (await import("@/i18n/locales/zh-TW/translation.json")).default;
  const lookup = (key: string): unknown =>
    key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object"
            ? (node as Record<string, unknown>)[part]
            : undefined,
        zh,
      );
  return {
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        const template = lookup(key);
        if (typeof template !== "string") return key;
        return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
          String(opts?.[name] ?? ""),
        );
      },
      i18n: { language: "zh-TW" },
    }),
  };
});

vi.mock("@/lib/api", () => ({
  apiClient: {
    createSchoolClassroom: vi.fn(),
    updateSchoolClassroom: vi.fn(),
  },
  // classroomGrade.ts imports ApiError from this module
  ApiError: class ApiError extends Error {
    status?: number;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/utils/errorLogger", () => ({
  logError: vi.fn(),
}));

const baseClassroom: Classroom = {
  id: "1",
  name: "一年級 A 班",
  program_level: "A1",
  grade: 3,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  teacher_name: null,
  teacher_email: null,
  student_count: 0,
  assignment_count: 0,
  program_count: 0,
};

const classrooms: Classroom[] = [
  baseClassroom,
  { ...baseClassroom, id: "2", name: "二年級 B 班", grade: null },
  { ...baseClassroom, id: "3", name: "停用班", grade: 5, is_active: false },
];

describe("ClassroomListTable (#1097)", () => {
  it("renders the same zh-TW headers and badges as before the i18n conversion", () => {
    render(
      <ClassroomListTable
        classrooms={classrooms}
        onEdit={vi.fn()}
        onAssignHomework={vi.fn()}
      />,
    );

    for (const header of [
      "班級名稱",
      "語言程度",
      "年級",
      "導師",
      "學生數量",
      "派發作業",
      "狀態",
      "操作",
    ]) {
      expect(
        screen.getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByText("指派導師")).toHaveLength(3);
    expect(screen.getAllByText("派發")).toHaveLength(3);
    expect(screen.getAllByText("編輯")).toHaveLength(3);
    expect(screen.getAllByText("啟用")).toHaveLength(2);
    expect(screen.getByText("停用")).toBeInTheDocument();
  });

  it("renders the grade column with labels and 未設定", () => {
    render(<ClassroomListTable classrooms={classrooms} />);

    expect(screen.getByText("3 年級")).toBeInTheDocument();
    expect(screen.getByText("未設定")).toBeInTheDocument();
    expect(screen.getByText("5 年級")).toBeInTheDocument();
  });

  it("hides the checkbox column when selection props are not passed", () => {
    render(<ClassroomListTable classrooms={classrooms} />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("does not render a checkbox for inactive classrooms", () => {
    render(
      <ClassroomListTable
        classrooms={classrooms}
        selectedIds={new Set()}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: "選取 一年級 A 班" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "選取 二年級 B 班" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "選取 停用班" }),
    ).not.toBeInTheDocument();
  });

  it("calls onToggle and onToggleAll", () => {
    const onToggle = vi.fn();
    const onToggleAll = vi.fn();
    render(
      <ClassroomListTable
        classrooms={classrooms}
        selectedIds={new Set()}
        onToggle={onToggle}
        onToggleAll={onToggleAll}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "選取 一年級 A 班" }));
    expect(onToggle).toHaveBeenCalledWith("1", true);

    fireEvent.click(
      screen.getByRole("checkbox", { name: "全選目前列出的班級" }),
    );
    expect(onToggleAll).toHaveBeenCalledWith(true);
  });

  it("shows the header checkbox as checked when all selectable rows are selected", () => {
    render(
      <ClassroomListTable
        classrooms={classrooms}
        selectedIds={new Set(["1", "2"])}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: "全選目前列出的班級" }),
    ).toHaveAttribute("data-state", "checked");
  });
});

describe("CreateClassroomDialog (#1097)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the same zh-TW texts as before the i18n conversion", () => {
    render(
      <CreateClassroomDialog
        open={true}
        onOpenChange={vi.fn()}
        schoolId="school-1"
        schoolName="測試學校"
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText("建立新班級")).toBeInTheDocument();
    expect(
      screen.getByText("為 測試學校 建立一個新的班級"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("例如：一年級 A 班"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("班級描述（選填）")).toBeInTheDocument();
    expect(screen.getByLabelText("描述")).toBeInTheDocument();
    expect(screen.getByText("語言程度 *")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("blocks submit without a grade, then sends the chosen grade", async () => {
    vi.mocked(apiClient.createSchoolClassroom).mockResolvedValue({});
    const onSuccess = vi.fn();
    render(
      <CreateClassroomDialog
        open={true}
        onOpenChange={vi.fn()}
        schoolId="school-1"
        schoolName="Test School"
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByLabelText("班級名稱 *"), {
      target: { value: "三年級 C 班" },
    });
    fireEvent.click(screen.getByRole("button", { name: "建立" }));

    expect(toast.error).toHaveBeenCalledWith("請選擇年級");
    expect(apiClient.createSchoolClassroom).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("年級 *"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "建立" }));

    await waitFor(() => {
      expect(apiClient.createSchoolClassroom).toHaveBeenCalledWith(
        "school-1",
        expect.objectContaining({ name: "三年級 C 班", grade: 3 }),
      );
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("班級建立成功");
  });
});

describe("EditClassroomDialog (#1097)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the same zh-TW texts as before the i18n conversion", () => {
    render(
      <EditClassroomDialog
        open={true}
        onOpenChange={vi.fn()}
        classroom={baseClassroom}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText("編輯班級")).toBeInTheDocument();
    expect(screen.getByText("更新 一年級 A 班 的資訊")).toBeInTheDocument();
    expect(screen.getByLabelText("啟用班級")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "儲存" })).toBeInTheDocument();
  });

  it("requires picking a grade when the classroom has none", async () => {
    vi.mocked(apiClient.updateSchoolClassroom).mockResolvedValue({});
    render(
      <EditClassroomDialog
        open={true}
        onOpenChange={vi.fn()}
        classroom={{ ...baseClassroom, grade: null }}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    expect(toast.error).toHaveBeenCalledWith("請選擇年級");
    expect(apiClient.updateSchoolClassroom).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("年級 *"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(apiClient.updateSchoolClassroom).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ grade: 7 }),
      );
    });
  });

  it("prefills the existing grade and sends it on save", async () => {
    vi.mocked(apiClient.updateSchoolClassroom).mockResolvedValue({});
    render(
      <EditClassroomDialog
        open={true}
        onOpenChange={vi.fn()}
        classroom={baseClassroom}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("年級 *")).toHaveValue("3");
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(apiClient.updateSchoolClassroom).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ grade: 3 }),
      );
    });
  });

  it("discards unsaved edits when the dialog is cancelled and reopened", async () => {
    const props = {
      onOpenChange: vi.fn(),
      classroom: baseClassroom,
      onSuccess: vi.fn(),
    };
    const { rerender } = render(<EditClassroomDialog open={true} {...props} />);

    fireEvent.change(screen.getByLabelText("年級 *"), {
      target: { value: "9" },
    });
    expect(screen.getByLabelText("年級 *")).toHaveValue("9");

    // Cancel: the parent closes the dialog without saving
    rerender(<EditClassroomDialog open={false} {...props} />);
    // Reopen the same classroom
    rerender(<EditClassroomDialog open={true} {...props} />);

    await waitFor(() => {
      expect(screen.getByLabelText("年級 *")).toHaveValue("3");
    });
    expect(apiClient.updateSchoolClassroom).not.toHaveBeenCalled();
  });
});
