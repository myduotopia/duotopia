/**
 * VisibilitySelect / visibilityLabelKey 測試：題庫只有兩個值，機構 scope 的 private 顯示「僅機構」。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { VisibilitySelect, visibilityLabelKey } from "../VisibilitySelect";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("visibilityLabelKey", () => {
  it("個人：private→私人、public→公開；機構：private→僅機構、public→公開", () => {
    expect(visibilityLabelKey("private", "personal")).toBe(
      "questionBank.visibility.private",
    );
    expect(visibilityLabelKey("public", "personal")).toBe(
      "questionBank.visibility.public",
    );
    expect(visibilityLabelKey("private", "organization")).toBe(
      "questionBank.visibility.organizationPrivate",
    );
    expect(visibilityLabelKey("public", "organization")).toBe(
      "questionBank.visibility.public",
    );
  });
});

describe("VisibilitySelect", () => {
  it("required 且未選 → aria-invalid；已選則無", () => {
    const { rerender } = render(
      <VisibilitySelect value={null} onChange={vi.fn()} required />,
    );
    expect(
      screen.getByTestId("visibility-select").getAttribute("aria-invalid"),
    ).toBe("true");
    rerender(<VisibilitySelect value="public" onChange={vi.fn()} required />);
    expect(
      screen.getByTestId("visibility-select").getAttribute("aria-invalid"),
    ).toBeNull();
  });
});
