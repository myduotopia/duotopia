import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  downloadStudentGradeReport,
  GradeReportError,
} from "@/services/gradeReportService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classroomId: number;
  studentIds: number[];
  selectedCount: number;
}

/**
 * Dialog for downloading per-student grade reports. Optional inclusive
 * date range filters assignments by `created_at` (派發日期).
 */
export function StudentGradeDownloadDialog({
  open,
  onOpenChange,
  classroomId,
  studentIds,
  selectedCount,
}: Props) {
  const { t } = useTranslation();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset dates each time the dialog re-opens so leftovers don't surprise the user.
  useEffect(() => {
    if (open) {
      setStartDate("");
      setEndDate("");
    }
  }, [open]);

  const handleDownload = async () => {
    if (startDate && endDate && startDate > endDate) {
      toast.error(t("studentGradeDownloadDialog.invalidRange"));
      return;
    }
    setSubmitting(true);
    try {
      await downloadStudentGradeReport({
        classroomId,
        studentIds,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      toast.success(t("studentGradeDownloadDialog.downloadStarted"));
      onOpenChange(false);
    } catch (e) {
      const msg =
        e instanceof GradeReportError
          ? e.detail
          : t("studentGradeDownloadDialog.downloadFailed");
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("studentGradeDownloadDialog.title", { count: selectedCount })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {t("studentGradeDownloadDialog.description")}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="grade-start-date">
                {t("studentGradeDownloadDialog.startDate")}
              </Label>
              <Input
                id="grade-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="grade-end-date">
                {t("studentGradeDownloadDialog.endDate")}
              </Label>
              <Input
                id="grade-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t("studentGradeDownloadDialog.cancel")}
          </Button>
          <Button onClick={handleDownload} disabled={submitting}>
            {submitting
              ? t("studentGradeDownloadDialog.downloading")
              : t("studentGradeDownloadDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
