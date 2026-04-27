import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import LineContactButton from "../LineContactButton";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

describe("LineContactButton", () => {
  it("renders as an anchor pointing to the LINE add-friend URL", () => {
    render(<LineContactButton />);
    const link = screen.getByRole("link", {
      name: "common.lineContact.ariaLabel",
    });
    expect(link).toHaveAttribute("href", "https://line.me/R/ti/p/@duotopia");
  });

  it("opens the LINE link in a new tab safely", () => {
    render(<LineContactButton />);
    const link = screen.getByRole("link", {
      name: "common.lineContact.ariaLabel",
    });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("uses an i18n aria-label", () => {
    render(<LineContactButton />);
    expect(
      screen.getByLabelText("common.lineContact.ariaLabel"),
    ).toBeInTheDocument();
  });
});
