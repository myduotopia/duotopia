import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import StudentLayout from "../StudentLayout";

// Mock the stores
vi.mock("@/stores/studentAuthStore", () => ({
  useStudentAuthStore: () => ({
    user: { id: 1, name: "Test Student", email: "test@example.com" },
    logout: vi.fn(),
  }),
}));

// Mock DigitalTeachingToolbar component
vi.mock("@/components/teachingTools/DigitalTeachingToolbar", () => ({
  default: () => (
    <div data-testid="digital-teaching-toolbar">DigitalTeachingToolbar</div>
  ),
}));

// Mock LanguageSwitcher
vi.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <div>LanguageSwitcher</div>,
}));

describe("StudentLayout", () => {
  it("should NOT render DigitalTeachingToolbar", () => {
    render(
      <BrowserRouter>
        <StudentLayout />
      </BrowserRouter>,
    );

    // This test should FAIL initially (RED phase)
    // Students should NOT have access to teaching tools
    expect(
      screen.queryByTestId("digital-teaching-toolbar"),
    ).not.toBeInTheDocument();
  });

  it("should render student sidebar", () => {
    render(
      <BrowserRouter>
        <StudentLayout />
      </BrowserRouter>,
    );

    // Students should have sidebar navigation
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });
});
