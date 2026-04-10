import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { getTeacherDashboardRoute } from "@/utils/authNavigation";
import TeacherLoginSheet from "@/components/TeacherLoginSheet";

export default function BlogHeader() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isTeacherLoginOpen, setIsTeacherLoginOpen] = useState(false);

  const { isAuthenticated: isTeacherAuth, user: teacherUser } =
    useTeacherAuthStore();
  const { isAuthenticated: isStudentAuth } = useStudentAuthStore();

  return (
    <>
      <header className="bg-white py-3 px-3 sm:py-4 sm:px-6 flex items-center justify-between shadow-sm">
        <Link to="/">
          <img
            src="https://storage.googleapis.com/duotopia-social-media-videos/website/logo/logo_row_nobg.png"
            alt={t("home.header.logo")}
            className="h-8 sm:h-10"
          />
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-3">
          <Link to="/blog">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs sm:text-sm px-2 sm:px-3 h-8 sm:h-9 font-semibold text-primary"
            >
              Blog
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (isTeacherAuth && teacherUser) {
                navigate(getTeacherDashboardRoute());
              } else {
                setIsTeacherLoginOpen(true);
              }
            }}
            className="text-xs sm:text-sm px-2 sm:px-3 h-8 sm:h-9"
          >
            {isTeacherAuth
              ? t("home.header.teacherDashboard", "教師後台")
              : t("home.header.teacherLogin")}
          </Button>
          {isStudentAuth ? (
            <Link to="/student/dashboard">
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-xs sm:text-sm px-2 sm:px-3 h-8 sm:h-9"
              >
                {t("home.header.studentDashboard", "學生專區")}
              </Button>
            </Link>
          ) : (
            <Link to="/student/login">
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-xs sm:text-sm px-2 sm:px-3 h-8 sm:h-9"
              >
                {t("home.header.studentLogin")}
              </Button>
            </Link>
          )}
          <LanguageSwitcher />
        </div>
      </header>

      <TeacherLoginSheet
        isOpen={isTeacherLoginOpen}
        onClose={() => setIsTeacherLoginOpen(false)}
      />
    </>
  );
}
