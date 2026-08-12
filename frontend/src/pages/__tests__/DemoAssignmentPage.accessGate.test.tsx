/**
 * Wiring test for DemoAssignmentPage (#989).
 *
 * DemoAccessGate has its own unit tests; what is checked here is the branch in
 * the page itself — a preview response whose `access_status` is not "active"
 * must render the gate instead of the activity, and the normal response must
 * still render the activity.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import DemoAssignmentPage from "../DemoAssignmentPage";
import { demoApi } from "@/lib/demoApi";

vi.mock("@/lib/demoApi", () => ({
  demoApi: { getPreview: vi.fn() },
  DemoApiError: class extends Error {},
}));

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return {
    ...actual,
    useParams: () => ({ assignmentId: "42" }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

// The activity renderer and the gate are covered by their own tests; stub them
// so this test fails only when the page picks the wrong branch.
vi.mock("@/components/demo/DemoAccessGate", () => ({
  default: ({
    status,
    resourceProgramId,
  }: {
    status: string;
    resourceProgramId?: number | null;
  }) => (
    <div data-testid="access-gate">
      {status}:{String(resourceProgramId)}
    </div>
  ),
}));

vi.mock("../student/StudentActivityPageContent", () => ({
  default: () => <div data-testid="activity-content" />,
}));

const getPreview = vi.mocked(demoApi.getPreview);

function renderPage() {
  return render(
    <MemoryRouter>
      <DemoAssignmentPage />
    </MemoryRouter>,
  );
}

describe("DemoAssignmentPage access window (#989)", () => {
  beforeEach(() => {
    getPreview.mockReset();
  });

  it("renders the access gate when the demo has not opened yet", async () => {
    getPreview.mockResolvedValue({
      assignment_id: 42,
      title: "Demo",
      access_status: "not_started",
      start_date: "2099-01-01T00:00:00+00:00",
      due_date: null,
      resource_program_id: 63,
      resource_program_name: "Starter Pack",
      total_activities: 0,
      activities: [],
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("access-gate")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("access-gate")).toHaveTextContent(
      "not_started:63",
    );
    expect(screen.queryByTestId("activity-content")).not.toBeInTheDocument();
  });

  it("renders the access gate when the demo has expired", async () => {
    getPreview.mockResolvedValue({
      assignment_id: 42,
      title: "Demo",
      access_status: "expired",
      start_date: null,
      due_date: "2020-01-01T00:00:00+00:00",
      resource_program_id: null,
      resource_program_name: null,
      total_activities: 0,
      activities: [],
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("access-gate")).toHaveTextContent(
        "expired:null",
      ),
    );
    expect(screen.queryByTestId("activity-content")).not.toBeInTheDocument();
  });

  it("renders the activity while the demo is active", async () => {
    getPreview.mockResolvedValue({
      assignment_id: 42,
      title: "Demo",
      access_status: "active",
      start_date: null,
      due_date: null,
      total_activities: 1,
      activities: [{ id: 1, type: "reading_assessment" }],
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("activity-content")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("access-gate")).not.toBeInTheDocument();
  });
});
