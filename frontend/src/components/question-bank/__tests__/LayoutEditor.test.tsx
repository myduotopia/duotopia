/**
 * LayoutEditor 元件測試（Issue #1082 第 2 段修訂：文件式編輯器）。
 *
 * jsdom 不測拖拉（dnd-kit 需要真實座標），只測：
 * 空狀態「新增區塊」、區塊之間的「＋」插入、輸入段落、欄寬分隔線（雙欄才有；鍵盤與指標吸附）、
 * 加／移除外框、刪除區塊（收掉空欄）、沒有預覽入口（統一在面板標題列）、沒有「新增列／比例」、disabled。
 * 每步都檢查 onChange 收到的 LayoutDoc。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import LayoutEditor from "../LayoutEditor";
import type { LayoutDoc, LayoutRow } from "@/types/questionBank";

const uploadMock = vi.fn<(file: File) => Promise<string | null>>();
vi.mock("../uploadImageFile", async () => {
  const actual =
    await vi.importActual<typeof import("../uploadImageFile")>(
      "../uploadImageFile",
    );
  return {
    ...actual,
    uploadImageFile: (file: File) => uploadMock(file),
  };
});

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

function twoParagraphsDoc(): LayoutDoc {
  return {
    version: 1,
    rows: ["A", "B"].map((text) => ({
      columns: [{ span: 1, blocks: [{ type: "paragraph", text }] }],
    })),
  };
}

function twoColumnDoc(): LayoutDoc {
  return {
    version: 1,
    rows: [
      {
        columns: [
          { span: 1, blocks: [{ type: "paragraph", text: "left" }] },
          { span: 1, blocks: [{ type: "paragraph", text: "right" }] },
        ],
      },
    ],
  };
}

const rowTexts = (doc: LayoutDoc | null): string[][] =>
  (doc?.rows ?? []).map((n) =>
    (n.type === "section" ? n.rows[0] : n).columns.map((c) =>
      c.blocks.map((b) => ("text" in b ? b.text : "img")).join("+"),
    ),
  );

describe("LayoutEditor", () => {
  beforeEach(() => {
    // Radix Select／Dialog 在 jsdom 缺的 API：scrollIntoView／pointer capture
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it("空排版：只有一個空狀態；「新增區塊 → 段落」→ 一列一欄一段落；輸入文字 → onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<LayoutEditor layout={null} onChange={onChange} testId="le" />);
    expect(screen.getAllByText("questionBank.group.layout.empty")).toHaveLength(
      1,
    );
    // 沒有「新增列」與比例選單
    expect(screen.queryByTestId("le-add-row")).toBeNull();
    expect(screen.queryByTestId("le-new-ratio")).toBeNull();

    await user.click(screen.getByTestId("le-add"));
    await user.click(await screen.findByTestId("le-add-paragraph"));
    let doc = lastLayout(onChange);
    expect(doc?.rows).toHaveLength(1);
    const col = (doc?.rows[0] as LayoutRow).columns;
    expect(col).toHaveLength(1);
    expect(col[0].blocks).toEqual([{ type: "paragraph", text: "" }]);

    await user.type(screen.getByTestId("le-block-0-text"), "Hello");
    doc = lastLayout(onChange);
    expect((doc?.rows[0] as LayoutRow).columns[0].blocks[0]).toEqual({
      type: "paragraph",
      text: "Hello",
    });
    // 聚焦時出現粗體／底線工具列，且在版面內（不是 absolute 浮出，第一個區塊才不會被裁切）
    const toolbar = screen.getByTestId("le-block-0-toolbar");
    expect(toolbar).toBeTruthy();
    expect(toolbar.className).not.toMatch(/absolute|-top-/);
  });

  it("區塊之間的「＋」：在 A 後插入標題 → A、標題、B 各獨占一行", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <LayoutEditor
        layout={twoParagraphsDoc()}
        onChange={onChange}
        testId="le"
      />,
    );
    await user.click(screen.getByTestId("le-insert-after-0"));
    await user.click(await screen.findByTestId("le-insert-after-0-heading"));
    expect(rowTexts(lastLayout(onChange))).toEqual([["A"], [""], ["B"]]);
    expect(
      (lastLayout(onChange)?.rows[1] as LayoutRow).columns[0].blocks[0],
    ).toMatchObject({ type: "heading", level: 2 });

    // 最前面也能插
    await user.click(screen.getByTestId("le-insert-first"));
    await user.click(await screen.findByTestId("le-insert-first-paragraph"));
    expect(rowTexts(lastLayout(onChange))[0]).toEqual([""]);
    expect(lastLayout(onChange)?.rows).toHaveLength(4);
  });

  it("欄寬分隔線：雙欄才有；→ 變 2:1、← 兩次變 1:2；拖到 5/6 處吸附 2:1；單欄／三欄沒有", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <LayoutEditor layout={twoColumnDoc()} onChange={onChange} testId="le" />,
    );
    expect(screen.getByTestId("le-row")).toHaveAttribute("data-columns", "2");
    expect(screen.queryByTestId("le-block-0-width")).toBeNull();
    const divider = screen.getByTestId("le-row-divider");
    expect(divider).toHaveAttribute("aria-valuenow", "2");

    divider.focus();
    await user.keyboard("{ArrowRight}");
    let row = lastLayout(onChange)?.rows[0] as LayoutRow;
    expect(row.columns.map((c) => c.span)).toEqual([2, 1]);
    expect(screen.getByTestId("le-row-divider")).toHaveAttribute(
      "aria-valuenow",
      "3",
    );
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    row = lastLayout(onChange)?.rows[0] as LayoutRow;
    expect(row.columns.map((c) => c.span)).toEqual([1, 2]);

    // 指標拖曳：列寬 300，拖到 x=250（5/6）→ 左欄 2/3
    const rowEl = screen.getByTestId("le-row");
    rowEl.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 300, height: 100 }) as DOMRect;
    const d = screen.getByTestId("le-row-divider");
    d.setPointerCapture = vi.fn();
    d.hasPointerCapture = () => true;
    d.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(d, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(d, { pointerId: 1, clientX: 250 });
    fireEvent.pointerUp(d, { pointerId: 1, clientX: 250 });
    row = lastLayout(onChange)?.rows[0] as LayoutRow;
    expect(row.columns.map((c) => c.span)).toEqual([2, 1]);

    const { unmount } = render(
      <LayoutEditor
        layout={twoParagraphsDoc()}
        onChange={vi.fn()}
        testId="single"
      />,
    );
    expect(screen.queryByTestId("single-row-divider")).toBeNull();
    unmount();

    const three: LayoutDoc = {
      version: 1,
      rows: [
        {
          columns: ["a", "b", "c"].map((text) => ({
            span: 1,
            blocks: [{ type: "paragraph", text }],
          })),
        },
      ],
    };
    const r3 = render(
      <LayoutEditor layout={three} onChange={vi.fn()} testId="three" />,
    );
    expect(screen.queryByTestId("three-row-divider")).toBeNull();
    r3.unmount();
  });

  it("外框：按一次 → 該列包成 section（有框線）；再按 → 解開", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <LayoutEditor
        layout={twoParagraphsDoc()}
        onChange={onChange}
        testId="le"
      />,
    );
    await user.click(screen.getByTestId("le-block-0-frame"));
    let node = lastLayout(onChange)?.rows[0];
    expect(node?.type).toBe("section");
    expect(node?.type === "section" && node.frame).toBe(true);
    expect(screen.getByTestId("le-section")).toBeTruthy();
    expect(screen.getByTestId("le-block-0-frame")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // B 不在框裡
    expect(screen.getByTestId("le-block-1-frame")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.click(screen.getByTestId("le-block-0-frame"));
    node = lastLayout(onChange)?.rows[0];
    expect(node?.type).not.toBe("section");
    expect(rowTexts(lastLayout(onChange))).toEqual([["A"], ["B"]]);
  });

  it("刪除：雙欄刪一個 → 剩下的撐滿整行；全部刪光 → onChange(null) 回到空狀態", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <LayoutEditor layout={twoColumnDoc()} onChange={onChange} testId="le" />,
    );
    await user.click(screen.getByTestId("le-block-1-remove"));
    const row = lastLayout(onChange)?.rows[0] as LayoutRow;
    expect(row.columns).toHaveLength(1);
    expect(row.columns[0].span).toBe(1);
    expect(screen.getByTestId("le-row")).toHaveAttribute("data-columns", "1");
    expect(screen.queryByTestId("le-block-0-width")).toBeNull();

    await user.click(screen.getByTestId("le-block-0-remove"));
    expect(lastLayout(onChange)).toBeNull();
    expect(screen.getByTestId("le-add")).toBeTruthy();
    expect(screen.getAllByText("questionBank.group.layout.empty")).toHaveLength(
      1,
    );
  });

  it("沒有預覽入口（預覽統一在面板標題列，#1082）：工具列沒有預覽鈕、也沒有預覽 Dialog", () => {
    render(
      <LayoutEditor layout={twoColumnDoc()} onChange={vi.fn()} testId="le" />,
    );
    expect(screen.queryByTestId("le-preview-open")).toBeNull();
    expect(screen.queryByTestId("le-preview")).toBeNull();
    expect(screen.queryByText("questionBank.group.layout.preview")).toBeNull();
  });

  it("空狀態「上傳圖片」（#1083 以圖為準）：上傳成功 → 一列一欄一張原圖；失敗不動文件", async () => {
    const onChange = vi.fn();
    render(<LayoutEditor layout={null} onChange={onChange} testId="le" />);
    const input = screen.getByTestId(
      "le-upload-image-file",
    ) as HTMLInputElement;
    expect(screen.getByTestId("le-upload-image")).toBeTruthy();

    uploadMock.mockResolvedValueOnce(null);
    fireEvent.change(input, {
      target: { files: [new File(["x"], "bad.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect(onChange).not.toHaveBeenCalled();

    uploadMock.mockResolvedValueOnce("http://x/poster.png");
    fireEvent.change(input, {
      target: {
        files: [new File(["x"], "poster.png", { type: "image/png" })],
      },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const doc = lastLayout(onChange);
    expect(doc?.rows).toHaveLength(1);
    const cols = (doc?.rows[0] as LayoutRow).columns;
    expect(cols).toHaveLength(1);
    expect(cols[0].blocks).toEqual([
      { type: "image", url: "http://x/poster.png", alt: "", align: "center" },
    ]);
    // 有內容後空狀態的入口消失，改成一般的區塊編輯
    expect(screen.queryByTestId("le-upload-image")).toBeNull();
    expect(screen.getByTestId("le-block-0-tools")).toBeTruthy();
  });

  it("disabled：新增鈕停用、區塊沒有工具列、「＋」不出現", () => {
    render(
      <LayoutEditor
        layout={twoColumnDoc()}
        onChange={vi.fn()}
        disabled
        testId="le"
      />,
    );
    expect(screen.queryByTestId("le-add")).toBeNull();
    expect(screen.queryByTestId("le-block-0-tools")).toBeNull();
    expect(screen.queryByTestId("le-insert-after-1")).toBeNull();
    expect(screen.getByTestId("le-block-0-text")).toBeDisabled();
  });

  it("父層換掉 layout（例如 AI 擷取整份填入）→ 編輯器跟著重設；自己 onChange 回來的不重設", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <LayoutEditor layout={null} onChange={onChange} testId="le" />,
    );
    expect(screen.queryByTestId("le-block-0-text")).toBeNull();

    // 外部塞進兩欄文件 → 兩個段落出現
    rerender(
      <LayoutEditor layout={twoColumnDoc()} onChange={onChange} testId="le" />,
    );
    expect(
      (screen.getByTestId("le-block-0-text") as HTMLTextAreaElement).value,
    ).toBe("left");
    expect(
      (screen.getByTestId("le-block-1-text") as HTMLTextAreaElement).value,
    ).toBe("right");

    // 自己打字 → onChange 的物件被父層原樣傳回來，不會把游標／內容洗掉
    await user.type(screen.getByTestId("le-block-0-text"), "!");
    const emitted = lastLayout(onChange);
    rerender(<LayoutEditor layout={emitted} onChange={onChange} testId="le" />);
    expect(
      (screen.getByTestId("le-block-0-text") as HTMLTextAreaElement).value,
    ).toBe("left!");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
