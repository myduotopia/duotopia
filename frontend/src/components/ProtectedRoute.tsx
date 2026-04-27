import { Navigate, useLocation } from "react-router-dom";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useEffect, useState } from "react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requiredRoles?: string[]; // New: Support role-based access
}

export function ProtectedRoute({
  children,
  requireAdmin = false,
  requiredRoles,
}: ProtectedRouteProps) {
  const isAuthenticated = useTeacherAuthStore((state) => state.isAuthenticated);
  const user = useTeacherAuthStore((state) => state.user);
  const token = useTeacherAuthStore((state) => state.token);
  const location = useLocation();
  const [hasRequiredRole, setHasRequiredRole] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(!!requiredRoles);

  // Check if user has required roles
  useEffect(() => {
    if (!requiredRoles || requiredRoles.length === 0) {
      setHasRequiredRole(true);
      setIsLoading(false);
      return;
    }

    const checkRoles = async () => {
      // Priority: Use user.role if available (from login response)
      if (user?.role) {
        const hasRole = requiredRoles.includes(user.role);
        setHasRequiredRole(hasRole);
        setIsLoading(false);
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
          const userRoles = data.all_roles || [];
          const hasRole = requiredRoles.some((role) =>
            userRoles.includes(role),
          );
          setHasRequiredRole(hasRole);
        } else {
          setHasRequiredRole(false);
        }
      } catch (error) {
        console.error("Failed to check roles:", error);
        setHasRequiredRole(false);
      } finally {
        setIsLoading(false);
      }
    };

    if (isAuthenticated && token) {
      checkRoles();
    }
  }, [requiredRoles, isAuthenticated, token, user]);

  if (!isAuthenticated) {
    const from = location.pathname + location.search + location.hash;
    return <Navigate to="/teacher/login" replace state={{ from }} />;
  }

  // Admin check (original logic)
  if (requireAdmin && !user?.is_admin) {
    return <Navigate to="/teacher/dashboard" replace />;
  }

  // Role check - show loading or redirect
  if (requiredRoles && requiredRoles.length > 0) {
    if (isLoading) {
      return (
        <div className="flex h-screen items-center justify-center">
          <div className="text-gray-500">驗證權限中...</div>
        </div>
      );
    }

    if (!hasRequiredRole) {
      return <Navigate to="/teacher/dashboard" replace />;
    }
  }

  return <>{children}</>;
}
