/**
 * GradingHeader - 批改頁頂部工具列（作業類型不可知）
 *
 * 顯示：返回按鈕、作業標題、學生名稱 + 狀態燈、儲存狀態、學生切換 prev/next。
 * 此元件不得依 practice_mode 改變行為；所有作業類型共用。
 *
 * 詳見 docs/design/grading-page-architecture.md
 */

import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { TrafficLightDot } from "@/components/StudentStatusPanel";
import {
  User,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import type {
  StudentSubmission,
  StudentListItem,
  SaveStatus,
} from "@/pages/teacher/GradingPage";

interface GradingHeaderProps {
  assignmentTitle: string;
  submission: StudentSubmission | null;
  saveStatus: SaveStatus;
  lastSavedTime: Date | null;
  students: StudentListItem[];
  currentStudentId: string | null;
  classroomId?: string;
  assignmentId?: string;
  onPreviousStudent: () => void;
  onNextStudent: () => void;
}

export function GradingHeader({
  assignmentTitle,
  submission,
  saveStatus,
  lastSavedTime,
  students,
  currentStudentId,
  classroomId,
  assignmentId,
  onPreviousStudent,
  onNextStudent,
}: GradingHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const assignedStudents = students.filter(
    (s) => s.status && s.status !== "NOT_ASSIGNED",
  );
  const currentAssignedIndex = assignedStudents.findIndex(
    (s) => s.student_id === parseInt(currentStudentId || "0"),
  );
  const isCurrentStudentAssigned = currentAssignedIndex !== -1;

  return (
    <div className="bg-white shadow-sm border-b sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-2">
          <div className="flex items-center gap-1 sm:gap-4 flex-1 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                navigate(
                  `/teacher/classroom/${classroomId}/assignment/${assignmentId}`,
                )
              }
              className="flex-shrink-0"
            >
              <ArrowLeft className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">{t("common.back")}</span>
            </Button>
            <div className="border-l h-8 mx-1 hidden md:block"></div>
            <div className="flex flex-col min-w-0 flex-1">
              <h1 className="text-sm sm:text-lg md:text-xl font-semibold truncate">
                <span className="hidden sm:inline">
                  {t("gradingPage.labels.gradingAssignment")}{" "}
                </span>
                {assignmentTitle}
              </h1>
              {submission && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <TrafficLightDot status={submission.status} size={12} />
                  <User className="h-3 w-3 text-gray-500" />
                  <span className="text-xs sm:text-sm text-gray-600 font-medium">
                    {submission.student_name}
                  </span>
                </div>
              )}
            </div>

            {saveStatus !== "idle" && (
              <div className="ml-2 sm:ml-4 hidden sm:block">
                {saveStatus === "saving" && (
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <div className="animate-spin rounded-full h-3 w-3 border-b border-gray-500"></div>
                    {t("gradingPage.messages.saving")}
                  </span>
                )}
                {saveStatus === "saved" && lastSavedTime && (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    {t("gradingPage.messages.saved")}{" "}
                    {lastSavedTime.toLocaleTimeString("zh-TW")}
                  </span>
                )}
                {saveStatus === "error" && (
                  <span className="text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {t("gradingPage.messages.saveFailed")}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 sm:gap-4 flex-shrink-0">
            <span className="text-xs sm:text-sm text-gray-500 hidden md:inline">
              {isCurrentStudentAssigned
                ? `${currentAssignedIndex + 1} / ${assignedStudents.length} 位已指派學生`
                : `未指派學生 (${assignedStudents.length} 位已指派)`}
            </span>
            <span className="text-xs text-gray-500 md:hidden">
              {isCurrentStudentAssigned
                ? `${currentAssignedIndex + 1} / ${assignedStudents.length}`
                : `-`}
            </span>
            <div className="flex gap-0 sm:gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={onPreviousStudent}
                disabled={!isCurrentStudentAssigned || currentAssignedIndex === 0}
                className="h-8 w-8 sm:h-10 sm:w-10"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onNextStudent}
                disabled={
                  !isCurrentStudentAssigned ||
                  currentAssignedIndex === assignedStudents.length - 1
                }
                className="h-8 w-8 sm:h-10 sm:w-10"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
