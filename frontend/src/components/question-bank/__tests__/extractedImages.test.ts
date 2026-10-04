/**
 * 擷取圖片裁切／上傳的「座標對位」測試（#1084 / #1086）。
 *
 * 真正的裁切（canvas）與上傳（API）都 mock 掉，只驗證一件事：
 * 一次攤平送進 `cropImageFileMany` 的那串 box，回來的 url 要各自歸回
 * 素材圖、文章插圖、每題題幹、每題各選項的正確位置 —— 題數不同、
 * 選項數不同（2／4／6）、部分 box 為 null 時都不能錯位。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import type {
  MagicPasteGroupResult,
  MagicPasteMcItem,
} from "@/components/shared/MagicPasteInput";

const cropManyMock = vi.fn();
const uploadMock = vi.fn();

vi.mock("../cropImage", () => ({
  cropImageFileMany: (...a: unknown[]) => cropManyMock(...a),
}));
vi.mock("../uploadImageFile", () => ({
  uploadImageFile: (...a: unknown[]) => uploadMock(...a),
  MAX_IMAGE_BYTES: 2 * 1024 * 1024,
  VALID_IMAGE_TYPES: ["image/png"],
}));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import {
  uploadExtractedGroupImages,
  uploadExtractedQuestionImages,
} from "../extractedImages";

const t = ((key: string) => key) as never;

const pngFile = () => new File(["x"], "sheet.png", { type: "image/png" });

/** 裁出來的檔名帶攤平後的序號，上傳 mock 再轉成 url，就能驗證對位 */
function mockCropByIndex() {
  cropManyMock.mockImplementation((_file: File, boxes: unknown[]) =>
    Promise.resolve(
      boxes.map((b, i) =>
        b ? new File(["x"], `crop-${i}.png`, { type: "image/png" }) : null,
      ),
    ),
  );
  uploadMock.mockImplementation((file: File) =>
    Promise.resolve(`https://cdn/${file.name}`),
  );
}

const url = (i: number) => `https://cdn/crop-${i}.png`;

const box = (n: number) => [n, n, n + 10, n + 10];

/** 3 題：2／4／6 個選項，部分 box 故意留 null */
function mcItems(): MagicPasteMcItem[] {
  return [
    {
      stem: "two options",
      stem_box_2d: box(1), // flat 0
      options: ["a", "b"],
      option_boxes: [box(2), null], // flat 1, 2
      correct_indexes: [0],
      explanation: "",
    },
    {
      stem: "four options",
      stem_box_2d: null, // flat 3
      options: ["", "", "", ""],
      option_boxes: [box(3), box(4), null, box(5)], // flat 4..7
      correct_indexes: [1],
      explanation: "",
    },
    {
      stem: "six options",
      stem_box_2d: box(6), // flat 8
      options: ["a", "b", "c", "d", "e", "f"],
      option_boxes: [null, null, box(7), null, null, box(8)], // flat 9..14
      correct_indexes: [2],
      explanation: "",
    },
  ];
}

const expectedQuestionImages = (offset: number) => ({
  stemUrls: [url(offset + 0), null, url(offset + 8)],
  optionUrls: [
    [url(offset + 1), null],
    [url(offset + 4), url(offset + 5), null, url(offset + 7)],
    [null, null, url(offset + 11), null, null, url(offset + 14)],
  ],
});

describe("uploadExtractedQuestionImages（單題擷取）", () => {
  beforeEach(() => {
    cropManyMock.mockReset();
    uploadMock.mockReset();
    mockCropByIndex();
  });

  it("多題、選項數不同、部分 box 為 null → 題幹與選項各歸其位", async () => {
    const items = mcItems();
    const images = await uploadExtractedQuestionImages(items, pngFile(), t);

    // 一次解碼：只呼叫一次 cropImageFileMany，攤平長度 = 題數 + 總選項數
    expect(cropManyMock).toHaveBeenCalledTimes(1);
    expect((cropManyMock.mock.calls[0][1] as unknown[]).length).toBe(3 + 12);
    // 只有真的有 box 的位置才上傳
    expect(uploadMock).toHaveBeenCalledTimes(8);
    expect(images).toEqual(expectedQuestionImages(0));
  });

  it("PDF：不裁不上傳，形狀仍與題目對齊（全 null）", async () => {
    const items = mcItems();
    const images = await uploadExtractedQuestionImages(
      items,
      new File(["x"], "sheet.pdf", { type: "application/pdf" }),
      t,
    );
    expect(cropManyMock).not.toHaveBeenCalled();
    expect(images.stemUrls).toEqual([null, null, null]);
    expect(images.optionUrls.map((o) => o.length)).toEqual([2, 4, 6]);
    expect(images.optionUrls.flat().every((u) => u === null)).toBe(true);
  });
});

describe("uploadExtractedGroupImages（題組擷取）", () => {
  beforeEach(() => {
    cropManyMock.mockReset();
    uploadMock.mockReset();
    mockCropByIndex();
  });

  const groupResult = (): MagicPasteGroupResult => ({
    title: "Santa",
    stimulus: {
      kind: "text",
      paragraphs: ["First.", "Second."],
      text: "",
      box_2d: null,
      page: null,
      figures: [
        { box_2d: box(20), after_paragraph: 0, caption: "santa" },
        { box_2d: null, after_paragraph: 1, caption: "missing" },
        { box_2d: box(21), after_paragraph: 1, caption: "tree" },
      ],
    },
    glossary: [],
    questions: mcItems(),
  });

  it("素材圖／插圖／每題題幹／每題選項各歸其位", async () => {
    const images = await uploadExtractedGroupImages(
      groupResult(),
      pngFile(),
      t,
    );

    expect(cropManyMock).toHaveBeenCalledTimes(1);
    // 攤平順序：素材圖(1) + 插圖(3) + 小題(3 題幹 + 12 選項)
    expect((cropManyMock.mock.calls[0][1] as unknown[]).length).toBe(
      1 + 3 + 15,
    );
    // kind=text 沒有整塊素材圖
    expect(images.stimulusUrl).toBeNull();
    expect(images.figureUrls).toEqual([url(1), null, url(3)]);
    expect(images.questions).toEqual(expectedQuestionImages(4));
  });

  it("kind=image：第一格是整塊素材圖，插圖與小題位置跟著平移", async () => {
    const result = groupResult();
    result.stimulus = {
      kind: "image",
      paragraphs: [],
      text: "poster",
      box_2d: box(30),
      page: 1,
      figures: [],
    };
    const images = await uploadExtractedGroupImages(result, pngFile(), t);

    expect(images.stimulusUrl).toBe(url(0));
    expect(images.figureUrls).toEqual([]);
    expect(images.questions).toEqual(expectedQuestionImages(1));
  });

  it("多張上傳失敗時只 toast 一次摘要", async () => {
    const { toast } = await import("sonner");
    uploadMock.mockResolvedValue(null);

    const images = await uploadExtractedGroupImages(
      groupResult(),
      pngFile(),
      t,
    );

    expect(images.questions?.optionUrls.flat().every((u) => u === null)).toBe(
      true,
    );
    const errors = vi.mocked(toast.error).mock.calls;
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toBe(
      "contentEditor.magicPaste.croppedImageUploadFailed",
    );
  });
});
