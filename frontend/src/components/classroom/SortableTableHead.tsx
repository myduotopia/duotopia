/**
 * SortableTableHead — 可點擊排序的表頭（#1097，自 TeacherClassrooms 抽出）
 *
 * 目前排序欄顯示 ↑／↓，其他欄顯示淡色 ↕；點擊呼叫 onSort(field)，
 * 升冪 → 降冪 → 取消的切換由呼叫端決定。
 */
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";

export interface SortableTableHeadProps<F extends string> {
  field: F;
  activeField: F | null;
  direction: "asc" | "desc";
  onSort: (field: F) => void;
  children: ReactNode;
  className?: string;
}

export function SortableTableHead<F extends string>({
  field,
  activeField,
  direction,
  onSort,
  children,
  className,
}: SortableTableHeadProps<F>) {
  const icon =
    activeField !== field ? (
      <ArrowUpDown className="h-3 w-3 opacity-50" />
    ) : direction === "asc" ? (
      <ArrowUp className="h-3 w-3" />
    ) : (
      <ArrowDown className="h-3 w-3" />
    );

  return (
    <TableHead className={className}>
      <button
        onClick={() => onSort(field)}
        className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-100 transition-colors text-xs sm:text-sm"
      >
        {children}
        {icon}
      </button>
    </TableHead>
  );
}

export default SortableTableHead;
