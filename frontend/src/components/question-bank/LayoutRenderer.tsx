/**
 * 題組主圖文的共用 renderer（Issue #1082）。
 *
 * 老師預覽、學生端作答、考卷輸出都用這一個元件畫同一份 `LayoutDoc`，
 * 三處永遠一致（同批改頁「同路由分 Panel」的一份程式原則）。
 *
 * - rows → columns：CSS grid 依 `span` 比例；手機寬度（< md）或 `forceStack`
 *   時欄位依序上下堆疊，不做橫向捲動
 * - section：`frame` 畫框線
 * - 文件根層 `frame`（整篇外框）：所有列外包一個框（樣式同 section 框，`data-testid="layout-frame"`），
 *   單字註解框留在框外
 * - 區塊：heading（h2/h3）、paragraph、image（可點擊放大）、dialogue（說話者＋文字）
 * - 文字經 `parseInline` 成節點樹渲染：粗體、底線、雙底線、`{{n}}` 畫成底線＋編號；
 *   不使用 dangerouslySetInnerHTML；文字元素 `whitespace-pre-wrap`，段落開頭與連續空格照原樣
 * - glossary 有「word 與中文都非空」的項目時才渲染底部框；全空就不佔位
 * - `InlineText`、`ZoomableImage`（圖＋點擊放大 Dialog）、`GlossaryBox`（單字註解框）另外匯出，
 *   題組預覽（GroupPreview）／小題預覽（QuestionsPreview）共用，不另寫一套
 */

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type {
  GlossaryEntry,
  LayoutBlock,
  LayoutColumn,
  LayoutDoc,
  LayoutNode,
  LayoutRow,
} from "@/types/questionBank";
import { parseInline, type InlineNode } from "./layoutInline";

export interface LayoutRendererProps {
  layout: LayoutDoc | null | undefined;
  glossary?: GlossaryEntry[] | null;
  /** 強制手機排版（欄位堆疊）；老師端「手機預覽」用 */
  forceStack?: boolean;
  className?: string;
  /** 點圖放大；學生端與預覽預設開，考卷輸出關 */
  zoomable?: boolean;
}

/** 行內節點 → React；供題幹／選項預覽共用 */
export function renderInline(
  nodes: InlineNode[],
  keyPrefix = "i",
): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (n.type) {
      case "text":
        return n.text;
      case "bold":
        return <strong key={key}>{renderInline(n.children, key)}</strong>;
      case "underline":
        return (
          <span key={key} className="underline decoration-1 underline-offset-2">
            {renderInline(n.children, key)}
          </span>
        );
      case "doubleUnderline":
        return (
          <span
            key={key}
            className="underline decoration-double decoration-1 underline-offset-2"
          >
            {renderInline(n.children, key)}
          </span>
        );
      case "blank":
        return (
          <span
            key={key}
            className="inline-block min-w-[3.5rem] border-b border-gray-700 px-1 text-center text-xs align-baseline"
            data-blank={n.n}
          >
            {n.n}
          </span>
        );
      case "br":
        return <br key={key} />;
    }
  });
}

export function InlineText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return <span className={className}>{renderInline(parseInline(text))}</span>;
}

/**
 * 圖片＋點擊放大 Dialog；主圖文的圖片區塊與題組預覽的題幹／選項圖共用。
 * `zoomable=false`（考卷輸出）只畫 `<img>`。
 */
export function ZoomableImage({
  src,
  alt = "",
  className,
  style,
  zoomable = true,
  testId,
}: {
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  zoomable?: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const img = (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      data-testid={testId}
    />
  );
  if (!zoomable) return img;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-zoom-in"
        aria-label={t("questionBank.group.render.zoomImage")}
      >
        {img}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] md:max-w-4xl p-2">
          <DialogTitle className="sr-only">
            {alt || t("questionBank.group.render.zoomImage")}
          </DialogTitle>
          <div className="max-h-[85vh] overflow-auto">
            <img src={src} alt={alt} className="w-full h-auto" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImageBlock({
  block,
  zoomable,
}: {
  block: Extract<LayoutBlock, { type: "image" }>;
  zoomable: boolean;
}) {
  const align = block.align ?? "center";
  const justify =
    align === "left"
      ? "items-start"
      : align === "right"
        ? "items-end"
        : "items-center";
  return (
    <figure className={cn("flex flex-col gap-1", justify)}>
      <ZoomableImage
        src={block.url}
        alt={block.alt ?? ""}
        className={cn(
          "max-w-full h-auto",
          block.frame && "rounded border border-gray-300 p-1 bg-white",
        )}
        style={block.maxWidth ? { maxWidth: block.maxWidth } : undefined}
        zoomable={zoomable}
      />
      {block.caption && (
        <figcaption className="text-sm text-gray-700">
          <InlineText text={block.caption} />
        </figcaption>
      )}
    </figure>
  );
}

function Block({ block, zoomable }: { block: LayoutBlock; zoomable: boolean }) {
  switch (block.type) {
    case "heading":
      return block.level === 2 ? (
        <h2 className="whitespace-pre-wrap text-lg font-bold leading-snug">
          <InlineText text={block.text} />
        </h2>
      ) : (
        <h3 className="whitespace-pre-wrap text-base font-semibold leading-snug">
          <InlineText text={block.text} />
        </h3>
      );
    case "paragraph":
      return (
        <p className="whitespace-pre-wrap leading-relaxed">
          <InlineText text={block.text} />
        </p>
      );
    case "image":
      return <ImageBlock block={block} zoomable={zoomable} />;
    case "dialogue":
      return (
        <div
          className={cn(
            "space-y-1",
            block.frame !== false && "rounded border border-gray-300 p-3",
          )}
        >
          {block.lines.map((line, i) => (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 font-medium text-gray-800">
                <InlineText text={line.speaker} />:
              </span>
              <span className="whitespace-pre-wrap leading-relaxed">
                <InlineText text={line.text} />
              </span>
            </div>
          ))}
        </div>
      );
  }
}

function Column({
  column,
  zoomable,
}: {
  column: LayoutColumn;
  zoomable: boolean;
}) {
  return (
    <div className="min-w-0 space-y-3">
      {column.blocks.map((b, i) => (
        <Block key={i} block={b} zoomable={zoomable} />
      ))}
    </div>
  );
}

function Row({
  row,
  forceStack,
  zoomable,
}: {
  row: LayoutRow;
  forceStack: boolean;
  zoomable: boolean;
}) {
  const spans = row.columns.map((c) => c.span);
  const template = spans.map((s) => `minmax(0, ${s}fr)`).join(" ");
  return (
    <div
      className={cn(
        "grid gap-4",
        !forceStack && "md:[grid-template-columns:var(--qb-cols)]",
      )}
      style={{ "--qb-cols": template } as React.CSSProperties}
      data-columns={row.columns.length}
    >
      {row.columns.map((c, i) => (
        <Column key={i} column={c} zoomable={zoomable} />
      ))}
    </div>
  );
}

function Node({
  node,
  forceStack,
  zoomable,
}: {
  node: LayoutNode;
  forceStack: boolean;
  zoomable: boolean;
}) {
  if (node.type === "section") {
    return (
      <div
        className={cn(
          "space-y-4",
          node.frame !== false && "rounded border border-gray-400 p-4",
        )}
        data-section
      >
        {node.rows.map((r, i) => (
          <Row key={i} row={r} forceStack={forceStack} zoomable={zoomable} />
        ))}
      </div>
    );
  }
  return <Row row={node} forceStack={forceStack} zoomable={zoomable} />;
}

/**
 * 底部單字註解框：只有 word 與中文都非空的項目才算；全空（含編輯中留下的空列）不畫框、不佔位。
 * 題組預覽沒有 layout 的退回顯示也用這一個，不另寫一套。
 */
export function GlossaryBox({
  glossary,
}: {
  glossary: GlossaryEntry[] | null | undefined;
}) {
  const { t } = useTranslation();
  const entries = (glossary ?? []).filter((g) => g.word.trim() && g.zh.trim());
  if (entries.length === 0) return null;
  return (
    <div
      className="flex flex-wrap gap-x-4 gap-y-1 rounded border border-gray-300 px-3 py-2 text-sm"
      data-testid="layout-glossary"
      aria-label={t("questionBank.group.glossary.title")}
    >
      {entries.map((g, i) => (
        <span key={i}>
          <span className="font-medium">{g.word}</span>{" "}
          <span className="text-gray-600">{g.zh}</span>
        </span>
      ))}
    </div>
  );
}

export default function LayoutRenderer({
  layout,
  glossary,
  forceStack = false,
  className,
  zoomable = true,
}: LayoutRendererProps) {
  if (!layout || layout.rows.length === 0) return null;
  const nodes = layout.rows.map((n, i) => (
    <Node key={i} node={n} forceStack={forceStack} zoomable={zoomable} />
  ));
  return (
    <div
      className={cn(
        "space-y-4 text-[15px] text-gray-900 break-words",
        className,
      )}
      data-testid="layout-renderer"
      data-stack={forceStack || undefined}
    >
      {layout.frame ? (
        <div
          className="space-y-4 rounded border border-gray-400 p-4"
          data-testid="layout-frame"
        >
          {nodes}
        </div>
      ) : (
        nodes
      )}
      <GlossaryBox glossary={glossary} />
    </div>
  );
}
