import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Download, Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import html2canvas from "html2canvas";
import { apiClient } from "@/lib/api";
import {
  buildStickyNotePageHtml,
  openPrintWindow,
} from "@/lib/stickyNotePrint";
import { Assignment } from "@/types";
import StudentStatusPanel from "@/components/StudentStatusPanel";

interface StudentProgress {
  student_id: number;
  student_number: number;
  student_name: string;
  score?: number;
  is_assigned?: boolean;
  is_interim_score?: boolean;
  status:
    | "NOT_STARTED"
    | "IN_PROGRESS"
    | "SUBMITTED"
    | "GRADED"
    | "RETURNED"
    | "RESUBMITTED"
    | "unassigned";
}

interface AssignmentStickyNoteProps {
  open: boolean;
  onClose: () => void;
  assignments: Assignment[];
  initialAssignmentIndex: number;
  classroomId: string | number;
  onStudentClick?: (
    assignmentId: number,
    studentId: number,
    classroomId: string | number,
  ) => void;
}

export default function AssignmentStickyNote({
  open,
  onClose,
  assignments,
  initialAssignmentIndex,
  classroomId,
  onStudentClick: _onStudentClick,
}: AssignmentStickyNoteProps) {
  void _onStudentClick; // Will be wired via StudentStatusPanel in the future
  const { t } = useTranslation();
  const captureRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(initialAssignmentIndex);
  const [studentData, setStudentData] = useState<StudentProgress[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingStudentIds, setPendingStudentIds] = useState<number[] | null>(
    null,
  );

  const currentAssignment = assignments[currentIndex];

  const fetchProgress = useCallback(async (assignmentId: number) => {
    setLoading(true);
    try {
      const response = await apiClient.get(
        `/api/teachers/assignments/${assignmentId}/progress`,
      );
      const progressArray = Array.isArray(response)
        ? response
        : (response as { data?: unknown[] }).data || [];

      setStudentData(
        progressArray.map(
          (p: Record<string, unknown>) =>
            ({
              student_id: (p.student_id as number) || undefined,
              student_number: (p.student_number as number) || 0,
              student_name:
                (p.student_name as string) || (p.name as string) || "",
              score: (p.score as number) ?? undefined,
              is_assigned: p.is_assigned as boolean | undefined,
              is_interim_score: (p.is_interim_score as boolean) || false,
              status: (p.status as string) || "NOT_STARTED",
            }) as StudentProgress,
        ),
      );
    } catch {
      setStudentData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setCurrentIndex(initialAssignmentIndex);
  }, [initialAssignmentIndex]);

  useEffect(() => {
    if (open && currentAssignment) {
      fetchProgress(currentAssignment.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- track primitive id, not object reference
  }, [open, currentAssignment?.id, fetchProgress]);

  const handleSaveStudents = async () => {
    if (!currentAssignment || !pendingStudentIds) return;
    setSaving(true);
    try {
      await apiClient.patch(
        `/api/teachers/assignments/${currentAssignment.id}`,
        { student_ids: pendingStudentIds },
      );
      // Refresh data after save
      fetchProgress(currentAssignment.id);
    } catch {
      toast.error(t("stickyNote.saveError", "儲存失敗"));
    } finally {
      setSaving(false);
    }
  };

  const handlePrev = () => {
    const newIndex =
      currentIndex > 0 ? currentIndex - 1 : assignments.length - 1;
    setCurrentIndex(newIndex);
  };

  const handleNext = () => {
    const newIndex =
      currentIndex < assignments.length - 1 ? currentIndex + 1 : 0;
    setCurrentIndex(newIndex);
  };

  // Download as PNG image — captures the StudentStatusPanel data area
  const handleDownloadImage = async () => {
    const el = captureRef.current;
    if (!el) return;

    // Temporarily expand the scroll area so all students are visible
    const origStyle = el.style.cssText;
    el.style.maxHeight = "none";
    el.style.overflow = "visible";
    el.style.flex = "none";

    try {
      const canvas = await html2canvas(el, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
      });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${currentAssignment?.title || "assignment"}_${t("stickyNote.submissionStatus")}.png`;
        link.click();
        URL.revokeObjectURL(url);
      });
    } catch {
      toast.error(t("stickyNote.downloadError", "下載失敗"));
    } finally {
      el.style.cssText = origStyle;
    }
  };

  // Print via new window (uses shared utility)
  const handlePrint = () => {
    const assigned = studentData.filter(
      (s) => s.status !== "unassigned" && s.is_assigned !== false,
    );
    const counts = assigned.reduce(
      (acc, s) => {
        acc[s.status] = (acc[s.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const pageHtml = buildStickyNotePageHtml(
      currentAssignment?.title || "",
      assigned,
      counts,
      { showNumber: true, showName: true, showScore: true },
      t,
    );
    openPrintWindow([pageHtml]);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[95vw] max-w-2xl h-[85vh] flex flex-col [&]:overflow-hidden">
        <DialogHeader>
          {/* Navigation header */}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handlePrev}
              disabled={assignments.length <= 1}
              className="h-8 w-8 shrink-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <DialogTitle className="text-center flex-1 truncate text-base">
              {currentAssignment?.title || ""}
              <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                ({currentIndex + 1}/{assignments.length})
              </span>
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNext}
              disabled={assignments.length <= 1}
              className="h-8 w-8 shrink-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Student Status Panel (shared component) */}
        <div className="flex-1 min-h-0">
          <StudentStatusPanel
            ref={captureRef}
            students={studentData}
            assignmentId={currentAssignment?.id ?? 0}
            classroomId={String(classroomId)}
            practiceMode={currentAssignment?.practice_mode ?? undefined}
            isEditingStudents={false}
            onEditingStudentsChange={() => {}}
            onStudentIdsChanged={setPendingStudentIds}
            onSave={handleSaveStudents}
            saving={saving}
            loading={loading}
            scrollable
          />
        </div>

        {/* Action buttons */}
        {!loading && studentData.length > 0 && (
          <div className="flex items-center justify-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadImage}
              className="text-xs"
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              {t("stickyNote.downloadImage")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="text-xs"
            >
              <Printer className="h-3.5 w-3.5 mr-1" />
              {t("stickyNote.print")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
