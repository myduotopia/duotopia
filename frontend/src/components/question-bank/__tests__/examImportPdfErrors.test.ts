/**
 * 上傳題本 PDF 開檔失敗的錯誤分流（#1112 第四輪）。
 *
 * 1. `pdfErrorKey`：依 pdfjs 例外的 `name` 對到 errors 底下的 key
 *    （有密碼 → pdfPassword；損壞／不是 PDF → pdfInvalid；其他 → pdfLoaderFailed）
 * 2. `preparePageSource`：getDocument 失敗時丟對應的 `ClientError`，並 console.error 原始錯誤
 * 3. 三個 key 中英文都有
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getDocument = vi.fn();
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: (...args: unknown[]) => getDocument(...args),
}));

import { pdfErrorKey, preparePageSource } from "../exam-import/pageSource";
import { ClientError } from "../exam-import/examImportErrors";
import zhTW from "@/i18n/locales/zh-TW/translation.json";
import en from "@/i18n/locales/en/translation.json";

function namedError(name: string): Error {
  const err = new Error(`${name} message`);
  err.name = name;
  return err;
}

/** 不靠 jsdom 的 File／crypto：給 preparePageSource 一個只有用到欄位的假 PDF */
function fakePdf(): File {
  return {
    name: "exam.pdf",
    type: "application/pdf",
    size: 4,
    arrayBuffer: async () => new ArrayBuffer(4),
  } as unknown as File;
}

describe("pdfErrorKey", () => {
  it("PasswordException → pdfPassword", () => {
    expect(pdfErrorKey(namedError("PasswordException"))).toBe("pdfPassword");
  });

  it("InvalidPDFException／MissingPDFException → pdfInvalid", () => {
    expect(pdfErrorKey(namedError("InvalidPDFException"))).toBe("pdfInvalid");
    expect(pdfErrorKey(namedError("MissingPDFException"))).toBe("pdfInvalid");
  });

  it("其他錯誤（worker 載不進來、動態 import 失敗、非 Error）→ pdfLoaderFailed", () => {
    expect(pdfErrorKey(new Error("Setting up fake worker failed"))).toBe(
      "pdfLoaderFailed",
    );
    expect(pdfErrorKey(new TypeError("Failed to fetch dynamically"))).toBe(
      "pdfLoaderFailed",
    );
    expect(pdfErrorKey("boom")).toBe("pdfLoaderFailed");
    expect(pdfErrorKey(undefined)).toBe("pdfLoaderFailed");
  });
});

describe("preparePageSource：PDF 開檔失敗", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getDocument.mockReset();
    vi.stubGlobal("crypto", {
      subtle: { digest: async () => new ArrayBuffer(32) },
    });
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleError.mockRestore();
  });

  it.each([
    ["PasswordException", "pdfPassword"],
    ["InvalidPDFException", "pdfInvalid"],
    ["MissingPDFException", "pdfInvalid"],
    ["Error", "pdfLoaderFailed"],
  ])("%s → ClientError(%s)，並 console.error 原始錯誤", async (name, key) => {
    const original = namedError(name);
    getDocument.mockReturnValue({ promise: Promise.reject(original) });

    const err = await preparePageSource([fakePdf()]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClientError);
    expect((err as ClientError).key).toBe(key);
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), original);
  });

  it("getDocument 同步丟錯（例如元件初始化失敗）也走同一段分流", async () => {
    getDocument.mockImplementation(() => {
      throw new Error("worker init failed");
    });
    const err = await preparePageSource([fakePdf()]).catch((e: unknown) => e);
    expect((err as ClientError).key).toBe("pdfLoaderFailed");
  });
});

describe("i18n", () => {
  it.each(["pdfPassword", "pdfInvalid", "pdfLoaderFailed"])(
    "%s 中英文都有",
    (key) => {
      const zh = zhTW.questionBank.examImport.errors as Record<string, string>;
      const enErrors = en.questionBank.examImport.errors as Record<
        string,
        string
      >;
      expect(zh[key]).toBeTruthy();
      expect(enErrors[key]).toBeTruthy();
    },
  );
});
