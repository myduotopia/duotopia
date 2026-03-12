import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BookOpen,
  Clock,
  Layers,
  Search,
  Copy,
  CheckCircle,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { logError } from "@/utils/errorLogger";

export interface TeacherProgram {
  id: number;
  name: string;
  description?: string;
  level: string;
  estimated_hours?: number;
  lesson_count?: number;
  classroom_id?: number;
  already_in_classroom?: boolean;
}

interface CopyProgramDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  classroomId: number;
}

export default function CopyProgramDialog({
  open,
  onClose,
  onSuccess,
  classroomId,
}: CopyProgramDialogProps) {
  const { t } = useTranslation();
  const [programs, setPrograms] = useState<TeacherProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const copyingRef = useRef(false);
  const [selectedPrograms, setSelectedPrograms] = useState<number[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (open) {
      fetchPrograms();
      setSelectedPrograms([]);
      setSearchTerm("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchPrograms recreated each render; only run on dialog open
  }, [open]);

  const fetchPrograms = async () => {
    try {
      setLoading(true);
      const data = (await apiClient.getCopyablePrograms(
        classroomId,
      )) as TeacherProgram[];
      const availablePrograms = data.filter(
        (p) => p.classroom_id !== classroomId,
      );
      setPrograms(availablePrograms);
    } catch (error) {
      logError("Failed to fetch programs:", error);
      toast.error(t("dialogs.copyProgramDialog.loadError"));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleProgram = (programId: number) => {
    setSelectedPrograms((prev) => {
      if (prev.includes(programId)) {
        return prev.filter((id) => id !== programId);
      } else {
        return [...prev, programId];
      }
    });
  };

  const handleCopyPrograms = async () => {
    if (selectedPrograms.length === 0) return;
    if (copyingRef.current) return;

    copyingRef.current = true;
    setCopying(true);
    try {
      await apiClient.copyProgramToClassroom(classroomId, selectedPrograms);
      toast.success(
        t("dialogs.copyProgramDialog.successToast", {
          count: selectedPrograms.length,
        }),
      );
      onSuccess();
      onClose();
    } catch (error) {
      logError("Failed to copy programs:", error);
      toast.error(t("dialogs.copyProgramDialog.copyError"));
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  };

  const filteredPrograms = programs.filter((program) =>
    program.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const getLevelBadgeClass = (level: string) => {
    const levelColors: Record<string, string> = {
      beginner: "bg-green-100 text-green-800",
      intermediate: "bg-blue-100 text-blue-800",
      advanced: "bg-purple-100 text-purple-800",
      expert: "bg-red-100 text-red-800",
    };
    return levelColors[level.toLowerCase()] || "bg-gray-100 text-gray-800";
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent
        className="bg-white max-w-3xl max-h-[80vh] flex flex-col"
        style={{ backgroundColor: "white" }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Copy className="h-5 w-5" />
            <span>{t("dialogs.copyProgramDialog.title")}</span>
          </DialogTitle>
          <DialogDescription>
            {t("dialogs.copyProgramDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="relative my-4">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder={t("dialogs.copyProgramDialog.searchPlaceholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {selectedPrograms.length > 0 && (
          <div className="mb-3 px-3 py-2 bg-blue-50 rounded-md">
            <span className="text-sm font-medium text-blue-700">
              {t("dialogs.copyProgramDialog.selectedCount", {
                count: selectedPrograms.length,
              })}
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-[300px]">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-2 text-gray-600">
                  {t("dialogs.copyProgramDialog.loading")}
                </p>
              </div>
            </div>
          ) : filteredPrograms.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <BookOpen className="h-12 w-12 text-gray-400 mb-3" />
              {programs.length === 0 ? (
                <>
                  <p className="text-gray-600 font-medium">
                    {t("dialogs.copyProgramDialog.noProgramsTitle")}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    {t("dialogs.copyProgramDialog.noProgramsHint")}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-gray-600 font-medium">
                    {t("dialogs.copyProgramDialog.noResults")}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    {t("dialogs.copyProgramDialog.noResultsHint")}
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredPrograms.map((program) => (
                <div
                  key={program.id}
                  className={`border rounded-lg p-4 transition-colors ${
                    program.already_in_classroom
                      ? "bg-gray-50 opacity-60"
                      : selectedPrograms.includes(program.id)
                        ? "bg-blue-50 border-blue-300"
                        : "hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    <div className="pt-1">
                      <input
                        type="checkbox"
                        checked={selectedPrograms.includes(program.id)}
                        onChange={() => handleToggleProgram(program.id)}
                        disabled={program.already_in_classroom}
                        className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <h4 className="font-medium">{program.name}</h4>
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getLevelBadgeClass(program.level)}`}
                        >
                          {program.level}
                        </span>
                        {program.already_in_classroom && (
                          <span className="inline-flex items-center space-x-1 text-xs text-green-600">
                            <CheckCircle className="h-3 w-3" />
                            <span>
                              ({t("dialogs.copyProgramDialog.alreadyExists")})
                            </span>
                          </span>
                        )}
                      </div>
                      {program.description && (
                        <p className="text-sm text-gray-600 mt-1">
                          {program.description}
                        </p>
                      )}
                      <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                        <div className="flex items-center space-x-1">
                          <Layers className="h-3 w-3" />
                          <span>
                            {t("dialogs.copyProgramDialog.lessonCount", {
                              count: program.lesson_count || 0,
                            })}
                          </span>
                        </div>
                        {program.estimated_hours && (
                          <div className="flex items-center space-x-1">
                            <Clock className="h-3 w-3" />
                            <span>
                              {t("dialogs.copyProgramDialog.hours", {
                                hours: program.estimated_hours,
                              })}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={copying}>
            {t("dialogs.copyProgramDialog.cancel")}
          </Button>
          <Button
            onClick={handleCopyPrograms}
            disabled={selectedPrograms.length === 0 || copying}
          >
            {copying ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                {t("dialogs.copyProgramDialog.copying")}
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                {t("dialogs.copyProgramDialog.copyButton", {
                  count: selectedPrograms.length,
                })}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
