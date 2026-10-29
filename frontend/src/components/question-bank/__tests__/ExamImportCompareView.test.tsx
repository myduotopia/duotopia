/**
 * 上傳題本核對畫面・「整頁對照原卷」分頁（#1112 C4c 第 4 點；cold-read E1／E8／E9、定案 U2／U3）。
 *
 * 1. `compareBox`：小題框優先、整組框其次；跨頁小題只在自己那頁畫；手動補的題不畫
 * 2. 寬螢幕切到整頁對照 → 開目前這題所在的頁，「‹ 第 N／總 頁 ›」換頁、到頭停用並說明
 * 3. 滑鼠停在右邊的題 → 左邊畫框（位置照 bbox 0–1000 換成百分比）；離開後留著點過的那題
 * 4. 右邊可以原位編輯；編輯中存不回去 → 不換分頁
 * 5. 窄螢幕（< md）不顯示分頁、一律逐題核對
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { compareBox } from "../exam-import/ExamImportCompareView";
import type { ExamImportCard } from "../exam-import/types";
import type { QuestionDraft } from "../questionDraft";
import { ApiError } from "@/lib/api";
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

const api = vi.hoisted(() => ({ patchCard: vi.fn() }));
vi.mock("../exam-import/examImportApi", () => ({ examImportApi: api }));

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiClient: { listExamPoints: vi.fn(async () => ({ items: [] })) },
}));

vi.mock("../exam-import/ExamImportReviewTop", () => ({
  default: () => <div data-testid="top-stub" />,
}));

vi.mock("../QuestionCard", () => ({
  default: ({
    draft,
    onChange,
  }: {
    draft: QuestionDraft;
    onChange: (d: QuestionDraft) => void;
  }) => (
    <input
      data-testid="qc-stub-stem"
      value={draft.stem}
      onChange={(e) => onChange({ ...draft, stem: e.target.value })}
    />
  ),
}));

const originalMatchMedia = window.matchMedia;
const setWide = (wide: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: wide && query.includes("min-width"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  vi.clearAllMocks();
  setWide(true);
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function withBox(card: ExamImportCard, bbox: number[]): ExamImportCard {
  card.question!.bbox = bbox;
  return card;
}

function twoPages() {
  const p1 = page(1, [
    withBox(single("a", "1"), [100, 50, 200, 950]),
    withBox(single("b", "2"), [300, 50, 400, 950]),
  ]);
  const p2 = page(2, [withBox(single("c", "3"), [500, 0, 600, 1000])]);
  p1.image_url = "https://img/p1.png";
  p2.image_url = "https://img/p2.png";
  return controllerWith([p1, p2]);
}

const openCompare = () =>
  fireEvent.mouseDown(screen.getByTestId("exam-review-tab-compare"));

describe("compareBox", () => {
  it("小題框優先；跨頁小題不在這頁不畫；手動補的題不畫", () => {
    const g = group("g", { bbox: [0, 0, 900, 1000] });
    g.group!.questions![0].bbox = [400, 0, 500, 1000];
    g.group!.questions![0].page_no = 1;
    g.group!.questions!.push({
      source_question_no: "2",
      page_no: 2,
      bbox: [100, 0, 200, 1000],
    });
    expect(compareBox(g, 0, 1)).toEqual([400, 0, 500, 1000]);
    expect(compareBox(g, 1, 1)).toBeNull();
    expect(compareBox(g, 1, 2)).toEqual([100, 0, 200, 1000]);
    expect(compareBox(g, null, 1)).toEqual([0, 0, 900, 1000]);
    expect(
      compareBox({ ...g, manual: true } as ExamImportCard, 0, 1),
    ).toBeNull();
    // 框不合法（下緣在上緣上面）不畫
    const bad = withBox(single("x", "9"), [500, 0, 100, 1000]);
    expect(compareBox(bad, 0, 1)).toBeNull();
  });
});

describe("整頁對照原卷", () => {
  it("切過去開第 1 頁；換頁兩邊一起換；到頭停用並說明", async () => {
    renderReview(twoPages());
    openCompare();
    await screen.findByTestId("exam-compare");
    expect(screen.getByTestId("exam-compare-page").textContent).toBe(
      'questionBank.examImport.review.compare.page {"n":1,"total":2}',
    );
    expect(screen.getByTestId("exam-card-a-view")).toBeTruthy();
    expect(screen.queryByTestId("exam-card-c-view")).toBeNull();
    // 題號下拉換成頁碼列
    expect(screen.queryByTestId("exam-review-picker")).toBeNull();

    const prev = screen.getByTestId("exam-compare-prev") as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(prev.parentElement?.getAttribute("title")).toBe(
      "questionBank.examImport.review.compare.firstPage",
    );

    fireEvent.click(screen.getByTestId("exam-compare-next"));
    await waitFor(() =>
      expect(screen.getByTestId("exam-card-c-view")).toBeTruthy(),
    );
    expect(screen.queryByTestId("exam-card-a-view")).toBeNull();
    expect(screen.getByTestId("exam-compare-image").getAttribute("src")).toBe(
      "https://img/p2.png",
    );
    expect(
      (screen.getByTestId("exam-compare-next") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("滑鼠停在右邊的題 → 左邊畫框；離開後留著點過的那題", async () => {
    renderReview(twoPages());
    openCompare();
    await screen.findByTestId("exam-compare");
    expect(screen.queryByTestId("exam-compare-box")).toBeNull();

    const preview = (id: string) =>
      screen.getByTestId(`exam-card-${id}-preview-q-0-number`);
    fireEvent.mouseOver(preview("b"));
    const box = screen.getByTestId("exam-compare-box");
    expect(box.style.top).toBe("30%");
    expect(box.style.left).toBe("5%");
    expect(box.style.height).toBe("10%");
    expect(box.style.width).toBe("90%");

    fireEvent.mouseLeave(screen.getByTestId("exam-compare-questions"));
    expect(screen.queryByTestId("exam-compare-box")).toBeNull();

    // 點了 a（打開編輯）→ 離開後框留在 a
    fireEvent.click(preview("a"));
    fireEvent.mouseLeave(screen.getByTestId("exam-compare-questions"));
    expect(screen.getByTestId("exam-compare-box").style.top).toBe("10%");
  });

  it("右邊可以原位編輯；編輯中存不回去 → 不換分頁", async () => {
    api.patchCard.mockRejectedValue(
      new ApiError(500, { message: "boom" } as unknown as { message: string }),
    );
    renderReview(twoPages());
    openCompare();
    await screen.findByTestId("exam-compare");
    fireEvent.click(screen.getByTestId("exam-card-a-edit"));
    fireEvent.change(await screen.findByTestId("qc-stub-stem"), {
      target: { value: "Changed" },
    });

    fireEvent.mouseDown(screen.getByTestId("exam-review-tab-questions"));
    await waitFor(() => expect(api.patchCard).toHaveBeenCalled());
    // 還在整頁對照、編輯沒關
    expect(screen.getByTestId("exam-compare")).toBeTruthy();
    expect(screen.getByTestId("exam-card-a-editor")).toBeTruthy();
  });

  it("切回逐題核對 → 回到考卷列表", async () => {
    renderReview(twoPages());
    openCompare();
    await screen.findByTestId("exam-compare");
    fireEvent.mouseDown(screen.getByTestId("exam-review-tab-questions"));
    await waitFor(() =>
      expect(screen.getByTestId("exam-review-scroll")).toBeTruthy(),
    );
    expect(screen.queryByTestId("exam-compare")).toBeNull();
    expect(screen.getByTestId("exam-review-picker")).toBeTruthy();
  });

  it("窄螢幕（< md）一律逐題核對", async () => {
    setWide(false);
    renderReview(twoPages());
    openCompare();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("exam-compare")).toBeNull();
    expect(screen.getByTestId("exam-review-scroll")).toBeTruthy();
  });
});
