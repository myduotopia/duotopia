import api from "./api";

/**
 * 學生登入「視圖」scope（Issue #793）
 * 多重身分教師分享 QR 時，帶上此 scope，學生掃描後預設只看到該視圖下的班級。
 *  - personal：教師個人班級（無機構連結）
 *  - org：某機構（旗下各校）的班級
 *  - school：某學校的班級
 * 省略 scope（或舊 QR）→ 後端回全部，向後相容。
 */
export type StudentLoginScope =
  | { type: "personal" }
  | { type: "org"; orgId: string }
  | { type: "school"; schoolId: string };

/** 把 scope 轉成 URLSearchParams 片段（無 scope 回空） */
function scopeToParams(scope?: StudentLoginScope | null): URLSearchParams {
  const params = new URLSearchParams();
  if (!scope) return params;
  params.set("scope", scope.type);
  if (scope.type === "org") params.set("org_id", scope.orgId);
  if (scope.type === "school") params.set("school_id", scope.schoolId);
  return params;
}

/**
 * 組學生登入 URL（含 teacher_email 與選用的視圖 scope）。
 * QR code / 可複製連結共用此 helper，避免多處硬寫漂移（Issue #793）。
 */
export function buildStudentLoginUrl(
  email: string,
  scope?: StudentLoginScope | null,
): string {
  const params = scopeToParams(scope);
  params.set("teacher_email", email);
  return `${window.location.origin}/student/login?${params.toString()}`;
}

export const teacherService = {
  async getDashboard() {
    const response = await api.get("/api/teacher/dashboard");
    return response.data;
  },

  async getClassrooms() {
    const response = await api.get("/api/teacher/classrooms");
    return response.data;
  },

  async getStudents(classroomId?: number) {
    const params = classroomId ? `?classroom_id=${classroomId}` : "";
    const response = await api.get(`/api/teacher/students${params}`);
    return response.data;
  },

  async getPrograms(classroomId?: number) {
    const params = classroomId ? `?classroom_id=${classroomId}` : "";
    const response = await api.get(`/api/teacher/programs${params}`);
    return response.data;
  },

  // Public endpoints for student login flow
  async validateTeacher(email: string) {
    const response = await api.post("/api/public/validate-teacher", { email });
    return response.data;
  },

  async getPublicClassrooms(
    teacherEmail: string,
    scope?: StudentLoginScope | null,
  ) {
    const params = scopeToParams(scope);
    params.set("email", teacherEmail);
    const response = await api.get(
      `/api/public/teacher-classrooms?${params.toString()}`,
    );
    return response.data;
  },

  async getClassroomStudents(classroomId: number) {
    const response = await api.get(
      `/api/public/classroom-students/${classroomId}`,
    );
    return response.data;
  },
};
