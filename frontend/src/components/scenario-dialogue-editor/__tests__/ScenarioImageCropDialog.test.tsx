/**
 * ScenarioImageCropDialog（Issue #1146 review 7）—— 情境圖手動重裁。
 *
 * 驗：開啟時畫出目前的裁切框、拖拉換算成 box_2d、套用送出新框、沒有原圖時不能套用、
 * 處理中不能關。圖的實際位置用替身（jsdom 不排版）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { ScenarioImage } from "../scenarioImages";
import { ScenarioImageCropDialog } from "../ScenarioImageCropDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const APPLY = "scenarioDialogue.images.applyCrop";
const CANCEL = "contentEditor.buttons.cancel";

const sourceFile = new File(["img"], "page.png", { type: "image/png" });
const image = (box = [100, 100, 500, 500]): ScenarioImage => ({
  id: "si-1",
  url: "https://cdn/si-1.png",
  source: { file: sourceFile, box },
});

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
let rectSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:source");
  URL.revokeObjectURL = vi.fn();
  // 畫面上的圖：左上 (0,0)、寬 200、高 100
  rectSpy = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  // jsdom 不一定有 PointerEvent；沒有的話 fireEvent.pointer* 會丟掉 clientX/Y
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    (window as unknown as { PointerEvent: unknown }).PointerEvent =
      PointerEventPolyfill;
  }
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  rectSpy.mockRestore();
});

const renderDialog = (
  props: Partial<Parameters<typeof ScenarioImageCropDialog>[0]> = {},
) => {
  const onApply = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ScenarioImageCropDialog
      image={image()}
      busy={false}
      onApply={onApply}
      onOpenChange={onOpenChange}
      {...props}
    />,
  );
  return { onApply, onOpenChange };
};

describe("ScenarioImageCropDialog", () => {
  it("開啟時在原圖上畫出目前的裁切框，直接套用就是原本的框", () => {
    const { onApply } = renderDialog();

    expect(screen.getByTestId("scenario-crop-area")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: APPLY }));
    expect(onApply).toHaveBeenCalledWith([100, 100, 500, 500]);
  });

  it("拖拉出新框 → 換算成 box_2d（[ymin, xmin, ymax, xmax]，0–1000）", () => {
    const { onApply } = renderDialog();
    const area = screen.getByTestId("scenario-crop-area");

    fireEvent.pointerDown(area, { clientX: 20, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(area, { clientX: 100, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(area, { pointerId: 1 });

    fireEvent.click(screen.getByRole("button", { name: APPLY }));
    expect(onApply).toHaveBeenCalledWith([100, 100, 600, 500]);
  });

  it("沒按下就移動不會改框", () => {
    const { onApply } = renderDialog();
    const area = screen.getByTestId("scenario-crop-area");

    fireEvent.pointerMove(area, { clientX: 150, clientY: 90, pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: APPLY }));
    expect(onApply).toHaveBeenCalledWith([100, 100, 500, 500]);
  });

  it("已存的圖沒有原圖：不顯示裁切區，不能套用", () => {
    const { onApply } = renderDialog({
      image: { id: "si-2", url: "https://cdn/x.png", source: null },
    });

    expect(screen.queryByTestId("scenario-crop-area")).toBeNull();
    const apply = screen.getByRole("button", { name: APPLY });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("處理中（重新上傳）不能取消也不能再按套用", () => {
    renderDialog({ busy: true });

    expect(screen.getByRole("button", { name: CANCEL })).toBeDisabled();
    expect(screen.getByRole("button", { name: APPLY })).toBeDisabled();
  });

  it("image 為 null 時不開啟", () => {
    renderDialog({ image: null });
    expect(screen.queryByRole("button", { name: APPLY })).toBeNull();
  });
});
