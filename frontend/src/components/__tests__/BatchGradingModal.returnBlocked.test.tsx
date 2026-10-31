/**
 * #1158：finalize-batch-grade 回 return_not_allowed_count > 0（情境對話的「退回」被略過）時，
 * 批次批改視窗另外跳警告說明原因；其他作業類型（0 或沒有這欄）不跳。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import BatchGradingModal from "../BatchGradingModal";

const stableT = (key: string) => key;
const stableI18n = { language: "zh-TW" };
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: stableI18n }),
}));

const mockPost = vi.fn();
vi.mock("@/lib/api", () => ({
  apiClient: { post: (...args: unknown[]) => mockPost(...args) },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const toastMock = toast as unknown as {
  success: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
};

const GRADE_RESPONSE = {
  total_students: 1,
  processed: 1,
  results: [
    {
      student_id: 1,
      student_name: "Amy",
      total_score: 40,
      missing_items: 0,
      total_items: 1,
      completed_items: 1,
      avg_pronunciation: 40,
      avg_accuracy: 40,
      avg_fluency: 40,
      avg_completeness: 40,
      status: "SUBMITTED",
    },
  ],
};

const finalize = (extra: Record<string, number>) => ({
  returned_count: 0,
  graded_count: 0,
  unchanged_count: 1,
  total_count: 1,
  ...extra,
});

const run = async (finalizeBody: Record<string, number>) => {
  mockPost.mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith("/batch-grade") ? GRADE_RESPONSE : finalize(finalizeBody),
    ),
  );
  render(
    <BatchGradingModal
      open
      onOpenChange={vi.fn()}
      assignmentId={9}
      classroomId={3}
      onComplete={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(screen.getAllByText("Amy").length).toBeGreaterThan(0),
  );
  fireEvent.click(
    screen.getByRole("button", { name: /batchGrading.submitAll/ }),
  );
  await waitFor(() =>
    expect(mockPost).toHaveBeenCalledWith(
      "/api/teachers/assignments/9/finalize-batch-grade",
      expect.objectContaining({ teacher_decisions: { 1: "RETURNED" } }),
    ),
  );
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(2));
};

describe("BatchGradingModal — 退回被略過（#1158）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("return_not_allowed_count > 0 → 警告說明原因", async () => {
    await run({ return_not_allowed_count: 1 });
    expect(toastMock.warning).toHaveBeenCalledWith(
      "batchGrading.returnNotAllowedSkipped",
    );
  });

  it("其他作業類型（0）→ 不跳警告（迴歸）", async () => {
    await run({ return_not_allowed_count: 0 });
    expect(toastMock.warning).not.toHaveBeenCalled();
  });
});
