/**
 * #1158：情境對話作業不能退回訂正 —— 批改 hub（RequestRevisionModal）批次退回鈕停用並說明原因、
 * 列退回不送 API；其他作業類型照舊。另開一檔：RequestRevisionModal.test.tsx 在 CI 隔離名單內。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { RequestRevisionModal } from "../RequestRevisionModal";
import type { StudentProgress } from "@/components/StudentStatusPanel";

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

const renderModal = (
  props?: Partial<React.ComponentProps<typeof RequestRevisionModal>>,
) =>
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

// #1158：情境對話作業不能退回訂正 —— 批次退回鈕停用並說明原因、列退回不送 API；
// 其他作業類型（上面的小考測試）行為不變。
describe("RequestRevisionModal — 情境對話不能退回訂正（#1158）", () => {
  const scenario = [
    { id: 300, title: "Scenario", practice_mode: "scenario_dialogue" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    lastPanelProps = null;
    mockGet.mockResolvedValue(students);
  });

  it("批次退回鈕停用，title 寫原因；勾選學生後仍停用", async () => {
    renderModal({ assignments: scenario });
    await waitFor(() => expect(lastPanelProps).not.toBeNull());
    await act(async () => {
      lastPanelProps!.onRevisionSelectionChange([1, 2]);
    });
    const btn = screen.getByRole("button", { name: /退回訂正/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "情境對話作業目前不能退回訂正");
    // 「完成批改」不受影響
    expect(screen.getByRole("button", { name: /完成批改/ })).toBeEnabled();
  });

  it("列退回不送 API、不改狀態", async () => {
    renderModal({ assignments: scenario });
    await waitFor(() => expect(lastPanelProps).not.toBeNull());
    await act(async () => {
      lastPanelProps!.onRowReturn(1);
    });
    expect(mockPost).not.toHaveBeenCalled();
    expect(screen.getByTestId("student-1").textContent).toContain("SUBMITTED");
  });

  it("其他作業類型的批次退回鈕照舊可按（迴歸）", async () => {
    renderModal();
    await waitFor(() => expect(lastPanelProps).not.toBeNull());
    await act(async () => {
      lastPanelProps!.onRevisionSelectionChange([1]);
    });
    const btn = screen.getByRole("button", { name: /退回訂正/ });
    expect(btn).toBeEnabled();
    expect(btn).not.toHaveAttribute("title");
  });
});
