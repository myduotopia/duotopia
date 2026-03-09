import type { TeacherUser } from "@/stores/teacherAuthStore";

const ORG_ROLES = ["org_owner", "org_admin", "school_admin", "school_director"];

/**
 * Get the appropriate dashboard route for a teacher user based on their role.
 */
export function getTeacherDashboardRoute(user: TeacherUser): string {
  return ORG_ROLES.includes(user.role || "")
    ? "/organization/dashboard"
    : "/teacher/dashboard";
}
