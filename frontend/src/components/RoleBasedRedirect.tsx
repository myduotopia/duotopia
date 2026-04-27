import { Navigate, useLocation } from "react-router-dom";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

// Always redirects authenticated users to /teacher/dashboard; forwards the
// intended URL via router state when unauthenticated.
export function RoleBasedRedirect() {
  const { isAuthenticated } = useTeacherAuthStore();
  const location = useLocation();

  if (!isAuthenticated) {
    const from = location.pathname + location.search + location.hash;
    return <Navigate to="/teacher/login" replace state={{ from }} />;
  }

  return <Navigate to="/teacher/dashboard" replace />;
}
