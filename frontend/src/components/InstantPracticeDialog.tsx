/**
 * InstantPracticeDialog - 即刻練習設定對話框
 *
 * 簡化版練習設定，讓老師快速選擇練習模式後開始練習。
 * 建立暫時 assignment 後導向 preview 頁面。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Mic,
  Shuffle,
  BookOpen,
  Zap,
  Swords,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";

interface InstantPracticeDialogProps {
  open: boolean;
  onClose: () => void;
  contentId: number;
  contentTitle: string;
  contentType?: string;
  classroomId?: number;
  onStartPractice: (assignmentId: number) => void;
}

interface PracticeModeOption {
  value: string;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  contentTypes: string[];
}

const PRACTICE_MODES: PracticeModeOption[] = [
  {
    value: "reading",
    labelKey: "instantPractice.modes.reading.label",
    descriptionKey: "instantPractice.modes.reading.description",
    icon: Mic,
    contentTypes: ["EXAMPLE_SENTENCES", "example_sentences"],
  },
  {
    value: "rearrangement",
    labelKey: "instantPractice.modes.rearrangement.label",
    descriptionKey: "instantPractice.modes.rearrangement.description",
    icon: Shuffle,
    contentTypes: ["EXAMPLE_SENTENCES", "example_sentences"],
  },
  {
    value: "word_reading",
    labelKey: "instantPractice.modes.wordReading.label",
    descriptionKey: "instantPractice.modes.wordReading.description",
    icon: BookOpen,
    contentTypes: ["VOCABULARY_SET", "vocabulary_set"],
  },
  {
    value: "word_selection",
    labelKey: "instantPractice.modes.wordSelection.label",
    descriptionKey: "instantPractice.modes.wordSelection.description",
    icon: Zap,
    contentTypes: ["VOCABULARY_SET", "vocabulary_set"],
  },
  {
    value: "tug_of_war",
    labelKey: "instantPractice.modes.tugOfWar.label",
    descriptionKey: "instantPractice.modes.tugOfWar.description",
    icon: Swords,
    contentTypes: ["VOCABULARY_SET", "vocabulary_set"],
  },
];

export function InstantPracticeDialog({
  open,
  onClose,
  contentId,
  contentTitle,
  contentType,
  classroomId,
  onStartPractice,
}: InstantPracticeDialogProps) {
  const { t } = useTranslation();
  const [selectedMode, setSelectedMode] = useState<string>("");
  const [isCreating, setIsCreating] = useState(false);

  // Filter modes by content type
  const availableModes = contentType
    ? PRACTICE_MODES.filter((mode) => mode.contentTypes.includes(contentType))
    : PRACTICE_MODES;

  // Auto-select first available mode
  const effectiveMode =
    selectedMode ||
    (availableModes.length > 0 ? availableModes[0].value : "reading");

  const handleStart = async () => {
    if (isCreating) return;
    setIsCreating(true);

    try {
      const response = await apiClient.post<{
        success: boolean;
        assignment_id: number;
      }>("/api/teachers/instant-practice/create", {
        content_id: contentId,
        ...(classroomId ? { classroom_id: classroomId } : {}),
        practice_mode: effectiveMode,
      });

      if (response.success) {
        onClose();
        onStartPractice(response.assignment_id);
      }
    } catch (error) {
      console.error("Failed to create instant practice:", error);
      toast.error(t("instantPractice.error"));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            {t("instantPractice.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {contentTitle}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{t("instantPractice.modeLabel")}</Label>
            <div className="grid gap-2">
              {availableModes.map((mode) => {
                const Icon = mode.icon;
                const isSelected = effectiveMode === mode.value;
                return (
                  <button
                    key={mode.value}
                    onClick={() => setSelectedMode(mode.value)}
                    className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-colors text-left ${
                      isSelected
                        ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20"
                        : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${
                        isSelected
                          ? "bg-amber-100 dark:bg-amber-900/30"
                          : "bg-gray-100 dark:bg-gray-800"
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 ${
                          isSelected
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-gray-500 dark:text-gray-400"
                        }`}
                      />
                    </div>
                    <div>
                      <p
                        className={`text-sm font-medium ${
                          isSelected
                            ? "text-amber-900 dark:text-amber-100"
                            : "text-gray-900 dark:text-gray-100"
                        }`}
                      >
                        {t(mode.labelKey)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t(mode.descriptionKey)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isCreating}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleStart}
            disabled={isCreating || availableModes.length === 0}
            className="bg-amber-500 hover:bg-amber-600 text-white"
          >
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("instantPractice.creating")}
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                {t("instantPractice.start")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
