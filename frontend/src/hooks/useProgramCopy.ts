import { API_URL } from "@/config/api";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

export type ProgramCopyTargetScope =
  | "classroom"
  | "teacher"
  | "school"
  | "organization";

interface ProgramCopyRequest {
  programId: number;
  targetScope: ProgramCopyTargetScope;
  targetId?: string | number;
  name?: string;
}

export function useProgramCopy() {
  const token = useTeacherAuthStore((state) => state.token);
  const user = useTeacherAuthStore((state) => state.user);

  const copyProgram = async ({
    programId,
    targetScope,
    targetId,
    name,
  }: ProgramCopyRequest) => {
    const resolvedTargetId =
      targetScope === "teacher" ? (targetId ?? user?.id) : targetId;

    if (!resolvedTargetId) {
      throw new Error("Missing targetId for copy");
    }

    const response = await fetch(`${API_URL}/api/programs/${programId}/copy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        target_scope: targetScope,
        target_id: String(resolvedTargetId),
        name,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to copy program");
    }

    return response.json();
  };

  return { copyProgram };
}
