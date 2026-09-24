/**
 * 題組主圖文的區塊編輯器（Issue #1082）。
 *
 * 資料模型就是 `LayoutDoc`（內部用帶 id 的 `EditorDoc`，見 layoutEditorModel）。
 * 操作：新增列（比例只能選 1 / 1:1 / 1:2 / 2:1 / 1:1:1）、欄內新增區塊（段落／標題／圖片／對話）、
 * 刪除、把列包成 section（框起來）／解開。
 *
 * 拖拉（@dnd-kit 多容器模式）：
 * - 列（含 section）可在最外層上下排序；section 內的列可在 section 內排序
 * - 區塊可在同欄內排序，也可拖到任何一欄（包含空欄）：`onDragOver` 跨容器搬移、
 *   `DragOverlay` 顯示拖曳中預覽
 * - 拖曳中只跟同類型的目標碰撞（拖區塊時只看區塊／欄，拖列時只看列），
 *   避免把列丟進欄裡
 *
 * 右側（寬螢幕）／下方（窄螢幕）即時預覽用共用 `LayoutRenderer`，可切桌機／手機寬度。
 */

import { useMemo, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BoxSelect,
  GripVertical,
  Monitor,
  Plus,
  Smartphone,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  GlossaryEntry,
  LayoutBlock,
  LayoutDoc,
} from "@/types/questionBank";
import LayoutBlockEditor from "./LayoutBlockEditor";
import LayoutRenderer from "./LayoutRenderer";
import {
  COLUMN_RATIOS,
  addBlock,
  addRow,
  allColumns,
  defaultBlock,
  findColumn,
  findColumnOfBlock,
  moveBlock,
  moveRowInSection,
  moveTopLevel,
  removeBlock,
  removeRow,
  rowRatio,
  setRowRatio,
  setSectionFrame,
  toEditorDoc,
  toLayoutDoc,
  unwrapSection,
  updateBlock,
  wrapRowInSection,
  type ColumnRatio,
  type EditorBlock,
  type EditorColumn,
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

const rowDragId = (id: string) => `row:${id}`;
const blockDragId = (id: string) => `block:${id}`;
const colDropId = (id: string) => `col:${id}`;
const kindOf = (id: string) => id.split(":")[0];
const rawId = (id: string) => id.slice(id.indexOf(":") + 1);

/** 拖區塊時只跟區塊／欄碰撞；拖列時只跟列碰撞 */
const sameKindCollision: CollisionDetection = (args) => {
  const active = String(args.active.id);
  const wanted = kindOf(active) === "block" ? ["block", "col"] : ["row"];
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) =>
      wanted.includes(kindOf(String(c.id))),
    ),
  });
};

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

// ---------------------------------------------------------------- 區塊卡

function SortableBlock({
  block,
  onChange,
  onRemove,
  disabled,
  testId,
}: {
  block: EditorBlock;
  onChange: (patch: Partial<LayoutBlock>) => void;
  onRemove: () => void;
  disabled: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: blockDragId(block.id), disabled });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="rounded border border-gray-200 bg-white p-2"
      data-testid={testId}
      data-block-type={block.type}
    >
      <div className="mb-1.5 flex items-center gap-1 text-xs text-gray-500">
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          className="cursor-grab touch-none text-gray-400 hover:text-gray-700 disabled:cursor-default"
          title={t("questionBank.group.layout.dragBlock")}
          aria-label={t("questionBank.group.layout.dragBlock")}
          data-testid={`${testId}-handle`}
        >
          <GripVertical size={14} />
        </button>
        <span className="flex-1">
          {t(`questionBank.group.layout.block.${block.type}`)}
        </span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="text-gray-400 hover:text-red-600 disabled:opacity-40"
          aria-label={t("questionBank.group.layout.removeBlock")}
          data-testid={`${testId}-remove`}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <LayoutBlockEditor
        block={block}
        onChange={onChange}
        disabled={disabled}
        testId={testId}
      />
    </div>
  );
}

// ---------------------------------------------------------------- 欄

function ColumnEditor({
  column,
  doc,
  setDoc,
  disabled,
  testId,
}: {
  column: EditorColumn;
  doc: EditorDoc;
  setDoc: (next: EditorDoc) => void;
  disabled: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({
    id: colDropId(column.id),
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-w-0 rounded-md border border-dashed p-2 space-y-2 transition-colors",
        isOver
          ? "border-blue-400 bg-blue-50/40"
          : "border-gray-300 bg-gray-50/60",
      )}
      data-testid={testId}
    >
      <SortableContext
        items={column.blocks.map((b) => blockDragId(b.id))}
        strategy={verticalListSortingStrategy}
      >
        {column.blocks.map((b, i) => (
          <SortableBlock
            key={b.id}
            block={b}
            onChange={(patch) => setDoc(updateBlock(doc, b.id, patch))}
            onRemove={() => setDoc(removeBlock(doc, b.id))}
            disabled={disabled}
            testId={`${testId}-block-${i}`}
          />
        ))}
      </SortableContext>
      {column.blocks.length === 0 && (
        <p className="py-3 text-center text-xs text-gray-400">
          {t("questionBank.group.layout.emptyColumn")}
        </p>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-full gap-1 text-xs text-gray-600"
            disabled={disabled}
            data-testid={`${testId}-add-block`}
          >
            <Plus size={12} />
            {t("questionBank.group.layout.addBlock")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {BLOCK_TYPES.map((type) => (
            <DropdownMenuItem
              key={type}
              onSelect={() =>
                setDoc(addBlock(doc, column.id, defaultBlock(type)))
              }
              data-testid={`${testId}-add-${type}`}
            >
              {t(`questionBank.group.layout.block.${type}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------- 列

function RowEditor({
  row,
  doc,
  setDoc,
  disabled,
  inSection,
  testId,
}: {
  row: EditorRow;
  doc: EditorDoc;
  setDoc: (next: EditorDoc) => void;
  disabled: boolean;
  inSection: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rowDragId(row.id), disabled });
  const template = row.columns.map((c) => `minmax(0, ${c.span}fr)`).join(" ");
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="rounded-md border border-gray-200 bg-white p-2 space-y-2"
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          className="cursor-grab touch-none text-gray-400 hover:text-gray-700 disabled:cursor-default"
          title={t("questionBank.group.layout.dragRow")}
          aria-label={t("questionBank.group.layout.dragRow")}
          data-testid={`${testId}-handle`}
        >
          <GripVertical size={14} />
        </button>
        <span>{t("questionBank.group.layout.ratio")}</span>
        <Select
          value={rowRatio(row)}
          onValueChange={(v) =>
            setDoc(setRowRatio(doc, row.id, v as ColumnRatio))
          }
          disabled={disabled}
        >
          <SelectTrigger
            className="h-7 w-24 text-xs"
            data-testid={`${testId}-ratio`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COLUMN_RATIOS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="flex-1" />
        {!inSection && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => setDoc(wrapRowInSection(doc, row.id))}
            disabled={disabled}
            data-testid={`${testId}-wrap`}
          >
            <BoxSelect size={12} />
            {t("questionBank.group.layout.wrap")}
          </Button>
        )}
        <button
          type="button"
          onClick={() => setDoc(removeRow(doc, row.id))}
          disabled={disabled}
          className="text-gray-400 hover:text-red-600 disabled:opacity-40"
          aria-label={t("questionBank.group.layout.removeRow")}
          data-testid={`${testId}-remove`}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div
        className="grid gap-2 md:[grid-template-columns:var(--qb-cols)]"
        style={{ "--qb-cols": template } as React.CSSProperties}
      >
        {row.columns.map((c, i) => (
          <ColumnEditor
            key={c.id}
            column={c}
            doc={doc}
            setDoc={setDoc}
            disabled={disabled}
            testId={`${testId}-col-${i}`}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- section

function SectionEditor({
  section,
  doc,
  setDoc,
  disabled,
  testId,
}: {
  section: EditorSection;
  doc: EditorDoc;
  setDoc: (next: EditorDoc) => void;
  disabled: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rowDragId(section.id), disabled });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className={cn(
        "rounded-md border-2 p-2 space-y-2",
        section.frame ? "border-gray-500" : "border-dashed border-gray-300",
      )}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          className="cursor-grab touch-none text-gray-400 hover:text-gray-700 disabled:cursor-default"
          title={t("questionBank.group.layout.dragRow")}
          aria-label={t("questionBank.group.layout.dragRow")}
          data-testid={`${testId}-handle`}
        >
          <GripVertical size={14} />
        </button>
        <span className="font-medium">
          {t("questionBank.group.layout.section")}
        </span>
        <label className="flex items-center gap-1">
          <Checkbox
            checked={section.frame}
            onCheckedChange={(c) =>
              setDoc(setSectionFrame(doc, section.id, c === true))
            }
            disabled={disabled}
            data-testid={`${testId}-frame`}
          />
          {t("questionBank.group.layout.frame")}
        </label>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => setDoc(addRow(doc, "1", section.id))}
          disabled={disabled}
          data-testid={`${testId}-add-row`}
        >
          <Plus size={12} />
          {t("questionBank.group.layout.addRow")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setDoc(unwrapSection(doc, section.id))}
          disabled={disabled}
          data-testid={`${testId}-unwrap`}
        >
          {t("questionBank.group.layout.unwrap")}
        </Button>
      </div>
      <SortableContext
        items={section.rows.map((r) => rowDragId(r.id))}
        strategy={verticalListSortingStrategy}
      >
        {section.rows.map((r, i) => (
          <RowEditor
            key={r.id}
            row={r}
            doc={doc}
            setDoc={setDoc}
            disabled={disabled}
            inSection
            testId={`${testId}-row-${i}`}
          />
        ))}
      </SortableContext>
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [newRatio, setNewRatio] = useState<ColumnRatio>("1");

  const setDoc = (next: EditorDoc) => {
    setDocState(next);
    onChange(toLayoutDoc(next));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const preview = useMemo(() => toLayoutDoc(doc), [doc]);

  // 拖曳開始時快照：取消（Esc）要回到拖曳前的狀態，因為 dragOver 已改過 doc
  const dragSnapshot = useRef<EditorDoc | null>(null);
  const handleDragStart = (e: DragStartEvent) => {
    dragSnapshot.current = doc;
    setActiveId(String(e.active.id));
  };

  /** 跨欄搬移在拖曳過程中就做（dnd-kit 多容器慣例），同欄排序留到 dragEnd */
  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const a = String(active.id);
    const o = String(over.id);
    if (kindOf(a) !== "block") return;
    const blockId = rawId(a);
    const from = findColumnOfBlock(doc, blockId);
    if (!from) return;
    let toColumn: EditorColumn | null = null;
    let toIndex: number | undefined;
    if (kindOf(o) === "col") {
      toColumn = findColumn(doc, rawId(o));
    } else if (kindOf(o) === "block") {
      toColumn = findColumnOfBlock(doc, rawId(o));
      toIndex = toColumn?.blocks.findIndex((b) => b.id === rawId(o));
    }
    if (!toColumn || toColumn.id === from.id) return;
    // 只在拖曳過程中更新內部狀態，不每次通知外層（dragEnd 才同步）
    setDocState(moveBlock(doc, blockId, toColumn.id, toIndex));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    dragSnapshot.current = null;
    const { active, over } = e;
    const a = String(active.id);
    if (!over) {
      onChange(toLayoutDoc(doc));
      return;
    }
    const o = String(over.id);
    let next = doc;
    if (kindOf(a) === "block") {
      const blockId = rawId(a);
      const col = findColumnOfBlock(doc, blockId);
      if (col && kindOf(o) === "block" && o !== a) {
        const target = findColumnOfBlock(doc, rawId(o));
        if (target && target.id === col.id) {
          const oldIndex = col.blocks.findIndex((b) => b.id === blockId);
          const newIndex = col.blocks.findIndex((b) => b.id === rawId(o));
          if (oldIndex !== newIndex)
            next = moveBlock(doc, blockId, col.id, newIndex);
        }
      }
    } else if (kindOf(a) === "row" && a !== o) {
      const fromId = rawId(a);
      const toId = rawId(o);
      const topIds = doc.rows.map((n) => n.id);
      const fromTop = topIds.indexOf(fromId);
      const toTop = topIds.indexOf(toId);
      if (fromTop >= 0 && toTop >= 0) {
        next = moveTopLevel(doc, fromTop, toTop);
      } else {
        // section 內排序：兩者必須在同一個 section
        const section = doc.rows.find(
          (n): n is EditorSection =>
            n.type === "section" &&
            n.rows.some((r) => r.id === fromId) &&
            n.rows.some((r) => r.id === toId),
        );
        if (section) {
          next = moveRowInSection(
            doc,
            section.id,
            section.rows.findIndex((r) => r.id === fromId),
            section.rows.findIndex((r) => r.id === toId),
          );
        }
      }
    }
    setDoc(next);
  };

  const activeBlock = useMemo(() => {
    if (!activeId || kindOf(activeId) !== "block") return null;
    const id = rawId(activeId);
    return (
      allColumns(doc)
        .flatMap((c) => c.blocks)
        .find((b) => b.id === id) ?? null
    );
  }, [activeId, doc]);

  return (
    <div
      className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
      data-testid={testId}
    >
      {/* 左：結構編輯 */}
      <div className="space-y-2">
        <DndContext
          sensors={sensors}
          collisionDetection={sameKindCollision}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActiveId(null);
            const before = dragSnapshot.current ?? doc;
            dragSnapshot.current = null;
            setDoc(before);
          }}
        >
          <SortableContext
            items={doc.rows.map((n) => rowDragId(n.id))}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {doc.rows.map((n, i) =>
                n.type === "section" ? (
                  <SectionEditor
                    key={n.id}
                    section={n}
                    doc={doc}
                    setDoc={setDoc}
                    disabled={disabled}
                    testId={`${testId}-node-${i}`}
                  />
                ) : (
                  <RowEditor
                    key={n.id}
                    row={n}
                    doc={doc}
                    setDoc={setDoc}
                    disabled={disabled}
                    inSection={false}
                    testId={`${testId}-node-${i}`}
                  />
                ),
              )}
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeBlock ? (
              <div className="rounded border border-blue-400 bg-white px-2 py-1 text-xs shadow-lg">
                {blockSummary(activeBlock, t)}
              </div>
            ) : activeId ? (
              <div className="rounded border border-blue-400 bg-white px-2 py-1 text-xs shadow-lg">
                {t("questionBank.group.layout.row")}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {doc.rows.length === 0 && (
          <p className="rounded border border-dashed border-gray-300 py-4 text-center text-xs text-gray-400">
            {t("questionBank.group.layout.empty")}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1 text-xs"
            onClick={() => setDoc(addRow(doc, newRatio))}
            disabled={disabled}
            data-testid={`${testId}-add-row`}
          >
            <Plus size={14} />
            {t("questionBank.group.layout.addRow")}
          </Button>
          <Select
            value={newRatio}
            onValueChange={(v) => setNewRatio(v as ColumnRatio)}
            disabled={disabled}
          >
            <SelectTrigger
              className="h-8 w-24 text-xs"
              data-testid={`${testId}-new-ratio`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLUMN_RATIOS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 右：即時預覽（同一個 renderer） */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span className="font-medium">
            {t("questionBank.group.layout.preview")}
          </span>
          <div className="flex rounded border border-gray-200">
            <button
              type="button"
              onClick={() => setMobilePreview(false)}
              className={cn(
                "flex items-center gap-1 px-2 py-1",
                !mobilePreview ? "bg-gray-100 text-gray-900" : "text-gray-500",
              )}
              aria-pressed={!mobilePreview}
              data-testid={`${testId}-preview-desktop`}
            >
              <Monitor size={12} />
              {t("questionBank.group.layout.previewDesktop")}
            </button>
            <button
              type="button"
              onClick={() => setMobilePreview(true)}
              className={cn(
                "flex items-center gap-1 px-2 py-1",
                mobilePreview ? "bg-gray-100 text-gray-900" : "text-gray-500",
              )}
              aria-pressed={mobilePreview}
              data-testid={`${testId}-preview-mobile`}
            >
              <Smartphone size={12} />
              {t("questionBank.group.layout.previewMobile")}
            </button>
          </div>
        </div>
        <div
          className={cn(
            "rounded-md border border-gray-200 bg-white p-4",
            mobilePreview && "mx-auto w-[390px] max-w-full",
          )}
          data-testid={`${testId}-preview`}
        >
          {preview ? (
            <LayoutRenderer
              layout={preview}
              glossary={glossary}
              forceStack={mobilePreview}
            />
          ) : (
            <p className="text-center text-xs text-gray-400">
              {t("questionBank.group.layout.empty")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
