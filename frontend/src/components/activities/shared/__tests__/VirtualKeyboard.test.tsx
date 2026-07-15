import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import VirtualKeyboard from "../VirtualKeyboard";

// react-simple-keyboard renders each key as a button carrying a
// `data-skbtn` attribute equal to the key's value.
function getKey(container: HTMLElement, value: string): HTMLElement | null {
  return container.querySelector(`[data-skbtn="${value}"]`);
}

describe("VirtualKeyboard", () => {
  it("底排提供 '-' (連字號) 鍵", () => {
    const { container } = render(<VirtualKeyboard onKey={vi.fn()} onBackspace={vi.fn()} onEnter={vi.fn()} />);
    expect(getKey(container, "-")).not.toBeNull();
  });

  it("點擊 '-' 會以字元 '-' 呼叫 onKey", () => {
    const onKey = vi.fn();
    const { container } = render(<VirtualKeyboard onKey={onKey} onBackspace={vi.fn()} onEnter={vi.fn()} />);
    const hyphen = getKey(container, "-");
    expect(hyphen).not.toBeNull();
    fireEvent.click(hyphen as HTMLElement);
    expect(onKey).toHaveBeenCalledWith("-");
  });

  it("'-' 鍵套用 vk-punct（與字母同寬）", () => {
    const { container } = render(<VirtualKeyboard onKey={vi.fn()} onBackspace={vi.fn()} onEnter={vi.fn()} />);
    const hyphen = getKey(container, "-");
    expect(hyphen?.className).toContain("vk-punct");
  });
});
