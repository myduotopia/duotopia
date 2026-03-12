import { ReactNode, useState, useEffect, useRef } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LogOut, ChevronLeft, ChevronRight, Building2 } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import {
  OrganizationProvider,
  useOrganization,
} from "@/contexts/OrganizationContext";
import { OrganizationTree } from "@/components/organization/OrganizationTree";
import { API_URL } from "@/config/api";

interface OrganizationLayoutProps {
  children?: ReactNode;
}

function OrganizationLayoutContent({ children }: OrganizationLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const {
    token,
    logout: storeLogout,
    user,
    setUserRoles,
  } = useTeacherAuthStore();
  const { setOrganizations, setIsFetchingOrgs } = useOrganization();

  // Fetch organizations on mount (only if not already loaded)
  const hasFetchedOrgs = useRef(false);
  useEffect(() => {
    if (!token || hasFetchedOrgs.current) return;
    hasFetchedOrgs.current = true;

    const fetchOrganizations = async () => {
      try {
        setIsFetchingOrgs(true);
        const response = await fetch(`${API_URL}/api/organizations`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          const data = await response.json();
          setOrganizations(data);

          // If on index route, redirect to first organization
          const currentPath = window.location.pathname;
          if (
            (currentPath === "/organization" ||
              currentPath === "/organization/") &&
            data.length > 0
          ) {
            navigate(`/organization/${data[0].id}`, { replace: true });
          }
        } else {
          console.error("Failed to fetch organizations:", response.status);
          hasFetchedOrgs.current = false;
        }
      } catch (error) {
        console.error("Failed to fetch organizations:", error);
        hasFetchedOrgs.current = false;
      } finally {
        setIsFetchingOrgs(false);
      }
    };

    fetchOrganizations();
  }, [token, navigate, setOrganizations, setIsFetchingOrgs]);

  // Check permissions on mount
  useEffect(() => {
    const checkPermissions = async () => {
      const currentUser = useTeacherAuthStore.getState().user;

      // Priority: Use user.role if available (from login response)
      if (currentUser?.role) {
        // Store role in userRoles for child components (MaterialsPage needs this)
        setUserRoles([currentUser.role]);
        const hasOrgRole = ["org_owner", "org_admin", "school_admin"].includes(
          currentUser.role,
        );
        if (!hasOrgRole) {
          navigate("/teacher/dashboard", { replace: true });
        }
        return;
      }

      // Fallback: Fetch roles if not in user object (legacy login)
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_URL}/api/teachers/me/roles`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        if (response.ok) {
          const data = await response.json();
          // Store roles in global state for use by child components
          if (data.all_roles) {
            setUserRoles(data.all_roles);
          }
          const hasOrgRole = data.all_roles?.some((role: string) =>
            ["org_owner", "org_admin", "school_admin"].includes(role),
          );

          if (!hasOrgRole) {
            // No organization role, redirect to teacher dashboard
            navigate("/teacher/dashboard", { replace: true });
          }
        }
      } catch (error) {
        console.error("Failed to check permissions:", error);
      }
    };

    if (token) {
      checkPermissions();
    }
  }, [token, navigate, setUserRoles]);

  const handleLogout = () => {
    apiClient.logout();
    storeLogout();
    navigate("/teacher/login");
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r bg-white transition-all duration-300",
          sidebarCollapsed ? "w-16" : "w-64",
        )}
      >
        {/* Sidebar Header */}
        <div className="flex h-16 items-center justify-between border-b px-4">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" />
              <span className="font-semibold">組織管理</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="ml-auto"
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Sidebar Navigation - Organization Tree */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden p-4">
          {!sidebarCollapsed ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold text-gray-500 uppercase">
                  組織架構
                </div>
                {user?.is_admin && (
                  <button
                    onClick={() => navigate("/organization/all")}
                    className={cn(
                      "text-xs hover:underline transition-colors",
                      location.pathname === "/organization/all"
                        ? "text-blue-800 font-semibold"
                        : "text-blue-600 hover:text-blue-800",
                    )}
                  >
                    所有機構
                  </button>
                )}
              </div>
              <OrganizationTree
                onNodeSelect={(type, data) => {
                  if (type === "organization") {
                    // 點擊組織 → 導航到組織詳情頁面
                    navigate(`/organization/${data.id}`);
                  } else if (type === "school") {
                    // 點擊學校 → 導航到學校詳情頁面
                    navigate(`/organization/schools/${data.id}`);
                  }
                }}
                className="text-sm"
              />
            </>
          ) : (
            // Sidebar 收合時顯示簡化圖標
            <div className="flex flex-col items-center space-y-4">
              <Building2 className="h-5 w-5 text-gray-500" />
            </div>
          )}
        </nav>

        {/* Sidebar Footer */}
        <div className="border-t p-4">
          <Button
            variant="ghost"
            className={cn(
              "w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50",
              sidebarCollapsed && "justify-center px-2",
            )}
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            {!sidebarCollapsed && <span className="ml-2">登出</span>}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="flex h-16 items-center justify-between border-b bg-white px-6">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold">組織管理後台</h1>
          </div>
          <div className="flex items-center gap-4">
            {/* Current User Info */}
            {user && (
              <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 rounded-lg text-sm">
                <div className="text-gray-600">
                  <span className="font-medium">{user.name}</span>
                  <span className="mx-2 text-gray-300">|</span>
                  <span>{user.email}</span>
                  <span className="mx-2 text-gray-300">|</span>
                  <span className="text-blue-600">
                    {user.role === "org_owner"
                      ? "機構擁有者"
                      : user.role === "org_admin"
                        ? "機構管理員"
                        : user.role === "school_admin"
                          ? "學校管理員"
                          : "教師"}
                  </span>
                </div>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/teacher/dashboard")}
            >
              切換到教師後台
            </Button>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-6">
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
}

export default function OrganizationLayout(props: OrganizationLayoutProps) {
  return (
    <OrganizationProvider>
      <OrganizationLayoutContent {...props} />
    </OrganizationProvider>
  );
}
