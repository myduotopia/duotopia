/**
 * Demo Modal Component
 * Slide-in modal from right for demo assignment preview
 */

import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { X, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { demoApi, DemoApiError } from "@/lib/demoApi";
import { toast } from "sonner";
import StudentActivityPageContent, {
  type Activity,
} from "@/pages/student/StudentActivityPageContent";

interface DemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignmentId: number | null;
  demoType: string;
}

interface DemoData {
  assignment_id: number;
  title: string;
  practice_mode: string;
  activities: Activity[];
}

export function DemoModal({
  isOpen,
  onClose,
  assignmentId,
  demoType,
}: DemoModalProps) {
  const { t } = useTranslation();
  const [demoData, setDemoData] = useState<DemoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && assignmentId) {
      fetchDemoData();
    } else {
      // Reset state when modal closes
      setDemoData(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, assignmentId]);

  const fetchDemoData = async () => {
    if (!assignmentId) return;

    setLoading(true);
    setError(null);

    try {
      const data = (await demoApi.getPreview(assignmentId)) as DemoData;
      setDemoData(data);
    } catch (err) {
      const errorMessage =
        err instanceof DemoApiError
          ? err.detail
          : "Failed to load demo assignment";
      setError(errorMessage);
      toast.error(errorMessage);
      console.error("Failed to load demo:", err);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleComplete = async (_data: { answers: any[] }): Promise<void> => {
    toast.success(t("demo.complete"));
    onClose();
  };

  if (!assignmentId) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl lg:max-w-4xl p-0 overflow-hidden"
      >
        {/* Header with close button */}
        <SheetHeader className="sticky top-0 z-50 bg-white border-b px-6 py-4 flex flex-row items-center justify-between space-y-0">
          <SheetTitle className="text-lg font-semibold">
            {t(`home.demo.${demoType}.title`)} - {t("demo.mode")}
          </SheetTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-5 w-5" />
          </Button>
        </SheetHeader>

        {/* Demo Content */}
        <div className="h-[calc(100vh-80px)] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
                <p className="text-gray-600">{t("common.loading")}</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full p-6">
              <div className="text-center">
                <p className="text-red-600 mb-4">{error}</p>
                <Button onClick={fetchDemoData} variant="outline">
                  {t("common.retry")}
                </Button>
              </div>
            </div>
          )}

          {!loading && !error && demoData && (
            <>
              {/* Demo Mode Banner */}
              <div className="bg-blue-600 text-white py-3 px-6 text-center text-sm">
                {t("demo.banner")}
              </div>

              {/* Activity Content */}
              <div className="p-6">
                <StudentActivityPageContent
                  activities={demoData.activities}
                  assignmentTitle={demoData.title}
                  assignmentId={demoData.assignment_id}
                  practiceMode={demoData.practice_mode}
                  isDemoMode={true}
                  onBack={onClose}
                  onSubmit={handleComplete}
                />
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
