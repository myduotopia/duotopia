import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { toast } from "sonner";
import { RequestRevisionModal } from "../RequestRevisionModal";
import type { StudentProgress } from "@/components/StudentStatusPanel";

const toastMock = toast as unknown as {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
};

// Stable t/i18n references — RequestRevisionModal lists `t` in a useEffect
// dependency array, so a fresh function each render would loop forever.
const stableT = (key: string, defaultOrOpts?: unknown) =>
  typeof defaultOrOpts === "string" ? defaultOrOpts : key;
const stableI18n = { language: "zh-TW" };
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: stableI18n }),
}));

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// Stub the heavy StudentStatusPanel. It is the source of selection + row
// actions; this lightweight stand-in exposes those callbacks as plain buttons
// so we can drive the modal's batch/row handlers deterministically. It also
// re-renders the students prop so we can assert optimistic status updates.
type PanelProps = {
  students: StudentProgress[];
  loading: boolean;
  onRevisionSelectionChange: (ids: number[]) => void;
  onRowReset: (id: number) => void;
  onRowReturn: (id: number) => void;
  onRowGrade: (id: number) => void;
};
let lastPanelProps: PanelProps | null = null;
vi.mock("@/components/StudentStatusPanel", () => ({
  __esModule: true,
  default: (props: PanelProps) => {
    lastPanelProps = props;
    return (
      <div data-testid="panel">
        <span data-testid="loading">{String(props.loading)}</span>
        {props.students.map((s) => (
          <div key={s.student_id} data-testid={`student-${s.student_id}`}>
            {s.student_name}:{s.status}
          </div>
        ))}
      </div>
    );
  },
}));

const students: StudentProgress[] = [
  {
    student_id: 1,
    student_number: 1,
    student_name: "Amy",
    status: "SUBMITTED",
  },
  {
    student_id: 2,
    student_number: 2,
    student_name: "Bob",
    status: "SUBMITTED",
  },
  {
    student_id: 3,
    student_number: 3,
    student_name: "Cal",
    status: "GRADED",
  },
];

const assignments = [
  { id: 100, title: "Quiz One", practice_mode: "word_selection_quiz" },
  { id: 200, title: "Quiz Two", practice_mode: "word_selection_quiz" },
];

const renderModal = (props?: Partial<React.ComponentProps<typeof RequestRevisionModal>>) =>
  render(
    <RequestRevisionModal
      open
      onOpenChange={vi.fn()}
      assignments={assignments}
      initialIndex={0}
      classroomId={7}
      onDone={vi.fn()}
      {...props}
    />,
  );

describe("RequestRevisionModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastPanelProps = null;
    mockGet.mockResolvedValue(students);
  });

  it("loads the student progress list for the current assignment on open", async () => {
    renderModal();
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        "/api/teachers/assignments/100/progress",
      );
    });
    expect(await screen.findByTestId("student-1")).toBeInTheDocument();
  });

  it("renders the assignment title and pager position", async () => {
    renderModal();
    expect(screen.getByText("Quiz One")).toBeInTheDocument();
    expect(screen.getByText("(1/2)")).toBeInTheDocument();
  });

  it("row 'return for revision' posts batch-return-for-revision for that student and flips status optimistically", async () => {
    renderModal();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    mockPost.mockResolvedValue({});

    // Drive the row return handler the panel would have called.
    await waitFor(() => expect(lastPanelProps).not.toBeNull());
    await act(async () => {
      lastPanelProps!.onRowReturn(1);
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        "/api/teachers/assignments/100/batch-return-for-revision",
        { student_ids: [1] },
      );
    });
    // Optimistic UI: student 1 now RETURNED.
    await waitFor(() => {
      expect(screen.getByTestId("student-1").textContent).toContain("RETURNED");
    });
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("row 'grade' posts finalize-batch-grade with classroom_id + teacher_decisions and flips status to GRADED", async () => {
    renderModal();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    mockPost.mockResolvedValue({});
    await waitFor(() => expect(lastPanelProps).not.toBeNull());

    await act(async () => {
      lastPanelProps!.onRowGrade(1);
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        "/api/teachers/assignments/100/finalize-batch-grade",
        { classroom_id: 7, teacher_decisions: { "1": "GRADED" } },
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("student-1").textContent).toContain("GRADED");
    });
  });

  it("row 'reset' posts batch-reset-not-started and flips status to NOT_STARTED", async () => {
    renderModal();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    mockPost.mockResolvedValue({});
    await waitFor(() => expect(lastPanelProps).not.toBeNull());

    await act(async () => {
      lastPanelProps!.onRowReset(2);
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        "/api/teachers/assignments/100/batch-reset-not-started",
        { student_ids: [2] },
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("student-2").textContent).toContain(
        "NOT_STARTED",
      );
    });
  });

  it("batch return posts the selected ids excluding already-RETURNED students", async () => {
    renderModal();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    mockPost.mockResolvedValue({});
    await waitFor(() => expect(lastPanelProps).not.toBeNull());

    // Select students 1 and 2 via the panel's selection callback.
    await act(async () => {
      lastPanelProps!.onRevisionSelectionChange([1, 2]);
    });

    // "退回訂正（2）" button enabled → click it.
    const returnBtn = await screen.findByText(/退回訂正/);
    fireEvent.click(returnBtn);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        "/api/teachers/assignments/100/batch-return-for-revision",
        { student_ids: [1, 2] },
      );
    });
  });

  it("batch complete posts finalize-batch-grade for selected, skipping already-GRADED students", async () => {
    renderModal();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    mockPost.mockResolvedValue({});
    await waitFor(() => expect(lastPanelProps).not.toBeNull());

    // Select 1 (SUBMITTED) and 3 (already GRADED → should be skipped).
    await act(async () => {
      lastPanelProps!.onRevisionSelectionChange([1, 3]);
    });

    const completeBtn = await screen.findByText(/完成批改/);
    fireEvent.click(completeBtn);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        "/api/teachers/assignments/100/finalize-batch-grade",
        { classroom_id: 7, teacher_decisions: { "1": "GRADED" } },
      );
    });
  });

  it("shows an error toast when the progress fetch fails", async () => {
    mockGet.mockRejectedValue(new Error("boom"));
    renderModal();
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
  });

  it("row return surfaces an error toast and does not flip status when the API rejects", async () => {
    renderModal();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    mockPost.mockRejectedValue(new Error("network"));
    await waitFor(() => expect(lastPanelProps).not.toBeNull());

    await act(async () => {
      lastPanelProps!.onRowReturn(1);
    });

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
    // Status remains SUBMITTED (no optimistic flip on failure).
    expect(screen.getByTestId("student-1").textContent).toContain("SUBMITTED");
  });
});
