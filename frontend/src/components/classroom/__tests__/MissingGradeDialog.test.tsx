import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MissingGradeDialog } from "../MissingGradeDialog";
import { BATCH_GRADE_MAX_ITEMS } from "../classroomGrade";

// 真實上限 200 會讓每個測試渲染並逐列操作 200+ 個下拉，CI 上超過 20s 逾時；
// 縮小上限只為加速，判斷邏輯（> 上限擋、= 上限放行）不變
vi.mock("../classroomGrade", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../classroomGrade")>()),
  BATCH_GRADE_MAX_ITEMS: 5,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "classroomGrade.missingDialog.title": "Set classroom grades",
        "classroomGrade.missingDialog.rowLabel": "Grade for {{name}}",
        "classroomGrade.missingDialog.save": "Save ({{count}})",
        "classroomGrade.missing.limitExceeded":
          "Save at most {{max}} classes at a time",
        "classroomGrade.limitExceeded": "Use the grade filter ({{max}})",
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

const makeClassrooms = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Class ${i + 1}`,
  }));

const pickGradeForAll = (count: number) => {
  for (let i = 1; i <= count; i++) {
    fireEvent.change(screen.getByLabelText(`Grade for Class ${i}`), {
      target: { value: "3" },
    });
  }
};

describe("MissingGradeDialog", () => {
  it("blocks saving more than the batch limit with the fill-in specific notice", () => {
    const onSave = vi.fn();
    const count = BATCH_GRADE_MAX_ITEMS + 1;
    render(
      <MissingGradeDialog
        open={true}
        onOpenChange={vi.fn()}
        classrooms={makeClassrooms(count)}
        onSave={onSave}
      />,
    );

    pickGradeForAll(count);

    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent(
      `Save at most ${BATCH_GRADE_MAX_ITEMS} classes at a time`,
    );
    // The adjust dialog's "use the grade filter" wording must not be used here
    expect(notice).not.toHaveTextContent("Use the grade filter");

    const save = screen.getByRole("button", { name: `Save (${count})` });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("allows saving exactly the batch limit", () => {
    const count = BATCH_GRADE_MAX_ITEMS;
    render(
      <MissingGradeDialog
        open={true}
        onOpenChange={vi.fn()}
        classrooms={makeClassrooms(count + 5)}
        onSave={vi.fn()}
      />,
    );

    // Only rows with a picked grade count toward the limit
    pickGradeForAll(count);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Save (${count})` }),
    ).not.toBeDisabled();
  });
});
