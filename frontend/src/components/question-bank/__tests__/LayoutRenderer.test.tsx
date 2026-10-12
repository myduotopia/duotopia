/**
 * LayoutRenderer 測試（Issue #1082 修訂三）。
 *
 * 老師預覽＝學生端＝考卷共用的 renderer，這裡鎖住：
 * 段落開頭與換行後的空格照原樣（whitespace-pre-wrap）。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import LayoutRenderer from "../LayoutRenderer";
import type { LayoutDoc } from "@/types/questionBank";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

function docWith(text: string): LayoutDoc {
  return {
    version: 1,
    rows: [{ columns: [{ span: 1, blocks: [{ type: "paragraph", text }] }] }],
  };
}

describe("LayoutRenderer", () => {
  it("段落開頭兩個空格與換行後的兩個空格都保留", () => {
    render(
      <LayoutRenderer layout={docWith("  First line.\n  Second line.")} />,
    );
    const p = screen.getByTestId("layout-renderer").querySelector("p");
    expect(p).not.toBeNull();
    expect(p!.className).toContain("whitespace-pre-wrap");
    // br 節點把 \n 換成 <br>，其餘字元（含空格）原樣進 DOM
    expect(p!.textContent).toBe("  First line.  Second line.");
    expect(p!.querySelectorAll("br")).toHaveLength(1);
  });

  it("==雙底線== 渲染成 decoration-double 的 span", () => {
    render(<LayoutRenderer layout={docWith("a ==b== c")} />);
    const span = screen
      .getByTestId("layout-renderer")
      .querySelector("span.decoration-double");
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe("b");
  });

  it("註解全空或只有空列時不渲染註解框；有有效項目才渲染", () => {
    const { rerender } = render(
      <LayoutRenderer layout={docWith("x")} glossary={[]} />,
    );
    expect(screen.queryByTestId("layout-glossary")).toBeNull();
    rerender(
      <LayoutRenderer
        layout={docWith("x")}
        glossary={[
          { word: "", zh: "" },
          { word: "timeline", zh: "" },
        ]}
      />,
    );
    expect(screen.queryByTestId("layout-glossary")).toBeNull();
    rerender(
      <LayoutRenderer
        layout={docWith("x")}
        glossary={[
          { word: "", zh: "" },
          { word: "timeline", zh: "時間軸" },
        ]}
      />,
    );
    const box = screen.getByTestId("layout-glossary");
    expect(box.textContent).toContain("timeline");
    expect(box.querySelectorAll(":scope > span")).toHaveLength(1);
  });

  it("layout.frame（整篇外框）：所有列包在框內、單字註解在框外；沒設就沒有框", () => {
    const glossary = [{ word: "timeline", zh: "時間軸" }];
    const { rerender } = render(
      <LayoutRenderer layout={docWith("x")} glossary={glossary} />,
    );
    expect(screen.queryByTestId("layout-frame")).toBeNull();
    rerender(
      <LayoutRenderer
        layout={{ ...docWith("body text"), frame: true }}
        glossary={glossary}
      />,
    );
    const frame = screen.getByTestId("layout-frame");
    expect(frame.className).toContain("border");
    expect(frame).toHaveTextContent("body text");
    expect(within(frame).queryByTestId("layout-glossary")).toBeNull();
    expect(screen.getByTestId("layout-glossary")).toBeTruthy();
  });

  it("標題與對話文字也保留空格", () => {
    const layout: LayoutDoc = {
      version: 1,
      rows: [
        {
          columns: [
            {
              span: 1,
              blocks: [
                { type: "heading", level: 2, text: "  Title" },
                {
                  type: "dialogue",
                  lines: [{ speaker: "Jim", text: "  Hi there" }],
                },
              ],
            },
          ],
        },
      ],
    };
    render(<LayoutRenderer layout={layout} />);
    const root = screen.getByTestId("layout-renderer");
    const h2 = root.querySelector("h2")!;
    expect(h2.className).toContain("whitespace-pre-wrap");
    expect(h2.textContent).toBe("  Title");
    const spans = Array.from(root.querySelectorAll("span")).filter((s) =>
      s.className.includes("whitespace-pre-wrap"),
    );
    expect(spans.some((s) => s.textContent === "  Hi there")).toBe(true);
  });

  it("圖片可點擊放大（#1083 以圖為準，手機必要）：桌機與堆疊模式都有放大鈕，點了開 Dialog", async () => {
    const user = userEvent.setup();
    const layout: LayoutDoc = {
      version: 1,
      rows: [
        {
          columns: [
            {
              span: 1,
              blocks: [
                { type: "image", url: "http://x/poster.png", alt: "Poster" },
              ],
            },
          ],
        },
      ],
    };
    const { unmount } = render(<LayoutRenderer layout={layout} />);
    const zoom = screen.getByRole("button", {
      name: "questionBank.group.render.zoomImage",
    });
    expect(zoom.className).toContain("cursor-zoom-in");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(zoom);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
      "http://x/poster.png",
    );
    unmount();

    render(<LayoutRenderer layout={layout} forceStack />);
    expect(
      screen.getByRole("button", {
        name: "questionBank.group.render.zoomImage",
      }),
    ).toBeTruthy();
    // 關掉放大：預覽／學生端以外（例如考卷）不給放大鈕
    const r = render(<LayoutRenderer layout={layout} zoomable={false} />);
    expect(
      within(r.container).queryByRole("button", {
        name: "questionBank.group.render.zoomImage",
      }),
    ).toBeNull();
  });
});
