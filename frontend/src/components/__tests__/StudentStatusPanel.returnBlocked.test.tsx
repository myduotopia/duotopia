/**
 * #1158：批改 hub（StudentStatusPanel mode="revision"）每列的「退回」——
 * 情境對話作業停用並以 title 說明原因、點了不呼叫 onRowReturn；其他作業類型照舊。
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import StudentStatusPanel, {
  type StudentProgress,
} from "@/components/StudentStatusPanel";

const stableT = (key: string, defaultOrOpts?: unknown) =>
  typeof defaultOrOpts === "string" ? defaultOrOpts : key;
const stableI18n = { language: "zh-TW" };
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: stableI18n }),
}));
vi.mock("@formkit/auto-animate/react", () => ({
  useAutoAnimate: () => [() => {}],
}));

const REASON = "情境對話作業目前不能退回訂正";

const students: StudentProgress[] = [
  {
    student_id: 1,
    student_number: 1,
    student_name: "Amy",
    status: "SUBMITTED",
  },
];

const renderPanel = (practiceMode: string, onRowReturn = vi.fn()) => {
  render(
    <StudentStatusPanel
      mode="revision"
      students={students}
      assignmentId={1}
      classroomId={1}
      practiceMode={practiceMode}
      isEditingStudents={false}
      onEditingStudentsChange={() => {}}
      onStudentIdsChanged={() => {}}
      loading={false}
      onRowReset={vi.fn()}
      onRowReturn={onRowReturn}
      onRowGrade={vi.fn()}
    />,
  );
  return onRowReturn;
};

describe("StudentStatusPanel 列退回（#1158）", () => {
  it("情境對話：退回鈕停用、title 寫原因，點了不退回", () => {
    const onRowReturn = renderPanel("scenario_dialogue");
    const btn = screen
      .getAllByTitle(REASON)
      .find((el) => el.tagName === "BUTTON")!;
    expect(btn).toBeDisabled();
    expect(btn.parentElement).toHaveAttribute("title", REASON);
    fireEvent.click(btn);
    expect(onRowReturn).not.toHaveBeenCalled();
  });

  it("其他作業類型：退回鈕照舊可按（迴歸）", () => {
    const onRowReturn = renderPanel("reading");
    expect(screen.queryByTitle(REASON)).toBeNull();
    const btn = screen
      .getAllByTitle("退回")
      .find((el) => el.tagName === "BUTTON")!;
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onRowReturn).toHaveBeenCalledTimes(1);
  });
});
