/**
 * 上傳題本核對畫面・題號下拉列（#1112 C4c，cold-read E2／E3／E11、定案 U4）。
 * Radix Select 換成簡單替身（選項＝按鈕），只測我們自己的分組、狀態與動作。
 *
 * 1. 下拉依「原卷第 P 頁」分組、每題標狀態文字；處理中的頁一行灰字不能選；觸發鈕只顯示題號
 * 2. 選一題 → 捲到那題並淡藍底；選回目前這題也會再捲一次
 * 3. 需注意 ‹ ›：下一個／上一個需注意的題，到頭尾循環；0 題時停用並說明
 * 4. 捲動偵測：捲動區 1/3 處碰到的題變成「第 N 題」；程式捲動後一小段時間不改
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";

import {
  controllerWith,
  group,
  page,
  renderReview,
  single,
} from "./examImportReviewFixtures";

vi.mock("react-i18next", () => {
  const translation = {
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    i18n: { language: "zh-TW" },
  };
  return { useTranslation: () => translation };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../exam-import/examImportApi", () => ({ examImportApi: {} }));

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiClient: { listExamPoints: vi.fn(async () => ({ items: [] })) },
}));

vi.mock("../exam-import/ExamImportReviewTop", () => ({
  default: () => <div data-testid="top-stub" />,
}));

// 標準 Select 的替身：選項是按鈕，點了呼叫 onValueChange（同值也呼叫，與 Radix 不同，
// 所以「選回同一題」改測選項自己的 onClick）
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const Pick = React.createContext<(v: string) => void>(() => undefined);
  type P = { children?: React.ReactNode; [k: string]: unknown };
  return {
    Select: ({ children, onValueChange, value }: P) => (
      <Pick.Provider value={onValueChange as (v: string) => void}>
        <div data-testid="select-stub" data-value={value as string}>
          {children}
        </div>
      </Pick.Provider>
    ),
    SelectTrigger: ({ children, ...p }: P) => (
      <div data-testid={p["data-testid"] as string}>{children}</div>
    ),
    SelectValue: ({ children }: P) => <span>{children}</span>,
    SelectContent: ({ children }: P) => <div>{children}</div>,
    SelectGroup: ({ children }: P) => <div role="group">{children}</div>,
    SelectLabel: ({ children }: P) => <div data-role="label">{children}</div>,
    SelectItem: ({ children, value, onClick, ...p }: P) => {
      const pick = React.useContext(Pick);
      return (
        <button
          type="button"
          data-testid={p["data-testid"] as string}
          onClick={(e) => {
            (onClick as ((e: unknown) => void) | undefined)?.(e);
            pick(value as string);
          }}
        >
          {children}
        </button>
      );
    },
  };
});

const scrolled: string[] = [];

beforeEach(() => {
  scrolled.length = 0;
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this.id);
  });
});

const domId = (key: string) =>
  `exam-review-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;

describe("題號下拉", () => {
  it("依原卷頁分組、每題標狀態；處理中的頁一行灰字；觸發鈕只顯示題號", () => {
    const controller = controllerWith([
      page(1, [
        single("a", "1"),
        single("b", "2", {}, []),
        single("c", "3", {
          duplicate_of: { type: "bank", kind: "single", id: 5 },
        }),
        single("d", "4", {
          duplicate_of: {
            type: "bank",
            kind: "single",
            id: 6,
            reason: "same_stem",
          },
        }),
        single("e", "5", { status: "failed" }),
        single("f", "6", { duplicate_of: { type: "import", card_id: "a" } }),
      ]),
      page(2, [], "processing"),
    ]);
    renderReview(controller);

    const status = (key: string) =>
      screen
        .getByTestId(`exam-review-picker-item-${key}`)
        .querySelector("[data-status]")
        ?.getAttribute("data-status") ?? null;
    expect(status("a:0")).toBeNull();
    expect(status("b:0")).toBe("missing");
    expect(status("c:0")).toBe("duplicate");
    expect(status("d:0")).toBe("sameStem");
    expect(status("e:0")).toBe("failed");
    expect(status("f:0")).toBe("importDuplicate");
    expect(
      screen.getByTestId("exam-review-picker-item-c:0").textContent,
    ).toContain("questionBank.examImport.review.status.duplicate");

    const labels = Array.from(document.querySelectorAll("[data-role=label]"));
    expect(labels.map((l) => l.textContent)).toEqual([
      'questionBank.examImport.review.pageLabel {"n":1}',
      'questionBank.examImport.review.pageLabel {"n":2}',
    ]);
    expect(screen.getByTestId("exam-review-picker-processing-2")).toBeTruthy();
    expect(screen.queryByTestId("exam-review-picker-item-page-2")).toBeNull();

    // 缺答案、失敗、本份重複算需注意；題庫已有、題目文字相同不算
    expect(screen.getByTestId("exam-review-attention").textContent).toContain(
      '"count":3',
    );

    // 還沒選：觸發鈕空的；選了 → 只顯示題號
    fireEvent.click(screen.getByTestId("exam-review-picker-item-c:0"));
    expect(screen.getByTestId("exam-review-picker").textContent).toBe("3");
  });

  it("題組每個小題一列，標籤＝原卷題號", () => {
    const g = group("g");
    g.group!.questions!.push({
      source_question_no: "2",
      stem: "Who?",
      options: ["a", "b"],
      correct_indexes: [],
      status: "ok",
    });
    renderReview(controllerWith([page(1, [g])]));
    expect(screen.getByTestId("exam-review-picker-item-g:0").textContent).toBe(
      "1",
    );
    expect(
      screen.getByTestId("exam-review-picker-item-g:1").textContent,
    ).toContain("questionBank.examImport.review.status.missing");
  });

  it("選一題 → 捲到那題、淡藍底；選回同一題再捲一次", () => {
    renderReview(
      controllerWith([page(1, [single("a", "1"), single("b", "2")])]),
    );
    fireEvent.click(screen.getByTestId("exam-review-picker-item-b:0"));
    expect(scrolled).toEqual([domId("b:0")]);
    expect(document.getElementById(domId("b:0"))?.className).toContain(
      "bg-blue-50",
    );
    fireEvent.click(screen.getByTestId("exam-review-picker-item-b:0"));
    expect(scrolled.length).toBeGreaterThanOrEqual(2);
    expect(scrolled[scrolled.length - 1]).toBe(domId("b:0"));
  });
});

describe("需注意 ‹ ›", () => {
  const threeMissing = () =>
    controllerWith([
      page(1, [
        single("a", "1", {}, []),
        single("b", "2"),
        single("c", "3", {}, []),
        single("d", "4", {}, []),
      ]),
    ]);

  it("下一個依序、到底循環；上一個從頭往回到最後一個", () => {
    renderReview(threeMissing());
    const next = screen.getByTestId("exam-review-attention-next");
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);
    expect(scrolled).toEqual([
      domId("a:0"),
      domId("c:0"),
      domId("d:0"),
      domId("a:0"),
    ]);

    scrolled.length = 0;
    const prev = screen.getByTestId("exam-review-attention-prev");
    fireEvent.click(prev); // 目前在 a → 往回循環到 d
    fireEvent.click(prev);
    expect(scrolled).toEqual([domId("d:0"), domId("c:0")]);
  });

  it("沒有需注意的題 → ‹ › 停用並說明", () => {
    renderReview(controllerWith([page(1, [single("a", "1")])]));
    for (const name of ["prev", "next"]) {
      const btn = screen.getByTestId(
        `exam-review-attention-${name}`,
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.parentElement?.getAttribute("title")).toBe(
        "questionBank.examImport.review.noAttention",
      );
    }
  });
});

describe("捲動偵測", () => {
  type Callback = (records: Partial<IntersectionObserverEntry>[]) => void;
  let callback: Callback | null = null;
  const observed: Element[] = [];
  const original = globalThis.IntersectionObserver;

  beforeEach(() => {
    callback = null;
    observed.length = 0;
    class FakeObserver {
      constructor(cb: Callback) {
        callback = cb;
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
      unobserve() {}
    }
    globalThis.IntersectionObserver =
      FakeObserver as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    globalThis.IntersectionObserver = original;
    vi.useRealTimers();
  });

  it("1/3 線碰到的題變成目前這題；選題後一小段時間不被捲動蓋掉", () => {
    renderReview(
      controllerWith([
        page(1, [single("a", "11"), single("b", "12"), single("c", "13")]),
      ]),
    );
    expect(observed.map((el) => el.id)).toEqual([
      domId("a:0"),
      domId("b:0"),
      domId("c:0"),
    ]);
    const el = (k: string) => document.getElementById(domId(k))!;

    act(() => callback!([{ target: el("b:0"), isIntersecting: true }]));
    expect(screen.getByTestId("exam-review-picker").textContent).toBe("12");

    // 同時碰到兩題 → 取前面那題
    act(() => callback!([{ target: el("a:0"), isIntersecting: true }]));
    expect(screen.getByTestId("exam-review-picker").textContent).toBe("11");

    // 從下拉選 c，平滑捲動經過 a、b 不改
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId("exam-review-picker-item-c:0"));
    act(() =>
      callback!([
        { target: el("a:0"), isIntersecting: false },
        { target: el("b:0"), isIntersecting: true },
      ]),
    );
    expect(screen.getByTestId("exam-review-picker").textContent).toBe("13");

    // 過了暫停時間，捲動又會更新
    vi.advanceTimersByTime(1500);
    act(() =>
      callback!([
        { target: el("b:0"), isIntersecting: false },
        { target: el("c:0"), isIntersecting: true },
      ]),
    );
    expect(screen.getByTestId("exam-review-picker").textContent).toBe("13");
    act(() => callback!([{ target: el("b:0"), isIntersecting: true }]));
    expect(screen.getByTestId("exam-review-picker").textContent).toBe("12");
  });
});
