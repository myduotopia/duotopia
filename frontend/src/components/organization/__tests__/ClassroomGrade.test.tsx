/**
 * 機構後台班級年級（#1097）：ClassroomListTable 年級欄／勾選欄、
 * CreateClassroomDialog 與 EditClassroomDialog 的年級必填。
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "teacherClassrooms.labels.grade": "Grade",
        "classroomGrade.gradeLabel": "Grade {{grade}}",
        "classroomGrade.unset": "Not set",
        "classroomGrade.selectPlaceholder": "Select a grade",
        "classroomGrade.required": "Please select a grade",
        "classroomGrade.selection.selectAll": "Select all listed classrooms",
        "classroomGrade.selection.selectRow": "Select {{name}}",
      };
      const template = translations[key];
      if (!template) return key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(opts?.[name] ?? ""),
      );
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("@/lib/api", () => ({
  apiClient: {
    createSchoolClassroom: vi.fn(),
    updateSchoolClassroom: vi.fn(),
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

describe("ClassroomListTable grade (#1097)", () => {
  it("renders the grade column with labels and Not set", () => {
    render(<ClassroomListTable classrooms={classrooms} />);

    expect(screen.getByText("Grade")).toBeInTheDocument();
    expect(screen.getByText("Grade 3")).toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.getByText("Grade 5")).toBeInTheDocument();
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
      screen.getByRole("checkbox", { name: "Select 一年級 A 班" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select 二年級 B 班" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Select 停用班" }),
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

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select 一年級 A 班" }),
    );
    expect(onToggle).toHaveBeenCalledWith("1", true);

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all listed classrooms" }),
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
      screen.getByRole("checkbox", { name: "Select all listed classrooms" }),
    ).toHaveAttribute("data-state", "checked");
  });
});

describe("CreateClassroomDialog grade (#1097)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(toast.error).toHaveBeenCalledWith("Please select a grade");
    expect(apiClient.createSchoolClassroom).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Grade *"), {
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
  });
});

describe("EditClassroomDialog grade (#1097)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(toast.error).toHaveBeenCalledWith("Please select a grade");
    expect(apiClient.updateSchoolClassroom).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Grade *"), {
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

    expect(screen.getByLabelText("Grade *")).toHaveValue("3");
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(apiClient.updateSchoolClassroom).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ grade: 3 }),
      );
    });
  });
});
