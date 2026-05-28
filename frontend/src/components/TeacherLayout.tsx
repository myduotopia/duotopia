import { ReactNode, useMemo, useCallback, useRef } from "react";
import { SidebarProvider, useSidebar } from "@/contexts/SidebarContext";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import DigitalTeachingToolbar from "@/components/teachingTools/DigitalTeachingToolbar";
import {
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  Crown,
  User,
  CreditCard,
  Building2,
  Globe,
  ChevronUp,
  Check,
} from "lucide-react";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { apiClient } from "@/lib/api";
import { buildQuotaSources, type QuotaSourceItem } from "@/lib/quotaSources";
import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getSidebarGroups } from "@/config/sidebarConfig";
import { useSidebarRoles } from "@/hooks/useSidebarRoles";
import { SidebarGroup } from "@/components/sidebar/SidebarGroup";
import { WorkspaceProvider, useWorkspace } from "@/contexts/WorkspaceContext";
import { WorkspaceSwitcher } from "@/components/workspace";

interface TeacherProfile {
  id: number;
  email: string;
  name: string;
  phone?: string;
  is_demo: boolean;
  is_active: boolean;
  is_admin?: boolean;
}

interface WorkspaceColor {
  surface: string;
  accent: string;
  text: string;
  bar: string;
}

interface TokenInfo {
  used: number;
  total: number;
  sources: QuotaSourceItem[];
}

/**
 * Sidebar token-balance bar, extracted as a leaf so a token refetch only
 * re-renders this subtree — the surrounding memoized SidebarContent (which
 * includes nav, WorkspaceSwitcher, account menu) stays untouched.
 */
function SidebarTokenBar({
  tokenInfo,
  workspaceColor,
}: {
  tokenInfo: TokenInfo | null;
  workspaceColor: WorkspaceColor;
}) {
  if (!tokenInfo || tokenInfo.total <= 0) return null;
  const barTotal = Math.max(
    1,
    tokenInfo.sources.reduce((a, x) => a + x.total, 0),
  );
  return (
    <div className="mt-3 rounded-md px-3 py-2 bg-white/70 dark:bg-gray-900/40">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-gray-700 dark:text-gray-300">
          剩餘點數
        </span>
        <span className="font-semibold" style={{ color: workspaceColor.text }}>
          {Math.max(0, tokenInfo.total - tokenInfo.used).toLocaleString()} /{" "}
          {tokenInfo.total.toLocaleString()}
        </span>
      </div>
      {tokenInfo.sources.length > 0 ? (
        <>
          {/* Stacked-by-source bar (personal). Each segment width is its
              share of sum-of-sources (avoids white gap if a package expires
              between QuotaService's two queries). Dark inner fill ∝
              REMAINING (matches the "剩餘 X / Y" headline above). */}
          <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            {tokenInfo.sources.map((s) => {
              const segPct = (s.total / barTotal) * 100;
              const remainingPct =
                (Math.max(0, s.total - s.used) / Math.max(1, s.total)) * 100;
              return (
                <div
                  key={s.kind}
                  className="h-full"
                  style={{
                    width: `${segPct}%`,
                    backgroundColor: s.bg,
                  }}
                >
                  <div
                    className="h-full"
                    style={{
                      width: `${remainingPct}%`,
                      backgroundColor: s.fill,
                    }}
                  />
                </div>
              );
            })}
          </div>
          <ul className="mt-2 space-y-1">
            {tokenInfo.sources.map((s) => (
              <li
                key={s.kind}
                className="flex items-center gap-1.5 text-[10px]"
              >
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: s.fill }}
                />
                <span className="text-gray-700 dark:text-gray-300">
                  {s.label}
                </span>
                <span className="ml-auto font-semibold text-gray-700 dark:text-gray-300">
                  {s.used.toLocaleString()} / {s.total.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        // Org mode: single solid bar; width = REMAINING / total so a
        // depleted balance reads as an almost-empty bar.
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white dark:bg-gray-800">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(
                0,
                Math.min(
                  100,
                  Math.round(
                    (Math.max(0, tokenInfo.total - tokenInfo.used) /
                      Math.max(1, tokenInfo.total)) *
                      100,
                  ),
                ),
              )}%`,
              backgroundColor: workspaceColor.bar,
            }}
          />
        </div>
      )}
    </div>
  );
}

interface SystemConfig {
  enablePayment: boolean;
  environment: string;
}

interface TeacherLayoutProps {
  children: ReactNode;
}

// Inner component that uses workspace context
interface TeacherLayoutInnerProps extends TeacherLayoutProps {
  teacherProfile: TeacherProfile;
}

function TeacherLayoutInner({
  children,
  teacherProfile,
}: TeacherLayoutInnerProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const { sidebarCollapsed, setSidebarCollapsed, sidebarDisabled } =
    useSidebar();
  const [config, setConfig] = useState<SystemConfig | null>(null);

  // Get user role and roles from auth store
  const user = useTeacherAuthStore((state) => state.user);
  const userRoles = useTeacherAuthStore((state) => state.userRoles);

  // Get workspace context
  const { mode, selectedSchool, selectedOrganization } = useWorkspace();

  // Watch for dark-mode class changes on <html> so we can skip the workspace
  // tint when dark mode is active (the tinted surface colours are all light
  // and would read poorly against dark-mode text).
  const [isDarkMode, setIsDarkMode] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const obs = new MutationObserver(() => {
      setIsDarkMode(root.classList.contains("dark"));
    });
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Workspace color palette: Personal = indigo (default), Orgs cycle the next
  // four colors deterministically by org id so the same org always gets the
  // same tint. The whole workspace+token block at the bottom of the sidebar
  // tints to match the active workspace. Memoized so the SidebarContent
  // useMemo below doesn't recompute on every render.
  const workspaceColor = useMemo(() => {
    // `surface` is the whole-sidebar wash (color-100 level — readable but
    // distinct); `accent` is the inner workspace+token block; `bar` is the
    // progress fill / strong text.
    const PALETTE = [
      {
        surface: "#E0E7FF",
        accent: "#C7D2FE",
        text: "#3730A3",
        bar: "#4F46E5",
      }, // indigo (personal)
      {
        surface: "#D1FAE5",
        accent: "#A7F3D0",
        text: "#065F46",
        bar: "#059669",
      }, // emerald
      {
        surface: "#FEF3C7",
        accent: "#FDE68A",
        text: "#92400E",
        bar: "#D97706",
      }, // amber
      {
        surface: "#FFE4E6",
        accent: "#FECDD3",
        text: "#9F1239",
        bar: "#E11D48",
      }, // rose
      {
        surface: "#EDE9FE",
        accent: "#DDD6FE",
        text: "#5B21B6",
        bar: "#7C3AED",
      }, // violet
    ];
    if (mode === "personal" || !selectedOrganization) return PALETTE[0];
    const hash = Array.from(selectedOrganization.id).reduce(
      (a, c) => a + c.charCodeAt(0),
      0,
    );
    return PALETTE[1 + (hash % 4)];
    // Key on the .id primitive (not the object reference) so the colour only
    // recomputes when the org actually changes — matches the token-fetch effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedOrganization?.id]);

  // Workspace-aware token / quota for the sidebar bar.
  // Personal mode  → /api/subscription/status (AGGREGATED across the active
  //                  subscription period + every active credit package, e.g.
  //                  trial + referral bonus + purchased packs — matches what
  //                  admins see in the per-teacher list)
  // Org mode       → /api/organizations/{id}/points (org-level points balance)
  // (/api/teachers/subscription only returns the current subscription_period
  // and is intentionally NOT used here — it would understate the teacher's
  // available points by ignoring credit packages.)
  // sources is non-empty only in personal mode (where we have a breakdown);
  // org mode just shows total/used without colour-coded segments.
  const [tokenInfo, setTokenInfo] = useState<{
    used: number;
    total: number;
    sources: QuotaSourceItem[];
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const fetchToken = async () => {
      try {
        if (mode === "organization" && selectedOrganization) {
          const res = await apiClient.get<{
            total_points: number;
            used_points: number;
          }>(`/api/organizations/${selectedOrganization.id}/points`);
          if (cancelled) return;
          if (res && typeof res.total_points === "number") {
            setTokenInfo({
              used: res.used_points ?? 0,
              total: res.total_points,
              sources: [],
            });
          } else {
            setTokenInfo(null);
          }
        } else {
          const res = await apiClient.getSubscriptionStatus();
          if (cancelled) return;
          if (typeof res.quota_total === "number" && res.quota_total > 0) {
            setTokenInfo({
              used: res.quota_used ?? 0,
              total: res.quota_total,
              sources: buildQuotaSources(res),
            });
          } else {
            setTokenInfo(null);
          }
        }
      } catch {
        // Non-fatal — hide the bar rather than break the sidebar (e.g. a
        // non-admin teacher in an org may not have permission to read points).
        if (!cancelled) setTokenInfo(null);
      }
    };
    fetchToken();
    return () => {
      cancelled = true;
    };
    // We intentionally key on .id (a primitive) instead of the whole object so
    // re-renders with the same org don't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedOrganization?.id]);

  // ✅ 切換 workspace mode 時，自動導向 dashboard（避免殘留前一模式的頁面）
  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (prevModeRef.current !== mode) {
      prevModeRef.current = mode;
      navigate("/teacher/dashboard");
    }
  }, [mode, navigate]);

  // Check if user has organization management role
  const hasOrgRole = useMemo(() => {
    const managementRoles = [
      "org_owner",
      "org_admin",
      "school_admin",
      "school_director",
    ];

    // Check if user has any management role in their roles array
    return userRoles.some((role) => managementRoles.includes(role));
  }, [userRoles]);

  // Determine which sidebar items are read-only
  const readOnlyItemIds = useMemo(() => {
    // In organization mode with a school selected, classrooms and students are read-only
    if (mode === "organization" && selectedSchool) {
      return ["classrooms", "students"];
    }
    return [];
  }, [mode, selectedSchool]);

  // 使用 hook 獲取 sidebar 配置和角色過濾
  const sidebarGroups = useMemo(() => getSidebarGroups(t), [t]);
  const { visibleGroups } = useSidebarRoles(
    sidebarGroups,
    config,
    teacherProfile,
  );

  // ✅ 根據 workspace mode 過濾 sidebar 內容
  // 個人模式：過濾掉組織相關功能（組織架構、機構教材）
  // 機構模式：顯示所有功能
  // 資源帳號：隱藏「資源教材包」（不需要複製自己的教材）
  const RESOURCE_ACCOUNT_EMAIL =
    import.meta.env.VITE_RESOURCE_ACCOUNT_EMAIL || "contact@duotopia.co";
  const isResourceAccount = user?.email === RESOURCE_ACCOUNT_EMAIL;

  const filteredGroups = useMemo(() => {
    return visibleGroups
      .filter((group) => {
        // 個人模式下過濾掉組織管理 group
        if (mode === "personal" && group.id === "organization-hub") {
          return false;
        }
        // 資源帳號隱藏「資源教材包」
        if (isResourceAccount && group.id === "shared-resources") {
          return false;
        }
        return true;
      })
      .map((group) => {
        // 個人模式下過濾掉「機構教材」item
        if (mode === "personal" && group.id === "class-management") {
          return {
            ...group,
            items: group.items.filter((item) => item.id !== "org-materials"),
          };
        }
        return group;
      });
  }, [visibleGroups, mode, isResourceAccount]);

  const handleLogout = useCallback(() => {
    apiClient.logout();
    navigate("/teacher/login");
  }, [navigate]);

  // ✅ 使用 useRef 防止重複執行
  const hasFetchedConfig = useRef(false);

  useEffect(() => {
    // 只在 mount 時執行一次
    if (hasFetchedConfig.current) return;
    hasFetchedConfig.current = true;

    const fetchConfig = async () => {
      try {
        const data = await apiClient.getConfig();
        setConfig(data);
      } catch (err) {
        console.error("Failed to fetch system config:", err);
      }
    };

    fetchConfig();
  }, []); // 只在 mount 時執行

  const isActive = useCallback(
    (path: string) => location.pathname === path,
    [location.pathname],
  );

  // Memoize SidebarContent to prevent unnecessary re-renders
  const SidebarContent = useMemo(
    () =>
      ({ onNavigate }: { onNavigate?: () => void }) => (
        <>
          {/* Header */}
          <div className="p-4 border-b dark:border-gray-700">
            <div className="flex items-start justify-between">
              {!sidebarCollapsed ? (
                <Link to="/" className="flex-1">
                  <img
                    src="https://storage.googleapis.com/duotopia-social-media-videos/website/logo/logo_row_nobg.png"
                    alt="Duotopia"
                    className="h-8 sm:h-10"
                  />
                </Link>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="md:flex hidden h-8 w-8 p-0 items-center justify-center flex-shrink-0"
              >
                {sidebarCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Navigation */}
          <nav
            className={`flex-1 overflow-y-auto ${sidebarCollapsed ? "p-2" : "p-4"}`}
          >
            <ul className="space-y-1">
              {filteredGroups.map((group) => (
                <SidebarGroup
                  key={group.id}
                  group={group}
                  isCollapsed={sidebarCollapsed}
                  isActive={isActive}
                  readOnlyItemIds={readOnlyItemIds}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </nav>

          {/* Workspace + token (Variant B: switcher moved to bottom near
              user). Accent tint is light-mode only — same reason as the
              parent sidebar background. */}
          {!sidebarCollapsed && teacherProfile && (
            <div
              className="px-3 pt-3 pb-2 border-t dark:border-gray-700"
              style={
                isDarkMode
                  ? undefined
                  : { backgroundColor: workspaceColor.accent }
              }
            >
              <WorkspaceSwitcher />
              {/* Render the bar as a child component so that setTokenInfo()
                  doesn't force the whole memoized SidebarContent to rebuild
                  — React reconciles this subtree on its own. */}
              <SidebarTokenBar
                tokenInfo={tokenInfo}
                workspaceColor={workspaceColor}
              />
            </div>
          )}

          {/* Account Menu */}
          <div className="p-2 border-t dark:border-gray-700">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`w-full flex items-center gap-3 rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer ${sidebarCollapsed ? "justify-center" : ""}`}
                >
                  <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                      {teacherProfile?.name?.charAt(0) || "T"}
                    </span>
                  </div>
                  {!sidebarCollapsed && (
                    <>
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {teacherProfile?.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {teacherProfile?.email}
                        </p>
                      </div>
                      <ChevronUp className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    </>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="center"
                sideOffset={8}
                className="w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 z-[100]"
              >
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">
                      {teacherProfile?.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {teacherProfile?.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    navigate("/teacher/profile");
                    onNavigate?.();
                  }}
                >
                  <User className="mr-2 h-4 w-4" />
                  {t("teacherLayout.nav.profile")}
                </DropdownMenuItem>
                {teacherProfile?.is_admin && (
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => {
                      navigate("/admin");
                      onNavigate?.();
                    }}
                  >
                    <Crown className="mr-2 h-4 w-4 text-yellow-500" />
                    {t("teacherLayout.nav.systemAdmin")}
                  </DropdownMenuItem>
                )}
                {config?.enablePayment && (
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => {
                      navigate("/teacher/subscription");
                      onNavigate?.();
                    }}
                  >
                    <CreditCard className="mr-2 h-4 w-4" />
                    {t("teacherLayout.nav.subscription")}
                  </DropdownMenuItem>
                )}
                {hasOrgRole && (
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => {
                      navigate("/organization");
                      onNavigate?.();
                    }}
                  >
                    <Building2 className="mr-2 h-4 w-4 text-blue-600" />
                    {t("teacherLayout.nav.orgManagement")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="cursor-pointer">
                    <Globe className="mr-2 h-4 w-4" />
                    {t("teacherLayout.nav.language")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="bg-white dark:bg-gray-800">
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={() => i18n.changeLanguage("zh-TW")}
                    >
                      繁體中文
                      {i18n.language.startsWith("zh") && (
                        <Check className="ml-auto h-4 w-4" />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={() => i18n.changeLanguage("en")}
                    >
                      English
                      {!i18n.language.startsWith("zh") && (
                        <Check className="ml-auto h-4 w-4" />
                      )}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-900/20"
                  onClick={() => {
                    handleLogout();
                    onNavigate?.();
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  {t("nav.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      ),
    [
      sidebarCollapsed,
      t,
      i18n,
      navigate,
      setSidebarCollapsed,
      filteredGroups,
      isActive,
      readOnlyItemIds,
      teacherProfile,
      config,
      hasOrgRole,
      handleLogout,
      // tokenInfo intentionally omitted: SidebarTokenBar is a child component,
      // so React reconciles it on its own when tokenInfo changes.
      workspaceColor,
      isDarkMode,
    ],
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      {/* Mobile Header */}
      <div className="md:hidden bg-white dark:bg-gray-800 border-b dark:border-gray-700 sticky top-0 z-50">
        <div className="flex items-center justify-between p-4">
          <Link to="/">
            <img
              src="https://storage.googleapis.com/duotopia-social-media-videos/website/logo/logo_row_nobg.png"
              alt="Duotopia"
              className="h-7"
            />
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-12 min-h-12 w-12"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <div
                  className="flex flex-col h-full bg-white dark:bg-gray-800"
                  style={
                    isDarkMode
                      ? undefined
                      : { backgroundColor: workspaceColor.surface }
                  }
                >
                  <SidebarContent onNavigate={() => {}} />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>

      <div className="flex">
        {/* Desktop Sidebar — tinted by active workspace color (light mode
            only; in dark mode we let dark:bg-gray-800 win). */}
        <div
          className={`hidden md:flex bg-white dark:bg-gray-800 shadow-lg transition-all duration-300 ${sidebarCollapsed ? "w-16" : "w-64"} flex-col h-screen sticky top-0 ${sidebarDisabled ? "pointer-events-none opacity-50" : ""}`}
          style={
            isDarkMode ? undefined : { backgroundColor: workspaceColor.surface }
          }
        >
          <SidebarContent />
        </div>

        {/* Main Content */}
        <div className="flex-1 p-4 md:p-6 overflow-auto relative">
          <DigitalTeachingToolbar />
          {children}
        </div>
      </div>
    </div>
  );
}

// Wrapper component that provides workspace context
export default function TeacherLayout({ children }: TeacherLayoutProps) {
  const [teacherProfile, setTeacherProfile] = useState<TeacherProfile | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedProfile = useRef(false);

  useEffect(() => {
    if (hasFetchedProfile.current) return;
    hasFetchedProfile.current = true;

    const fetchTeacherProfile = async () => {
      try {
        const data = (await apiClient.getTeacherDashboard()) as {
          teacher: TeacherProfile;
        };
        setTeacherProfile(data.teacher);
        setError(null);
      } catch (err) {
        console.error("Failed to fetch teacher profile:", err);
        setError("無法載入資料，請檢查網路連線後重試");
      } finally {
        setIsLoading(false);
      }
    };

    fetchTeacherProfile();
  }, []);

  // Show error state if profile fetch failed
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center" role="alert" aria-live="assertive">
          <p className="text-red-600 mb-4">{error}</p>
          <Button onClick={() => window.location.reload()} autoFocus>
            重試
          </Button>
        </div>
      </div>
    );
  }

  // Show loading state while fetching teacher profile
  if (isLoading || !teacherProfile) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <WorkspaceProvider teacherId={teacherProfile.id}>
        <TeacherLayoutInner teacherProfile={teacherProfile}>
          {children}
        </TeacherLayoutInner>
      </WorkspaceProvider>
    </SidebarProvider>
  );
}
