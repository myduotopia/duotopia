/**
 * 前端裁圖（#1084 第 1 段）：jsdom 沒有 canvas，只測「裁不了就回 null、不丟例外」的路徑。
 */
import { describe, it, expect } from "vitest";

import { cropImageFile } from "../cropImage";

describe("cropImageFile", () => {
  it("PDF 不裁（前端無法點陣化）→ null", async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "a.pdf", {
      type: "application/pdf",
    });
    expect(await cropImageFile(pdf, [0, 0, 500, 1000])).toBeNull();
  });

  it("沒有座標 → null", async () => {
    const png = new File([new Uint8Array([0x89, 0x50])], "a.png", {
      type: "image/png",
    });
    expect(await cropImageFile(png, null)).toBeNull();
    expect(await cropImageFile(png, undefined)).toBeNull();
  });

  it("jsdom 無法載入／繪製圖片時回 null 而不是丟例外", async () => {
    const png = new File([new Uint8Array([0x89, 0x50])], "a.png", {
      type: "image/png",
    });
    await expect(cropImageFile(png, [0, 0, 500, 1000])).resolves.toBeNull();
  });
});
