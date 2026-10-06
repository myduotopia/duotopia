import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  ClassroomTableRow,
  isClassroomDraftDirty,
  makeClassroomDraft,
  type ClassroomDraft,
  type ClassroomTableRowProps,
} from "../ClassroomTableRow";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "classroomGrade.gradeLabel": "Grade {{grade}}",
        "classroomGrade.unset": "Not set",
        "classroomGrade.selectPlaceholder": "Select a grade",
        "classroomGrade.status.active": "Active",
        "classroomGrade.status.inactive": "Inactive",
        "classroomGrade.status.switchDisable": "Disable",
        "classroomGrade.status.switchEnable": "Enable",
        "classroomGrade.status.switchDisableAria": "Disable this classroom",
        "classroomGrade.status.switchEnableAria": "Enable this classroom",
        "classroomGrade.status.dispatchDisabled": "Classroom inactive",
        "classroomGrade.selection.selectRow": "Select {{name}}",
        "teacherClassrooms.buttons.dispatchAssignment": "Assign Homework",
        "teacherClassrooms.labels.grade": "Grade",
        "teacherClassrooms.labels.classroomName": "Classroom Name",
        "teacherClassrooms.labels.level": "Level",
        "teacherClassrooms.labels.description": "Description",
        "common.edit": "Edit",
        "common.delete": "Delete",
        "common.save": "Save",
        "common.cancel": "Cancel",
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

const classroom = {
  id: 7,
  name: "Alpha",
  description: "First class",
  level: "A1",
  grade: 3,
  is_active: true,
  student_count: 4,
  program_count: 2,
};

function renderRow(overrides: Partial<ClassroomTableRowProps> = {}) {
  const props: ClassroomTableRowProps = {
    classroom,
    showSelectColumn: true,
    selectable: true,
    selected: false,
    onSelectedChange: vi.fn(),
    expanded: false,
    onToggleExpanded: vi.fn(),
    createdAtText: "2026/01/15",
    readOnly: false,
    onDispatch: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    canToggleStatus: true,
    onToggleActive: vi.fn(),
    editing: false,
    draft: null,
    onDraftChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <table>
        <tbody>
          <ClassroomTableRow {...props} />
        </tbody>
      </table>
    </MemoryRouter>,
  );
  return props;
}

describe("ClassroomTableRow", () => {
  it("renders cells in grade → name → level → students → created → status → actions order", () => {
    renderRow();
    const cells = screen.getAllByRole("cell").map((c) => c.textContent ?? "");
    expect(cells[1]).toBe("Grade 3");
    expect(cells[2]).toContain("Alpha");
    expect(cells[2]).toContain("First class");
    expect(cells[3]).toBe("A1");
    expect(cells[4]).toBe("4");
    expect(cells[5]).toBe("2026/01/15");
    // Toggleable row: the status cell is a switch whose track shows the target state
    expect(cells[6]).toBe("Disable");
  });

  it("shows an active classroom as a checked brand switch labelled with the target state", () => {
    renderRow();
    const toggle = screen.getByRole("switch", {
      name: "Disable this classroom",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveTextContent("Disable");
    expect(toggle).toHaveClass("bg-blue-600");
    // The separate Active/Inactive badge is gone for toggleable rows
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });

  it("shows an inactive classroom as an unchecked grey switch and enables it without confirmation", () => {
    const props = renderRow({ classroom: { ...classroom, is_active: false } });
    const toggle = screen.getByRole("switch", {
      name: "Enable this classroom",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveTextContent("Enable");
    expect(toggle).toHaveClass("bg-gray-300");
    fireEvent.click(toggle);
    expect(props.onToggleActive).toHaveBeenCalledWith(true);
  });

  it("disables the switch while a status update is in flight", () => {
    const props = renderRow({ statusBusy: true });
    const toggle = screen.getByRole("switch", {
      name: "Disable this classroom",
    });
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(props.onToggleActive).not.toHaveBeenCalled();
  });

  it("toggles expansion when the row is clicked, but not from the switch", () => {
    const props = renderRow();
    fireEvent.click(screen.getByText("Grade 3"));
    expect(props.onToggleExpanded).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("switch", { name: "Disable this classroom" }),
    );
    expect(props.onToggleActive).toHaveBeenCalledWith(false);
    expect(props.onToggleExpanded).toHaveBeenCalledTimes(1);
  });

  it("disables dispatch for an inactive classroom", () => {
    renderRow({
      classroom: { ...classroom, is_active: false },
      canToggleStatus: false,
    });
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByTitle("Classroom inactive")).toBeDisabled();
    expect(screen.getByTitle("Edit")).not.toBeDisabled();
  });

  it("shows only the status badge when the status cannot be toggled and disables edit when read-only", () => {
    renderRow({ canToggleStatus: false, readOnly: true });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByTitle("Edit")).toBeDisabled();
    expect(screen.getByTitle("Delete")).toBeDisabled();
  });

  it("renders inputs in edit mode, reports draft changes and does not expand", () => {
    const draft: ClassroomDraft = makeClassroomDraft(classroom);
    const props = renderRow({ editing: true, draft });

    expect(screen.getByLabelText("Classroom Name")).toHaveValue("Alpha");
    expect(screen.getByLabelText("Description")).toHaveValue("First class");
    expect(screen.getByLabelText("Level")).toHaveValue("A1");
    expect(screen.getByLabelText("Grade")).toHaveValue("3");

    fireEvent.change(screen.getByLabelText("Classroom Name"), {
      target: { value: "Alpha 2" },
    });
    expect(props.onDraftChange).toHaveBeenCalledWith({
      ...draft,
      name: "Alpha 2",
    });

    fireEvent.click(screen.getByLabelText("Classroom Name"));
    expect(props.onToggleExpanded).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("saves on Enter and cancels on Escape, ignoring IME composition", () => {
    const props = renderRow({
      editing: true,
      draft: makeClassroomDraft(classroom),
    });
    const input = screen.getByLabelText("Classroom Name");

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(props.onSave).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSave).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("classroom draft helpers", () => {
  it("normalises the level and treats an invalid grade as unset", () => {
    expect(
      makeClassroomDraft({
        id: 1,
        name: "X",
        level: "PREA",
        grade: 0,
        student_count: 0,
      }),
    ).toEqual({ name: "X", description: "", level: "preA", grade: null });
  });

  it("is dirty only when a field differs from the original", () => {
    const draft = makeClassroomDraft(classroom);
    expect(isClassroomDraftDirty(draft, classroom)).toBe(false);
    expect(isClassroomDraftDirty({ ...draft, grade: 4 }, classroom)).toBe(true);
    expect(
      isClassroomDraftDirty({ ...draft, description: "x" }, classroom),
    ).toBe(true);
  });
});
