import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { useProgramCopy } from "@/hooks/useProgramCopy";
import { useTeacherOrganizations } from "@/hooks/useTeacherOrganizations";
import { logError } from "@/utils/errorLogger";

interface CopyToOrganizationDialogProps {
  open: boolean;
  onClose: () => void;
  programId: number | null;
  programName: string;
  onSuccess?: () => void;
}

export default function CopyToOrganizationDialog({
  open,
  onClose,
  programId,
  programName,
  onSuccess,
}: CopyToOrganizationDialogProps) {
  const { t } = useTranslation();
  const { organizations, loading } = useTeacherOrganizations();
  const { copyProgram } = useProgramCopy();

  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedOrgId(organizations[0]?.id ?? "");
      setName(programName ? `${programName} (複製)` : "");
    }
  }, [open, organizations, programName]);

  const handleSubmit = async () => {
    if (!programId || !selectedOrgId) return;
    setSubmitting(true);
    try {
      await copyProgram({
        programId,
        targetScope: "organization",
        targetId: selectedOrgId,
        name: name.trim() || undefined,
      });
      toast.success(
        t("copyToOrganizationDialog.successToast", "已複製到機構教材"),
      );
      onSuccess?.();
      onClose();
    } catch (err) {
      logError("Copy program to organization failed:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : t("copyToOrganizationDialog.errorToast", "複製失敗"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="bg-white max-w-md"
        style={{ backgroundColor: "white" }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Copy className="h-5 w-5" />
            <span>{t("copyToOrganizationDialog.title", "複製教材到機構")}</span>
          </DialogTitle>
          <DialogDescription>
            {t(
              "copyToOrganizationDialog.description",
              "將個人整包教材（含所有單元與內容）複製為機構共用教材。",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("copyToOrganizationDialog.targetOrg", "目標機構")}
            </label>
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              disabled={loading || organizations.length === 0}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            >
              {organizations.length === 0 && (
                <option value="">
                  {loading
                    ? t("common.loading", "載入中…")
                    : t("copyToOrganizationDialog.noOrgs", "尚未加入任何機構")}
                </option>
              )}
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.display_name || org.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("copyToOrganizationDialog.newName", "新教材名稱")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={programName}
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel", "取消")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !selectedOrgId || !programId}
          >
            {submitting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                {t("copyToOrganizationDialog.copying", "複製中…")}
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                {t("copyToOrganizationDialog.copyButton", "複製到機構")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
