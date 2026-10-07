import React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { School } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatClassroomDisplayName } from "@/components/classroom/classroomGrade";

interface ClassroomAssignDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (classroomId: number) => void;
  // grade：年級 1–12，選單顯示組合班名（#1097）
  classrooms: Array<{ id: number; name: string; grade?: number | null }>;
  studentCount: number;
}

export function ClassroomAssignDialog({
  open,
  onClose,
  onConfirm,
  classrooms,
  studentCount,
}: ClassroomAssignDialogProps) {
  const { t } = useTranslation();
  const [selectedClassroomId, setSelectedClassroomId] = React.useState<
    number | null
  >(null);

  const handleConfirm = () => {
    if (selectedClassroomId) {
      onConfirm(selectedClassroomId);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="bg-white max-w-md"
        style={{ backgroundColor: "white" }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <School className="h-5 w-5" />
            <span>{t("dialogs.classroomAssignDialog.title")}</span>
          </DialogTitle>
          <DialogDescription>
            {t("dialogs.classroomAssignDialog.description", {
              count: studentCount,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <label
            htmlFor="classroom-select"
            className="text-sm font-medium mb-2 block"
          >
            {t("dialogs.classroomAssignDialog.selectClassroom")}
          </label>
          <select
            id="classroom-select"
            value={selectedClassroomId || ""}
            onChange={(e) =>
              setSelectedClassroomId(
                e.target.value ? Number(e.target.value) : null,
              )
            }
            className="w-full px-3 py-2 border rounded-md"
          >
            <option value="">
              {t("dialogs.classroomAssignDialog.selectPlaceholder")}
            </option>
            {classrooms.map((classroom) => (
              <option key={classroom.id} value={classroom.id}>
                {formatClassroomDisplayName(t, classroom)}
              </option>
            ))}
          </select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("dialogs.classroomAssignDialog.buttons.cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedClassroomId}>
            {t("dialogs.classroomAssignDialog.buttons.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
