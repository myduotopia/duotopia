import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { API_URL } from "@/config/api";

interface ProgramAPIOptions {
  scope: "teacher" | "organization" | "school";
  organizationId?: string;
  schoolId?: string;
}

export function useProgramAPI(options: ProgramAPIOptions) {
  const token = useTeacherAuthStore((state) => state.token);
  const { scope, organizationId, schoolId } = options;

  // Build base URL with scope
  const buildURL = (
    path: string,
    additionalParams?: Record<string, string>,
  ) => {
    const params = new URLSearchParams();
    params.set("scope", scope);
    if (scope === "organization" && organizationId) {
      params.set("organization_id", organizationId);
    }
    if (scope === "school" && schoolId) {
      params.set("school_id", schoolId);
    }
    if (additionalParams) {
      Object.entries(additionalParams).forEach(([key, value]) => {
        params.set(key, value);
      });
    }
    return `${API_URL}${path}?${params}`;
  };

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  return {
    // Programs
    getPrograms: async () => {
      const response = await fetch(buildURL("/api/programs"), { headers });
      if (!response.ok) throw new Error("Failed to fetch programs");
      return response.json();
    },

    createProgram: async (data: {
      name: string;
      description?: string;
      level?: string;
      tags?: string[];
    }) => {
      const response = await fetch(buildURL("/api/programs"), {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create program");
      return response.json();
    },

    updateProgram: async (
      id: number,
      data: {
        name?: string;
        description?: string;
        level?: string;
        tags?: string[];
      },
    ) => {
      const response = await fetch(buildURL(`/api/programs/${id}`), {
        method: "PUT",
        headers,
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update program");
      return response.json();
    },

    deleteProgram: async (id: number) => {
      const response = await fetch(buildURL(`/api/programs/${id}`), {
        method: "DELETE",
        headers,
      });
      if (!response.ok) throw new Error("Failed to delete program");
      return response.json();
    },

    // Lessons (scope-agnostic)
    createLesson: async (
      programId: number,
      data: { name: string; description?: string; order_index?: number },
    ) => {
      const response = await fetch(
        buildURL(`/api/programs/${programId}/lessons`),
        {
          method: "POST",
          headers,
          body: JSON.stringify(data),
        },
      );
      if (!response.ok) throw new Error("Failed to create lesson");
      return response.json();
    },

    updateLesson: async (
      lessonId: number,
      data: { name?: string; description?: string },
    ) => {
      const response = await fetch(
        buildURL(`/api/programs/lessons/${lessonId}`),
        {
          method: "PUT",
          headers,
          body: JSON.stringify(data),
        },
      );
      if (!response.ok) throw new Error("Failed to update lesson");
      return response.json();
    },

    deleteLesson: async (lessonId: number) => {
      const response = await fetch(
        buildURL(`/api/programs/lessons/${lessonId}`),
        {
          method: "DELETE",
          headers,
        },
      );
      if (!response.ok) throw new Error("Failed to delete lesson");
      return response.json();
    },

    // Contents (scope-agnostic)
    createContent: async (
      lessonId: number,
      data: { type: string; title: string; order_index?: number },
    ) => {
      const response = await fetch(
        buildURL(`/api/programs/lessons/${lessonId}/contents`),
        {
          method: "POST",
          headers,
          body: JSON.stringify(data),
        },
      );
      if (!response.ok) throw new Error("Failed to create content");
      return response.json();
    },

    deleteContent: async (contentId: number) => {
      const response = await fetch(
        buildURL(`/api/programs/contents/${contentId}`),
        {
          method: "DELETE",
          headers,
        },
      );
      if (!response.ok) throw new Error("Failed to delete content");
      return response.json();
    },

    // Reorder operations
    reorderPrograms: async (
      orderData: Array<{ id: number; order_index: number }>,
    ) => {
      const response = await fetch(buildURL("/api/programs/reorder"), {
        method: "PUT",
        headers,
        body: JSON.stringify(orderData),
      });
      if (!response.ok) throw new Error("Failed to reorder programs");
      return response.json();
    },

    reorderLessons: async (
      programId: number,
      orderData: Array<{ id: number; order_index: number }>,
    ) => {
      const response = await fetch(
        buildURL(`/api/programs/${programId}/lessons/reorder`),
        {
          method: "PUT",
          headers,
          body: JSON.stringify(orderData),
        },
      );
      if (!response.ok) throw new Error("Failed to reorder lessons");
      return response.json();
    },

    reorderContents: async (
      lessonId: number,
      orderData: Array<{ id: number; order_index: number }>,
    ) => {
      const response = await fetch(
        buildURL(`/api/programs/lessons/${lessonId}/contents/reorder`),
        {
          method: "PUT",
          headers,
          body: JSON.stringify(orderData),
        },
      );
      if (!response.ok) throw new Error("Failed to reorder contents");
      return response.json();
    },
  };
}
