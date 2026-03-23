import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { toast } from "sonner";
import { useTranslation, getI18n } from "react-i18next";
import {
  BookOpen,
  Trophy,
  Clock,
  CheckCircle,
  AlertCircle,
  Mail,
  Loader2,
  School,
} from "lucide-react";

export default function StudentDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, token } = useStudentAuthStore();
  const [assignmentStats, setAssignmentStats] = useState({
    todo: 0,
    submitted: 0,
    returned: 0,
    resubmitted: 0,
    graded: 0,
  });
  const [stats, setStats] = useState({
    completedAssignments: 0,
    averageScore: 0,
    totalPracticeTime: 0,
    practiceDays: 0,
  });
  const [showEmailSetup, setShowEmailSetup] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailInitialized, setEmailInitialized] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [currentEmail, setCurrentEmail] = useState("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  const proverbs = [
    {
      en: "Practice makes perfect.",
      "zh-TW": "熟能生巧。",
      ja: "習うより慣れよ。",
      ko: "연습이 완벽을 만든다.",
    },
    {
      en: "A journey of a thousand miles begins with a single step.",
      "zh-TW": "千里之行，始於足下。",
      ja: "千里の道も一歩から。",
      ko: "천 리 길도 한 걸음부터.",
    },
    {
      en: "Where there is a will, there is a way.",
      "zh-TW": "有志者事竟成。",
      ja: "意志あるところに道は開ける。",
      ko: "뜻이 있는 곳에 길이 있다.",
    },
    {
      en: "Knowledge is power.",
      "zh-TW": "知識就是力量。",
      ja: "知識は力なり。",
      ko: "아는 것이 힘이다.",
    },
    {
      en: "The early bird catches the worm.",
      "zh-TW": "早起的鳥兒有蟲吃。",
      ja: "早起きは三文の徳。",
      ko: "일찍 일어나는 새가 벌레를 잡는다.",
    },
    {
      en: "Actions speak louder than words.",
      "zh-TW": "坐而言不如起而行。",
      ja: "行動は言葉よりも雄弁。",
      ko: "행동이 말보다 중요하다.",
    },
    {
      en: "Every expert was once a beginner.",
      "zh-TW": "每個專家都曾是初學者。",
      ja: "誰でも最初は初心者。",
      ko: "모든 전문가도 처음엔 초보였다.",
    },
    {
      en: "Rome was not built in a day.",
      "zh-TW": "羅馬不是一天造成的。",
      ja: "ローマは一日にして成らず。",
      ko: "로마는 하루아침에 이루어지지 않았다.",
    },
    {
      en: "Learning never exhausts the mind.",
      "zh-TW": "學習永遠不會使心智疲憊。",
      ja: "学びは心を疲れさせない。",
      ko: "배움은 마음을 지치게 하지 않는다.",
    },
    {
      en: "The more you learn, the more you earn.",
      "zh-TW": "學得越多，收穫越多。",
      ja: "学べば学ぶほど得るものがある。",
      ko: "배우면 배울수록 더 많이 얻는다.",
    },
    {
      en: "Mistakes are proof that you are trying.",
      "zh-TW": "犯錯是你正在努力的證明。",
      ja: "失敗は挑戦している証拠。",
      ko: "실수는 노력하고 있다는 증거다.",
    },
    {
      en: "Believe you can and you're halfway there.",
      "zh-TW": "相信你能，你就成功了一半。",
      ja: "できると信じれば半分は達成したも同然。",
      ko: "할 수 있다고 믿으면 반은 이룬 것이다.",
    },
  ];

  const [proverbIndex, setProverbIndex] = useState(() =>
    Math.floor(Math.random() * proverbs.length),
  );
  const [typedText, setTypedText] = useState("");
  const [showTranslation, setShowTranslation] = useState(false);

  useEffect(() => {
    const fullText = proverbs[proverbIndex].en;
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
      () => {
        setProverbIndex((prev) => (prev + 1) % proverbs.length);
      },
      fullText.length * 45 + 5000,
    );

    return () => {
      clearInterval(typeTimer);
      clearTimeout(nextTimer);
    };
  }, [proverbIndex, proverbs.length]);

  useEffect(() => {
    if (!user || !token) {
      navigate("/student/login");
      return;
    }
    loadAssignmentStats();
    loadStats();
    loadEmailStatus();
  }, [user, token, navigate]);

  const loadAssignmentStats = async () => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || "";
      const response = await fetch(`${apiUrl}/api/students/assignments`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = (await response.json()) as { status?: string }[];
      setAssignmentStats({
        todo: data.filter(
          (a) => a.status === "NOT_STARTED" || a.status === "IN_PROGRESS",
        ).length,
        submitted: data.filter((a) => a.status === "SUBMITTED").length,
        returned: data.filter((a) => a.status === "RETURNED").length,
        resubmitted: data.filter((a) => a.status === "RESUBMITTED").length,
        graded: data.filter((a) => a.status === "GRADED").length,
      });
    } catch (error) {
      console.error("Failed to load assignment stats:", error);
    }
  };

  const loadStats = async () => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || "";
      const response = await fetch(`${apiUrl}/api/students/stats`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setStats({
        completedAssignments: data.completedAssignments || 0,
        averageScore: data.averageScore || 0,
        totalPracticeTime: data.totalPracticeTime || 0,
        practiceDays: data.practiceDays || 0,
      });
    } catch (error) {
      console.error("Failed to load stats:", error);
      // Fallback to zero if API fails
      setStats({
        completedAssignments: 0,
        averageScore: 0,
        totalPracticeTime: 0,
        practiceDays: 0,
      });
    }
  };

  const loadEmailStatus = async () => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || "";
      // 使用 /me 端點來獲取當前學生資訊
      const response = await fetch(`${apiUrl}/api/students/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();

        // 如果有 email，預填到輸入框
        if (data.email && !emailInitialized) {
          setNewEmail(data.email);
          setCurrentEmail(data.email);
          setEmailInitialized(true);
        }

        // 設定驗證狀態
        setEmailVerified(data.email_verified === true);
        setEmailInitialized(true);
      }
    } catch (error) {
      console.error("Failed to load email status:", error);
      setEmailInitialized(true);
    }
  };

  const handleEmailUpdate = async () => {
    if (!newEmail || !newEmail.includes("@")) {
      toast.error(t("studentDashboard.errors.invalidEmail"));
      return;
    }

    setIsSendingEmail(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || "";
      // 使用正確的 update-email 端點
      const response = await fetch(`${apiUrl}/api/students/update-email`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: newEmail }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.verification_sent) {
          toast.success(t("studentDashboard.success.verificationSent"));
        } else {
          toast.success(t("studentDashboard.success.emailUpdated"));
        }
        setShowEmailSetup(false);
        // 重新載入 email 狀態
        loadEmailStatus();
      } else {
        const error = await response.text();
        toast.error(
          `${t("studentDashboard.errors.updateEmailFailed")}: ${error}`,
        );
      }
    } catch (error) {
      console.error("Failed to update email:", error);
      toast.error(t("studentDashboard.errors.updateEmailFailed"));
    } finally {
      setIsSendingEmail(false);
    }
  };

  return (
    <div className="p-3 sm:p-4 lg:p-6 min-h-full">
      <div className="max-w-full mx-auto">
        {/* Proverb Typewriter */}
        <div className="mb-6 min-h-[4rem] sm:min-h-[5rem]">
          <p className="text-base sm:text-xl lg:text-2xl italic text-gray-700 dark:text-gray-300 font-serif">
            &ldquo;{typedText}
            <span className="animate-pulse">|</span>&rdquo;
          </p>
          {getI18n().language !== "en" && (
            <p
              className={`text-sm sm:text-base text-gray-500 dark:text-gray-400 mt-2 transition-opacity duration-300 ${showTranslation ? "opacity-100" : "opacity-0"}`}
            >
              {proverbs[proverbIndex][
                getI18n().language as keyof (typeof proverbs)[0]
              ] || proverbs[proverbIndex]["zh-TW"]}
            </p>
          )}
        </div>

        {/* Email Setup Modal */}
        <Dialog open={showEmailSetup} onOpenChange={setShowEmailSetup}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {t("studentDashboard.email.setupTitle")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  {t("studentDashboard.email.yourEmail")}
                </label>
                <Input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder={t("studentDashboard.email.emailPlaceholder")}
                />
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("studentDashboard.email.note")}
              </p>
              <Button
                onClick={handleEmailUpdate}
                disabled={
                  isSendingEmail || !newEmail || !newEmail.includes("@")
                }
                className="w-full"
              >
                {isSendingEmail ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("studentDashboard.email.sending")}
                  </>
                ) : (
                  t("studentDashboard.email.verifyButton")
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Empty state for students without classrooms (e.g. 1Campus SSO first login) */}
        {user && (!user.classrooms || user.classrooms.length === 0) && !user.classroom_id && (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <School className="h-16 w-16 text-blue-300 mb-4" />
            <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-200 mb-2">
              {t("studentDashboard.noClassroom.title", "歡迎來到 Duotopia！")}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 text-center max-w-md">
              {t(
                "studentDashboard.noClassroom.description",
                "目前還沒有加入任何班級，請等待老師將你加入班級。",
              )}
            </p>
          </div>
        )}

        {/* Dashboard Tiles — 成就 + 作業狀態統一容器 */}
        <div className={`flex flex-wrap gap-3 sm:gap-4 justify-center sm:justify-start ${user && (!user.classrooms || user.classrooms.length === 0) && !user.classroom_id ? "hidden" : ""}`}>
          {/* ===== 成就區 ===== */}

          {/* Email 設定 — 未驗證時顯示 */}
          {emailInitialized && !emailVerified && (
            <button
              onClick={() => setShowEmailSetup(true)}
              className="crayon-texture animate-fade-up w-[40%] aspect-square sm:w-[calc(50%-8px)] lg:w-auto lg:flex-1 lg:max-w-[200px] rounded-2xl bg-gradient-to-br from-sky-100 to-blue-200 dark:from-sky-900/30 dark:to-blue-900/40 shadow-sm p-2 sm:p-4 flex flex-col items-center justify-center gap-1 sm:gap-3 hover:shadow-md hover:scale-[1.02] transition-all cursor-pointer"
              style={{ animationDelay: "0ms" }}
            >
              <Mail className="h-6 w-6 sm:h-10 sm:w-10 text-blue-500" />
              <span className="text-xs sm:text-sm font-medium text-center leading-tight">
                {currentEmail
                  ? t("studentDashboard.email.reverifyButton")
                  : t("studentDashboard.email.setupButton")}
              </span>
            </button>
          )}

          {/* 完成作業 */}
          <div
            className="crayon-texture animate-fade-up w-[40%] aspect-square sm:w-[calc(50%-8px)] lg:w-auto lg:flex-1 lg:max-w-[200px] rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-200 dark:from-blue-900/30 dark:to-indigo-900/40 shadow-sm p-2 sm:p-4 flex flex-col items-center justify-center gap-1 sm:gap-2"
            style={{ animationDelay: "50ms" }}
          >
            <BookOpen className="h-6 w-6 sm:h-10 sm:w-10 text-blue-500" />
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 text-center leading-tight">
              {t("studentDashboard.stats.completedAssignments")}
            </p>
            <p className="text-lg sm:text-2xl font-bold">
              {stats.completedAssignments}
            </p>
            <p className="text-[8px] sm:text-[10px] text-gray-400 dark:text-gray-500 text-center leading-tight">
              {t("studentDashboard.stats.completedAssignmentsDesc")}
            </p>
          </div>

          {/* 平均分數 */}
          <div
            className="crayon-texture animate-fade-up w-[40%] aspect-square sm:w-[calc(50%-8px)] lg:w-auto lg:flex-1 lg:max-w-[200px] rounded-2xl bg-gradient-to-br from-amber-100 to-yellow-200 dark:from-amber-900/30 dark:to-yellow-900/40 shadow-sm p-2 sm:p-4 flex flex-col items-center justify-center gap-1 sm:gap-2"
            style={{ animationDelay: "100ms" }}
          >
            <Trophy className="h-6 w-6 sm:h-10 sm:w-10 text-yellow-500" />
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 text-center leading-tight">
              {t("studentDashboard.stats.averageScore")}
            </p>
            <p className="text-lg sm:text-2xl font-bold">
              {stats.averageScore}
              {t("studentDashboard.stats.scoreUnit")}
            </p>
            <p className="text-[8px] sm:text-[10px] text-gray-400 dark:text-gray-500 text-center leading-tight">
              {t("studentDashboard.stats.averageScoreDesc")}
            </p>
          </div>

          {/* 練習時間 */}
          <div
            className="crayon-texture animate-fade-up w-[40%] aspect-square sm:w-[calc(50%-8px)] lg:w-auto lg:flex-1 lg:max-w-[200px] rounded-2xl bg-gradient-to-br from-emerald-100 to-green-200 dark:from-emerald-900/30 dark:to-green-900/40 shadow-sm p-2 sm:p-4 flex flex-col items-center justify-center gap-1 sm:gap-2"
            style={{ animationDelay: "150ms" }}
          >
            <Clock className="h-6 w-6 sm:h-10 sm:w-10 text-green-500" />
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 text-center leading-tight">
              {t("studentDashboard.stats.practiceTime")}
            </p>
            <p className="text-lg sm:text-2xl font-bold">
              {stats.totalPracticeTime}
              {t("studentDashboard.stats.minutesUnit")}
            </p>
            <p className="text-[8px] sm:text-[10px] text-gray-400 dark:text-gray-500 text-center leading-tight">
              {t("studentDashboard.stats.practiceTimeDesc")}
            </p>
          </div>

          {/* 桌面版分行用隱形分隔 */}
          <div className="hidden lg:block w-full" />

          {/* ===== 作業狀態區（可點擊，漸層底） ===== */}
          {/* 待完成 */}
          <button
            onClick={() => navigate("/student/assignments?tab=todo")}
            className="crayon-texture animate-fade-up w-[40%] aspect-square sm:w-[calc(50%-8px)] lg:w-auto lg:flex-1 lg:max-w-[200px] rounded-2xl bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-950 dark:to-blue-900 shadow-sm p-2 sm:p-4 flex flex-col items-center justify-center gap-1 sm:gap-2 hover:shadow-md hover:scale-[1.02] transition-all cursor-pointer"
            style={{ animationDelay: "200ms" }}
          >
            <Clock className="h-6 w-6 sm:h-10 sm:w-10 text-blue-600" />
            <p className="text-xs sm:text-sm text-blue-700 dark:text-blue-300 text-center leading-tight font-medium">
              {t("studentAssignmentList.flowStatus.todo")}
            </p>
            <p className="text-lg sm:text-2xl font-bold text-blue-800 dark:text-blue-200">
              {assignmentStats.todo}
            </p>
          </button>

          {/* 已提交 */}
          <button
            onClick={() => navigate("/student/assignments?tab=submitted")}
            className="crayon-texture animate-fade-up w-[40%] aspect-square sm:w-[calc(50%-8px)] lg:w-auto lg:flex-1 lg:max-w-[200px] rounded-2xl bg-gradient-to-br from-yellow-100 to-amber-200 dark:from-yellow-950 dark:to-amber-900 shadow-sm p-2 sm:p-4 flex flex-col items-center justify-center gap-1 sm:gap-2 hover:shadow-md hover:scale-[1.02] transition-all cursor-pointer"
            style={{ animationDelay: "250ms" }}
          >
            <CheckCircle className="h-6 w-6 sm:h-10 sm:w-10 text-yellow-600" />
            <p className="text-xs sm:text-sm text-yellow-700 dark:text-yellow-300 text-center leading-tight font-medium">
              {t("studentAssignmentList.flowStatus.submitted")}
            </p>
            <p className="text-lg sm:text-2xl font-bold text-yellow-800 dark:text-yellow-200">
              {assignmentStats.submitted}
            </p>
          </button>

          {/* 待訂正 */}
          <button
            onClick={() => navigate("/student/assignments?tab=returned")}
            className="crayon-texture animate-fade-up w-[40%] aspect-square sm:w-[calc(50%-8px)] lg:w-auto lg:flex-1 lg:max-w-[200px] rounded-2xl bg-gradient-to-br from-orange-100 to-orange-200 dark:from-orange-950 dark:to-orange-900 shadow-sm p-2 sm:p-4 flex flex-col items-center justify-center gap-1 sm:gap-2 hover:shadow-md hover:scale-[1.02] transition-all cursor-pointer"
            style={{ animationDelay: "300ms" }}
          >
            <AlertCircle className="h-6 w-6 sm:h-10 sm:w-10 text-orange-600" />
            <p className="text-xs sm:text-sm text-orange-700 dark:text-orange-300 text-center leading-tight font-medium">
              {t("studentAssignmentList.flowStatus.returned")}
            </p>
            <p className="text-lg sm:text-2xl font-bold text-orange-800 dark:text-orange-200">
              {assignmentStats.returned}
            </p>
          </button>

          {/* 已訂正 */}
          <button
            onClick={() => navigate("/student/assignments?tab=resubmitted")}
            className="crayon-texture animate-fade-up w-[40%] aspect-square sm:w-[calc(50%-8px)] lg:w-auto lg:flex-1 lg:max-w-[200px] rounded-2xl bg-gradient-to-br from-purple-100 to-violet-200 dark:from-purple-950 dark:to-violet-900 shadow-sm p-2 sm:p-4 flex flex-col items-center justify-center gap-1 sm:gap-2 hover:shadow-md hover:scale-[1.02] transition-all cursor-pointer"
            style={{ animationDelay: "350ms" }}
          >
            <CheckCircle className="h-6 w-6 sm:h-10 sm:w-10 text-purple-600" />
            <p className="text-xs sm:text-sm text-purple-700 dark:text-purple-300 text-center leading-tight font-medium">
              {t("studentAssignmentList.flowStatus.resubmitted")}
            </p>
            <p className="text-lg sm:text-2xl font-bold text-purple-800 dark:text-purple-200">
              {assignmentStats.resubmitted}
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
