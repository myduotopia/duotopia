/**
 * StudentListPanel - 批改頁左欄學生列表（作業類型不可知）
 *
 * 顯示全班學生、狀態燈號、目前分數。點選未指派或未開始的學生會 disabled。
 * 此元件不得依 practice_mode 改變行為；所有作業類型共用。
 *
 * 詳見 docs/design/grading-page-architecture.md
 */

import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { TrafficLightDot, StatusLegend } from "@/components/StudentStatusPanel";
import { Users } from "lucide-react";
import type { StudentListItem } from "@/pages/teacher/GradingPage";

interface StudentListPanelProps {
  students: StudentListItem[];
  currentStudentId: string | null;
  onSelect: (student: StudentListItem) => void;
  activeTab: "students" | "content" | "grading";
}

export function StudentListPanel({
  students,
  currentStudentId,
  onSelect,
  activeTab,
}: StudentListPanelProps) {
  const { t } = useTranslation();

  const assignedCount = students.filter(
    (s) => s.status && s.status !== "NOT_ASSIGNED",
  ).length;

  return (
    <div
      className={`col-span-12 lg:col-span-2 ${
        activeTab === "students" ? "block" : "hidden lg:block"
      }`}
    >
      <Card className="p-3">
        <h3 className="text-sm font-medium mb-3 flex items-center justify-between text-gray-700">
          <div className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            <span>{t("gradingPage.labels.students")}</span>
          </div>
          <span className="text-xs text-gray-500">
            ({assignedCount}/{students.length})
          </span>
        </h3>
        <StatusLegend columns={1} />
        <div className="space-y-1 mt-3">
          {students.map((student) => {
            const isClickable =
              !!student.status &&
              student.status !== "NOT_ASSIGNED" &&
              student.status !== "NOT_STARTED";

            return (
              <button
                key={student.student_id}
                onClick={() => isClickable && onSelect(student)}
                disabled={!isClickable}
                className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
                  !isClickable
                    ? "opacity-50 cursor-not-allowed bg-gray-50"
                    : student.student_id === parseInt(currentStudentId!)
                      ? "bg-blue-100 text-blue-700"
                      : "hover:bg-gray-100"
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <TrafficLightDot status={student.status} size={12} />
                  <span className="truncate font-medium flex-1">
                    {student.student_name}
                  </span>
                  {student.score != null && (
                    <span className="text-xs font-bold text-gray-700 shrink-0 tabular-nums">
                      {(Math.round(student.score * 10) / 10).toFixed(1)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
