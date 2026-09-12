/**
 * 分組設定左欄的一列組別（issue #1046）。
 *
 * 整列可點選（切換到該組的編輯區），但拖曳只吃左側的握把 —— 整列都能拖的話
 * 老師想點選組別時很容易誤觸成拖曳。
 */

import { GripVertical, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import { GROUP_COLOR_DOT, type StudentGroup } from "@/lib/studentGroup";

interface SortableGroupRowProps {
  group: StudentGroup;
  active: boolean;
  handleTitle: string;
  deleteLabel: string;
  onSelect: () => void;
  onDelete: () => void;
}

export function SortableGroupRow({
  group,
  active,
  handleTitle,
  deleteLabel,
  onSelect,
  onDelete,
}: SortableGroupRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 px-2 py-2 rounded-lg border transition-colors",
        active
          ? "bg-blue-50 border-blue-300"
          : "bg-white border-gray-200 hover:border-gray-300",
      )}
    >
      <button
        type="button"
        title={handleTitle}
        aria-label={handleTitle}
        className="text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={onSelect}
        className="flex-1 flex items-center gap-2 min-w-0 text-left"
      >
        <span
          className={cn(
            "h-3 w-3 rounded-full shrink-0",
            group.color ? GROUP_COLOR_DOT[group.color] : "bg-gray-300",
          )}
        />
        <span className="truncate text-sm font-medium text-gray-900">
          {group.name}
        </span>
        <span className="ml-auto text-xs text-gray-500 shrink-0">
          {group.members.length}
        </span>
      </button>

      <button
        type="button"
        onClick={onDelete}
        title={deleteLabel}
        aria-label={deleteLabel}
        className="text-gray-400 hover:text-red-600 shrink-0"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}
