import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Users, Edit2, UserPlus, Send } from "lucide-react";
import {
  formatGradeLabel,
  isValidGrade,
} from "@/components/classroom/classroomGrade";

export interface Classroom {
  id: string;
  name: string;
  program_level: string;
  grade?: number | null; // 年級 1–12；null = 尚未設定（#1097）
  is_active: boolean;
  created_at: string;
  teacher_name: string | null;
  teacher_email: string | null;
  teacher_id?: number | null;
  student_count: number;
  assignment_count: number;
  program_count: number;
}

/**
 * 可否勾選做年級批次調整（#1097）：停用班級會被後端批次端點拒絕（404），
 * 所以不可勾選。頁面的補填清單與全選範圍使用相同條件（SchoolClassroomsPage）。
 */
const isClassroomSelectable = (classroom: Classroom) => classroom.is_active;

interface ClassroomListTableProps {
  classrooms: Classroom[];
  onEdit?: (classroom: Classroom) => void;
  onAssignTeacher?: (classroom: Classroom) => void;
  onViewStudents?: (classroom: Classroom) => void;
  onAssignHomework?: (classroom: Classroom) => void;
  /**
   * 勾選欄（#1097）：三個都有傳才顯示。
   * onToggleAll 由頁面決定作用範圍（目前列出且可勾選的班級）。
   */
  selectedIds?: ReadonlySet<string>;
  onToggle?: (classroomId: string, checked: boolean) => void;
  onToggleAll?: (checked: boolean) => void;
}

export function ClassroomListTable({
  classrooms,
  onEdit,
  onAssignTeacher,
  onViewStudents,
  onAssignHomework,
  selectedIds,
  onToggle,
  onToggleAll,
}: ClassroomListTableProps) {
  const { t } = useTranslation();
  const showSelection = !!(selectedIds && onToggle && onToggleAll);
  const selectable = classrooms.filter(isClassroomSelectable);
  const selectedCount = selectable.filter((c) => selectedIds?.has(c.id)).length;
  const headerChecked =
    selectable.length > 0 && selectedCount === selectable.length
      ? true
      : selectedCount > 0
        ? "indeterminate"
        : false;

  const getLevelBadge = (level: string) => {
    const levelColors: Record<string, string> = {
      PREA: "bg-gray-100 text-gray-800",
      A1: "bg-green-100 text-green-800",
      A2: "bg-blue-100 text-blue-800",
      B1: "bg-purple-100 text-purple-800",
      B2: "bg-indigo-100 text-indigo-800",
      C1: "bg-red-100 text-red-800",
      C2: "bg-orange-100 text-orange-800",
    };
    const color =
      levelColors[level?.toUpperCase()] || "bg-gray-100 text-gray-800";
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}
      >
        {level || "A1"}
      </span>
    );
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showSelection && (
            <TableHead className="w-[40px]">
              <Checkbox
                checked={headerChecked}
                disabled={selectable.length === 0}
                onCheckedChange={(checked) => onToggleAll!(checked === true)}
                aria-label={t("classroomGrade.selection.selectAll")}
              />
            </TableHead>
          )}
          <TableHead>{t("teacherClassrooms.labels.classroomName")}</TableHead>
          <TableHead>{t("schoolClassrooms.labels.level")}</TableHead>
          <TableHead>{t("teacherClassrooms.labels.grade")}</TableHead>
          <TableHead>{t("schoolClassrooms.labels.teacher")}</TableHead>
          <TableHead>{t("schoolClassrooms.labels.studentCount")}</TableHead>
          {onAssignHomework && (
            <TableHead>
              {t("teacherClassrooms.buttons.dispatchAssignment")}
            </TableHead>
          )}
          <TableHead>{t("schoolClassrooms.labels.status")}</TableHead>
          {onEdit && (
            <TableHead>{t("teacherClassrooms.labels.actions")}</TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {classrooms.map((classroom) => (
          <TableRow key={classroom.id}>
            {showSelection && (
              <TableCell>
                {isClassroomSelectable(classroom) && (
                  <Checkbox
                    checked={selectedIds!.has(classroom.id)}
                    onCheckedChange={(checked) =>
                      onToggle!(classroom.id, checked === true)
                    }
                    aria-label={t("classroomGrade.selection.selectRow", {
                      name: classroom.name,
                    })}
                  />
                )}
              </TableCell>
            )}
            <TableCell className="font-medium">{classroom.name}</TableCell>
            <TableCell>{getLevelBadge(classroom.program_level)}</TableCell>
            <TableCell
              className={
                isValidGrade(classroom.grade) ? undefined : "text-gray-400"
              }
            >
              {formatGradeLabel(t, classroom.grade)}
            </TableCell>
            <TableCell>
              {classroom.teacher_name ? (
                <button
                  onClick={() => onAssignTeacher?.(classroom)}
                  className="flex items-center gap-1.5 text-gray-900 hover:text-blue-600 transition-colors group"
                >
                  <span>{classroom.teacher_name}</span>
                  <Edit2 className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ) : (
                <button
                  onClick={() => onAssignTeacher?.(classroom)}
                  className="text-blue-600 hover:text-blue-800 hover:underline transition-colors flex items-center gap-1"
                >
                  <UserPlus className="h-4 w-4" />
                  <span>{t("schoolClassrooms.buttons.assignTeacher")}</span>
                </button>
              )}
            </TableCell>
            <TableCell>
              <button
                onClick={() => onViewStudents?.(classroom)}
                className="flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline transition-colors"
              >
                <Users className="h-4 w-4" />
                <span>{classroom.student_count}</span>
              </button>
            </TableCell>
            {onAssignHomework && (
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onAssignHomework(classroom)}
                  className="gap-1 text-blue-600 hover:text-blue-800"
                >
                  <Send className="h-4 w-4" />
                  {t("schoolClassrooms.buttons.dispatch")}
                </Button>
              </TableCell>
            )}
            <TableCell>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  classroom.is_active
                    ? "bg-green-100 text-green-800"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                {classroom.is_active
                  ? t("schoolClassrooms.status.active")
                  : t("schoolClassrooms.status.inactive")}
              </span>
            </TableCell>
            {onEdit && (
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(classroom)}
                  className="gap-1"
                >
                  <Edit2 className="h-4 w-4" />
                  {t("common.edit")}
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
