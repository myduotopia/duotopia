import { Navigate, useLocation } from "react-router-dom";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

/**
 * RoleBasedRedirect - Redirects users after login
 *
 * Always redirects to /teacher/dashboard (personal teacher mode).
 * Users with org roles can switch to org mode via sidebar.
 *
 * When unauthenticated, forwards the intended URL via router state so the
 * login flow can return the user here afterwards (#571).
 */
export function RoleBasedRedirect() {
  const { isAuthenticated } = useTeacherAuthStore();
  const location = useLocation();

  if (!isAuthenticated) {
    const from = location.pathname + location.search + location.hash;
    return <Navigate to="/teacher/login" replace state={{ from }} />;
  }

  return <Navigate to="/teacher/dashboard" replace />;
}
