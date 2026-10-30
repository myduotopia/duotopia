import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";
import StudentLayout from "../StudentLayout";
import {
  StudentLayoutChromeContext,
  useHideStudentHeaderOnMobile,
} from "@/contexts/StudentLayoutChromeContext";

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

  // #1158 E-3：作答頁（情境對話）要求窄螢幕隱藏「學生專區」標題列
  function Page({ hide }: { hide: boolean }) {
    useHideStudentHeaderOnMobile(hide);
    return <div>page</div>;
  }
  const renderWithPage = (hide: boolean) =>
    render(
      <MemoryRouter initialEntries={["/student/x"]}>
        <Routes>
          <Route path="/student" element={<StudentLayout />}>
            <Route path="x" element={<Page hide={hide} />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

  it("頁面要求時，標題列在窄螢幕隱藏（lg 以上照常）", () => {
    renderWithPage(true);
    const header = screen.getByTestId("student-layout-header");
    expect(header.className).toContain("hidden");
    expect(header.className).toContain("lg:block");
  });

  it("頁面沒要求時，標題列照常顯示", () => {
    renderWithPage(false);
    const header = screen.getByTestId("student-layout-header");
    expect(header.className).not.toContain("hidden");
  });

  // 修正 E3：在畫第一格前就隱藏（useLayoutEffect），標題列不會先閃一下
  it("隱藏要求在 layout 階段就送出（排在後面的 layout effect 已看得到）", () => {
    const setHide = vi.fn();
    let callsSeenInLayout = -1;
    function Probe() {
      useLayoutEffect(() => {
        callsSeenInLayout = setHide.mock.calls.length;
      }, []);
      return null;
    }
    render(
      <StudentLayoutChromeContext.Provider
        value={{ setHideHeaderOnMobile: setHide }}
      >
        <Page hide />
        <Probe />
      </StudentLayoutChromeContext.Provider>,
    );
    expect(callsSeenInLayout).toBe(1);
    expect(setHide).toHaveBeenCalledWith(true);
  });
});
