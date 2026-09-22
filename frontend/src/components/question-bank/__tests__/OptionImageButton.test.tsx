/**
 * OptionImageButton 測試（Issue #1064）：型別／大小擋下、成功回填 image_url、移除。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import OptionImageButton from "../OptionImageButton";

const uploadImage = vi.fn();
vi.mock("@/lib/api", () => ({
  apiClient: { uploadImage: (...a: unknown[]) => uploadImage(...a) },
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("OptionImageButton", () => {
  beforeEach(() => {
    uploadImage.mockReset();
    toastError.mockReset();
  });

  it("成功上傳回填 image_url，之後可移除", async () => {
    uploadImage.mockResolvedValue({ image_url: "http://x/a.png" });
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <OptionImageButton imageUrl={null} onChange={onChange} label="A" />,
    );
    const file = new File([new Uint8Array(10)], "a.png", { type: "image/png" });
    await user.upload(screen.getByTestId("option-image-input"), file);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("http://x/a.png"),
    );
    const fd = uploadImage.mock.calls[0][0] as FormData;
    expect(fd.get("file")).toBeTruthy();
    expect(fd.get("content_id")).toBeNull();

    rerender(
      <OptionImageButton
        imageUrl="http://x/a.png"
        onChange={onChange}
        label="A"
      />,
    );
    await user.click(screen.getByTestId("option-image-remove"));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("非圖片型別或超過 2MB → 擋下不上傳", async () => {
    const onChange = vi.fn();
    // applyAccept: false — 否則 user-event 依 accept 屬性直接濾掉 .txt，驗不到元件本身的型別檢查
    const user = userEvent.setup({ applyAccept: false });
    render(<OptionImageButton imageUrl={null} onChange={onChange} label="A" />);
    const input = screen.getByTestId("option-image-input");

    await user.upload(input, new File(["x"], "a.txt", { type: "text/plain" }));
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", {
      type: "image/png",
    });
    await user.upload(input, big);

    expect(uploadImage).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(2);
  });
});
