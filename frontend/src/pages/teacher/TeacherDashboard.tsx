import { useState, useEffect } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  GraduationCap,
  Users,
  BookOpen,
  Package,
  Share2,
  Copy,
  Check,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { apiClient } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

interface DashboardData {
  teacher: {
    id: number;
    email: string;
    name: string;
    is_demo: boolean;
  };
  classroom_count: number;
  student_count: number;
  program_count: number;
  classrooms: Array<{
    id: number;
    name: string;
    description?: string;
    student_count: number;
    school_id?: string;
    school_name?: string;
    organization_id?: string;
  }>;
  recent_students: Array<{
    id: number;
    name: string;
    email: string;
    classroom_name: string;
    school_id?: string;
    school_name?: string;
    organization_id?: string;
  }>;
  subscription_status?: string;
  subscription_end_date?: string;
  days_remaining?: number;
  can_assign_homework?: boolean;
  is_test_account?: boolean;
}

export default function TeacherDashboard() {
  const { t } = useTranslation();
  const { selectedSchool, selectedOrganization, mode } = useWorkspace();
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const [showShareDialog, setShowShareDialog] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const data = (await apiClient.getTeacherDashboard()) as DashboardData;
      setDashboardData(data);
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      if (err instanceof Error && err.message.includes("401")) {
        navigate("/teacher/login");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!dashboardData) return;
    const studentLoginUrl = `${window.location.origin}/student/login?teacher_email=${dashboardData.teacher.email}`;
    try {
      await navigator.clipboard.writeText(studentLoginUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy URL:", err);
    }
  };

  const getStudentLoginUrl = () => {
    if (!dashboardData) return "";
    return `${window.location.origin}/student/login?teacher_email=${dashboardData.teacher.email}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">{t("teacherDashboard.loading")}</p>
        </div>
      </div>
    );
  }

  if (!dashboardData) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">
          {t("teacherDashboard.error.loadFailed")}
        </p>
      </div>
    );
  }

  const filteredClassrooms = dashboardData.classrooms.filter((classroom) => {
    if (mode === "personal") {
      return !classroom.school_id && !classroom.organization_id;
    }
    if (selectedSchool) {
      return classroom.school_id === selectedSchool.id;
    }
    if (selectedOrganization) {
      return classroom.organization_id === selectedOrganization.id;
    }
    return true;
  });

  const filteredStudentCount = filteredClassrooms.reduce(
    (sum, c) => sum + c.student_count,
    0,
  );

  const functionButtons = [
    {
      key: "myClassrooms",
      path: "/teacher/classrooms",
      icon: GraduationCap,
      bgColor: "bg-blue-100",
      iconColor: "text-blue-600",
      badgeColor: "bg-blue-100 text-blue-600",
      countColor: "text-blue-600",
      step: t("teacherDashboard.functionButtons.myClassrooms.step"),
      title: t("teacherDashboard.functionButtons.myClassrooms.title"),
      description: t(
        "teacherDashboard.functionButtons.myClassrooms.description",
      ),
      count: t("teacherDashboard.functionButtons.myClassrooms.count", {
        count: filteredClassrooms.length,
      }),
    },
    {
      key: "allStudents",
      path: "/teacher/students",
      icon: Users,
      bgColor: "bg-green-100",
      iconColor: "text-green-600",
      badgeColor: "bg-green-100 text-green-600",
      countColor: "text-green-600",
      step: t("teacherDashboard.functionButtons.allStudents.step"),
      title: t("teacherDashboard.functionButtons.allStudents.title"),
      description: t(
        "teacherDashboard.functionButtons.allStudents.description",
      ),
      count: t("teacherDashboard.functionButtons.allStudents.count", {
        count: filteredStudentCount,
      }),
    },
    {
      key: "myMaterials",
      path: "/teacher/programs",
      icon: BookOpen,
      bgColor: "bg-purple-100",
      iconColor: "text-purple-600",
      badgeColor: "bg-purple-100 text-purple-600",
      countColor: "text-purple-600",
      step: t("teacherDashboard.functionButtons.myMaterials.step"),
      title: t("teacherDashboard.functionButtons.myMaterials.title"),
      description: t(
        "teacherDashboard.functionButtons.myMaterials.description",
      ),
      count: t("teacherDashboard.functionButtons.myMaterials.count", {
        count: dashboardData.program_count,
      }),
    },
    {
      key: "resourceMaterials",
      path: "/teacher/resource-materials",
      icon: Package,
      bgColor: "bg-orange-100",
      iconColor: "text-orange-600",
      badgeColor: null,
      countColor: null,
      step: null,
      title: t("teacherDashboard.functionButtons.resourceMaterials.title"),
      description: t(
        "teacherDashboard.functionButtons.resourceMaterials.description",
      ),
      count: null,
    },
  ];

  return (
    <>
      {/* Share to Students Dialog */}
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("teacherDashboard.share.title")}</DialogTitle>
            <DialogDescription>
              {t("teacherDashboard.share.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex justify-center p-4 bg-white border rounded-lg">
              <QRCodeSVG value={getStudentLoginUrl()} size={200} />
            </div>
            <div className="flex items-center space-x-2">
              <Input value={getStudentLoginUrl()} readOnly className="flex-1" />
              <Button
                size="sm"
                onClick={handleCopyUrl}
                className="flex-shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    {t("teacherDashboard.share.copied")}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    {t("teacherDashboard.share.copy")}
                  </>
                )}
              </Button>
            </div>
            <div className="text-sm text-gray-600 space-y-2">
              <p>{t("teacherDashboard.share.instructions")}</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>{t("teacherDashboard.share.instruction1")}</li>
                <li>{t("teacherDashboard.share.instruction2")}</li>
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-3xl font-bold text-gray-900">
            {t("teacherDashboard.welcome.title", {
              name: dashboardData.teacher.name,
            })}
          </h2>
          <Button
            onClick={() => setShowShareDialog(true)}
            className="flex items-center gap-2"
          >
            <Share2 className="h-4 w-4" />
            {t("teacherDashboard.share.button")}
          </Button>
        </div>

        {/* Four Function Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {functionButtons.map((btn) => {
            const Icon = btn.icon;
            return (
              <Card
                key={btn.key}
                className="cursor-pointer hover:shadow-md transition-shadow border hover:border-gray-300"
                onClick={() => navigate(btn.path)}
              >
                <CardContent className="pt-6 pb-6">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 ${btn.bgColor} rounded-lg flex-shrink-0`}>
                      <Icon className={`h-6 w-6 ${btn.iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      {btn.step && (
                        <div className="mb-1">
                          <span
                            className={`text-xs font-medium ${btn.badgeColor} px-2 py-0.5 rounded-full`}
                          >
                            {btn.step}
                          </span>
                        </div>
                      )}
                      <h3 className="text-lg font-semibold text-gray-900">
                        {btn.title}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">
                        {btn.description}
                      </p>
                      {btn.count && (
                        <p className={`text-sm font-medium ${btn.countColor} mt-2`}>
                          {btn.count}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
