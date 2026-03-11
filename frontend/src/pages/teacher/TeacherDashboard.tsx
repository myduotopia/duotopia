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
  Send,
  Brain,
  Radar,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { apiClient } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import { useTranslation, getI18n } from "react-i18next";

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

  const taglines = [
    {
      en: "Duotopia makes teaching smarter and learning more active.",
      "zh-TW": "語拓邦讓教學更智能、學習更主動。",
    },
    {
      en: "Save 80% of lesson prep and grading time.",
      "zh-TW": "節省 80% 備課與批改時間。",
    },
    {
      en: "Use the Timer & Dice in the toolbar — teaching made effortless.",
      "zh-TW": "善用右側工具列的計時器與骰子，讓教學更輕鬆。",
    },
    {
      en: "Assign once, AI grades instantly.",
      "zh-TW": "派作業一次，AI 即時完成批改。",
    },
    {
      en: "Every student gets personalized feedback.",
      "zh-TW": "每位學生都能獲得個人化回饋。",
    },
    {
      en: "Track progress, celebrate growth.",
      "zh-TW": "追蹤學習進度，見證每一步成長。",
    },
  ];

  const [taglineIndex, setTaglineIndex] = useState(0);
  const [typedText, setTypedText] = useState("");
  const [showTranslation, setShowTranslation] = useState(false);

  useEffect(() => {
    const fullText = taglines[taglineIndex].en;
    let i = 0;
    setTypedText("");
    setShowTranslation(false);

    const typeTimer = setInterval(() => {
      i++;
      setTypedText(fullText.slice(0, i));
      if (i >= fullText.length) {
        clearInterval(typeTimer);
        setTimeout(() => setShowTranslation(true), 200);
      }
    }, 45);

    const nextTimer = setTimeout(
      () => setTaglineIndex((prev) => (prev + 1) % taglines.length),
      fullText.length * 45 + 5000,
    );

    return () => {
      clearInterval(typeTimer);
      clearTimeout(nextTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taglineIndex]);

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
        <div className="flex items-start justify-between mb-6 gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              {t("teacherDashboard.welcome.title", {
                name: dashboardData.teacher.name,
              })}
            </h2>
            <div className="min-h-[3.5rem]">
              <p className="text-base sm:text-xl italic text-gray-700 font-serif">
                &ldquo;{typedText}
                <span className="animate-pulse">|</span>&rdquo;
              </p>
              {getI18n().language !== "en" && (
                <p
                  className={`text-sm sm:text-base text-blue-600 mt-1 transition-opacity duration-300 ${showTranslation ? "opacity-100" : "opacity-0"}`}
                >
                  {taglines[taglineIndex]["zh-TW"]}
                </p>
              )}
            </div>
          </div>
          <Button
            onClick={() => setShowShareDialog(true)}
            className="hidden md:flex items-center gap-2 flex-shrink-0"
          >
            <Share2 className="h-4 w-4" />
            {t("teacherDashboard.share.button")}
          </Button>
        </div>

        {/* Four Function Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:grid-rows-2">
          {functionButtons.map((btn) => {
            const Icon = btn.icon;
            return (
              <Card
                key={btn.key}
                className="cursor-pointer hover:shadow-md transition-shadow border hover:border-gray-300 h-full min-h-[130px]"
                onClick={() => navigate(btn.path)}
              >
                <CardContent className="pt-6 pb-6 h-full">
                  <div className="flex items-start gap-4">
                    <div
                      className={`p-3 ${btn.bgColor} rounded-lg flex-shrink-0`}
                    >
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
                        <p
                          className={`text-sm font-medium ${btn.countColor} mt-2`}
                        >
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

        {/* Daily Flow */}
        <div className="mt-8 p-6 bg-blue-50 rounded-2xl">
          <p className="text-sm font-medium text-blue-700 mb-4">
            {t("teacherDashboard.dailyFlow.title")}
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1 text-center">
              <div className="mb-2 flex justify-center">
                <Send className="h-12 w-12 text-blue-500" />
              </div>
              <p className="text-sm font-semibold text-gray-800">
                {t("teacherDashboard.dailyFlow.step1")}
              </p>
              <p className="hidden md:block text-xs text-gray-500 mt-0.5">
                {t("teacherDashboard.dailyFlow.step1Desc")}
              </p>
            </div>
            <div className="flex-shrink-0 flex items-center">
              {/* Short arrow: mobile */}
              <svg
                className="md:hidden"
                width="20"
                height="16"
                viewBox="0 0 20 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <line
                  x1="0"
                  y1="8"
                  x2="12"
                  y2="8"
                  stroke="#CBD5E1"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <polyline
                  points="8,3 16,8 8,13"
                  fill="none"
                  stroke="#CBD5E1"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {/* Long arrow: desktop */}
              <svg
                className="hidden md:block"
                width="72"
                height="16"
                viewBox="0 0 72 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <line
                  x1="0"
                  y1="8"
                  x2="58"
                  y2="8"
                  stroke="#CBD5E1"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <polyline
                  points="52,3 64,8 52,13"
                  fill="none"
                  stroke="#CBD5E1"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="flex-1 text-center">
              <div className="mb-2 flex justify-center">
                <Brain className="h-12 w-12 text-purple-500" />
              </div>
              <p className="text-sm font-semibold text-gray-800">
                {t("teacherDashboard.dailyFlow.step2")}
              </p>
              <p className="hidden md:block text-xs text-gray-500 mt-0.5">
                {t("teacherDashboard.dailyFlow.step2Desc")}
              </p>
            </div>
            <div className="flex-shrink-0 flex items-center">
              {/* Short arrow: mobile */}
              <svg
                className="md:hidden"
                width="20"
                height="16"
                viewBox="0 0 20 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <line
                  x1="0"
                  y1="8"
                  x2="12"
                  y2="8"
                  stroke="#CBD5E1"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <polyline
                  points="8,3 16,8 8,13"
                  fill="none"
                  stroke="#CBD5E1"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {/* Long arrow: desktop */}
              <svg
                className="hidden md:block"
                width="72"
                height="16"
                viewBox="0 0 72 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <line
                  x1="0"
                  y1="8"
                  x2="58"
                  y2="8"
                  stroke="#CBD5E1"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <polyline
                  points="52,3 64,8 52,13"
                  fill="none"
                  stroke="#CBD5E1"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="flex-1 text-center">
              <div className="mb-2 flex justify-center">
                <Radar className="h-12 w-12 text-green-500" />
              </div>
              <p className="text-sm font-semibold text-gray-800">
                {t("teacherDashboard.dailyFlow.step3")}
              </p>
              <p className="hidden md:block text-xs text-gray-500 mt-0.5">
                {t("teacherDashboard.dailyFlow.step3Desc")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
