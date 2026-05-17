import { useEffect, useState } from "react";
import { API_URL } from "@/config/api";
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
  const token = useTeacherAuthStore((s) => s.token);
  const teacherId = useTeacherAuthStore((s) => s.user?.id);

  const [organizations, setOrganizations] = useState<TeacherOrganization[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teacherId || !token) {
      setOrganizations([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/api/teachers/${teacherId}/organizations`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ApiResponse = await res.json();
        if (!cancelled) setOrganizations(data.organizations ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teacherId, token]);

  return { organizations, loading, error };
}
