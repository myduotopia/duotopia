/**
 * pdfToImages（Issue #1146 review 7）—— PDF 點陣化共用 helper（#1112 也會用）。
 *
 * pdf.js 與 canvas 都換成替身（jsdom 沒有 canvas），驗的是 helper 自己的規則：
 * 要畫哪幾頁、頁數上限、檔名與格式、太大改 JPEG、用完一定釋放文件。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_PDF_PAGES, isPdfFile, pdfToImages } from "../pdfToImages";

const getPage = vi.fn();
const destroy = vi.fn();
let numPages = 3;

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: Promise.resolve({
      get numPages() {
        return numPages;
      },
      getPage: (n: number) => getPage(n),
      destroy: () => destroy(),
    }),
  }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "pdf.worker.js",
}));

/** 每次 toBlob 產出的大小（bytes）；用來測「太大改 JPEG」 */
let blobSizes: Record<string, number> = {};

const pdfFile = (name = "lesson.pdf") => {
  const file = new File(["%PDF-1.4"], name, { type: "application/pdf" });
  // jsdom 的 File 不一定有 arrayBuffer
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new ArrayBuffer(8),
  });
  return file;
};

const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;

beforeEach(() => {
  numPages = 3;
  blobSizes = {};
  destroy.mockReset();
  getPage.mockReset();
  getPage.mockImplementation(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 100 * scale,
      height: 50 * scale,
    }),
    render: () => ({ promise: Promise.resolve() }),
    cleanup: vi.fn(),
  }));
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillStyle: "",
    fillRect: vi.fn(),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toBlob = function (
    callback: BlobCallback,
    type?: string,
  ) {
    const mime = type || "image/png";
    callback(new Blob([new Uint8Array(blobSizes[mime] ?? 10)], { type: mime }));
  };
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  HTMLCanvasElement.prototype.toBlob = originalToBlob;
});

describe("pdfToImages", () => {
  it("不指定頁碼 → 全部頁，依頁碼排序，檔名帶頁碼", async () => {
    const pages = await pdfToImages(pdfFile());

    expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(pages[0].file.name).toBe("lesson-p1.png");
    expect(pages[0].file.type).toBe("image/png");
    // 預設 2 倍縮放
    expect(pages[0].width).toBe(200);
    expect(pages[0].height).toBe(100);
  });

  it("只畫指定的頁：去重、排序、超出範圍的略過", async () => {
    const pages = await pdfToImages(pdfFile(), { pages: [3, 1, 3, 0, 9, 1.5] });

    expect(pages.map((p) => p.page)).toEqual([1, 3]);
    expect(getPage.mock.calls.map((c) => c[0])).toEqual([1, 3]);
  });

  it(`最多處理 ${MAX_PDF_PAGES} 頁`, async () => {
    numPages = MAX_PDF_PAGES + 5;
    const pages = await pdfToImages(pdfFile());

    expect(pages).toHaveLength(MAX_PDF_PAGES);
    expect(getPage).not.toHaveBeenCalledWith(MAX_PDF_PAGES + 1);
  });

  it("頁面圖超過大小上限改存 JPEG", async () => {
    blobSizes = { "image/png": 500, "image/jpeg": 100 };
    const pages = await pdfToImages(pdfFile(), { pages: [1], maxBytes: 200 });

    expect(pages[0].file.type).toBe("image/jpeg");
    expect(pages[0].file.name).toBe("lesson-p1.jpg");
  });

  it("畫完一定釋放文件；畫到一半失敗也一樣", async () => {
    await pdfToImages(pdfFile());
    expect(destroy).toHaveBeenCalledTimes(1);

    getPage.mockRejectedValueOnce(new Error("broken page"));
    await expect(pdfToImages(pdfFile())).rejects.toThrow("broken page");
    expect(destroy).toHaveBeenCalledTimes(2);
  });
});

describe("isPdfFile", () => {
  it("看 MIME 或副檔名", () => {
    expect(isPdfFile(new File(["x"], "a.pdf", { type: "" }))).toBe(true);
    expect(isPdfFile(new File(["x"], "a", { type: "application/pdf" }))).toBe(
      true,
    );
    expect(isPdfFile(new File(["x"], "a.png", { type: "image/png" }))).toBe(
      false,
    );
  });
});
