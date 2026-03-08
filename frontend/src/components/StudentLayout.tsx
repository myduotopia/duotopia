import { useState } from "react";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import {
  BookOpen,
  Home,
  User,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Building2,
  School,
} from "lucide-react";

export default function StudentLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useStudentAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/student/login");
  };

  const navItems = [
    {
      path: "/student/dashboard",
      label: t("studentLayout.nav.home"),
      icon: Home,
      color: "text-blue-500",
      activeColor: "text-blue-600",
      borderColor: "border-blue-500",
      bgColor: "bg-blue-50/80",
    },
    {
      path: "/student/assignments",
      label: t("studentLayout.nav.assignments"),
      icon: BookOpen,
      color: "text-emerald-500",
      activeColor: "text-emerald-600",
      borderColor: "border-emerald-500",
      bgColor: "bg-emerald-50/80",
    },
  ];

  const bottomNavItems = [
    {
      path: "/student/profile",
      label: t("studentLayout.nav.profile"),
      icon: User,
      color: "text-violet-500",
      activeColor: "text-violet-600",
      borderColor: "border-violet-500",
      bgColor: "bg-violet-50/80",
    },
  ];

  const isActive = (path: string) => location.pathname === path;

  // Build breadcrumb items dynamically based on available data
  const breadcrumbItems = [
    user?.organization_name && {
      icon: Building2,
      label: user.organization_name,
      isFinal: false,
    },
    user?.school_name && {
      icon: School,
      label: user.school_name,
      isFinal: false,
    },
  ].filter(Boolean) as Array<{
    icon: typeof Building2;
    label: string;
    isFinal: boolean;
  }>;

  // Breadcrumb component with dynamic hierarchy
  const Breadcrumb = () => (
    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 overflow-x-auto">
      {breadcrumbItems.map((item, index) => {
        const Icon = item.icon;
        const isLast = index === breadcrumbItems.length - 1;

        return (
          <div key={index} className="flex items-center gap-2">
            <div className="flex items-center gap-1 whitespace-nowrap">
              <Icon className="h-3 w-3" />
              <span
                className={
                  item.isFinal
                    ? "font-medium text-gray-900 dark:text-gray-100"
                    : ""
                }
              >
                {item.label}
              </span>
            </div>
            {!isLast && <ChevronRight className="h-3 w-3 flex-shrink-0" />}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
        fixed lg:static inset-y-0 left-0 z-50
        transform ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0 transition-transform duration-300 ease-in-out
        w-64 bg-white bg-notebook-lines shadow-lg flex flex-col
      `}
      >
        {/* Logo Section */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <Link
              to="/student/dashboard"
              className="flex-1 flex justify-center"
            >
              <img
                src="https://storage.googleapis.com/duotopia-social-media-videos/website/logo/logo_row_nobg.png"
                alt="Duotopia"
                className="h-11"
              />
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* User Info */}
          <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">
                {user?.name?.charAt(0).toUpperCase() || "S"}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm">
                  {user?.name || t("studentLayout.userInfo.defaultStudent")}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {user?.classroom_name ||
                    t("studentLayout.userInfo.defaultClass")}
                </p>
              </div>
            </div>
            {/* Account Switcher */}
            <AccountSwitcher />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-r-xl transition-all
                  border-l-4
                  ${
                    active
                      ? `${item.borderColor} ${item.bgColor} ${item.activeColor} font-medium translate-x-1`
                      : `border-transparent text-gray-600 hover:bg-gray-100/60 hover:translate-x-0.5 dark:text-gray-300 dark:hover:bg-gray-700`
                  }
                `}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon
                  className={`h-5 w-5 ${active ? item.activeColor : item.color}`}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom Section */}
        <div className="p-4 border-t dark:border-gray-700 space-y-1">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-r-xl transition-all
                  border-l-4
                  ${
                    active
                      ? `${item.borderColor} ${item.bgColor} ${item.activeColor} font-medium translate-x-1`
                      : `border-transparent text-gray-600 hover:bg-gray-100/60 hover:translate-x-0.5 dark:text-gray-300 dark:hover:bg-gray-700`
                  }
                `}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon
                  className={`h-5 w-5 ${active ? item.activeColor : item.color}`}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}

          <Button
            variant="ghost"
            className="w-full justify-start text-gray-700 hover:bg-gray-100 px-4 py-3 mt-2"
            onClick={handleLogout}
          >
            <LogOut className="h-5 w-5 mr-3" />
            {t("studentLayout.nav.logout")}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-white dark:bg-gray-800 shadow-sm border-b dark:border-gray-700">
          <div className="px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden flex-shrink-0"
                  onClick={() => setSidebarOpen(true)}
                >
                  <Menu className="h-5 w-5" />
                </Button>

                <div className="flex-1 min-w-0">
                  <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    {navItems.find((item) => isActive(item.path))?.label ||
                      t("studentLayout.header.defaultTitle")}
                  </h1>
                  {/* Breadcrumb in header for desktop */}
                  <div className="mt-1 hidden sm:block">
                    <Breadcrumb />
                  </div>
                </div>
              </div>

              {/* Language Switcher */}
              <LanguageSwitcher />
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto relative bg-notebook">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
