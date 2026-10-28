/**
 * 上傳題本（#1112 C3）：把老師選的檔案變成「一頁一張 JPEG」的頁面來源。
 *
 * - **PDF**：`pdfjs-dist`（動態載入，不進主 bundle）逐頁畫到 canvas，固定縮放到長邊約
 *   `PDF_TARGET_LONG_SIDE`（2000px，上限 3 倍）。
 * - **照片**：PNG／JPEG／WebP，依選取順序一張一頁；長邊超過 `PHOTO_MAX_LONG_SIDE`（2400px）就縮小
 *   （`imageOrientation: "from-image"` 依 EXIF 轉正）。
 * - 一律白底輸出 **JPEG**（品質 0.85 起），超過 `MAX_PAGE_BYTES`（後端 MagicPasteService
 *   `MAX_FILE_BYTES` 10MB 再留 1MB 餘裕）就降品質、再縮小，直到低於上限。
 * - 送出前用同一張整頁圖判斷空白頁（`blankPage.ts`）。
 * - **檔案雜湊**：SHA-256（`crypto.subtle`）；多張照片依選取順序把內容串起來算。用來擋同一份
 *   題本重複匯入，以及「繼續」時確認老師重選的是同一份。
 * - PDF 和照片不能混選；最多 `EXAM_IMPORT_MAX_PAGES`（20）頁，超過整批擋下。PDF 或任一張照片
 *   原始檔超過 `MAX_SOURCE_FILE_BYTES`（100MB）也擋下（避免整個讀進記憶體）。錯誤丟
 *   `ClientError`（白話提示見 examImportErrors.ts）。
 * - pdfjs 關掉 `isEvalSupported`（不讓 PDF 內容觸發 eval／new Function）。
 * 頁面只在需要時才畫（`render(n)`），畫過的結果由呼叫端快取。
 */
import { ClientError } from "./examImportErrors";
import { isBlankPixels } from "./blankPage";

export const EXAM_IMPORT_MAX_PAGES = 20;
export const MAX_PAGE_BYTES = 9 * 1024 * 1024;
/** 原始檔上限（PDF 一個或照片一張），單位 MB */
export const MAX_SOURCE_FILE_MB = 100;
export const MAX_SOURCE_FILE_BYTES = MAX_SOURCE_FILE_MB * 1024 * 1024;
const PDF_TARGET_LONG_SIDE = 2000;
const PDF_MAX_SCALE = 3;
const PHOTO_MAX_LONG_SIDE = 2400;
const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];

export interface RenderedPage {
  blob: Blob;
  blank: boolean;
}

export interface PageSource {
  kind: "pdf" | "images";
  /** 草稿上顯示的檔名（多張照片：第一張檔名＋「等 N 張」由畫面組） */
  fileName: string;
  pageCount: number;
  /** SHA-256 hex（小寫） */
  hash: string;
  render: (pageNo: number) => Promise<RenderedPage>;
  dispose: () => void;
}

function isPdf(file: File): boolean {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

async function sha256Hex(buffers: ArrayBuffer[]): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new ClientError("hashUnavailable");
  const total = buffers.reduce((n, b) => n + b.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    joined.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", joined);
  return Array.from(new Uint8Array(digest))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new ClientError("renderFailed"))),
      "image/jpeg",
      quality,
    ),
  );
}

function newCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ClientError("renderFailed");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/** 判斷空白後輸出 JPEG；太大就降品質、再縮小 */
async function finishPage(canvas: HTMLCanvasElement): Promise<RenderedPage> {
  const ctx = canvas.getContext("2d");
  const blank = ctx
    ? isBlankPixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data)
    : false;
  let current = canvas;
  for (let shrink = 0; shrink < 4; shrink += 1) {
    for (const quality of [0.85, 0.7, 0.55]) {
      const blob = await canvasToBlob(current, quality);
      if (blob.size <= MAX_PAGE_BYTES) return { blob, blank };
    }
    const { canvas: smaller, ctx: sctx } = newCanvas(
      current.width * 0.75,
      current.height * 0.75,
    );
    sctx.drawImage(current, 0, 0, smaller.width, smaller.height);
    current = smaller;
  }
  throw new ClientError("pageTooLarge");
}

async function pdfSource(file: File): Promise<PageSource> {
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex([buffer]);
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url"))
    .default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    // getDocument 會把 buffer 轉給 worker，給它一份複本
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer.slice(0)),
      isEvalSupported: false,
    }).promise;
  } catch {
    throw new ClientError("pdfUnreadable");
  }
  if (doc.numPages > EXAM_IMPORT_MAX_PAGES) {
    void doc.destroy();
    throw new ClientError("tooManyPages", {
      count: doc.numPages,
      max: EXAM_IMPORT_MAX_PAGES,
    });
  }
  return {
    kind: "pdf",
    fileName: file.name,
    pageCount: doc.numPages,
    hash,
    render: async (pageNo) => {
      const page = await doc.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        PDF_MAX_SCALE,
        PDF_TARGET_LONG_SIDE / Math.max(base.width, base.height),
      );
      const viewport = page.getViewport({ scale });
      const { canvas, ctx } = newCanvas(viewport.width, viewport.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();
      return finishPage(canvas);
    },
    dispose: () => void doc.destroy(),
  };
}

async function imagesSource(files: File[]): Promise<PageSource> {
  if (files.some((f) => !PHOTO_TYPES.includes(f.type))) {
    throw new ClientError("unsupportedFile");
  }
  if (files.length > EXAM_IMPORT_MAX_PAGES) {
    throw new ClientError("tooManyPhotos", {
      count: files.length,
      max: EXAM_IMPORT_MAX_PAGES,
    });
  }
  const hash = await sha256Hex(
    await Promise.all(files.map((f) => f.arrayBuffer())),
  );
  return {
    kind: "images",
    fileName: files[0].name,
    pageCount: files.length,
    hash,
    render: async (pageNo) => {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(files[pageNo - 1], {
          imageOrientation: "from-image",
        });
      } catch {
        throw new ClientError("imageUnreadable");
      }
      const ratio = Math.min(
        1,
        PHOTO_MAX_LONG_SIDE / Math.max(bitmap.width, bitmap.height),
      );
      const { canvas, ctx } = newCanvas(
        bitmap.width * ratio,
        bitmap.height * ratio,
      );
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return finishPage(canvas);
    },
    dispose: () => undefined,
  };
}

/** 老師選的檔案 → 頁面來源。PDF 只能一個；照片可以多張；兩種不能混。 */
export async function preparePageSource(files: File[]): Promise<PageSource> {
  if (files.length === 0) throw new ClientError("noFile");
  const tooLarge = files.find((f) => f.size > MAX_SOURCE_FILE_BYTES);
  if (tooLarge) {
    throw new ClientError("fileTooLarge", {
      name: tooLarge.name,
      max: MAX_SOURCE_FILE_MB,
    });
  }
  const pdfs = files.filter(isPdf);
  if (pdfs.length > 0 && pdfs.length < files.length) {
    throw new ClientError("mixedFiles");
  }
  if (pdfs.length > 1) throw new ClientError("onePdfOnly");
  if (pdfs.length === 1) return pdfSource(pdfs[0]);
  return imagesSource(files);
}
