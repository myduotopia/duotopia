import { useState, useEffect } from "react";
import SystemOverviewTab from "./SystemOverviewTab";
import ClassroomsTab from "./ClassroomsTab";
import AllStudentsTab from "./AllStudentsTab";
import ResourceMaterialsTab from "./ResourceMaterialsTab";
import MaterialsTab from "./MaterialsTab";
import { useWorkspace } from "@/contexts/WorkspaceContext";
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
  Sparkles,
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
  useWorkspace();
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const [showShareDialog, setShowShareDialog] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("intro");
  const [slideDir, setSlideDir] = useState<"left" | "right">("left");
  const [prevTab, setPrevTab] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

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



  const tabs = [
    { key: "intro",      label: t("teacherDashboard.tabs.intro"),       icon: Sparkles,      iconColor: "text-red-600",    textColor: "text-red-800",    activeFill: "#ef4444", inactiveFill: "#fca5a5", svgPath: "M 8,0 L 82,0 Q 90,0 91.3,7.9 L 98.7,52.1 Q 100,60 92,60 L 8,60 Q 0,60 0,52 L 0,8 Q 0,0 8,0 Z"       },
    { key: "classrooms", label: t("teacherLayout.nav.myClassrooms"),     icon: GraduationCap, iconColor: "text-blue-600",   textColor: "text-blue-800",   activeFill: "#3b82f6", inactiveFill: "#93c5fd", svgPath: "M 8,0 L 92,0 Q 100,0 98.7,7.9 L 91.3,52.1 Q 90,60 82,60 L 18,60 Q 10,60 8.7,52.1 L 1.3,7.9 Q 0,0 8,0 Z"  },
    { key: "students",   label: t("teacherLayout.nav.allStudents"),      icon: Users,         iconColor: "text-green-600",  textColor: "text-green-800",  activeFill: "#22c55e", inactiveFill: "#86efac", svgPath: "M 18,0 L 92,0 Q 100,0 98.7,7.9 L 91.3,52.1 Q 90,60 82,60 L 8,60 Q 0,60 1.3,52.1 L 8.7,7.9 Q 10,0 18,0 Z"  },
    { key: "materials",  label: t("teacherLayout.nav.publicPrograms"),   icon: BookOpen,      iconColor: "text-purple-600", textColor: "text-purple-800", activeFill: "#a855f7", inactiveFill: "#d8b4fe", svgPath: "M 18,0 L 82,0 Q 90,0 91.3,7.9 L 98.7,52.1 Q 100,60 92,60 L 8,60 Q 0,60 1.3,52.1 L 8.7,7.9 Q 10,0 18,0 Z"  },
    { key: "resources",  label: t("teacherDashboard.functionButtons.resourceMaterials.title"), icon: Package, iconColor: "text-cyan-600", textColor: "text-cyan-800", activeFill: "#06b6d4", inactiveFill: "#67e8f9", svgPath: "M 8,0 L 92,0 Q 100,0 100,8 L 100,52 Q 100,60 92,60 L 18,60 Q 10,60 8.7,52.1 L 1.3,7.9 Q 0,0 8,0 Z" },
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

        {/* Tab Navigation — trapezoid + circle icon style */}
        <div className="flex">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => {
                  if (tab.key === activeTab || isTransitioning) return;
                  const tabKeys = tabs.map((t) => t.key);
                  const currentIdx = tabKeys.indexOf(activeTab);
                  const nextIdx = tabKeys.indexOf(tab.key);
                  setSlideDir(nextIdx > currentIdx ? "left" : "right");
                  setPrevTab(activeTab);
                  setActiveTab(tab.key);
                  setIsTransitioning(true);
                }}
                className="relative flex-1 flex flex-col items-center focus:outline-none transition-all duration-200"
                style={{ paddingTop: "20px", marginLeft: "0", filter: isActive ? "saturate(1)" : "none" }}
              >
                {/* Circle icon — bottom half overlaps trapezoid top edge */}
                <div
                  className={`absolute top-0 left-1/2 -translate-x-1/2 z-10 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ${
                    isActive
                      ? `bg-white shadow-sm ${tab.iconColor}`
                      : `bg-white ${tab.iconColor} opacity-60`
                  }`}
                >
                  <Icon size={18} />
                </div>
                {/* Drop-shadow wrapper — must wrap SVG element separately */}
                <div
                  className="w-full relative flex-1"
                  style={{
                    minHeight: "56px",
                    filter: isActive
                      ? "drop-shadow(0 4px 10px rgba(0,0,0,0.08))"
                      : "none",
                  }}
                >
                  {/* SVG rounded shape background */}
                  <svg
                    className="absolute inset-0 w-full h-full"
                    viewBox="0 0 100 60"
                    preserveAspectRatio="none"
                    style={{ display: "block" }}
                  >
                    <path
                      d={tab.svgPath}
                      fill={isActive ? tab.activeFill : tab.inactiveFill}
                    />
                  </svg>
                  {/* Label */}
                  <div
                    className={`relative z-10 text-center pt-8 pb-3 transition-colors duration-200 ${
                      isActive ? tab.textColor : `${tab.textColor} opacity-50`
                    }`}
                  >
                    <p className={`text-[15px] leading-tight px-4 break-words w-full ${isActive ? "font-bold" : "font-semibold"}`}>{tab.label}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="relative mt-4">
          {/* Triangle pointer */}
          <div
            className="absolute z-20 transition-all duration-300"
            style={{
              top: "-18px",
              left: `${(tabs.findIndex((t) => t.key === activeTab) + 0.5) / tabs.length * 100}%`,
              transform: "translateX(-50%)",
            }}
          >
            <div style={{
              width: 0, height: 0,
              borderLeft: "18px solid transparent",
              borderRight: "18px solid transparent",
              borderBottom: "18px solid rgba(255,255,255,0.8)",
            }} />
          </div>

        <div className="overflow-hidden rounded-2xl relative min-h-[300px]">
          {/* Outgoing content */}
          {isTransitioning && prevTab && (
            <div
              className={`absolute inset-0 overflow-auto bg-white/80 ${
                slideDir === "left"
                  ? "animate-slide-out-left"
                  : "animate-slide-out-right"
              }`}
            >
              {prevTab === "intro" ? (
                <SystemOverviewTab />
              ) : prevTab === "classrooms" ? (
                <ClassroomsTab />
              ) : prevTab === "students" ? (
                <AllStudentsTab />
              ) : prevTab === "materials" ? (
                <MaterialsTab />
              ) : prevTab === "resources" ? (
                <ResourceMaterialsTab />
              ) : (
                <div className="min-h-[300px] flex items-center justify-center text-gray-400 text-sm">
                  內容即將推出
                </div>
              )}
            </div>
          )}
          {/* Incoming content */}
          <div
            className={`bg-white/80 ${
              isTransitioning
                ? slideDir === "left"
                  ? "animate-slide-from-right"
                  : "animate-slide-from-left"
                : ""
            }`}
            onAnimationEnd={() => {
              setIsTransitioning(false);
              setPrevTab(null);
            }}
          >
            {activeTab === "intro" ? (
              <SystemOverviewTab />
            ) : activeTab === "classrooms" ? (
              <ClassroomsTab />
            ) : activeTab === "students" ? (
              <AllStudentsTab />
            ) : activeTab === "materials" ? (
              <MaterialsTab />
            ) : activeTab === "resources" ? (
              <ResourceMaterialsTab />
            ) : (
              <div className="min-h-[300px] flex items-center justify-center text-gray-400 text-sm">
                內容即將推出
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    </>
  );
}
