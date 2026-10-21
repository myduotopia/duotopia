import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  BatchEditClassroomsDialog,
  type BatchEditClassroomsDialogProps,
} from "../BatchEditClassroomsDialog";
import { BATCH_GRADE_MAX_ITEMS } from "../classroomGrade";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "classroomGrade.batchEdit.title": "Edit classrooms",
        "classroomGrade.batchEdit.setAllLabel": "Set all grades to",
        "classroomGrade.batchEdit.nameLabel": "Class name for {{name}}",
        "classroomGrade.batchEdit.gradeLabel": "Grade for {{name}}",
        "classroomGrade.batchEdit.preview": "Shown as: {{name}}",
        "classroomGrade.batchEdit.changed": "Edited",
        "classroomGrade.batchEdit.aiChanged": "Edited by AI",
        "classroomGrade.batchEdit.nameRequired": "Enter a class name",
        "classroomGrade.batchEdit.save": "Save ({{count}})",
        "classroomGrade.limitExceeded": "Up to {{max}} classrooms at a time",
        "classroomGrade.displayName": "{{grade}}年{{name}}班",
        "classroomGrade.gradeLabel": "Grade {{grade}}",
        "classroomGrade.selectPlaceholder": "Select a grade",
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

const classrooms = [
  { id: 1, name: "八年12班", grade: null },
  { id: 2, name: "3", grade: 7 },
  { id: 3, name: "忠班", grade: 5 },
];

const renderDialog = (
  props: Partial<BatchEditClassroomsDialogProps<number>> = {},
) => {
  const onSave = vi.fn().mockResolvedValue(true);
  const onOpenChange = vi.fn();
  render(
    <BatchEditClassroomsDialog<number>
      open={true}
      onOpenChange={onOpenChange}
      classrooms={classrooms}
      onSave={onSave}
      {...props}
    />,
  );
  return { onSave, onOpenChange };
};

const nameInput = (name: string) =>
  screen.getByLabelText(`Class name for ${name}`) as HTMLInputElement;
const gradeSelect = (name: string) =>
  screen.getByLabelText(`Grade for ${name}`) as HTMLSelectElement;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BatchEditClassroomsDialog", () => {
  it("disables save until something changes", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Save (0)" })).toBeDisabled();
  });

  it("sends only the changed rows and fields", async () => {
    const { onSave, onOpenChange } = renderDialog();
    fireEvent.change(nameInput("八年12班"), { target: { value: " 12 " } });
    fireEvent.change(gradeSelect("八年12班"), { target: { value: "8" } });
    fireEvent.change(gradeSelect("忠班"), { target: { value: "6" } });

    fireEvent.click(screen.getByRole("button", { name: "Save (2)" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSave).toHaveBeenCalledWith([
      { id: 1, name: "12", grade: 8 },
      { id: 3, grade: 6 },
    ]);
  });

  it("previews the display name students will see", () => {
    renderDialog();
    fireEvent.change(nameInput("八年12班"), { target: { value: "12" } });
    fireEvent.change(gradeSelect("八年12班"), { target: { value: "8" } });
    expect(screen.getByText("Shown as: 8年12班")).toBeInTheDocument();
  });

  it("blocks saving an empty name", () => {
    renderDialog();
    fireEvent.change(nameInput("3"), { target: { value: "   " } });
    expect(screen.getByText("Enter a class name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save (1)" })).toBeDisabled();
  });

  it("limits the name input to 100 characters", () => {
    renderDialog();
    expect(nameInput("3").maxLength).toBe(100);
  });

  it("sets every row's grade with 'set all', including unset rows", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Set all grades to"), {
      target: { value: "7" },
    });
    expect(gradeSelect("八年12班").value).toBe("7");
    expect(gradeSelect("3").value).toBe("7");
    expect(gradeSelect("忠班").value).toBe("7");
    expect(nameInput("忠班").value).toBe("忠班");
    // 班 2 原本就是 7 年級 → 只有 2 列變動
    expect(screen.getByRole("button", { name: "Save (2)" })).not.toBeDisabled();
  });

  it("does not offer an empty grade option for rows that already have a grade", () => {
    renderDialog();
    const withGrade = Array.from(gradeSelect("3").options).map((o) => o.value);
    expect(withGrade).not.toContain("");
    const unset = Array.from(gradeSelect("八年12班").options).map(
      (o) => o.value,
    );
    expect(unset).toContain("");
  });

  it("disables save when more rows changed than the batch limit", () => {
    const many = Array.from({ length: BATCH_GRADE_MAX_ITEMS + 1 }, (_, i) => ({
      id: i + 1,
      name: `C${i + 1}`,
      grade: 3,
    }));
    renderDialog({ classrooms: many });
    fireEvent.change(screen.getByLabelText("Set all grades to"), {
      target: { value: "4" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      `Up to ${BATCH_GRADE_MAX_ITEMS} classrooms at a time`,
    );
    expect(
      screen.getByRole("button", {
        name: `Save (${BATCH_GRADE_MAX_ITEMS + 1})`,
      }),
    ).toBeDisabled();
  });

  it("keeps the dialog open and the input when saving fails", async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    const { onOpenChange } = renderDialog({ onSave });
    fireEvent.change(nameInput("3"), { target: { value: "Three" } });
    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save (1)" }),
      ).not.toBeDisabled(),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(nameInput("3").value).toBe("Three");
  });

  it("asks before closing with unsaved changes", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onOpenChange } = renderDialog();
    fireEvent.change(nameInput("3"), { target: { value: "Three" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("renders the side panel slot and marks rows filled by AI", () => {
    renderDialog({
      renderSidePanel: ({ applyChanges }) => (
        <button
          type="button"
          onClick={() => applyChanges([{ id: 2, name: "Three" }], "ai")}
        >
          Fill by AI
        </button>
      ),
    });
    fireEvent.click(screen.getByRole("button", { name: "Fill by AI" }));
    expect(nameInput("3").value).toBe("Three");
    expect(screen.getByText("Edited by AI")).toBeInTheDocument();

    // 人工再改 → 換回人工標記
    fireEvent.change(nameInput("3"), { target: { value: "Three!" } });
    expect(screen.queryByText("Edited by AI")).not.toBeInTheDocument();
    expect(screen.getByText("Edited")).toBeInTheDocument();
  });
});
