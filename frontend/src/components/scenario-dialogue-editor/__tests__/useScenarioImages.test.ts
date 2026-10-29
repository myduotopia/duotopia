/**
 * useScenarioImages（Issue #1146 review 7）—— 5 張上限的計數。
 *
 * 裁切（canvas／pdf.js）與上傳（API）換成替身，只驗「每一批拿到幾格空位」：
 * - 同一個 async 流程裡連續擷取多個檔案（面板就是這樣依序擷取）
 * - 兩批同時在跑（擷取還在上傳、又補傳一批）時，空位不能被兩邊重複算
 * - 上傳失敗的那幾格要還回來
 */
import { useState } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScenarioImage, ScenarioImageSource } from "../scenarioImages";
import { useScenarioImages } from "../useScenarioImages";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const toastInfo = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: (...args: unknown[]) => toastInfo(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const cropFigures = vi.fn();
const uploadCrops = vi.fn();
vi.mock("../scenarioImages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scenarioImages")>()),
  cropFigures: (...args: unknown[]) => cropFigures(...args),
  uploadCrops: (...args: unknown[]) => uploadCrops(...args),
}));

type Crop = { file: File; source: ScenarioImageSource | null };

let seq = 0;
/** 照 uploadCrops 的契約：只上傳前 room 張，其餘算 skipped */
const fakeUpload = (crops: Crop[], room: number, failEvery = 0) => {
  const take = crops.slice(0, Math.max(0, room));
  const images: ScenarioImage[] = [];
  let failed = 0;
  take.forEach((crop, i) => {
    if (failEvery && (i + 1) % failEvery === 0) failed += 1;
    else
      images.push({ id: `img-${seq++}`, url: `u${seq}`, source: crop.source });
  });
  return { images, failed, skipped: crops.length - take.length };
};

const figures = (n: number) =>
  Array.from({ length: n }, () => ({ page: 1, box_2d: [0, 0, 500, 500] }));
const file = new File(["x"], "scene.png", { type: "image/png" });

function useHarness(initial: ScenarioImage[] = []) {
  const [images, setImages] = useState<ScenarioImage[]>(initial);
  return useScenarioImages(images, setImages);
}

beforeEach(() => {
  toastInfo.mockReset();
  toastError.mockReset();
  cropFigures.mockReset();
  uploadCrops.mockReset();
  cropFigures.mockImplementation(async (f: File, figs: unknown[]) =>
    figs.map(() => ({ file: f, source: { file: f, box: [0, 0, 500, 500] } })),
  );
  uploadCrops.mockImplementation(async (crops: Crop[], room: number) =>
    fakeUpload(crops, room),
  );
});

describe("useScenarioImages 5 張上限", () => {
  it("同一個流程連續擷取兩個檔案：第二個只拿到剩下的空位", async () => {
    const { result } = renderHook(() => useHarness());

    await act(async () => {
      await result.current.addExtracted(file, figures(3));
      await result.current.addExtracted(file, figures(3));
    });

    expect(uploadCrops.mock.calls.map((c) => c[1])).toEqual([3, 2]);
    expect(result.current.images).toHaveLength(5);
    expect(toastInfo).toHaveBeenCalledWith("scenarioDialogue.images.overLimit");
  });

  it("兩批同時在跑：空位先預留，合計不超過 5 張", async () => {
    const pending: Array<() => void> = [];
    uploadCrops.mockImplementation(
      (crops: Crop[], room: number) =>
        new Promise((resolve) => {
          pending.push(() => resolve(fakeUpload(crops, room)));
        }),
    );
    const { result } = renderHook(() => useHarness());

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.addExtracted(file, figures(4));
      second = result.current.addManual([
        new File(["a"], "a.png", { type: "image/png" }),
        new File(["b"], "b.png", { type: "image/png" }),
      ]);
    });
    await waitFor(() => expect(uploadCrops).toHaveBeenCalledTimes(2));
    expect(result.current.busy).toBe(true);

    await act(async () => {
      pending.forEach((resolve) => resolve());
      await Promise.all([first, second]);
    });

    // 先跑到上傳的那批拿到它要的，另一批只拿剩下的；總共 5 格
    const rooms = uploadCrops.mock.calls.map((c) => c[1] as number);
    expect(rooms.reduce((sum, n) => sum + n, 0)).toBe(5);
    expect(result.current.images).toHaveLength(5);
    expect(result.current.busy).toBe(false);
  });

  it("上傳失敗的格數還回來，下一批可以用", async () => {
    uploadCrops.mockImplementationOnce(async (crops: Crop[], room: number) =>
      fakeUpload(crops, room, 2),
    );
    const { result } = renderHook(() => useHarness());

    await act(async () => {
      // 4 張裡第 2、4 張上傳失敗 → 只進 2 張
      await result.current.addExtracted(file, figures(4));
    });
    expect(result.current.images).toHaveLength(2);
    expect(toastError).toHaveBeenCalledWith(
      "scenarioDialogue.images.uploadFailed",
    );

    await act(async () => {
      await result.current.addExtracted(file, figures(4));
    });
    expect(uploadCrops.mock.calls[1][1]).toBe(3);
    expect(result.current.images).toHaveLength(5);
  });

  it("已存的情境圖也算在內", async () => {
    const saved = Array.from({ length: 4 }, (_, i) => ({
      id: `saved-${i}`,
      url: `https://cdn/${i}.png`,
      source: null,
    }));
    const { result } = renderHook(() => useHarness(saved));

    await act(async () => {
      await result.current.addExtracted(file, figures(3));
    });

    expect(uploadCrops.mock.calls[0][1]).toBe(1);
    expect(result.current.images).toHaveLength(5);
  });
});
