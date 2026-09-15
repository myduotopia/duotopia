/**
 * #1045 階段 4 P1 / P5：老師預覽頁示範模式
 * - 小考：進頁 Dialog 出現「考前說明／考後檢討」兩選項；選擇後把模式帶給 StudentActivityPageContent
 * - 頂端切換鈕顯示目前模式，點擊切換並遞增 reset key（作答重置）
 * - 非小考：Dialog 維持只有「關閉」，不帶模式 prop
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TeacherAssignmentPreviewPage from "../TeacherAssignmentPreviewPage";

// t 必須是穩定參照：頁面 effect 依賴 t，每次 render 給新函式會無限重跑 effect
const stableT = (key: string) => key;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("react-router-dom", () => ({
  useParams: () => ({ classroomId: "1", assignmentId: "7" }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/stores/teacherAuthStore", () => ({
  useTeacherAuthStore: () => ({ token: "tok" }),
}));

const getMock = vi.fn();
vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
    patch: vi.fn(),
  },
}));
vi.mock("@/components/grading/QuestionStatBar", () => ({
  default: () => null,
}));
vi.mock("@/components/InstantPracticeSettingsPanel", () => ({
  default: () => null,
}));

type CapturedProps = {
  quizPreviewRevealAnswers?: boolean;
  quizPreviewResetKey?: number;
  onQuizPreviewRestart?: () => void;
};
const captured: CapturedProps[] = [];
vi.mock("../../student/StudentActivityPageContent", () => ({
  default: (props: CapturedProps) => {
    captured.push(props);
    return (
      <div data-testid="activity-content">
        {props.onQuizPreviewRestart && (
          <button type="button" onClick={props.onQuizPreviewRestart}>
            restart
          </button>
        )}
      </div>
    );
  },
}));

const last = () => captured[captured.length - 1];

function mockPreview(practiceMode: string) {
  getMock.mockImplementation((url: string) => {
    if (url.endsWith("/preview")) {
      return Promise.resolve({
        assignment_id: 7,
        title: "t",
        practice_mode: practiceMode,
        total_activities: 0,
        activities: [],
      });
    }
    return Promise.resolve({
      is_quiz: false,
      total_submitted: 0,
      questions: [],
    });
  });
}

beforeEach(() => {
  captured.length = 0;
  getMock.mockReset();
});

describe("TeacherAssignmentPreviewPage quiz demo modes (#1045 P1/P5)", () => {
  it("P1 quiz: dialog offers two modes (no plain close); choosing explain passes reveal=false", async () => {
    mockPreview("word_spelling_quiz");
    render(<TeacherAssignmentPreviewPage />);
    expect(await screen.findByTestId("quiz-mode-explain")).toBeInTheDocument();
    expect(screen.getByTestId("quiz-mode-review")).toBeInTheDocument();
    expect(screen.queryByText("common.close")).toBeNull();

    const keyBefore = last().quizPreviewResetKey ?? 0;
    await act(async () => {
      fireEvent.click(screen.getByTestId("quiz-mode-explain"));
    });
    expect(last().quizPreviewRevealAnswers).toBe(false);
    expect(last().quizPreviewResetKey).toBeGreaterThan(keyBefore);
    expect(screen.getByTestId("quiz-mode-current")).toHaveAttribute(
      "data-mode",
      "explain",
    );
  });

  it("P5 toggle shows current mode, switches and resets answers", async () => {
    mockPreview("word_selection_quiz");
    render(<TeacherAssignmentPreviewPage />);
    // findBy 不可包在 act 內：act 會暫緩載入完成的 state 更新，畫面永遠停在 loading
    const reviewButton = await screen.findByTestId("quiz-mode-review");
    await act(async () => {
      fireEvent.click(reviewButton);
    });
    expect(last().quizPreviewRevealAnswers).toBe(true);
    expect(screen.getByTestId("quiz-mode-current")).toHaveAttribute(
      "data-mode",
      "review",
    );

    const keyBefore = last().quizPreviewResetKey ?? 0;
    fireEvent.click(screen.getByTestId("quiz-mode-toggle"));
    expect(screen.getByTestId("quiz-mode-current")).toHaveAttribute(
      "data-mode",
      "explain",
    );
    expect(last().quizPreviewRevealAnswers).toBe(false);
    expect(last().quizPreviewResetKey).toBe(keyBefore + 1);

    // 「重新示範」也遞增 reset key
    fireEvent.click(screen.getByText("restart"));
    expect(last().quizPreviewResetKey).toBe(keyBefore + 2);
  });

  it("closing the dialog without choosing (Esc) → explain (no answers revealed)", async () => {
    mockPreview("word_cloze_quiz");
    render(<TeacherAssignmentPreviewPage />);
    const explainOption = await screen.findByTestId("quiz-mode-explain");
    // Dialog 開著、尚未選：也不得揭示答案
    expect(last().quizPreviewRevealAnswers).toBe(false);
    expect(screen.getByTestId("quiz-mode-current")).toHaveAttribute(
      "data-mode",
      "explain",
    );

    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? explainOption, {
        key: "Escape",
        code: "Escape",
      });
    });
    expect(screen.queryByTestId("quiz-mode-options")).toBeNull();
    expect(last().quizPreviewRevealAnswers).toBe(false);
    expect(screen.getByTestId("quiz-mode-current")).toHaveAttribute(
      "data-mode",
      "explain",
    );
    // 從未出現過 true（只有明確選考後檢討才會）
    expect(captured.some((p) => p.quizPreviewRevealAnswers === true)).toBe(
      false,
    );
  });

  it("P1 non-quiz: dialog keeps only the close button and passes no mode", async () => {
    mockPreview("reading");
    render(<TeacherAssignmentPreviewPage />);
    expect(await screen.findByText("common.close")).toBeInTheDocument();
    expect(screen.queryByTestId("quiz-mode-options")).toBeNull();
    expect(screen.queryByTestId("quiz-mode-toggle")).toBeNull();
    expect(last().quizPreviewRevealAnswers).toBeUndefined();
    expect(last().onQuizPreviewRestart).toBeUndefined();
  });
});
