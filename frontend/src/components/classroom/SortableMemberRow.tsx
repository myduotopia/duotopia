/**
 * 分組設定中欄的一位組員（issue #1046）。
 *
 * 欄寬刻意與 GroupSettingsTab 裡的表頭一一對應，改動任一邊時兩邊要一起調。
 * 組長用黃色星星表示：實心＝是組長，空心＝不是，點一下切換。
 */

import { GripVertical, Star, X } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import type { StudentGroupMember } from "@/lib/studentGroup";

interface SortableMemberRowProps {
  member: StudentGroupMember;
  /** 從 0 起算的索引，顯示時 +1 才是老師看到的組內序號。 */
  index: number;
  isLeader: boolean;
  handleTitle: string;
  leaderLabel: string;
  removeLabel: string;
  onToggleLeader: () => void;
  onRemove: () => void;
}

export function SortableMemberRow({
  member,
  index,
  isLeader,
  handleTitle,
  leaderLabel,
  removeLabel,
  onToggleLeader,
  onRemove,
}: SortableMemberRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: member.student_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-2 py-2 rounded-lg bg-white border border-gray-200"
    >
      <button
        type="button"
        title={handleTitle}
        aria-label={handleTitle}
        className="w-6 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <span className="w-5 text-xs text-gray-500 tabular-nums">
        {index + 1}
      </span>
      <span className="w-10 text-xs text-gray-500 truncate">
        {member.student_number || "-"}
      </span>
      <span className="flex-1 min-w-0 truncate text-sm text-gray-900">
        {member.name}
      </span>

      <button
        type="button"
        onClick={onToggleLeader}
        title={leaderLabel}
        aria-label={leaderLabel}
        aria-pressed={isLeader}
        className="w-9 flex justify-center shrink-0"
      >
        <Star
          className={cn(
            "h-4 w-4",
            isLeader
              ? "text-yellow-500 fill-yellow-400"
              : "text-gray-300 hover:text-yellow-400",
          )}
        />
      </button>

      <button
        type="button"
        onClick={onRemove}
        title={removeLabel}
        aria-label={removeLabel}
        className="w-8 flex justify-center text-gray-400 hover:text-red-600 shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}
