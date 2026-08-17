/**
 * Issue #983-2 — browser email autofill must fill ONE roster row, not all.
 *
 * Root cause of the first (failed) fix: the page has no <form> element at
 * all, so Chrome treats the whole document as a single autofill section and
 * fills every type="email" input at once. Chrome also deliberately ignores
 * autocomplete="off" for contact-info autofill, so the unique `name` +
 * autocomplete="off" pairing shipped in PR #984 could not have worked.
 *
 * The fix scopes autofill by giving every roster row its OWN <form>: browser
 * autofill never crosses a form boundary, so a one-field form can only ever
 * receive one value.
 *
 * These are structural assertions — real autofill can't be driven from
 * jsdom. They exist to stop the form wrappers from being refactored away.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import GroupBuyOpenPage from "../GroupBuyOpenPage";

const PLAN = {
  name: "團購-10席",
  teacher_seats: 3,
  annual_fee: 1000,
  total_amount: 3000,
  topup_discount: 0.95,
  monthly_quota: 500,
  display_order: 1,
};

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  apiClient: {
    listGroupBuyPlans: vi.fn(),
    getMyPersonalPromoCode: vi.fn(),
    validateTeamEmails: vi.fn(),
  },
}));

// The store state must be a stable module-level object: the page's roster
// effect depends on `teacher` identity, so returning a fresh object per
// render would loop forever.
const AUTH_STATE = { user: { id: 1, email: "leader@example.com" } };
vi.mock("@/stores/teacherAuthStore", () => ({
  useTeacherAuthStore: (selector: (s: unknown) => unknown) =>
    selector(AUTH_STATE),
}));

vi.mock("@/components/payment/TapPayPayment", () => ({
  default: () => null,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

import { apiClient } from "@/lib/api";

/** Render the page and advance to Step 2 (roster). */
async function renderRoster() {
  vi.mocked(apiClient.listGroupBuyPlans).mockResolvedValue([PLAN]);
  vi.mocked(apiClient.getMyPersonalPromoCode).mockResolvedValue({
    code: "PROMO1",
    expires_at: null,
    is_active: true,
    referral_count: 0,
    verified_count: 0,
    paid_count: 0,
    total_points_awarded: 0,
  });
  vi.mocked(apiClient.validateTeamEmails).mockResolvedValue({ results: [] });

  render(
    <BrowserRouter>
      <GroupBuyOpenPage />
    </BrowserRouter>,
  );

  fireEvent.click(await screen.findByRole("button", { name: "選擇此方案" }));
  await waitFor(() => expect(rosterInputs()).toHaveLength(PLAN.teacher_seats));
}

/** The roster email inputs, in render order. */
function rosterInputs(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[name^="gb-roster-email-"]',
    ),
  );
}

describe("GroupBuyOpenPage — roster email autofill scoping (#983-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("puts every roster email input in its own form element", async () => {
    await renderRoster();

    const forms = rosterInputs().map((input) => input.closest("form"));
    expect(forms.every((f) => f !== null)).toBe(true);
    // Distinct form nodes — a shared wrapper would let autofill spill across
    // rows, which is exactly the reported bug.
    expect(new Set(forms).size).toBe(forms.length);
  });

  it("keeps exactly one email input inside each roster form", async () => {
    await renderRoster();

    for (const input of rosterInputs()) {
      const form = input.closest("form") as HTMLFormElement;
      expect(form.querySelectorAll("input")).toHaveLength(1);
    }
  });

  it("gives each roster input a unique name and an explicit email autocomplete hint", async () => {
    await renderRoster();

    const inputs = rosterInputs();
    const names = inputs.map((i) => i.getAttribute("name"));
    expect(new Set(names).size).toBe(inputs.length);
    for (const input of inputs) {
      // autocomplete="off" is ignored by Chrome for contact info; declare the
      // real field type so autofill still works — scoped to this one form.
      expect(input.getAttribute("autocomplete")).toBe("email");
    }
  });

  it("does not submit or navigate when Enter is pressed in a roster form", async () => {
    await renderRoster();

    const form = rosterInputs()[0].closest("form") as HTMLFormElement;
    const submit = vi.fn();
    form.addEventListener("submit", submit);

    fireEvent.submit(form);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].defaultPrevented).toBe(true);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("still routes typing to only the edited row", async () => {
    await renderRoster();

    fireEvent.change(rosterInputs()[1], {
      target: { value: "member2@example.com" },
    });

    const values = rosterInputs().map((i) => i.value);
    expect(values[1]).toBe("member2@example.com");
    expect(values[2]).toBe("");
  });
});
