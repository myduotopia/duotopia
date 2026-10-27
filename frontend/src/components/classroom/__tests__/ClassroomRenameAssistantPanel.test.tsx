import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { BatchEditClassroomsDialog } from "../BatchEditClassroomsDialog";
import {
  ClassroomRenameAssistantPanel,
  useClassroomRenameAssistantSlot,
  type RequestClassroomSuggestion,
} from "../ClassroomRenameAssistantPanel";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import type { ClassroomBatchEditAiResponse } from "@/lib/api";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "classroomGrade.batchEdit.nameLabel": "Class name for {{name}}",
        "classroomGrade.batchEdit.gradeLabel": "Grade for {{name}}",
        "classroomGrade.batchEdit.save": "Save ({{count}})",
        "classroomGrade.batchEdit.aiChanged": "Edited by AI",
        "classroomGrade.batchEdit.changed": "Edited",
        "classroomGrade.batchEdit.ai.title": "AI assistant",
        "classroomGrade.batchEdit.ai.inputLabel": "Instructions",
        "classroomGrade.batchEdit.ai.send": "Send",
        "classroomGrade.batchEdit.ai.stop": "Stop",
        "classroomGrade.batchEdit.ai.undo": "Undo AI",
        "classroomGrade.batchEdit.ai.undoHint": "Undo hint",
        "classroomGrade.batchEdit.ai.thinking": "Thinking",
        "classroomGrade.batchEdit.ai.applying":
          "Applying {{current}}/{{total}}",
        "classroomGrade.batchEdit.ai.applied": "Applied {{count}}",
        "classroomGrade.batchEdit.ai.stopped": "Stopped {{current}}/{{total}}",
        "classroomGrade.batchEdit.ai.cancelled": "Cancelled",
        "classroomGrade.batchEdit.ai.error": "AI unavailable",
        "classroomGrade.batchEdit.ai.noChanges": "No changes",
        "classroomGrade.batchEdit.ai.undone": "Undone",
        "classroomGrade.batchEdit.ai.changeLine": "{{from}} -> {{to}}",
        "classroomGrade.batchEdit.ai.gradeChange":
          " (grade {{from}} -> {{to}})",
        "classroomGrade.gradeLabel": "G{{grade}}",
        "classroomGrade.unset": "unset",
        "classroomGrade.displayName": "{{grade}}年{{name}}班",
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
  { id: 2, name: "七年3班", grade: 7 },
  { id: 3, name: "忠班", grade: 5 },
];

const renderWithPanel = (
  requestSuggestion: RequestClassroomSuggestion,
  applyIntervalMs = 0,
) => {
  const onSave = vi.fn().mockResolvedValue(true);
  render(
    <BatchEditClassroomsDialog<number>
      open={true}
      onOpenChange={vi.fn()}
      classrooms={classrooms}
      onSave={onSave}
      renderSidePanel={(ctx) => (
        <ClassroomRenameAssistantPanel<number>
          {...ctx}
          requestSuggestion={requestSuggestion}
          applyIntervalMs={applyIntervalMs}
        />
      )}
    />,
  );
  return { onSave };
};

const nameInput = (name: string) =>
  screen.getByLabelText(`Class name for ${name}`) as HTMLInputElement;
const gradeSelect = (name: string) =>
  screen.getByLabelText(`Grade for ${name}`) as HTMLSelectElement;

const ask = (text: string) => {
  fireEvent.change(screen.getByLabelText("Instructions"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
};

const resolved =
  (res: ClassroomBatchEditAiResponse): RequestClassroomSuggestion =>
  () =>
    Promise.resolve(res);

afterEach(() => {
  vi.restoreAllMocks();
  useTeacherAuthStore.setState({ user: null });
});

describe("useClassroomRenameAssistantSlot", () => {
  it("gives no panel to non-admins", () => {
    useTeacherAuthStore.setState({
      user: { id: 1, name: "T", email: "t@x.com", is_admin: false },
    });
    const { result } = renderHook(() =>
      useClassroomRenameAssistantSlot<number>(),
    );
    expect(result.current).toBeUndefined();
  });

  it("gives the panel to platform admins", () => {
    useTeacherAuthStore.setState({
      user: { id: 1, name: "A", email: "a@x.com", is_admin: true },
    });
    const { result } = renderHook(() =>
      useClassroomRenameAssistantSlot<number>(),
    );
    expect(typeof result.current).toBe("function");
  });

  it("does not render the AI panel in the dialog for non-admins", () => {
    useTeacherAuthStore.setState({
      user: { id: 1, name: "T", email: "t@x.com", is_admin: false },
    });
    const Page = () => {
      const slot = useClassroomRenameAssistantSlot<number>();
      return (
        <BatchEditClassroomsDialog<number>
          open={true}
          onOpenChange={vi.fn()}
          classrooms={classrooms}
          onSave={vi.fn()}
          renderSidePanel={slot}
        />
      );
    };
    render(<Page />);
    expect(screen.queryByLabelText("Instructions")).not.toBeInTheDocument();
  });
});

describe("ClassroomRenameAssistantPanel", () => {
  it("sends the current table, applies only the listed rows and shows old → new", async () => {
    const request = vi.fn<RequestClassroomSuggestion>(
      resolved({
        reply: "Removed grades",
        changes: [
          { id: 1, name: "12", grade: 8 },
          { id: 3, name: "忠" },
          { id: 99, name: "not in table" },
        ],
      }),
    );
    renderWithPanel(request);
    fireEvent.change(nameInput("七年3班"), { target: { value: "manual" } });
    ask("remove grades");

    await waitFor(() =>
      expect(screen.getByText("Applied 2")).toBeInTheDocument(),
    );
    expect(request).toHaveBeenCalledWith(
      {
        classrooms: [
          { id: 1, name: "八年12班", grade: null },
          { id: 2, name: "manual", grade: 7 },
          { id: 3, name: "忠班", grade: 5 },
        ],
        history: [],
        instruction: "remove grades",
      },
      expect.any(AbortSignal),
    );
    expect(nameInput("八年12班").value).toBe("12");
    expect(gradeSelect("八年12班").value).toBe("8");
    expect(nameInput("忠班").value).toBe("忠");
    expect(nameInput("七年3班").value).toBe("manual");
    expect(screen.getByText("Removed grades")).toBeInTheDocument();
    expect(
      screen.getByText("八年12班 -> 12 (grade unset -> G8)"),
    ).toBeInTheDocument();
    expect(screen.getByText("忠班 -> 忠")).toBeInTheDocument();
    expect(screen.getAllByText("Edited by AI")).toHaveLength(2);
    // 寫入資料庫只能靠人按儲存
    expect(screen.getByRole("button", { name: "Save (3)" })).not.toBeDisabled();
  });

  it("shows thinking and stop cancels the request without touching the table", async () => {
    let signal: AbortSignal | undefined;
    const request: RequestClassroomSuggestion = (_payload, s) => {
      signal = s;
      return new Promise(() => {});
    };
    renderWithPanel(request);
    ask("remove grades");
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(nameInput("八年12班").value).toBe("八年12班");
    expect(screen.getByRole("button", { name: "Save (0)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("stop while applying keeps applied rows and drops the rest", async () => {
    renderWithPanel(
      resolved({
        reply: "",
        changes: [
          { id: 1, name: "A" },
          { id: 2, name: "B" },
          { id: 3, name: "C" },
        ],
      }),
      60_000,
    );
    ask("rename");
    await waitFor(() =>
      expect(screen.getByText("Applying 1/3")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByText("Stopped 1/3")).toBeInTheDocument();
    expect(nameInput("八年12班").value).toBe("A");
    expect(nameInput("七年3班").value).toBe("七年3班");
    expect(nameInput("忠班").value).toBe("忠班");
  });

  it("shows an error and leaves the table untouched when the AI fails", async () => {
    renderWithPanel(() => Promise.reject(new Error("502")));
    ask("rename");
    await waitFor(() =>
      expect(screen.getByText("AI unavailable")).toBeInTheDocument(),
    );
    expect(nameInput("八年12班").value).toBe("八年12班");
    expect(
      screen.queryByRole("button", { name: "Undo AI" }),
    ).not.toBeInTheDocument();
  });

  it("undo restores the table before each AI run, including later manual edits", async () => {
    const request = vi
      .fn<RequestClassroomSuggestion>()
      .mockResolvedValueOnce({ reply: "one", changes: [{ id: 1, name: "A" }] })
      .mockResolvedValueOnce({ reply: "two", changes: [{ id: 2, name: "B" }] });
    renderWithPanel(request);

    ask("first");
    await waitFor(() => expect(nameInput("八年12班").value).toBe("A"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument(),
    );
    ask("second");
    await waitFor(() => expect(nameInput("七年3班").value).toBe("B"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Undo AI" }),
      ).not.toBeDisabled(),
    );
    // 第二次 AI 之後的手動修改
    fireEvent.change(nameInput("忠班"), { target: { value: "manual" } });
    expect(screen.getByText("Undo hint")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo AI" }));
    expect(nameInput("七年3班").value).toBe("七年3班");
    expect(nameInput("忠班").value).toBe("忠班");
    expect(nameInput("八年12班").value).toBe("A");

    fireEvent.click(screen.getByRole("button", { name: "Undo AI" }));
    expect(nameInput("八年12班").value).toBe("八年12班");
    expect(
      screen.queryByRole("button", { name: "Undo AI" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save (0)" })).toBeDisabled();
  });

  it("sends earlier turns as history and does not change the table for a reply without changes", async () => {
    const request = vi
      .fn<RequestClassroomSuggestion>()
      .mockResolvedValueOnce({ reply: "Only names and grades", changes: [] })
      .mockResolvedValueOnce({ reply: "ok", changes: [] });
    renderWithPanel(request);

    ask("write a poem");
    await waitFor(() =>
      expect(screen.getByText("Only names and grades")).toBeInTheDocument(),
    );
    expect(screen.getByText("No changes")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Undo AI" }),
    ).not.toBeInTheDocument();

    ask("rename");
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1][0].history).toEqual([
      { role: "user", content: "write a poem" },
      { role: "assistant", content: "Only names and grades" },
    ]);
  });

  it("keeps the dialog's own save for writing — AI never saves", async () => {
    const { onSave } = renderWithPanel(
      resolved({ reply: "", changes: [{ id: 3, grade: 6 }] }),
    );
    ask("grade up");
    await waitFor(() => expect(gradeSelect("忠班").value).toBe("6"));
    await act(async () => {});
    expect(onSave).not.toHaveBeenCalled();
  });
});
