import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdjustGradeDialog } from "../AdjustGradeDialog";
import { BATCH_GRADE_MAX_ITEMS } from "../classroomGrade";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "classroomGrade.adjust.title": "Adjust grade",
        "classroomGrade.adjust.up": "Up one grade",
        "classroomGrade.adjust.down": "Down one grade",
        "classroomGrade.adjust.set": "Set to grade",
        "classroomGrade.adjust.targetLabel": "Target grade",
        "classroomGrade.adjust.descriptionSet":
          "All selected classes will be set to Grade {{grade}}. Class names won't change.",
        "classroomGrade.adjust.reason.same": "Already Grade {{grade}}",
        "classroomGrade.adjust.reason.unset": "Grade not set",
        "classroomGrade.unset": "Not set",
        "classroomGrade.adjust.confirm": "Apply ({{count}})",
        "classroomGrade.limitExceeded": "Up to {{max}} classrooms at a time",
        "classroomGrade.gradeLabel": "Grade {{grade}}",
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

const makeClassrooms = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Class ${i + 1}`,
    grade: 3,
  }));

describe("AdjustGradeDialog", () => {
  it("blocks applying more than the batch limit and shows a notice", () => {
    const onConfirm = vi.fn();
    render(
      <AdjustGradeDialog
        open={true}
        onOpenChange={vi.fn()}
        classrooms={makeClassrooms(BATCH_GRADE_MAX_ITEMS + 1)}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      `Up to ${BATCH_GRADE_MAX_ITEMS} classrooms at a time`,
    );
    const confirm = screen.getByRole("button", {
      name: `Apply (${BATCH_GRADE_MAX_ITEMS + 1})`,
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("allows applying exactly the batch limit", () => {
    render(
      <AdjustGradeDialog
        open={true}
        onOpenChange={vi.fn()}
        classrooms={makeClassrooms(BATCH_GRADE_MAX_ITEMS)}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Apply (${BATCH_GRADE_MAX_ITEMS})` }),
    ).not.toBeDisabled();
  });

  it("disables the direction buttons while saving", async () => {
    let resolveConfirm: (ok: boolean) => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    render(
      <AdjustGradeDialog
        open={true}
        onOpenChange={vi.fn()}
        classrooms={makeClassrooms(2)}
        onConfirm={onConfirm}
      />,
    );

    const up = screen.getByRole("button", { name: /Up one grade/ });
    const down = screen.getByRole("button", { name: /Down one grade/ });
    expect(up).not.toBeDisabled();
    expect(down).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Apply (2)" }));

    await waitFor(() => {
      expect(up).toBeDisabled();
      expect(down).toBeDisabled();
    });
    expect(onConfirm).toHaveBeenCalledWith([
      { id: 1, grade: 4 },
      { id: 2, grade: 4 },
    ]);

    resolveConfirm(false);
    await waitFor(() => {
      expect(up).not.toBeDisabled();
    });
  });
});

describe("AdjustGradeDialog — set to grade N", () => {
  const classrooms = [
    { id: 1, name: "Unset class", grade: null },
    { id: 2, name: "Seven class", grade: 7 },
    { id: 3, name: "Three class", grade: 3 },
  ];

  it("requires choosing a target before applying", () => {
    render(
      <AdjustGradeDialog
        open={true}
        onOpenChange={vi.fn()}
        classrooms={classrooms}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Set to grade/ }));
    const target = screen.getByLabelText("Target grade") as HTMLSelectElement;
    expect(target.value).toBe("");
    expect(screen.getByRole("button", { name: "Apply (0)" })).toBeDisabled();
  });

  it("includes unset classrooms, skips ones already at N, and sends N", async () => {
    const onConfirm = vi.fn().mockResolvedValue(true);
    const onOpenChange = vi.fn();
    render(
      <AdjustGradeDialog
        open={true}
        onOpenChange={onOpenChange}
        classrooms={classrooms}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Set to grade/ }));
    fireEvent.change(screen.getByLabelText("Target grade"), {
      target: { value: "7" },
    });

    expect(
      screen.getByText(
        "All selected classes will be set to Grade 7. Class names won't change.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Already Grade 7")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apply (2)" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).toHaveBeenCalledWith([
      { id: 1, grade: 7 },
      { id: 3, grade: 7 },
    ]);
  });
});
