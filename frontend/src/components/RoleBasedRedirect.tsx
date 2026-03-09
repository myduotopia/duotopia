import { Navigate } from "react-router-dom";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

/**
 * RoleBasedRedirect - Redirects users after login
 *
 * Always redirects to /teacher/dashboard (personal teacher mode).
 * Users with org roles can switch to org mode via sidebar.
 */
export function RoleBasedRedirect() {
  const { isAuthenticated } = useTeacherAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/teacher/login" replace />;
  }

  return <Navigate to="/teacher/dashboard" replace />;
}
