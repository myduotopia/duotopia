import { ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useStudentAuthStore } from "@/stores/studentAuthStore";

interface StudentProtectedRouteProps {
  children: ReactNode;
}

export function StudentProtectedRoute({
  children,
}: StudentProtectedRouteProps) {
  const isAuthenticated = useStudentAuthStore((state) => state.isAuthenticated);
  const [hasHydrated, setHasHydrated] = useState(
    useStudentAuthStore.persist.hasHydrated(),
  );

  useEffect(() => {
    const unsub = useStudentAuthStore.persist.onFinishHydration(() => {
      setHasHydrated(true);
    });
    return unsub;
  }, []);

  if (!hasHydrated) return null;

  if (!isAuthenticated) {
    return <Navigate to="/student/login" replace />;
  }

  return <>{children}</>;
}
