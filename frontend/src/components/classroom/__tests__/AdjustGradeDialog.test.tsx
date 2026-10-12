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
