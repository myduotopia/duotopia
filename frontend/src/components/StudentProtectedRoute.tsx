import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useStudentAuthStore } from "@/stores/studentAuthStore";

interface StudentProtectedRouteProps {
  children: ReactNode;
}

export function StudentProtectedRoute({
  children,
}: StudentProtectedRouteProps) {
  const isAuthenticated = useStudentAuthStore((state) => state.isAuthenticated);
  const location = useLocation();
  const [hasHydrated, setHasHydrated] = useState(
    useStudentAuthStore.persist.hasHydrated(),
  );

  useEffect(() => {
    if (useStudentAuthStore.persist.hasHydrated()) {
      setHasHydrated(true);
      return;
    }
    const unsub = useStudentAuthStore.persist.onFinishHydration(() => {
      setHasHydrated(true);
    });
    return unsub;
  }, []);

  if (!hasHydrated) return null;

  if (!isAuthenticated) {
    const from = location.pathname + location.search + location.hash;
    return <Navigate to="/student/login" replace state={{ from }} />;
  }

  return <>{children}</>;
}
