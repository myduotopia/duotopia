/**
 * PDF 點陣化：把 PDF 指定頁（或全部頁）畫成圖片檔（Issue #1146）。
 *
 * **共用 helper**：情境對話（#1146）與題庫「上傳題本」（#1112）都要「PDF 拆頁 → 從頁面
 * 圖用 box_2d 裁圖」，兩邊用這一份，不各寫一份。
 *
 * 為什麼在前端做：後端可用的 PDF 點陣化套件（PyMuPDF）是 AGPL，不適合放進商用後端；
 * `pdfjs-dist`（Apache 2.0）在瀏覽器裡就能畫，畫出來的頁面圖還能留在前端給老師
 * 「手動調整裁切範圍」用，不必再上傳一次。
 *
 * pdf.js 很大（主程式＋worker 約 1MB），一律**動態載入**：沒用到 PDF 的頁面不付這個成本。
 *
 * 產出的檔案：PNG；超過 `maxBytes` 改 JPEG（與 `question-bank/cropImage.ts` 同一套
 * 規則）。這些頁面圖只是裁切的原圖，不會原樣上傳。
 */

/** 一份 PDF 最多處理幾頁（與 #1112 上傳題本同值）。超過的頁數不畫 */
export const MAX_PDF_PAGES = 20;

/**
 * 預設縮放。pdf.js 的 1.0 ＝ 72 DPI，2 倍約 144 DPI：A4 一頁約 1190×1684px，
 * 裁出來的插圖在學生端放大看仍清楚，記憶體也還撐得住 20 頁。
 */
const DEFAULT_SCALE = 2;

export interface PdfToImagesOptions {
  /**
   * 只畫這些頁（1-based）。不給 = 全部頁（最多 MAX_PDF_PAGES）。
   * 擷取只需要「有圖的那幾頁」時傳這個，避免整份都畫。
   */
  pages?: number[];
  scale?: number;
  /** 單張頁面圖的大小上限，超過就改存 JPEG */
  maxBytes?: number;
}

export interface PdfPageImage {
  /** 1-based 頁碼 */
  page: number;
  file: File;
  width: number;
  height: number;
}

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

/** 動態載入 pdf.js 並設定 worker（只做一次） */
async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })().catch((err) => {
      // 載入失敗不要把壞掉的 promise 留著，下次還能重試
      pdfjsPromise = null;
      throw err;
    });
  }
  return pdfjsPromise;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

/**
 * 把 PDF 畫成頁面圖。
 *
 * 回傳依頁碼排序；不存在的頁碼（超出總頁數或超過 MAX_PDF_PAGES）直接略過。
 * 整份讀不開（壞檔、加密）會丟例外，由呼叫端提示老師。
 */
export async function pdfToImages(
  file: File,
  options: PdfToImagesOptions = {},
): Promise<PdfPageImage[]> {
  const scale = options.scale ?? DEFAULT_SCALE;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;

  try {
    const lastPage = Math.min(doc.numPages, MAX_PDF_PAGES);
    const wanted = options.pages
      ? Array.from(new Set(options.pages))
          .filter((p) => Number.isInteger(p) && p >= 1 && p <= lastPage)
          .sort((a, b) => a - b)
      : Array.from({ length: lastPage }, (_, i) => i + 1);

    const baseName = (file.name || "document").replace(/\.[^.]+$/, "");
    const out: PdfPageImage[] = [];
    for (const pageNumber of wanted) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      // PDF 背景是透明的，先鋪白底，否則轉 JPEG 會變黑底
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();

      let blob = await canvasToBlob(canvas, "image/png");
      let ext = "png";
      if (blob && blob.size > maxBytes) {
        blob = await canvasToBlob(canvas, "image/jpeg", 0.85);
        ext = "jpg";
      }
      if (!blob) continue;
      out.push({
        page: pageNumber,
        file: new File([blob], `${baseName}-p${pageNumber}.${ext}`, {
          type: blob.type,
        }),
        width: canvas.width,
        height: canvas.height,
      });
    }
    return out;
  } finally {
    void doc.destroy();
  }
}
