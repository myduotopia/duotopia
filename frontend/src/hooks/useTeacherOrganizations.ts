import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

export interface TeacherOrganization {
  id: string;
  name: string;
  display_name?: string | null;
  role: string;
}

interface ApiResponse {
  organizations?: TeacherOrganization[];
}

export function useTeacherOrganizations() {
  const teacherId = useTeacherAuthStore((s) => s.user?.id);

  const [organizations, setOrganizations] = useState<TeacherOrganization[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teacherId) {
      setOrganizations([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .get<ApiResponse>(`/api/teachers/${teacherId}/organizations`)
      .then((data) => {
        if (!cancelled) setOrganizations(data.organizations ?? []);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teacherId]);

  return { organizations, loading, error };
}
