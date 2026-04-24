import { Navigate } from "react-router-dom";
import { useStudentAuthStore } from "@/stores/studentAuthStore";

interface StudentProtectedRouteProps {
  children: React.ReactNode;
}

export function StudentProtectedRoute({
  children,
}: StudentProtectedRouteProps) {
  const isAuthenticated = useStudentAuthStore((state) => state.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/student/login" replace />;
  }

  return <>{children}</>;
}
