/**
 * 文件式編輯器裡「一個區塊」的外殼（Issue #1082 第 2 段修訂）。
 *
 * 平常沒有框線、沒有格子，看起來就是文章的一段；滑鼠移上去（或內部聚焦）才浮出
 * 右上角工具：拖曳把手、寬度（只在並排列出現）、加／移除外框、刪除。
 * 拖曳中作為落點時，依 `zone` 在左／右／上／下畫出高亮，讓老師放下前就知道結果。
 *
 * 拖曳用 dnd-kit：把手是 draggable、整塊是 droppable（同一個 `block:<id>` id，
 * 兩個註冊表互不干擾）。
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { BoxSelect, GripVertical, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WidthOption } from "./layoutEditorModel";

export type DropZone = "left" | "right" | "before" | "after";

export const blockDragId = (id: string) => `block:${id}`;
export const blockIdOf = (dragId: string) =>
  dragId.slice(dragId.indexOf(":") + 1);

const WIDTH_LABEL: Record<WidthOption, string> = {
  full: "1/1",
  "2/3": "2/3",
  "1/2": "1/2",
  "1/3": "1/3",
};

export interface LayoutBlockChromeProps {
  blockId: string;
  /** 目前寬度與可選寬度（單欄列只有 full → 不顯示寬度按鈕） */
  width: WidthOption;
  widthOptions: WidthOption[];
  onWidthChange: (w: WidthOption) => void;
  /** 所在列是否已框起來 */
  framed: boolean;
  onToggleFrame: () => void;
  onRemove: () => void;
  /** 拖曳中的落點高亮 */
  dropZone: DropZone | null;
  isDragging: boolean;
  disabled: boolean;
  testId: string;
  children: ReactNode;
}

export default function LayoutBlockChrome({
  blockId,
  width,
  widthOptions,
  onWidthChange,
  framed,
  onToggleFrame,
  onRemove,
  dropZone,
  isDragging,
  disabled,
  testId,
  children,
}: LayoutBlockChromeProps) {
  const { t } = useTranslation();
  const dragId = blockDragId(blockId);
  const { setNodeRef: setDropRef } = useDroppable({ id: dragId, disabled });
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    setActivatorNodeRef,
  } = useDraggable({ id: dragId, disabled });

  return (
    <div
      ref={(el) => {
        setDropRef(el);
        setDragRef(el);
      }}
      className={cn(
        "group relative rounded-md px-2 py-1.5 transition-colors",
        "hover:bg-gray-50 focus-within:bg-gray-50",
        isDragging && "opacity-40",
      )}
      data-testid={testId}
      data-drop-zone={dropZone ?? undefined}
    >
      {/* 落點高亮：左右＝並排，上下＝插在前後 */}
      {dropZone && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute z-10 rounded bg-blue-500/70",
            dropZone === "left" && "bottom-1 left-0 top-1 w-1",
            dropZone === "right" && "bottom-1 right-0 top-1 w-1",
            dropZone === "before" && "left-2 right-2 top-0 h-1",
            dropZone === "after" && "bottom-0 left-2 right-2 h-1",
          )}
        />
      )}
      {dropZone === "left" && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-1/2 rounded-l-md bg-blue-100/40"
        />
      )}
      {dropZone === "right" && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-1/2 rounded-r-md bg-blue-100/40"
        />
      )}

      {/* 浮出工具列 */}
      {!disabled && (
        <div
          className={cn(
            "absolute -top-3 right-2 z-20 flex items-center gap-0.5 rounded-md border border-gray-200 bg-white px-1 py-0.5 shadow-sm",
            "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
          )}
          data-testid={`${testId}-tools`}
        >
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab touch-none rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title={t("questionBank.group.layout.dragBlock")}
            aria-label={t("questionBank.group.layout.dragBlock")}
            data-testid={`${testId}-handle`}
          >
            <GripVertical size={14} />
          </button>
          {widthOptions.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 font-mono text-[11px] text-gray-600 hover:bg-gray-100"
                  title={t("questionBank.group.layout.width")}
                  aria-label={t("questionBank.group.layout.width")}
                  data-testid={`${testId}-width`}
                >
                  {WIDTH_LABEL[width]}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[6rem]">
                {widthOptions.map((w) => (
                  <DropdownMenuItem
                    key={w}
                    onSelect={() => onWidthChange(w)}
                    className={cn("font-mono text-xs", w === width && "font-bold")}
                    data-testid={`${testId}-width-${w.replace("/", "-")}`}
                  >
                    {WIDTH_LABEL[w]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button
            type="button"
            onClick={onToggleFrame}
            className={cn(
              "rounded p-1 hover:bg-gray-100",
              framed ? "text-blue-600" : "text-gray-400 hover:text-gray-700",
            )}
            title={t(
              framed
                ? "questionBank.group.layout.unframe"
                : "questionBank.group.layout.frameRow",
            )}
            aria-label={t(
              framed
                ? "questionBank.group.layout.unframe"
                : "questionBank.group.layout.frameRow",
            )}
            aria-pressed={framed}
            data-testid={`${testId}-frame`}
          >
            <BoxSelect size={14} />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
            title={t("questionBank.group.layout.removeBlock")}
            aria-label={t("questionBank.group.layout.removeBlock")}
            data-testid={`${testId}-remove`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}

      {children}
    </div>
  );
}
