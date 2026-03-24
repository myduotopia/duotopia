import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Search, ChevronDown, Check } from "lucide-react";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import { logError } from "@/utils/errorLogger";
import { Program, Lesson } from "@/types";

interface ContentCopyDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  contentId: number;
  contentTitle: string;
  /** Programs to show in target selection */
  programs: Program[];
}

export default function ContentCopyDialog({
  open,
  onClose,
  onSuccess,
  contentId,
  contentTitle,
  programs,
}: ContentCopyDialogProps) {
  const { t } = useTranslation();
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(
    null,
  );
  const [selectedLessonId, setSelectedLessonId] = useState<number | null>(null);
  const [programSearch, setProgramSearch] = useState("");
  const [lessonSearch, setLessonSearch] = useState("");
  const [showProgramDropdown, setShowProgramDropdown] = useState(false);
  const [showLessonDropdown, setShowLessonDropdown] = useState(false);
  const [copying, setCopying] = useState(false);
  const copyingRef = useRef(false);
  const programDropdownRef = useRef<HTMLDivElement>(null);
  const lessonDropdownRef = useRef<HTMLDivElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedProgramId(null);
      setSelectedLessonId(null);
      setProgramSearch("");
      setLessonSearch("");
      setShowProgramDropdown(false);
      setShowLessonDropdown(false);
    }
  }, [open]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        programDropdownRef.current &&
        !programDropdownRef.current.contains(event.target as Node)
      ) {
        setShowProgramDropdown(false);
      }
      if (
        lessonDropdownRef.current &&
        !lessonDropdownRef.current.contains(event.target as Node)
      ) {
        setShowLessonDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedProgram = programs.find((p) => p.id === selectedProgramId);
  const lessons: Lesson[] = selectedProgram?.lessons || [];

  const filteredPrograms = programs.filter((p) =>
    p.name.toLowerCase().includes(programSearch.toLowerCase()),
  );

  const filteredLessons = lessons.filter((l) =>
    l.name.toLowerCase().includes(lessonSearch.toLowerCase()),
  );

  const handleSelectProgram = (programId: number) => {
    setSelectedProgramId(programId);
    setSelectedLessonId(null);
    setLessonSearch("");
    setShowProgramDropdown(false);
    setProgramSearch("");
  };

  const handleSelectLesson = (lessonId: number) => {
    setSelectedLessonId(lessonId);
    setShowLessonDropdown(false);
    setLessonSearch("");
  };

  const handleCopy = async () => {
    if (!selectedLessonId || copyingRef.current) return;

    copyingRef.current = true;
    setCopying(true);
    try {
      await apiClient.copyContent(contentId, selectedLessonId);
      toast.success(
        t("dialogs.contentCopyDialog.success", { title: contentTitle }),
      );
      onSuccess();
      onClose();
    } catch (error) {
      logError("Failed to copy content:", error);
      toast.error(t("dialogs.contentCopyDialog.error"));
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Copy className="h-5 w-5" />
            <span>{t("dialogs.contentCopyDialog.title")}</span>
          </DialogTitle>
          <DialogDescription>
            {t("dialogs.contentCopyDialog.description", {
              title: contentTitle,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Program selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("dialogs.contentCopyDialog.targetProgram")}
            </label>
            <div className="relative" ref={programDropdownRef}>
              <button
                type="button"
                onClick={() => {
                  setShowProgramDropdown(!showProgramDropdown);
                  setShowLessonDropdown(false);
                }}
                className="w-full flex items-center justify-between px-3 py-2 border rounded-md bg-white hover:bg-gray-50 text-left text-sm"
              >
                <span
                  className={
                    selectedProgram ? "text-gray-900" : "text-gray-400"
                  }
                >
                  {selectedProgram?.name ||
                    t("dialogs.contentCopyDialog.selectProgram")}
                </span>
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </button>

              {showProgramDropdown && (
                <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-hidden">
                  <div className="p-2 border-b">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                      <input
                        type="text"
                        placeholder={t(
                          "dialogs.contentCopyDialog.searchProgram",
                        )}
                        value={programSearch}
                        onChange={(e) => setProgramSearch(e.target.value)}
                        className="w-full pl-7 pr-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="overflow-y-auto max-h-48">
                    {filteredPrograms.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500 text-center">
                        {t("dialogs.contentCopyDialog.noProgramMatch")}
                      </div>
                    ) : (
                      filteredPrograms.map((program) => (
                        <button
                          key={program.id}
                          type="button"
                          onClick={() => handleSelectProgram(program.id)}
                          className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-gray-100 ${
                            selectedProgramId === program.id
                              ? "bg-blue-50 text-blue-700"
                              : ""
                          }`}
                        >
                          <span className="truncate">{program.name}</span>
                          {selectedProgramId === program.id && (
                            <Check className="h-4 w-4 text-blue-600 flex-shrink-0" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Lesson selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("dialogs.contentCopyDialog.targetLesson")}
            </label>
            <div className="relative" ref={lessonDropdownRef}>
              <button
                type="button"
                onClick={() => {
                  if (!selectedProgramId) return;
                  setShowLessonDropdown(!showLessonDropdown);
                  setShowProgramDropdown(false);
                }}
                disabled={!selectedProgramId}
                className={`w-full flex items-center justify-between px-3 py-2 border rounded-md text-left text-sm ${
                  selectedProgramId
                    ? "bg-white hover:bg-gray-50"
                    : "bg-gray-100 cursor-not-allowed"
                }`}
              >
                <span
                  className={
                    selectedLessonId !== null
                      ? "text-gray-900"
                      : "text-gray-400"
                  }
                >
                  {lessons.find((l) => l.id === selectedLessonId)?.name ||
                    (selectedProgramId
                      ? t("dialogs.contentCopyDialog.selectLesson")
                      : t("dialogs.contentCopyDialog.selectProgramFirst"))}
                </span>
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </button>

              {showLessonDropdown && (
                <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-hidden">
                  <div className="p-2 border-b">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                      <input
                        type="text"
                        placeholder={t(
                          "dialogs.contentCopyDialog.searchLesson",
                        )}
                        value={lessonSearch}
                        onChange={(e) => setLessonSearch(e.target.value)}
                        className="w-full pl-7 pr-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="overflow-y-auto max-h-48">
                    {filteredLessons.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500 text-center">
                        {lessons.length === 0
                          ? t("dialogs.contentCopyDialog.noLessons")
                          : t("dialogs.contentCopyDialog.noLessonMatch")}
                      </div>
                    ) : (
                      filteredLessons.map((lesson) => (
                        <button
                          key={lesson.id}
                          type="button"
                          onClick={() => handleSelectLesson(lesson.id)}
                          className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-gray-100 ${
                            selectedLessonId === lesson.id
                              ? "bg-blue-50 text-blue-700"
                              : ""
                          }`}
                        >
                          <span className="truncate">{lesson.name}</span>
                          {selectedLessonId === lesson.id && (
                            <Check className="h-4 w-4 text-blue-600 flex-shrink-0" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={copying}>
            {t("dialogs.contentCopyDialog.cancel")}
          </Button>
          <Button onClick={handleCopy} disabled={!selectedLessonId || copying}>
            {copying ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                {t("dialogs.contentCopyDialog.copying")}
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                {t("dialogs.contentCopyDialog.copy")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
