import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdjustLevelDialog } from "../AdjustLevelDialog";
import { BATCH_GRADE_MAX_ITEMS } from "../classroomGrade";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "classroomGrade.level.title": "Adjust level",
        "classroomGrade.level.targetLabel": "Target level",
        "classroomGrade.level.targetPlaceholder": "Select a level",
        "classroomGrade.level.changesTitle": "{{count}} will change",
        "classroomGrade.level.skippedTitle": "{{count}} skipped",
        "classroomGrade.level.alreadyAtTarget": "Already {{level}}",
        "classroomGrade.level.confirm": "Apply ({{count}})",
        "classroomGrade.limitExceeded": "Up to {{max}} classrooms at a time",
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
  { id: 1, name: "Alpha", level: "A1" },
  { id: 2, name: "Beta", level: "B1" },
  { id: 3, name: "Gamma", level: "preA" },
];

const selectTarget = (value: string) =>
  fireEvent.change(screen.getByLabelText("Target level"), {
    target: { value },
  });

describe("AdjustLevelDialog", () => {
  it("keeps apply disabled until a target level is chosen", () => {
    render(
      <AdjustLevelDialog
        open={true}
        onOpenChange={vi.fn()}
        classrooms={classrooms}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Apply (0)" })).toBeDisabled();
    // Pre-A is offered as a target
    expect(screen.getByRole("option", { name: "Pre-A" })).toBeInTheDocument();
  });

  it("previews each change, lists skipped rows and sends the target level", async () => {
    const onConfirm = vi.fn().mockResolvedValue(true);
    const onOpenChange = vi.fn();
    render(
      <AdjustLevelDialog
        open={true}
        onOpenChange={onOpenChange}
        classrooms={classrooms}
        onConfirm={onConfirm}
      />,
    );

    selectTarget("B1");

    expect(screen.getByText("2 will change")).toBeInTheDocument();
    expect(screen.getByText("1 skipped")).toBeInTheDocument();
    expect(screen.getByText("Already B1")).toBeInTheDocument();
    // "Pre-A → B1" for Gamma, "A1 → B1" for Alpha
    expect(screen.getByText("Gamma").closest("li")).toHaveTextContent(
      "Pre-AB1",
    );
    expect(screen.getByText("Alpha").closest("li")).toHaveTextContent("A1B1");

    fireEvent.click(screen.getByRole("button", { name: "Apply (2)" }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith([
        { id: 1, level: "B1" },
        { id: 3, level: "B1" },
      ]);
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("keeps the dialog open and re-enables apply when saving fails", async () => {
    let resolveConfirm: (ok: boolean) => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    const onOpenChange = vi.fn();
    render(
      <AdjustLevelDialog
        open={true}
        onOpenChange={onOpenChange}
        classrooms={classrooms}
        onConfirm={onConfirm}
      />,
    );

    selectTarget("C1");
    const apply = screen.getByRole("button", { name: "Apply (3)" });
    fireEvent.click(apply);

    await waitFor(() => {
      expect(apply).toBeDisabled();
      expect(screen.getByLabelText("Target level")).toBeDisabled();
    });
    // A second click while saving does not send again
    fireEvent.click(apply);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    resolveConfirm(false);
    await waitFor(() => {
      expect(apply).not.toBeDisabled();
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("resets the target level when reopened", () => {
    const { rerender } = render(
      <AdjustLevelDialog
        open={true}
        onOpenChange={vi.fn()}
        classrooms={classrooms}
        onConfirm={vi.fn()}
      />,
    );
    selectTarget("A2");
    expect(screen.getByLabelText("Target level")).toHaveValue("A2");

    rerender(
      <AdjustLevelDialog
        open={false}
        onOpenChange={vi.fn()}
        classrooms={classrooms}
        onConfirm={vi.fn()}
      />,
    );
    rerender(
      <AdjustLevelDialog
        open={true}
        onOpenChange={vi.fn()}
        classrooms={classrooms}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Target level")).toHaveValue("");
  });

  it("blocks applying more than the batch limit", () => {
    const many = Array.from({ length: BATCH_GRADE_MAX_ITEMS + 1 }, (_, i) => ({
      id: i + 1,
      name: `Class ${i + 1}`,
      level: "A1",
    }));
    const onConfirm = vi.fn();
    render(
      <AdjustLevelDialog
        open={true}
        onOpenChange={vi.fn()}
        classrooms={many}
        onConfirm={onConfirm}
      />,
    );

    selectTarget("A2");
    expect(screen.getByRole("alert")).toHaveTextContent(
      `Up to ${BATCH_GRADE_MAX_ITEMS} classrooms at a time`,
    );
    const apply = screen.getByRole("button", {
      name: `Apply (${BATCH_GRADE_MAX_ITEMS + 1})`,
    });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
