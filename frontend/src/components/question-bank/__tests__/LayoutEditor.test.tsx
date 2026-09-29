/**
 * LayoutEditor 元件測試（Issue #1082 第 3 段）。
 *
 * jsdom 不測拖拉（dnd-kit 需要真實座標），只測結構操作與預覽：
 * 新增列／區塊、輸入段落、改比例（多欄→少欄區塊合併）、包成 section／解開、
 * 桌機／手機預覽切換。每步都檢查 onChange 收到的 LayoutDoc。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import LayoutEditor from "../LayoutEditor";
import type { LayoutDoc, LayoutRow } from "@/types/questionBank";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "questionBank.group.layout.block.paragraph": "段落",
        "questionBank.group.layout.block.heading": "標題",
        "questionBank.group.layout.block.image": "圖片",
        "questionBank.group.layout.block.dialogue": "對話",
      };
      return map[key] ?? key;
    },
    i18n: { language: "zh-TW" },
  }),
}));

function lastLayout(onChange: ReturnType<typeof vi.fn>): LayoutDoc | null {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1][0] as LayoutDoc | null;
}

function twoColumnDoc(): LayoutDoc {
  return {
    version: 1,
    rows: [
      {
        columns: [
          {
            span: 1,
            blocks: [{ type: "paragraph", text: "left" }],
          },
          {
            span: 1,
            blocks: [{ type: "paragraph", text: "right" }],
          },
        ],
      },
    ],
  };
}

describe("LayoutEditor", () => {
  beforeEach(() => {
    // Radix Select 在 jsdom 缺的 API：scrollIntoView／pointer capture
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it("空排版：新增列 → 一列一欄；新增段落區塊並輸入文字 → onChange 帶區塊內容", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<LayoutEditor layout={null} onChange={onChange} testId="le" />);
    // 編輯區與預覽區各一個空狀態
    expect(screen.getAllByText("questionBank.group.layout.empty")).toHaveLength(
      2,
    );

    await user.click(screen.getByTestId("le-add-row"));
    let doc = lastLayout(onChange);
    // 只有空列 → toLayoutDoc 仍回傳一列（空欄）
    expect(doc?.rows).toHaveLength(1);
    expect((doc?.rows[0] as LayoutRow).columns).toHaveLength(1);

    await user.click(screen.getByTestId("le-node-0-col-0-add-block"));
    await user.click(
      await screen.findByTestId("le-node-0-col-0-add-paragraph"),
    );
    doc = lastLayout(onChange);
    const col = (doc?.rows[0] as LayoutRow).columns[0];
    expect(col.blocks).toEqual([{ type: "paragraph", text: "" }]);

    await user.type(
      screen.getByTestId("le-node-0-col-0-block-0-text"),
      "Hello",
    );
    doc = lastLayout(onChange);
    expect((doc?.rows[0] as LayoutRow).columns[0].blocks[0]).toEqual({
      type: "paragraph",
      text: "Hello",
    });
  });

  it("改比例：1:1 → 1 時第二欄的區塊併到第一欄，不遺失；再改 1:2 → 兩欄 span 1／2", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <LayoutEditor layout={twoColumnDoc()} onChange={onChange} testId="le" />,
    );
    expect(screen.getByTestId("le-node-0-col-1")).toBeTruthy();

    await user.click(screen.getByTestId("le-node-0-ratio"));
    await user.click(await screen.findByRole("option", { name: "1" }));
    let row = lastLayout(onChange)?.rows[0] as LayoutRow;
    expect(row.columns).toHaveLength(1);
    expect(
      row.columns[0].blocks.map((b) => (b as { text: string }).text),
    ).toEqual(["left", "right"]);

    await user.click(screen.getByTestId("le-node-0-ratio"));
    await user.click(await screen.findByRole("option", { name: "1:2" }));
    row = lastLayout(onChange)?.rows[0] as LayoutRow;
    expect(row.columns.map((c) => c.span)).toEqual([1, 2]);
    expect(row.columns[1].blocks).toEqual([]);
  });

  it("包成 section → rows[0] 變 section 且含原列；框線可切換；解開 → 回到一般列", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <LayoutEditor layout={twoColumnDoc()} onChange={onChange} testId="le" />,
    );
    await user.click(screen.getByTestId("le-node-0-wrap"));
    let node = lastLayout(onChange)?.rows[0];
    expect(node?.type).toBe("section");
    if (node?.type !== "section") throw new Error("expected section");
    expect(node.rows).toHaveLength(1);
    expect(node.rows[0].columns).toHaveLength(2);
    // 包起來預設有框線；取消勾選 → frame=false
    expect(node.frame).toBe(true);

    await user.click(screen.getByTestId("le-node-0-frame"));
    node = lastLayout(onChange)?.rows[0];
    expect(node?.type === "section" && node.frame).toBe(false);

    // section 內的列不能再包一層
    expect(screen.queryByTestId("le-node-0-row-0-wrap")).toBeNull();

    await user.click(screen.getByTestId("le-node-0-unwrap"));
    node = lastLayout(onChange)?.rows[0];
    expect(node?.type).not.toBe("section");
    expect((node as LayoutRow).columns).toHaveLength(2);
  });

  it("刪除區塊／刪除列；全部刪光 → onChange(null)", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <LayoutEditor layout={twoColumnDoc()} onChange={onChange} testId="le" />,
    );
    await user.click(screen.getByTestId("le-node-0-col-1-block-0-remove"));
    let row = lastLayout(onChange)?.rows[0] as LayoutRow;
    expect(row.columns[1].blocks).toEqual([]);

    await user.click(screen.getByTestId("le-node-0-remove"));
    expect(lastLayout(onChange)).toBeNull();
    expect(screen.getAllByText("questionBank.group.layout.empty")).toHaveLength(
      2,
    );
  });

  it("預覽：預設桌機；切手機 → aria-pressed 與 390px 容器；預覽內容用同一份資料", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <LayoutEditor layout={twoColumnDoc()} onChange={onChange} testId="le" />,
    );
    const preview = screen.getByTestId("le-preview");
    expect(preview).toHaveTextContent("left");
    expect(preview).toHaveTextContent("right");
    expect(screen.getByTestId("le-preview-desktop")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(preview.className).not.toContain("w-[390px]");

    await user.click(screen.getByTestId("le-preview-mobile"));
    expect(screen.getByTestId("le-preview-mobile")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("le-preview").className).toContain("w-[390px]");
    // 預覽不會回寫 layout
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled：所有操作鍵停用", () => {
    render(
      <LayoutEditor
        layout={twoColumnDoc()}
        onChange={vi.fn()}
        disabled
        testId="le"
      />,
    );
    expect(screen.getByTestId("le-add-row")).toBeDisabled();
    expect(screen.getByTestId("le-node-0-wrap")).toBeDisabled();
    expect(screen.getByTestId("le-node-0-remove")).toBeDisabled();
    expect(screen.getByTestId("le-node-0-col-0-add-block")).toBeDisabled();
  });
});
