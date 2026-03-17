import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Hash,
  User,
  Trophy,
  ArrowUpDown,
  Download,
  Printer,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import html2canvas from "html2canvas";
import { apiClient } from "@/lib/api";
import {
  buildStickyNotePageHtml,
  openPrintWindow,
} from "@/lib/stickyNotePrint";
import { Assignment } from "@/types";

interface StudentProgress {
  student_id?: number;
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

type SortMode = "number" | "name" | "score";

// Practice modes that have grading pages
const GRADABLE_MODES = new Set(["reading", "word_reading"]);

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

const STATUS_CONFIG: Record<
  string,
  {
    color: string;
    textColor: string;
    bgColor: string;
    label: string;
    symbol: string;
    symbolClass?: string;
  }
> = {
  NOT_STARTED: {
    color: "bg-gray-400",
    textColor: "text-gray-400",
    bgColor: "bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-600",
    label: "stickyNote.status.notStarted",
    symbol: "○",
  },
  IN_PROGRESS: {
    color: "bg-blue-500",
    textColor: "text-blue-500",
    bgColor:
      "bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-700",
    label: "stickyNote.status.inProgress",
    symbol: "►",
  },
  SUBMITTED: {
    color: "bg-yellow-500",
    textColor: "text-yellow-500",
    bgColor:
      "bg-yellow-50 border-yellow-200 dark:bg-yellow-900/30 dark:border-yellow-700",
    label: "stickyNote.status.submitted",
    symbol: "★",
  },
  RETURNED: {
    color: "bg-orange-500",
    textColor: "text-orange-500",
    bgColor:
      "bg-orange-50 border-orange-200 dark:bg-orange-900/30 dark:border-orange-700",
    label: "stickyNote.status.returned",
    symbol: "✗",
  },
  RESUBMITTED: {
    color: "bg-purple-500",
    textColor: "text-purple-500",
    bgColor:
      "bg-purple-50 border-purple-200 dark:bg-purple-900/30 dark:border-purple-700",
    label: "stickyNote.status.resubmitted",
    symbol: "◆",
    symbolClass: "text-lg",
  },
  GRADED: {
    color: "bg-green-500",
    textColor: "text-green-500",
    bgColor:
      "bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-700",
    label: "stickyNote.status.graded",
    symbol: "✓",
  },
};

export default function AssignmentStickyNote({
  open,
  onClose,
  assignments,
  initialAssignmentIndex,
  classroomId,
  onStudentClick,
}: AssignmentStickyNoteProps) {
  const { t } = useTranslation();
  const captureRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(initialAssignmentIndex);
  const [studentData, setStudentData] = useState<StudentProgress[]>([]);
  const [loading, setLoading] = useState(false);

  // Display toggle states
  const [showNumber, setShowNumber] = useState(true);
  const [showName, setShowName] = useState(true);
  const [showScore, setShowScore] = useState(false);

  // Sort mode
  const [sortMode, setSortMode] = useState<SortMode>("number");

  const currentAssignment = assignments[currentIndex];

  // Check if current assignment has a grading page
  const isGradable =
    currentAssignment?.practice_mode &&
    GRADABLE_MODES.has(currentAssignment.practice_mode);

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

  // Toggle with "at least one must stay on" rule
  const handleToggle = (
    field: "number" | "name" | "score",
    current: boolean,
  ) => {
    const onCount =
      (showNumber ? 1 : 0) + (showName ? 1 : 0) + (showScore ? 1 : 0);
    if (current && onCount <= 1) return;

    if (field === "number") setShowNumber(!current);
    if (field === "name") setShowName(!current);
    if (field === "score") setShowScore(!current);
  };

  // Cycle sort mode
  const cycleSortMode = () => {
    const modes: SortMode[] = ["number", "name", "score"];
    const nextIdx = (modes.indexOf(sortMode) + 1) % modes.length;
    setSortMode(modes[nextIdx]);
  };

  // Filter: only assigned students (exclude unassigned)
  const assignedStudents = studentData.filter(
    (s) => s.status !== "unassigned" && s.is_assigned !== false,
  );

  // Sort
  const sortedStudents = [...assignedStudents].sort((a, b) => {
    if (sortMode === "number") return a.student_number - b.student_number;
    if (sortMode === "name")
      return a.student_name.localeCompare(b.student_name, "zh-TW");
    if (sortMode === "score") return (b.score ?? -1) - (a.score ?? -1);
    return 0;
  });

  // Count by status
  const statusCounts = sortedStudents.reduce(
    (acc, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const sortLabel = {
    number: t("stickyNote.sortByNumber"),
    name: t("stickyNote.sortByName"),
    score: t("stickyNote.sortByScore"),
  }[sortMode];

  // Download as PNG image
  const handleDownloadImage = async () => {
    if (!captureRef.current) return;

    // Temporarily show the title/footer and remove scroll/truncate constraints
    const titleEl =
      captureRef.current.querySelector<HTMLElement>(".capture-title");
    const footerEl =
      captureRef.current.querySelector<HTMLElement>(".capture-footer");
    const gridEl =
      captureRef.current.querySelector<HTMLElement>(".student-grid");
    const nameEls =
      captureRef.current.querySelectorAll<HTMLElement>(".student-name");

    if (titleEl) titleEl.style.display = "block";
    if (footerEl) footerEl.style.display = "block";
    const origGridStyle = gridEl?.style.cssText || "";
    if (gridEl) {
      gridEl.style.maxHeight = "none";
      gridEl.style.overflow = "visible";
    }
    nameEls.forEach((el) => {
      el.dataset.origClass = el.className;
      el.style.overflow = "visible";
      el.style.textOverflow = "clip";
      el.style.whiteSpace = "normal";
      el.style.wordBreak = "break-all";
    });

    let canvas: HTMLCanvasElement;
    try {
      canvas = await html2canvas(captureRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
      });
    } finally {
      // Restore original styles even if html2canvas throws
      if (titleEl) titleEl.style.display = "";
      if (footerEl) footerEl.style.display = "";
      if (gridEl) gridEl.style.cssText = origGridStyle;
      nameEls.forEach((el) => {
        el.style.overflow = "";
        el.style.textOverflow = "";
        el.style.whiteSpace = "";
        el.style.wordBreak = "";
      });
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${currentAssignment?.title || "assignment"}_${t("stickyNote.submissionStatus")}.png`;
      link.click();
      URL.revokeObjectURL(url);
    });
  };

  // Print via new window (uses shared utility)
  const handlePrint = () => {
    const pageHtml = buildStickyNotePageHtml(
      currentAssignment?.title || "",
      sortedStudents,
      statusCounts,
      { showNumber, showName, showScore },
      t,
    );
    openPrintWindow([pageHtml]);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[95vw] max-w-2xl [&]:overflow-x-hidden [&]:overflow-y-auto">
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

        {/* Toggle & sort toolbar (excluded from capture) */}
        <div className="flex flex-col gap-2">
          {/* Toggle & sort row */}
          <div className="flex items-center justify-center gap-1 flex-wrap">
            <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">
              {t("stickyNote.display")}
            </span>
            <button
              onClick={() => handleToggle("number", showNumber)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${
                showNumber
                  ? "bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300"
                  : "bg-gray-50 border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-500"
              }`}
            >
              <Hash className="h-3 w-3" />
              {t("stickyNote.seatNumber")}
            </button>
            <button
              onClick={() => handleToggle("name", showName)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${
                showName
                  ? "bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300"
                  : "bg-gray-50 border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-500"
              }`}
            >
              <User className="h-3 w-3" />
              {t("stickyNote.studentName")}
            </button>
            <button
              onClick={() => handleToggle("score", showScore)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${
                showScore
                  ? "bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300"
                  : "bg-gray-50 border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-500"
              }`}
            >
              <Trophy className="h-3 w-3" />
              {t("stickyNote.score")}
            </button>

            <span className="text-gray-300 dark:text-gray-600 mx-0.5">|</span>

            <button
              onClick={cycleSortMode}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors"
            >
              <ArrowUpDown className="h-3 w-3" />
              {sortLabel}
            </button>
          </div>
        </div>

        {/* Capturable area: legend + grid (for download/print) */}
        <div ref={captureRef} className="bg-white dark:bg-gray-950 pb-2">
          {/* Assignment title (visible in capture) */}
          <div className="text-center font-semibold text-base mb-2 capture-title hidden">
            {currentAssignment?.title || ""}
          </div>

          {/* Status legend */}
          <div className="flex flex-wrap gap-2 text-xs justify-center mb-2">
            {Object.entries(STATUS_CONFIG).map(([key, config]) => (
              <div key={key} className="flex items-center gap-1">
                <span
                  className={`${config.symbolClass || "text-sm"} font-bold leading-none ${config.textColor}`}
                >
                  {config.symbol}
                </span>
                <span className="text-gray-600 dark:text-gray-400">
                  {t(config.label)}
                  {statusCounts[key] ? ` (${statusCounts[key]})` : ""}
                </span>
              </div>
            ))}
          </div>

          {/* Student grid */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : sortedStudents.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              {t("stickyNote.noStudents")}
            </div>
          ) : (
            <div className="student-grid grid grid-cols-5 gap-2 max-h-[60vh] overflow-y-auto overflow-x-hidden py-2">
              {sortedStudents.map((student) => {
                const config =
                  STATUS_CONFIG[student.status] || STATUS_CONFIG.NOT_STARTED;
                const hasNumber = student.student_number > 0;
                const visibleCount =
                  (showNumber && hasNumber ? 1 : 0) +
                  (showName ? 1 : 0) +
                  (showScore ? 1 : 0);
                const clickable = isGradable && !!onStudentClick;
                return (
                  <button
                    key={`${student.student_number}-${student.student_name}`}
                    onClick={() => {
                      if (clickable) {
                        onStudentClick!(
                          currentAssignment.id,
                          student.student_id || student.student_number,
                          classroomId,
                        );
                      }
                    }}
                    className={`relative flex flex-col items-center justify-center p-1.5 rounded-lg border text-center transition-all min-h-[3.5rem] overflow-hidden min-w-0 ${config.bgColor} ${
                      clickable
                        ? "hover:shadow-md hover:scale-105 cursor-pointer"
                        : "cursor-default"
                    }`}
                    title={`${student.student_name} - ${t(config.label)}`}
                  >
                    {/* Status indicator: enlarged symbol */}
                    <span
                      className={`absolute top-0 right-1 ${config.symbolClass || "text-sm"} font-bold leading-none ${config.textColor}`}
                    >
                      {config.symbol}
                    </span>
                    {/* Seat number */}
                    {showNumber && hasNumber && (
                      <span
                        className={`font-bold text-gray-800 dark:text-gray-100 leading-tight ${visibleCount >= 3 ? "text-base" : visibleCount >= 2 ? "text-lg" : "text-xl"}`}
                      >
                        {student.student_number}
                      </span>
                    )}
                    {/* Name */}
                    {showName && (
                      <span
                        className={`student-name truncate w-full text-gray-700 dark:text-gray-300 leading-tight ${
                          visibleCount >= 3
                            ? "text-[9px]"
                            : showNumber && hasNumber
                              ? "text-[10px]"
                              : "text-xs font-medium py-0.5"
                        }`}
                      >
                        {student.student_name}
                      </span>
                    )}
                    {/* Score */}
                    {showScore && (
                      <span
                        className={`font-medium leading-tight ${visibleCount >= 3 ? "text-[9px]" : "text-[10px]"} ${
                          student.is_interim_score
                            ? "text-blue-500 dark:text-blue-400 italic"
                            : "text-gray-500 dark:text-gray-400"
                        }`}
                      >
                        {student.score != null
                          ? `${student.is_interim_score ? "~" : ""}${student.score}`
                          : "-"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Copyright footer (visible in capture/download) */}
          <div className="text-center text-[9px] text-gray-400 mt-2 pt-1.5 border-t border-gray-200 capture-footer hidden">
            <img
              src="https://storage.googleapis.com/duotopia-social-media-videos/website/logo/logo_row_nobg.png"
              alt="Duotopia"
              className="h-5 mx-auto mb-1"
              crossOrigin="anonymous"
            />
            {t("stickyNote.copyright")}
          </div>
        </div>

        {/* Action buttons */}
        {!loading && sortedStudents.length > 0 && (
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
