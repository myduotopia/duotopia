/**
 * useExamImport 流程測試（#1112 C3 review 12）。後端 API 用記憶體裡的假後端（不連網路、不呼叫 AI）。
 *
 * 1. 停下後接著送：網路中斷停下 → `canResume` →「繼續處理」(`resume`) 把剩下的頁送完；
 *    提示列「繼續」打開同一份（`openImport`）也會接著送
 * 2. 被 400 擋下的頁：標原因、這一輪不再自動送；`resendPage` 重送成功
 * 3. 處理中又按開始擷取：丟 `anotherRunning`、不建立新匯入
 * 4. 用狀態的子元件卸載（切到「教材」分頁）處理繼續；持有狀態的頁面卸載才停
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";

import { ApiError } from "@/lib/api";
import {
  useExamImport,
  type ExamImportController,
} from "../exam-import/useExamImport";
import type { PageSource } from "../exam-import/pageSource";
import { examImportApi } from "../exam-import/examImportApi";
import type {
  ExamImportDetail,
  ExamImportPage,
  ExamImportSettingsPayload,
} from "../exam-import/types";

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

vi.mock("react-i18next", () => {
  const translation = { t: (key: string) => key, i18n: { language: "zh-TW" } };
  return { useTranslation: () => translation };
});

// ---- 假後端 ----
let pages: ExamImportPage[] = [];
/** 送頁時的行為：回傳 Promise 就照它（可以讓它失敗或卡住） */
let sendHook: ((pageNo: number) => Promise<void> | void) | null = null;
const created: number[] = [];

function detail(): ExamImportDetail {
  return {
    id: 1,
    file_name: "paper.pdf",
    file_hash: "a".repeat(64),
    page_count: pages.length,
    status: pages.every((p) => p.status === "done") ? "ready" : "processing",
    settings: {},
    tts_accents: ["american"],
    question_count: 0,
    pages_done: pages.filter((p) => p.status === "done").length,
    pages_failed: pages.filter((p) => p.status === "failed").length,
    pages_blank: 0,
    created_at: null,
    updated_at: null,
    known_answers: {},
    retry_limits: { page_resends: 2, question_retries: 2 },
    pages: pages.map((p) => ({ ...p })),
  };
}

function makePages(n: number): ExamImportPage[] {
  return Array.from({ length: n }, (_, i) => ({
    page_no: i + 1,
    status: "pending" as const,
    image_url: null,
    is_answer_page: false,
    cards: [],
    error: null,
    blank_skipped: false,
    resend_count: 0,
    processed_at: null,
  }));
}

const sendPage = vi.fn(async (_id: number, pageNo: number) => {
  if (sendHook) await sendHook(pageNo);
  pages = pages.map((p) =>
    p.page_no === pageNo ? { ...p, status: "done" as const } : p,
  );
  return { page: pages[pageNo - 1], import: detail() };
});

vi.mock("../exam-import/examImportApi", () => ({
  examImportApi: {
    create: vi.fn(async () => {
      created.push(1);
      return detail();
    }),
    list: vi.fn(async () => ({ items: [] })),
    get: vi.fn(async () => detail()),
    sendPage: (id: number, pageNo: number) => sendPage(id, pageNo),
    markBlank: vi.fn(),
    sendBlank: vi.fn(),
    abandon: vi.fn(),
  },
}));

function fakeSource(pageCount: number): PageSource {
  return {
    kind: "pdf",
    fileName: "paper.pdf",
    pageCount,
    hash: "a".repeat(64),
    render: async () => ({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      blank: false,
    }),
    dispose: vi.fn(),
  };
}

const settings: ExamImportSettingsPayload = {
  grade_min: 7,
  grade_max: 9,
  source_id: 1,
  program_links: [],
  visibility: "private",
};

function startInput(pageCount: number) {
  return { source: fakeSource(pageCount), accents: ["american"], settings };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  pages = makePages(3);
  sendHook = null;
  created.length = 0;
  sendPage.mockClear();
  URL.createObjectURL = vi.fn(() => "blob:page");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useExamImport：停下後接著送", () => {
  it("網路中斷停下 → 顯示可以繼續 → resume 把剩下的頁送完", async () => {
    let failOnce = true;
    sendHook = (pageNo) => {
      if (pageNo === 1 && failOnce) {
        failOnce = false;
        throw new ApiError(0, "Network error");
      }
    };
    const { result } = renderHook(() => useExamImport(true));
    await act(async () => {
      await result.current.start(startInput(3));
    });
    // 先送最後一頁（3），再從第 1 頁；第 1 頁網路中斷 → 停下
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(result.current.runError?.key).toBe("network");
    expect(result.current.canResume).toBe(true);
    expect(pages.map((p) => p.status)).toEqual(["pending", "pending", "done"]);

    await act(async () => {
      result.current.resume();
    });
    await waitFor(() =>
      expect(pages.every((p) => p.status === "done")).toBe(true),
    );
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(result.current.canResume).toBe(false);
    expect(result.current.runError).toBeNull();
  });

  it("提示列「繼續」打開同一份、檔案還在 → 接著送", async () => {
    let failOnce = true;
    sendHook = (pageNo) => {
      if (pageNo === 1 && failOnce) {
        failOnce = false;
        throw new ApiError(0, "Network error");
      }
    };
    const { result } = renderHook(() => useExamImport(true));
    await act(async () => {
      await result.current.start(startInput(3));
    });
    await waitFor(() => expect(result.current.canResume).toBe(true));

    await act(async () => {
      await result.current.openImport(1);
    });
    await waitFor(() =>
      expect(pages.every((p) => p.status === "done")).toBe(true),
    );
  });

  it("被 400 擋下的頁：標原因、這一輪不再自動送；重送這一頁成功", async () => {
    let failOnce = true;
    sendHook = (pageNo) => {
      if (pageNo === 2 && failOnce) {
        failOnce = false;
        throw new ApiError(400, "too large");
      }
    };
    const { result } = renderHook(() => useExamImport(true));
    await act(async () => {
      await result.current.start(startInput(3));
    });
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(pages.map((p) => p.status)).toEqual(["done", "pending", "done"]);
    expect(result.current.pageNotes[2]?.key).toBe("badImage");
    expect(result.current.canResume).toBe(true);

    await act(async () => {
      await result.current.resendPage(2);
    });
    await waitFor(() => expect(pages[1].status).toBe("done"));
    expect(result.current.pageNotes[2]).toBeUndefined();
  });
});

describe("useExamImport：一次只處理一份", () => {
  it("處理中又按開始擷取 → 丟 anotherRunning、不建立新匯入", async () => {
    const gate = deferred();
    sendHook = () => gate.promise;
    const { result } = renderHook(() => useExamImport(true));
    await act(async () => {
      await result.current.start(startInput(3));
    });
    expect(result.current.running).toBe(true);

    await expect(result.current.start(startInput(2))).rejects.toMatchObject({
      key: "anotherRunning",
    });
    expect(created).toHaveLength(1);

    await act(async () => {
      gate.resolve();
    });
    await waitFor(() => expect(result.current.running).toBe(false));
  });
});

describe("useExamImport：切分頁與卸載", () => {
  /** 像「我的教材」頁：狀態在頁面層，題庫分頁可以切走 */
  function Page({
    onController,
  }: {
    onController: (c: ExamImportController) => void;
  }) {
    const controller = useExamImport(true);
    const [showQuestions, setShowQuestions] = useState(true);
    onController(controller);
    return (
      <div>
        <button
          type="button"
          data-testid="to-materials"
          onClick={() => setShowQuestions(false)}
        />
        {showQuestions && <span data-testid="questions-tab">questions</span>}
      </div>
    );
  }

  it("切到教材分頁（題庫分頁卸載）處理繼續", async () => {
    const gate = deferred();
    sendHook = (pageNo) => (pageNo === 3 ? gate.promise : undefined);
    let controller!: ExamImportController;
    const view = render(<Page onController={(c) => (controller = c)} />);
    await act(async () => {
      await controller.start(startInput(3));
    });
    act(() => {
      view.getByTestId("to-materials").click();
    });
    expect(view.queryByTestId("questions-tab")).toBeNull();

    await act(async () => {
      gate.resolve();
    });
    await waitFor(() =>
      expect(pages.every((p) => p.status === "done")).toBe(true),
    );
  });

  it("持有狀態的頁面卸載 → 停止，不再送下一頁", async () => {
    const gate = deferred();
    sendHook = (pageNo) => (pageNo === 3 ? gate.promise : undefined);
    const { result, unmount } = renderHook(() => useExamImport(true));
    await act(async () => {
      await result.current.start(startInput(3));
    });
    unmount();
    await act(async () => {
      gate.resolve();
    });
    // 第 3 頁送完後不再送第 1、2 頁
    await new Promise((r) => setTimeout(r, 20));
    expect(sendPage.mock.calls.map((c) => c[1])).toEqual([3]);
  });
});

/**
 * Issue #1112 的 feature flag（`ENABLE_QUESTION_BANK_EXAM_IMPORT`）關閉時，
 * 頁面傳 `enabled=false`。這組釘住「關閉就真的不碰後端」——
 * production 關著的期間，老師開題庫不應該打到 exam-imports 端點。
 */
describe("useExamImport：enabled 決定要不要碰後端", () => {
  it("enabled=false 不打清單端點；同一個 instance 翻成 true 才打", async () => {
    const { rerender } = renderHook(({ on }) => useExamImport(on), {
      initialProps: { on: false },
    });

    // 等到 macrotask（setTimeout 0）而不是只等一輪 microtask：日後 mount 的
    // effect 若在呼叫 list 之前多了一個 await，單一 microtask 的 flush 會讓
    // 「沒被呼叫」變成假通過 —— PR #1175 review 第 3 點提的正是這個。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(vi.mocked(examImportApi.list)).not.toHaveBeenCalled();

    // 同一個 hook instance 把 enabled 翻成 true 就會打。寫在同一條而不是另開
    // 一條，是為了讓「0 次」有意義：證明它不是因為 hook 根本沒跑起來、或假後端
    // 壞掉而為 0。兩條分開會各自新建 instance，對不上這個因果。
    rerender({ on: true });
    await waitFor(() =>
      expect(vi.mocked(examImportApi.list)).toHaveBeenCalled(),
    );
  });
});
