import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ClassQuizStats } from "../ClassQuizStats";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultOrOpts?: unknown) =>
      typeof defaultOrOpts === "string" ? defaultOrOpts : key,
    i18n: { language: "zh-TW" },
  }),
}));

const mockGet = vi.fn();
vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

// recharts ResponsiveContainer measures DOM size (0 in jsdom). Stub the chart
// primitives so the data path renders deterministically.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  BarChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="barchart">{children}</div>
  ),
  Bar: ({ dataKey }: { dataKey: string }) => (
    <div data-testid={`bar-${dataKey}`} />
  ),
  XAxis: () => <div data-testid="xaxis" />,
  YAxis: () => <div data-testid="yaxis" />,
  Tooltip: () => <div data-testid="tooltip" />,
}));

const statsResponse = {
  is_quiz: true,
  total_submitted: 3,
  questions: [
    {
      question_number: 1,
      content_item_id: 11,
      prompt: "apple",
      answer: "蘋果",
      correct: [{ student_id: 1, name: "Amy", number: 1 }],
      wrong: [{ student_id: 2, name: "Bob", number: 2 }],
      unanswered: [{ student_id: 3, name: "Cal", number: 3 }],
    },
    {
      question_number: 2,
      content_item_id: 12,
      prompt: "banana",
      answer: "香蕉",
      correct: [
        { student_id: 1, name: "Amy", number: 1 },
        { student_id: 2, name: "Bob", number: 2 },
      ],
      wrong: [],
      unanswered: [{ student_id: 3, name: "Cal", number: 3 }],
    },
  ],
};

describe("ClassQuizStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the quiz-question-stats endpoint with the assignmentId", async () => {
    mockGet.mockResolvedValue(statsResponse);
    render(<ClassQuizStats assignmentId={42} />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        "/api/teachers/assignments/42/quiz-question-stats",
      );
    });
  });

  it("renders the chart and per-question stacked bars on success", async () => {
    mockGet.mockResolvedValue(statsResponse);
    render(<ClassQuizStats assignmentId={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("barchart")).toBeInTheDocument();
    });
    // The three stacked series should be present.
    expect(screen.getByTestId("bar-correct_count")).toBeInTheDocument();
    expect(screen.getByTestId("bar-wrong_count")).toBeInTheDocument();
    expect(screen.getByTestId("bar-unanswered_count")).toBeInTheDocument();
  });

  it("shows the submitted count in the header after data loads", async () => {
    mockGet.mockResolvedValue(statsResponse);
    render(<ClassQuizStats assignmentId={1} />);
    await waitFor(() => {
      // default interpolation string "已交 {{n}}" — i18n mock returns default raw
      expect(screen.getByText(/已交/)).toBeInTheDocument();
    });
  });

  it("renders the legend labels in the data path", async () => {
    mockGet.mockResolvedValue(statsResponse);
    render(<ClassQuizStats assignmentId={1} />);
    await waitFor(() => {
      expect(screen.getByText("答對")).toBeInTheDocument();
    });
    expect(screen.getByText("答錯")).toBeInTheDocument();
    expect(screen.getByText("未作答")).toBeInTheDocument();
  });

  it("renders the empty state when the response has no questions", async () => {
    mockGet.mockResolvedValue({
      is_quiz: true,
      total_submitted: 0,
      questions: [],
    });
    render(<ClassQuizStats assignmentId={1} />);
    await waitFor(() => {
      expect(screen.getByText("尚無提交資料")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("barchart")).not.toBeInTheDocument();
  });

  it("renders the empty state when is_quiz is false", async () => {
    mockGet.mockResolvedValue({
      is_quiz: false,
      total_submitted: 5,
      questions: statsResponse.questions,
    });
    render(<ClassQuizStats assignmentId={1} />);
    await waitFor(() => {
      expect(screen.getByText("尚無提交資料")).toBeInTheDocument();
    });
  });

  it("swallows fetch rejection and renders the empty state without throwing", async () => {
    mockGet.mockRejectedValue(new Error("network down"));
    render(<ClassQuizStats assignmentId={1} />);
    // Component intentionally swallows the error; loading resolves to empty state.
    await waitFor(() => {
      expect(screen.getByText("尚無提交資料")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("barchart")).not.toBeInTheDocument();
  });

  it("always renders the card title regardless of data state", async () => {
    mockGet.mockResolvedValue(statsResponse);
    render(<ClassQuizStats assignmentId={1} />);
    // Title shows immediately (during loading and after).
    expect(screen.getByText("班級報告")).toBeInTheDocument();
    // Let the in-flight fetch settle to avoid act() warnings.
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await screen.findByTestId("barchart");
  });
});
