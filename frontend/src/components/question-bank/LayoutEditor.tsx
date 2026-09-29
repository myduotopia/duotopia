/**
 * 題組主圖文的文件式區塊編輯器（Issue #1082 第 2 段修訂）。
 *
 * 老師看到的是「一份文件」：段落接段落，沒有列／欄／比例這些概念。
 * - 區塊之間 hover 出現「＋」可插入段落／標題／圖片／對話；文件最後固定有一個「＋」
 * - 區塊 hover 才浮出工具（拖曳把手、外框、刪除），見 LayoutBlockChrome
 * - 並排靠拖曳：拖到另一區塊的左／右半邊 → 並排（一行最多三個；圖＋文預設圖 1/3、文 2/3，
 *   其餘等分）；拖到上／下半邊 → 插在前／後、獨占一行。拖曳中目標對應的那一邊會高亮
 * - 並排比例靠拖曳欄間的分隔線微調（1/3、1/2、2/3），見 LayoutColumnDivider
 * - 預覽改成獨立 Dialog（LayoutPreviewDialog），可切電腦／手機
 *
 * 資料仍是 `LayoutDoc`（rows → columns(span) → blocks），由 layoutEditorModel 的純函式維護；
 * 拖曳過程不改文件，只記錄落點，放下（dragEnd）才套用，取消就什麼都不動。
 */

import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Eye, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  GlossaryEntry,
  LayoutBlock,
  LayoutDoc,
} from "@/types/questionBank";
import LayoutBlockChrome, {
  blockIdOf,
  type DropZone,
} from "./LayoutBlockChrome";
import LayoutBlockEditor from "./LayoutBlockEditor";
import LayoutColumnDivider from "./LayoutColumnDivider";
import LayoutPreviewDialog from "./LayoutPreviewDialog";
import {
  appendBlock,
  canPlaceBeside,
  defaultBlock,
  deleteBlock,
  insertBlockRow,
  locateBlock,
  placeAround,
  placeBeside,
  rowSplit,
  setRowSplit,
  toEditorDoc,
  toLayoutDoc,
  toggleBlockFrame,
  updateBlock,
  type EditorBlock,
  type EditorDoc,
  type EditorRow,
  type EditorSection,
} from "./layoutEditorModel";
import { stripInlineMarkup } from "./layoutInline";

export interface LayoutEditorProps {
  layout: LayoutDoc | null;
  onChange: (layout: LayoutDoc | null) => void;
  glossary?: GlossaryEntry[];
  disabled?: boolean;
  testId?: string;
}

const BLOCK_TYPES: LayoutBlock["type"][] = [
  "paragraph",
  "heading",
  "image",
  "dialogue",
];

interface DropTarget {
  blockId: string;
  zone: DropZone;
}

/** 先用指標位置找落點，指標不在任何區塊上時退回矩形交集 */
const blockCollision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

/** 由指標在目標矩形內的位置決定落點：左右 25% 為並排，其餘看上下半 */
function zoneFor(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
  allowSides: boolean,
): DropZone {
  const rx = (x - rect.left) / Math.max(rect.width, 1);
  if (allowSides && rx < 0.25) return "left";
  if (allowSides && rx > 0.75) return "right";
  const ry = (y - rect.top) / Math.max(rect.height, 1);
  return ry < 0.5 ? "before" : "after";
}

function blockSummary(block: EditorBlock, t: (k: string) => string): string {
  const label = t(`questionBank.group.layout.block.${block.type}`);
  if (block.type === "image") return label;
  const text =
    block.type === "dialogue"
      ? block.lines.map((l) => l.text).join(" ")
      : block.text;
  const short = stripInlineMarkup(text).trim().slice(0, 40);
  return short ? `${label}：${short}` : label;
}

// ---------------------------------------------------------------- 插入「＋」

function AddBlockMenu({
  onAdd,
  disabled,
  testId,
  trigger,
}: {
  onAdd: (type: LayoutBlock["type"]) => void;
  disabled: boolean;
  testId: string;
  trigger: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        {BLOCK_TYPES.map((type) => (
          <DropdownMenuItem
            key={type}
            onSelect={() => onAdd(type)}
            data-testid={`${testId}-${type}`}
          >
            {t(`questionBank.group.layout.block.${type}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 兩個區塊之間的細線＋「＋」，hover 才顯示 */
function Inserter({
  onAdd,
  disabled,
  testId,
}: {
  onAdd: (type: LayoutBlock["type"]) => void;
  disabled: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  if (disabled) return <div className="h-2" />;
  return (
    <div className="group/ins relative flex h-4 items-center justify-center">
      <div className="absolute inset-x-2 top-1/2 h-px bg-transparent transition-colors group-hover/ins:bg-blue-200 group-focus-within/ins:bg-blue-200" />
      <AddBlockMenu
        onAdd={onAdd}
        disabled={disabled}
        testId={testId}
        trigger={
          <button
            type="button"
            className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full border border-blue-300 bg-white text-blue-600 opacity-0 transition-opacity hover:bg-blue-50 focus:opacity-100 group-hover/ins:opacity-100 data-[state=open]:opacity-100"
            title={t("questionBank.group.layout.insertHere")}
            aria-label={t("questionBank.group.layout.insertHere")}
            data-testid={testId}
          >
            <Plus size={12} />
          </button>
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------- 列

function RowView({
  row,
  doc,
  setDoc,
  framed,
  dropTarget,
  activeBlockId,
  disabled,
  indexOf,
  testId,
}: {
  row: EditorRow;
  doc: EditorDoc;
  setDoc: (next: EditorDoc) => void;
  framed: boolean;
  dropTarget: DropTarget | null;
  activeBlockId: string | null;
  disabled: boolean;
  indexOf: (blockId: string) => number;
  testId: string;
}) {
  const template = row.columns.map((c) => `minmax(0, ${c.span}fr)`).join(" ");
  const rowRef = useRef<HTMLDivElement>(null);
  const split = rowSplit(row);
  return (
    <div
      ref={rowRef}
      className={cn(
        "group/row relative grid gap-3",
        row.columns.length > 1 && "md:[grid-template-columns:var(--qb-cols)]",
      )}
      style={{ "--qb-cols": template } as React.CSSProperties}
      data-testid={`${testId}-row`}
      data-columns={row.columns.length}
    >
      {row.columns.map((col, ci) => (
        <div key={col.id} className="relative min-w-0 space-y-2">
          {ci === 0 && split !== null && !disabled && (
            <LayoutColumnDivider
              position={split}
              onChange={(pos) => setDoc(setRowSplit(doc, row.id, pos))}
              rowRef={rowRef}
              testId={`${testId}-row-divider`}
            />
          )}
          {col.blocks.map((b) => {
            const i = indexOf(b.id);
            const tid = `${testId}-block-${i}`;
            return (
              <LayoutBlockChrome
                key={b.id}
                blockId={b.id}
                framed={framed}
                onToggleFrame={() => setDoc(toggleBlockFrame(doc, b.id))}
                onRemove={() => setDoc(deleteBlock(doc, b.id))}
                dropZone={dropTarget?.blockId === b.id ? dropTarget.zone : null}
                isDragging={activeBlockId === b.id}
                disabled={disabled}
                testId={tid}
              >
                <LayoutBlockEditor
                  block={b}
                  onChange={(patch) => setDoc(updateBlock(doc, b.id, patch))}
                  disabled={disabled}
                  testId={tid}
                />
              </LayoutBlockChrome>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- 編輯器本體

export default function LayoutEditor({
  layout,
  onChange,
  glossary,
  disabled = false,
  testId = "layout-editor",
}: LayoutEditorProps) {
  const { t } = useTranslation();
  const [doc, setDocState] = useState<EditorDoc>(() => toEditorDoc(layout));
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const setDoc = (next: EditorDoc) => {
    if (next === doc) return;
    setDocState(next);
    onChange(toLayoutDoc(next));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  /** 全文件的區塊順序（給 data-testid 與拖曳預覽） */
  const blockOrder = useMemo(() => {
    const ids: string[] = [];
    for (const n of doc.rows) {
      for (const r of n.type === "section" ? n.rows : [n]) {
        for (const c of r.columns) for (const b of c.blocks) ids.push(b.id);
      }
    }
    return ids;
  }, [doc]);
  const indexOf = (id: string) => blockOrder.indexOf(id);

  const addAt = (
    type: LayoutBlock["type"],
    anchor: { rowId: string; position: "before" | "after" } | null,
  ) => setDoc(insertBlockRow(doc, defaultBlock(type), anchor));
  const addAtEnd = (type: LayoutBlock["type"]) =>
    setDoc(appendBlock(doc, defaultBlock(type)));

  // ---- 拖曳：過程只算落點，放下才動文件 ----
  const computeTarget = (
    e: DragMoveEvent | DragOverEvent,
  ): DropTarget | null => {
    const { active, over, activatorEvent, delta } = e;
    if (!over || over.id === active.id) return null;
    const movingId = blockIdOf(String(active.id));
    const targetId = blockIdOf(String(over.id));
    const pointer = activatorEvent as PointerEvent | MouseEvent | null;
    const x = (pointer?.clientX ?? over.rect.left) + delta.x;
    const y = (pointer?.clientY ?? over.rect.top) + delta.y;
    const zone = zoneFor(
      over.rect,
      x,
      y,
      canPlaceBeside(doc, movingId, targetId),
    );
    return { blockId: targetId, zone };
  };
  // 放下時要用「最後一次算出的落點」，不能靠 state（可能還沒重新 render）
  const dropTargetRef = useRef<DropTarget | null>(null);
  const updateTarget = (e: DragMoveEvent | DragOverEvent) => {
    const next = computeTarget(e);
    dropTargetRef.current = next;
    setDropTarget((prev) =>
      prev?.blockId === next?.blockId && prev?.zone === next?.zone
        ? prev
        : next,
    );
  };
  const handleDragStart = (e: DragStartEvent) =>
    setActiveBlockId(blockIdOf(String(e.active.id)));
  const clearDrag = () => {
    dropTargetRef.current = null;
    setActiveBlockId(null);
    setDropTarget(null);
  };
  const handleDragEnd = (e: DragEndEvent) => {
    const target = dropTargetRef.current;
    const movingId = blockIdOf(String(e.active.id));
    clearDrag();
    if (!target || target.blockId === movingId) return;
    const next =
      target.zone === "left" || target.zone === "right"
        ? placeBeside(doc, movingId, target.blockId, target.zone)
        : placeAround(doc, movingId, target.blockId, target.zone);
    setDoc(next);
  };

  const activeBlock = useMemo(
    () => (activeBlockId ? locateBlock(doc, activeBlockId)?.block : null),
    [activeBlockId, doc],
  );
  const preview = useMemo(() => toLayoutDoc(doc), [doc]);

  /** 一列＋列後的「＋」；「＋」的 testid 用該列最後一個區塊的序號 */
  const renderRow = (
    row: EditorRow,
    framed: boolean,
    key: string,
  ): React.ReactNode => {
    const lastCol = row.columns[row.columns.length - 1];
    const lastBlock = lastCol.blocks[lastCol.blocks.length - 1];
    return (
      <div key={key}>
        <RowView
          row={row}
          doc={doc}
          setDoc={setDoc}
          framed={framed}
          dropTarget={dropTarget}
          activeBlockId={activeBlockId}
          disabled={disabled}
          indexOf={indexOf}
          testId={testId}
        />
        <Inserter
          onAdd={(type) => addAt(type, { rowId: row.id, position: "after" })}
          disabled={disabled}
          testId={`${testId}-insert-after-${indexOf(lastBlock.id)}`}
        />
      </div>
    );
  };

  const renderNode = (n: EditorRow | EditorSection): React.ReactNode =>
    n.type === "section" ? (
      <div
        key={n.id}
        className={cn(
          "rounded-md px-2 pt-2",
          n.frame
            ? "border border-gray-400"
            : "border border-dashed border-gray-200",
        )}
        data-testid={`${testId}-section`}
      >
        {n.rows.map((r) => renderRow(r, true, r.id))}
      </div>
    ) : (
      renderRow(n, false, n.id)
    );

  return (
    <div className="space-y-1" data-testid={testId}>
      {/* 工具列：預覽 */}
      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => setPreviewOpen(true)}
          data-testid={`${testId}-preview-open`}
        >
          <Eye size={13} />
          {t("questionBank.group.layout.preview")}
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={blockCollision}
        onDragStart={handleDragStart}
        onDragOver={updateTarget}
        onDragMove={updateTarget}
        onDragEnd={handleDragEnd}
        onDragCancel={clearDrag}
      >
        <div
          className="rounded-md border border-gray-200 bg-white px-3 py-2"
          data-testid={`${testId}-document`}
        >
          {doc.rows.length === 0 ? (
            <div className="py-6 text-center">
              <p className="mb-3 text-sm text-gray-400">
                {t("questionBank.group.layout.empty")}
              </p>
              <AddBlockMenu
                onAdd={addAtEnd}
                disabled={disabled}
                testId={`${testId}-add`}
                trigger={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    disabled={disabled}
                    data-testid={`${testId}-add`}
                  >
                    <Plus size={14} />
                    {t("questionBank.group.layout.addBlock")}
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              <Inserter
                onAdd={(type) =>
                  addAt(type, { rowId: firstRowId(doc), position: "before" })
                }
                disabled={disabled}
                testId={`${testId}-insert-first`}
              />
              {doc.rows.map(renderNode)}
              {!disabled && (
                <div className="flex justify-center pb-1 pt-1">
                  <AddBlockMenu
                    onAdd={addAtEnd}
                    disabled={disabled}
                    testId={`${testId}-add`}
                    trigger={
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-3 py-1 text-xs text-gray-500 hover:border-blue-300 hover:text-blue-600"
                        data-testid={`${testId}-add`}
                      >
                        <Plus size={12} />
                        {t("questionBank.group.layout.addBlock")}
                      </button>
                    }
                  />
                </div>
              )}
            </>
          )}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeBlock ? (
            <div className="rounded border border-blue-400 bg-white px-2 py-1 text-xs shadow-lg">
              {blockSummary(activeBlock, t)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <LayoutPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        layout={preview}
        glossary={glossary}
        testId={`${testId}-preview`}
      />
    </div>
  );
}

function firstRowId(doc: EditorDoc): string {
  const n = doc.rows[0];
  return n.type === "section" ? n.rows[0].id : n.id;
}
