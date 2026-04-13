import { useState, useCallback } from "react";
import { API_URL } from "@/config/api";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

export interface ResourceMaterial {
  id: number;
  name: string;
  description: string | null;
  level: string | null;
  visibility: string;
  estimated_hours: number | null;
  tags: string[] | null;
  order_index: number;
  lesson_count: number;
  content_count: number;
  copied_today: boolean;
  copy_count_today: number;
  created_at: string | null;
}

export interface ResourceMaterialDetail {
  id: number;
  name: string;
  description: string | null;
  level: string | null;
  visibility: string;
  estimated_hours: number | null;
  tags: string[] | null;
  lesson_count: number;
  lessons: {
    id: number;
    name: string;
    description: string | null;
    order_index: number;
    content_count: number;
    contents: {
      id: number;
      title: string;
      type: string | null;
      order_index: number;
      item_count: number;
      items: {
        id: number;
        order_index: number;
        text: string;
        translation: string | null;
        image_url?: string | null;
      }[];
    }[];
  }[];
  created_at: string | null;
}

export function useResourceMaterialsAPI() {
  const token = useTeacherAuthStore((state) => state.token);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    [token],
  );

  const listMaterials = useCallback(
    async (
      scope: "individual" | "organization" = "individual",
      organizationId?: string,
    ): Promise<{ materials: ResourceMaterial[]; count: number }> => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ scope });
        if (organizationId) params.set("organization_id", organizationId);

        const res = await fetch(`${API_URL}/api/resource-materials?${params}`, {
          headers: authHeaders(),
        });
        if (!res.ok) throw new Error("Failed to fetch materials");
        return res.json();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
        return { materials: [], count: 0 };
      } finally {
        setLoading(false);
      }
    },
    [authHeaders],
  );

  const getMaterialDetail = useCallback(
    async (programId: number): Promise<ResourceMaterialDetail | null> => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_URL}/api/resource-materials/${programId}`,
          { headers: authHeaders() },
        );
        if (!res.ok) throw new Error("Failed to fetch material detail");
        return res.json();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [authHeaders],
  );

  const copyMaterial = useCallback(
    async (
      programId: number,
      targetType: "individual" | "organization",
      organizationId?: string,
    ) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_URL}/api/resource-materials/${programId}/copy`,
          {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              target_type: targetType,
              organization_id: organizationId,
            }),
          },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || "Failed to copy material");
        }
        return res.json();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [authHeaders],
  );

  const updateVisibility = useCallback(
    async (programId: number, visibility: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_URL}/api/resource-materials/${programId}/visibility`,
          {
            method: "PATCH",
            headers: authHeaders(),
            body: JSON.stringify({ visibility }),
          },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || "Failed to update visibility");
        }
        return res.json();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [authHeaders],
  );

  return {
    loading,
    error,
    listMaterials,
    getMaterialDetail,
    copyMaterial,
    updateVisibility,
  };
}
