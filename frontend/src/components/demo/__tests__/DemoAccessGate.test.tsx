/**
 * Tests for DemoAccessGate (#989) — the screen shown when a public demo is
 * outside the schedule its teacher set.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import DemoAccessGate from "../DemoAccessGate";
import { REDIRECT_STORAGE_KEY } from "@/utils/redirectAfterLogin";

const navigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

function storedPath(): string | null {
  const raw = localStorage.getItem(REDIRECT_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { path: string }).path : null;
}

function renderGate(
  props: Partial<React.ComponentProps<typeof DemoAccessGate>>,
) {
  return render(
    <MemoryRouter>
      <DemoAccessGate status="expired" {...props} />
    </MemoryRouter>,
  );
}

describe("DemoAccessGate", () => {
  beforeEach(() => {
    localStorage.clear();
    navigate.mockReset();
  });

  it("shows the expired heading and the copy invitation", () => {
    renderGate({ status: "expired", resourceProgramId: 63 });

    expect(screen.getByText("demo.access.expired.title")).toBeInTheDocument();
    expect(
      screen.getByText("demo.access.expired.invitation"),
    ).toBeInTheDocument();
  });

  it("shows the not-started heading when the demo has not opened", () => {
    renderGate({
      status: "not_started",
      startDate: "2099-01-01T00:00:00+00:00",
      resourceProgramId: 63,
    });

    expect(
      screen.getByText("demo.access.notStarted.title"),
    ).toBeInTheDocument();
  });

  it("drops the copy promise when no resource program was resolved", () => {
    renderGate({ status: "expired", resourceProgramId: null });

    expect(
      screen.getByText("demo.access.expired.invitationNoCopy"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("demo.access.expired.invitation"),
    ).not.toBeInTheDocument();
  });

  it("stores the copy target before sending the visitor to register", () => {
    renderGate({ status: "expired", resourceProgramId: 63 });

    fireEvent.click(screen.getByText("demo.access.registerCta"));

    expect(storedPath()).toBe("/teacher/programs?demoCopyProgram=63");
    expect(navigate).toHaveBeenCalledWith("/teacher/register");
  });

  it("sends the visitor to login without a copy target when none resolved", () => {
    renderGate({ status: "expired", resourceProgramId: null });

    fireEvent.click(screen.getByText("demo.access.loginCta"));

    expect(storedPath()).toBe("/teacher/programs");
    expect(navigate).toHaveBeenCalledWith("/teacher/login");
  });
});
