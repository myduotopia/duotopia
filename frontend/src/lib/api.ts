/**
 * API Client for Duotopia
 */

import { API_URL } from "../config/api";
import { retryAIAnalysis } from "../utils/retryHelper";
import { clearAllAuth } from "./authUtils";
import { appendAudioToFormData } from "@/utils/audioFormatDetection";
import { saveRedirectTarget } from "../utils/redirectAfterLogin";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

// 🔐 Security: Only enable debug logs in development
const DEBUG = false; // 暫時關閉以便追蹤其他問題

// Prevent multiple simultaneous 401 redirects
let isRedirectingToLogin = false;

/**
 * Custom API Error class for better error handling
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail:
      | string
      | { message?: string; errors?: string[] }
      | Array<{ msg?: string; loc?: (string | number)[]; type?: string }>,
    public originalError?: unknown,
  ) {
    // Extract message for Error base class
    // Handle Pydantic validation error arrays: [{ msg, loc, type, input, url }]
    const message = Array.isArray(detail)
      ? detail
          .map((e: { msg?: string; loc?: (string | number)[] }) => {
            const field = e.loc?.slice(-1)[0];
            return field ? `${field}: ${e.msg}` : (e.msg ?? "驗證錯誤");
          })
          .join("; ")
      : typeof detail === "object" && detail?.message
        ? detail.message
        : typeof detail === "string"
          ? detail
          : "Unknown error";
    super(message);
    this.name = "ApiError";

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  /**
   * Check if error is unauthorized (401)
   */
  isUnauthorized(): boolean {
    return this.status === 401;
  }

  /**
   * Check if error is forbidden (403)
   */
  isForbidden(): boolean {
    return this.status === 403;
  }

  /**
   * Check if error is not found (404)
   */
  isNotFound(): boolean {
    return this.status === 404;
  }

  /**
   * Check if error is validation error (422)
   */
  isValidationError(): boolean {
    return this.status === 422;
  }

  /**
   * Check if error is server error (5xx)
   */
  isServerError(): boolean {
    return this.status >= 500 && this.status < 600;
  }

  /**
   * Get error code if available
   */
  getErrorCode(): string | undefined {
    if (this.originalError && typeof this.originalError === "object") {
      return (this.originalError as { code?: string }).code;
    }
    return undefined;
  }

  /**
   * Get validation errors if available
   */
  getValidationErrors(): Record<string, string> | undefined {
    if (this.originalError && typeof this.originalError === "object") {
      return (this.originalError as { errors?: Record<string, string> }).errors;
    }
    return undefined;
  }
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: {
    id: number;
    email: string;
    name: string;
    role?: string;
    organization_id?: string | null;
    school_id?: string | null;
    is_demo: boolean;
    is_admin?: boolean;
  };
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  phone?: string;
  promo_code?: string;
}

export interface AdminCreditPackageOperation {
  action: "edit" | "cancel" | string;
  timestamp: string;
  admin_id: number;
  admin_email?: string;
  admin_name?: string;
  reason: string;
  changes: Record<
    string,
    { from: unknown; to: unknown } | string | number | boolean
  >;
}

interface AdminCreditPackageResult {
  id: number;
  package_id: string;
  source: string;
  points_total: number;
  points_used: number;
  points_remaining: number;
  expires_at: string;
  status: string;
  admin_operations: AdminCreditPackageOperation[];
}

// ============ Promo Code types ============
export interface PromoCodeRow {
  id: number;
  code: string;
  teacher_id: number;
  kind: string;
  expires_at: string | null;
  is_active: boolean;
  note: string | null;
  created_at: string | null;
}

export interface RewardConfigRow {
  id: number;
  reward_key: string;
  points: number;
  recipient: string;
  is_active: boolean;
}

export interface ReferralReportRow {
  referrer_teacher_id: number;
  referral_count: number;
  verified_count: number;
  paid_count: number;
  total_points_awarded: number;
}

// ============ Live Quiz (Issue #835) ============
export type LiveQuizState = "not_started" | "open" | "closed";

export interface LiveQuizStatus {
  assignment_id: number;
  is_live_quiz: boolean;
  state: LiveQuizState;
  opened_at: string | null;
  closed_at: string | null;
  server_time: string;
  force_completed_count?: number;
}

export interface LiveQuizProgressStudent {
  student_id: number;
  student_name: string;
  student_number: number;
  is_assigned: boolean;
  status: string;
  score: number | null;
  correct_count: number | null;
  answered_count: number | null;
  total_questions: number | null;
}

export interface LiveQuizProgress extends LiveQuizStatus {
  total_students: number;
  submitted_count: number;
  students: LiveQuizProgressStudent[];
}

export interface StudentQuizStatus {
  /** teacher 端 Assignment.id（非 StudentAssignment.id），用於訂閱 Realtime 收卷頻道 */
  assignment_id: number;
  is_live_quiz: boolean;
  opened_at: string | null;
  closed_at: string | null;
  server_time: string;
  status: string | null;
}

class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_URL;
  }

  private getToken(): string | null {
    const studentToken = useStudentAuthStore.getState().token;
    const teacherToken = useTeacherAuthStore.getState().token;

    // Context-aware token selection based on current page
    const path = window.location.pathname;
    const isTeacherContext =
      path.startsWith("/teacher") || path.startsWith("/organization");
    const isStudentContext = path.startsWith("/student");

    if (isTeacherContext) {
      return teacherToken || studentToken || null;
    }
    if (isStudentContext) {
      return studentToken || teacherToken || null;
    }

    // Default: prefer whichever token exists (teacher first for API compatibility)
    return teacherToken || studentToken || null;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    // 每次請求都動態獲取 token
    const currentToken = this.getToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (currentToken) {
      (headers as Record<string, string>)["Authorization"] =
        `Bearer ${currentToken}`;
    }

    // DIAGNOSTIC: Log request details before sending
    if (DEBUG) {
      console.log("🔍 [DEBUG] Request details:", {
        url,
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.parse(options.body as string) : undefined,
      });
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (DEBUG) {
          console.error("🌐 [ERROR] API請求失敗:", {
            url,
            status: response.status,
            error,
          });
        }

        // Extract detail - preserve structured error objects
        const detail =
          typeof error === "object" && error !== null && "detail" in error
            ? error.detail
            : `HTTP ${response.status} Error`;

        // Auto-logout on 401 (expired/invalid token)
        if (response.status === 401 && !endpoint.includes("/auth/")) {
          if (!isRedirectingToLogin) {
            isRedirectingToLogin = true;
            // Preserve the in-progress URL across this hard navigation.
            saveRedirectTarget(
              window.location.pathname +
                window.location.search +
                window.location.hash,
            );
            clearAllAuth();
            const loginPath = window.location.pathname.startsWith("/student")
              ? "/student/login"
              : "/teacher/login";
            window.location.href = loginPath;
            // Reset flag after a short delay so future 401s can still redirect
            setTimeout(() => {
              isRedirectingToLogin = false;
            }, 3000);
          }
        }

        // Throw ApiError instead of generic Error
        throw new ApiError(response.status, detail, error);
      }

      const result = await response.json();
      return result;
    } catch (err) {
      // If it's already an ApiError, re-throw it
      if (err instanceof ApiError) {
        throw err;
      }

      // Wrap network errors in ApiError
      if (DEBUG) console.error("🌐 [ERROR] Network error:", err);
      throw new ApiError(
        0, // Network errors have no HTTP status
        err instanceof Error ? err.message : "Network error occurred",
        err,
      );
    }
  }

  // ============ Auth Methods ============
  async teacherLogin(data: LoginRequest): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>(
      "/api/auth/teacher/login",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );

    // Note: Token storage is handled by teacherAuthStore in the calling component

    return response;
  }

  async teacherRegister(data: RegisterRequest): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>(
      "/api/auth/teacher/register",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );

    // Note: Token storage is handled by teacherAuthStore in the calling component
    return response;
  }

  async resendVerification(email: string): Promise<{ message: string }> {
    return this.request("/api/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  logout() {
    clearAllAuth();
    localStorage.removeItem("selectedPlan");
  }

  // ============ Generic HTTP Methods ============
  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: "GET",
    });
  }

  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async patch<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PATCH",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: "DELETE",
    });
  }

  getCurrentUser() {
    const userStr = localStorage.getItem("user");
    return userStr ? JSON.parse(userStr) : null;
  }

  // ============ Public Config Methods ============
  async getConfig() {
    return this.request<{
      enablePayment: boolean;
      environment: string;
    }>("/api/public/config");
  }

  // ============ Teacher Methods ============
  async getTeacherProfile() {
    return this.request("/api/teachers/me");
  }

  async updateTeacherProfile(data: { name?: string; phone?: string }) {
    return this.request("/api/teachers/me", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async updateTeacherPassword(data: {
    current_password: string;
    new_password: string;
  }) {
    return this.request("/api/teachers/me/password", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async getTeacherDashboard() {
    return this.request("/api/teachers/dashboard");
  }

  async syncOneCampusClasses() {
    return this.request<{
      synced: boolean;
      schools: string[];
      classrooms_added: number;
      classrooms_updated: number;
      students_added: number;
      students_updated: number;
      errors: string[];
      // The backend always returns `message`, but the UI builds its own
      // summary string from the counts; mark optional to signal that
      // callers should not rely on `message` as the primary copy.
      message?: string;
    }>("/api/teachers/me/sync-1campus-classes", {
      method: "POST",
    });
  }

  async getTeacherClassrooms(params?: {
    mode?: string;
    school_id?: string;
    organization_id?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.mode) queryParams.append("mode", params.mode);
    if (params?.school_id) queryParams.append("school_id", params.school_id);
    if (params?.organization_id)
      queryParams.append("organization_id", params.organization_id);

    const query = queryParams.toString();
    const url = query
      ? `/api/teachers/classrooms?${query}`
      : "/api/teachers/classrooms";

    return this.request(url);
  }

  async getTeacherPrograms(
    isTemplate?: boolean,
    classroomId?: number,
    schoolId?: string,
    organizationId?: string,
  ) {
    const params = new URLSearchParams();
    if (isTemplate !== undefined)
      params.append("is_template", String(isTemplate));
    if (classroomId !== undefined)
      params.append("classroom_id", String(classroomId));
    if (schoolId) params.append("school_id", schoolId);
    if (organizationId) params.append("organization_id", organizationId);
    const queryString = params.toString();
    return this.request(
      `/api/teachers/programs${queryString ? `?${queryString}` : ""}`,
    );
  }

  async getProgramDetail(programId: number) {
    return this.request(`/api/teachers/programs/${programId}`);
  }

  // ============ Public Template Program Methods ============
  async getTemplatePrograms(classroomId?: number) {
    const params = classroomId ? `?classroom_id=${classroomId}` : "";
    return this.request(`/api/programs/templates${params}`);
  }

  async createTemplateProgram(data: {
    name: string;
    description?: string;
    level?: string;
    estimated_hours?: number;
    tags?: string[];
  }) {
    return this.request("/api/programs/templates", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateTemplateProgram(
    id: number,
    data: {
      name?: string;
      description?: string;
      level?: string;
      estimated_hours?: number;
      tags?: string[];
    },
  ) {
    return this.request(`/api/programs/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async getTemplateProgram(programId: number) {
    return this.request(`/api/programs/templates/${programId}`);
  }

  async getTemplateProgramDetail(programId: number) {
    return this.request(`/api/programs/templates/${programId}`);
  }

  async copyFromTemplate(data: {
    template_id: number;
    classroom_id: number;
    name?: string;
  }) {
    return this.request("/api/programs/copy-from-template", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async copyProgram(data: {
    program_id: number;
    target_scope: "classroom" | "teacher" | "school";
    target_id: string;
    name?: string;
  }) {
    return this.request(`/api/programs/${data.program_id}/copy`, {
      method: "POST",
      body: JSON.stringify({
        target_scope: data.target_scope,
        target_id: data.target_id,
        name: data.name,
      }),
    });
  }

  async copyFromClassroom(data: {
    source_program_id: number;
    target_classroom_id: number;
    name?: string;
  }) {
    return this.request("/api/programs/copy-from-classroom", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async createCustomProgram(
    classroomId: number,
    data: {
      name: string;
      description?: string;
      level?: string;
      estimated_hours?: number;
      tags?: string[];
    },
  ) {
    return this.request(
      `/api/programs/create-custom?classroom_id=${classroomId}`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  }

  async getCopyablePrograms(classroomId: number, schoolId?: string) {
    let url = `/api/programs/copyable?classroom_id=${classroomId}`;
    if (schoolId) {
      url += `&school_id=${schoolId}`;
    }
    return this.request(url);
  }

  async getClassroomPrograms(classroomId: number) {
    return this.request(`/api/programs/classroom/${classroomId}`);
  }

  async getSchoolClassroomPrograms(schoolId: string, classroomId: number) {
    return this.request(
      `/api/schools/${schoolId}/classrooms/${classroomId}/programs`,
    );
  }

  async softDeleteProgram(programId: number) {
    return this.request(`/api/programs/${programId}`, {
      method: "DELETE",
    });
  }

  // ============ Classroom CRUD Methods ============
  async updateClassroom(
    classroomId: number,
    data: { name?: string; description?: string; level?: string },
  ) {
    return this.request(`/api/teachers/classrooms/${classroomId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteClassroom(classroomId: number) {
    return this.request(`/api/teachers/classrooms/${classroomId}`, {
      method: "DELETE",
    });
  }

  async createClassroom(data: {
    name: string;
    description?: string;
    level: string;
  }) {
    return this.request("/api/teachers/classrooms", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // ============ School Classroom Methods ============
  async createSchoolClassroom(
    schoolId: string,
    data: {
      name: string;
      description?: string;
      level: string;
      teacher_id?: number | null;
    },
  ) {
    return this.request(`/api/schools/${schoolId}/classrooms`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateSchoolClassroom(
    classroomId: number,
    data: {
      name?: string;
      description?: string;
      level?: string;
      is_active?: boolean;
    },
  ) {
    return this.request(`/api/classrooms/${classroomId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async assignTeacherToClassroom(
    classroomId: number,
    teacherId: number | null,
  ) {
    return this.request(`/api/classrooms/${classroomId}/teacher`, {
      method: "PUT",
      body: JSON.stringify({ teacher_id: teacherId }),
    });
  }

  // ============ School Student Methods ============
  async getSchoolStudents(
    schoolId: string,
    params?: {
      page?: number;
      limit?: number;
      search?: string;
      status?: "active" | "inactive";
      classroom_id?: number;
      unassigned?: boolean;
    },
  ) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append("page", params.page.toString());
    if (params?.limit) queryParams.append("limit", params.limit.toString());
    if (params?.search) queryParams.append("search", params.search);
    if (params?.status) queryParams.append("status", params.status);
    if (params?.classroom_id)
      queryParams.append("classroom_id", params.classroom_id.toString());
    if (params?.unassigned !== undefined)
      queryParams.append("unassigned", params.unassigned.toString());

    const queryString = queryParams.toString();
    const url = `/api/schools/${schoolId}/students${queryString ? `?${queryString}` : ""}`;
    return this.request(url);
  }

  async createSchoolStudent(
    schoolId: string,
    data: {
      name: string;
      email?: string;
      student_number?: string;
      birthdate?: string; // YYYY-MM-DD（選填）
      phone?: string;
    },
  ) {
    return this.request(`/api/schools/${schoolId}/students`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async addStudentToSchool(schoolId: string, studentId: number) {
    return this.request(`/api/schools/${schoolId}/students/${studentId}`, {
      method: "POST",
    });
  }

  async updateSchoolStudent(
    schoolId: string,
    studentId: number,
    data: {
      name?: string;
      email?: string;
      student_number?: string;
      birthdate?: string;
      phone?: string;
      is_active?: boolean;
    },
  ) {
    return this.request(`/api/schools/${schoolId}/students/${studentId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async resetSchoolStudentPassword(schoolId: string, studentId: number) {
    return this.request(
      `/api/schools/${schoolId}/students/${studentId}/reset-password`,
      {
        method: "POST",
      },
    );
  }

  async removeStudentFromSchool(schoolId: string, studentId: number) {
    return this.request(`/api/schools/${schoolId}/students/${studentId}`, {
      method: "DELETE",
    });
  }

  async addStudentToClassroom(
    schoolId: string,
    studentId: number,
    classroomId: number,
  ) {
    return this.request(
      `/api/schools/${schoolId}/students/${studentId}/classrooms`,
      {
        method: "POST",
        body: JSON.stringify({ classroom_id: classroomId }),
      },
    );
  }

  async removeStudentFromClassroom(
    schoolId: string,
    studentId: number,
    classroomId: number,
  ) {
    return this.request(
      `/api/schools/${schoolId}/students/${studentId}/classrooms/${classroomId}`,
      {
        method: "DELETE",
      },
    );
  }

  async getClassroomStudents(schoolId: string, classroomId: number) {
    return this.request(
      `/api/schools/${schoolId}/classrooms/${classroomId}/students`,
    );
  }

  async getTeacherClassroomStudents(classroomId: number) {
    return this.request(`/api/teachers/classrooms/${classroomId}/students`);
  }

  async batchAddStudentsToClassroom(
    schoolId: string,
    classroomId: number,
    studentIds: number[],
  ) {
    return this.request(
      `/api/schools/${schoolId}/classrooms/${classroomId}/students/batch`,
      {
        method: "POST",
        body: JSON.stringify({ student_ids: studentIds }),
      },
    );
  }

  async batchImportStudentsForSchool(
    schoolId: string,
    students: Array<{
      name: string;
      email?: string;
      student_number?: string;
      birthdate?: string;
      phone?: string;
      classroom_id?: number;
    }>,
    duplicateAction: "skip" | "update" | "add_suffix" = "skip",
  ) {
    return this.request(`/api/schools/${schoolId}/students/batch-import`, {
      method: "POST",
      body: JSON.stringify({
        students,
        duplicate_action: duplicateAction,
      }),
    });
  }

  // ============ Student CRUD Methods ============
  async createStudent(data: {
    name: string;
    email?: string; // Email 改為選填
    student_id?: string;
    birthdate: string;
    phone?: string;
    classroom_id?: number;
  }) {
    return this.request("/api/teachers/students", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateStudent(
    studentId: number,
    data: {
      name?: string;
      email?: string;
      student_id?: string;
      birthdate?: string;
      phone?: string;
      classroom_id?: number;
      status?: string;
    },
  ) {
    return this.request(`/api/teachers/students/${studentId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteStudent(studentId: number) {
    return this.request(`/api/teachers/students/${studentId}`, {
      method: "DELETE",
    });
  }

  async resetStudentPassword(studentId: number) {
    return this.request(`/api/teachers/students/${studentId}/reset-password`, {
      method: "POST",
    });
  }

  // ===== Phase 5-2 (issue #768): student activate / deactivate =====
  async updateStudentStatus(
    studentId: number,
    body: { status: "active" | "inactive"; note?: string },
  ) {
    return this.request<{
      student_id: number;
      status: "active" | "inactive";
      // null on the no-op branch (target status already equals current).
      // Backend StudentStatusUpdateResponse: history_id / changed_at are
      // Optional. Callers can treat a non-null history_id as confirmation
      // of a real write.
      history_id: number | null;
      changed_at: string | null;
    }>(`/api/teachers/students/${studentId}/status`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // ============ Program CRUD Methods ============
  async createProgram(data: {
    name: string;
    description?: string;
    level?: string;
    classroom_id?: number;
    estimated_hours?: number;
    is_template?: boolean;
    tags?: string[];
  }) {
    return this.request("/api/teachers/programs", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateProgram(
    programId: number,
    data: {
      name?: string;
      description?: string;
      level?: string;
      estimated_hours?: number;
      tags?: string[];
    },
  ) {
    return this.request(`/api/teachers/programs/${programId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteProgram(programId: number) {
    return this.request(`/api/teachers/programs/${programId}`, {
      method: "DELETE",
    });
  }

  async reorderPrograms(
    orderData: { id: number; order_index: number }[],
    organizationId?: string,
  ) {
    if (organizationId) {
      return this.request(
        `/api/programs/reorder?scope=organization&organization_id=${organizationId}`,
        {
          method: "PUT",
          body: JSON.stringify(orderData),
        },
      );
    }
    return this.request("/api/teachers/programs/reorder", {
      method: "PUT",
      body: JSON.stringify(orderData),
    });
  }

  async reorderLessons(
    programId: number,
    orderData: { id: number; order_index: number }[],
    organizationId?: string,
  ) {
    if (organizationId) {
      return this.request(
        `/api/programs/${programId}/lessons/reorder?scope=organization&organization_id=${organizationId}`,
        {
          method: "PUT",
          body: JSON.stringify(orderData),
        },
      );
    }
    return this.request(`/api/teachers/programs/${programId}/lessons/reorder`, {
      method: "PUT",
      body: JSON.stringify(orderData),
    });
  }

  async reorderContents(
    lessonId: number,
    orderData: { id: number; order_index: number }[],
    organizationId?: string,
  ) {
    if (organizationId) {
      return this.request(
        `/api/programs/lessons/${lessonId}/contents/reorder?scope=organization&organization_id=${organizationId}`,
        {
          method: "PUT",
          body: JSON.stringify(orderData),
        },
      );
    }
    return this.request(`/api/teachers/lessons/${lessonId}/contents/reorder`, {
      method: "PUT",
      body: JSON.stringify(orderData),
    });
  }

  // ============ Classroom Program Methods ============
  async copyProgramToClassroom(classroomId: number, programIds: number[]) {
    return this.request(
      `/api/teachers/classrooms/${classroomId}/programs/copy`,
      {
        method: "POST",
        body: JSON.stringify({ program_ids: programIds }),
      },
    );
  }

  async updateClassroomProgram(
    classroomId: number,
    programId: number,
    data: {
      name?: string;
      description?: string;
      level?: string;
      estimated_hours?: number;
    },
  ) {
    return this.request(
      `/api/teachers/classrooms/${classroomId}/programs/${programId}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
  }

  async deleteClassroomProgram(classroomId: number, programId: number) {
    return this.request(
      `/api/teachers/classrooms/${classroomId}/programs/${programId}`,
      {
        method: "DELETE",
      },
    );
  }

  // ============ Lesson Methods ============
  async createLesson(
    programId: number,
    data: {
      name: string;
      description?: string;
      order_index?: number;
      estimated_minutes?: number;
    },
  ) {
    return this.request(`/api/teachers/programs/${programId}/lessons`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateLesson(
    lessonId: number,
    data: {
      name?: string;
      description?: string;
      order_index?: number;
      estimated_minutes?: number;
    },
  ) {
    return this.request(`/api/teachers/lessons/${lessonId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteLesson(lessonId: number) {
    return this.request(`/api/teachers/lessons/${lessonId}`, {
      method: "DELETE",
    });
  }

  // Template lesson methods (for public version courses)
  async deleteTemplateLesson(lessonId: number) {
    return this.request(`/api/teachers/lessons/${lessonId}`, {
      method: "DELETE",
    });
  }

  // ============ Content Methods ============
  async getContentDetail(contentId: number): Promise<{
    id: number;
    title: string;
    items: Array<{
      id: number;
      text: string;
      translation?: string;
      definition?: string;
      audio_url?: string;
      has_student_progress?: boolean;
      // Issue #631 / #729: canonical shape is { text, image_url }; legacy
      // data may still be string[]. Both shapes flow through unchanged.
      distractors?: Array<string | { text: string; image_url?: string | null }>;
      item_metadata?: Record<string, unknown>;
      order_index?: number;
      content_id?: number;
      created_at?: string;
      updated_at?: string;
      // 統一翻譯欄位 (#366)
      vocabulary_translation?: string;
      vocabulary_translation_lang?: string;
      parts_of_speech?: string[];
      // 向後相容（ReadingAssessmentPanel 仍使用）
      english_definition?: string;
      selectedLanguage?: string;
      selectedWordLanguage?: string;
      part_of_speech?: string;
      // 例句相關
      example_sentence?: string;
      example_sentence_translation?: string;
      example_sentence_translation_lang?: string;
      image_url?: string;
    }>;
    audio_urls?: string[];
    type?: string;
    target_wpm?: number;
    target_accuracy?: number;
    time_limit_seconds?: number;
    order_index?: number;
    level?: string;
    tags?: string[];
  }> {
    return this.request(`/api/teachers/contents/${contentId}`, {
      method: "GET",
    });
  }

  async createContent(
    lessonId: number,
    data: {
      type: string;
      title: string;
      items: Array<{
        text: string;
        translation?: string;
      }>;
      target_wpm?: number;
      target_accuracy?: number;
    },
  ) {
    return this.request(`/api/teachers/lessons/${lessonId}/contents`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * Issue #587: Create content directly under a program (no lesson).
   * Calls unified endpoint that handles teacher/org/school permission internally.
   */
  async createProgramContent(
    programId: number,
    data: {
      type: string;
      title: string;
      order_index?: number;
    },
  ) {
    return this.request(`/api/programs/${programId}/contents`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * Issue #587: Reorder contents that live directly under a program.
   */
  async reorderProgramContents(
    programId: number,
    orderData: Array<{ id: number; order_index: number }>,
  ) {
    return this.request(`/api/programs/${programId}/contents/reorder`, {
      method: "PUT",
      body: JSON.stringify(orderData),
    });
  }

  async updateContent(
    contentId: number,
    data: {
      title?: string;
      items?: Array<{
        // #861: 既有題目帶上真實 DB id，後端據此原地更新而非全刪重建，
        // 學生作答紀錄才不會失聯（新題目不帶 id）。後端會把字串 id 轉成 int 比對，
        // 故型別放寬為 number | string 以相容 ContentItem.id。
        id?: number | string;
        text: string;
        translation?: string;
        definition?: string;
        audio_url?: string;
        // 統一翻譯欄位 (#366)
        vocabulary_translation?: string;
        vocabulary_translation_lang?: string;
        parts_of_speech?: string[];
        // 向後相容（ReadingAssessmentPanel 仍使用）
        english_definition?: string;
        selectedLanguage?: string;
        // 其他欄位
        options?: Array<unknown>;
        correct_answer?: unknown;
        question_type?: string;
        example_sentence?: string;
        example_sentence_translation?: string;
        example_sentence_translation_lang?: string;
        image_url?: string;
        // Issue #631 / #729: accept both legacy string[] and new object shape.
        distractors?: Array<
          string | { text: string; image_url?: string | null }
        >;
      }>;
      target_wpm?: number;
      target_accuracy?: number;
      time_limit_seconds?: number;
      order_index?: number;
    },
  ) {
    return this.request(`/api/teachers/contents/${contentId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteContent(contentId: number) {
    return this.request(`/api/teachers/contents/${contentId}`, {
      method: "DELETE",
    });
  }

  async copyContent(contentId: number, targetLessonId: number) {
    return this.request(`/api/teachers/contents/${contentId}/copy`, {
      method: "POST",
      body: JSON.stringify({ target_lesson_id: targetLessonId }),
    });
  }

  /**
   * Issue #587: Copy content directly under a program (no lesson).
   */
  async copyContentToProgram(contentId: number, targetProgramId: number) {
    return this.request(`/api/teachers/contents/${contentId}/copy`, {
      method: "POST",
      body: JSON.stringify({ target_program_id: targetProgramId }),
    });
  }

  // ============ Translation Methods ============
  async translateText(text: string, targetLang: string = "zh-TW") {
    return this.request("/api/teachers/translate", {
      method: "POST",
      body: JSON.stringify({ text, target_lang: targetLang }),
    });
  }

  // 翻譯並辨識詞性
  async translateWithPos(
    text: string,
    targetLang: string = "zh-TW",
  ): Promise<{
    original: string;
    translation: string;
    parts_of_speech: string[];
  }> {
    return this.request("/api/teachers/translate-with-pos", {
      method: "POST",
      body: JSON.stringify({ text, target_lang: targetLang }),
    });
  }

  async batchTranslate(texts: string[], targetLang: string = "zh-TW") {
    return this.request("/api/teachers/translate/batch", {
      method: "POST",
      body: JSON.stringify({ texts, target_lang: targetLang }),
    });
  }

  // 批次翻譯並辨識詞性
  async batchTranslateWithPos(
    texts: string[],
    targetLang: string = "zh-TW",
  ): Promise<{
    originals: string[];
    results: Array<{ translation: string; parts_of_speech: string[] }>;
  }> {
    return this.request("/api/teachers/translate-with-pos/batch", {
      method: "POST",
      body: JSON.stringify({ texts, target_lang: targetLang }),
    });
  }

  // AI 生成例句 + 同步 TTS（Issue #757：audio_url 在這裡一次拿到，
  // 寫入單字集後，派發時就不需要再補跑 TTS）
  async generateSentences(params: {
    words: string[];
    definitions?: string[];
    lesson_id?: number;
    level?: string;
    prompt?: string;
    translate_to?: string;
    parts_of_speech?: string[][];
    audio_settings?: { accent?: string; gender?: string; speed?: string };
  }): Promise<{
    sentences: Array<{
      sentence: string;
      translation?: string;
      word: string;
      audio_url?: string | null;
      cloze_answer?: string | null;
    }>;
  }> {
    return this.request("/api/teachers/generate-sentences", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  // ============ TTS Methods ============
  async generateTTS(
    text: string,
    voice?: string,
    rate?: string,
    volume?: string,
  ): Promise<{
    audio_url: string;
  }> {
    return this.request("/api/teachers/tts", {
      method: "POST",
      body: JSON.stringify({ text, voice, rate, volume }),
    });
  }

  async batchGenerateTTS(
    texts: string[],
    voice?: string,
    rate?: string,
    volume?: string,
  ) {
    return this.request("/api/teachers/tts/batch", {
      method: "POST",
      body: JSON.stringify({ texts, voice, rate, volume }),
    });
  }

  async getTTSVoices(language: string = "en") {
    return this.request(`/api/teachers/tts/voices?language=${language}`, {
      method: "GET",
    });
  }

  // ============ Student Management Methods ============
  async getAllStudents(params?: {
    mode?: string;
    school_id?: string;
    organization_id?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.mode) queryParams.append("mode", params.mode);
    if (params?.school_id) queryParams.append("school_id", params.school_id);
    if (params?.organization_id)
      queryParams.append("organization_id", params.organization_id);

    const query = queryParams.toString();
    const url = query
      ? `/api/teachers/students?${query}`
      : "/api/teachers/students";

    return this.request(url, {
      method: "GET",
    });
  }

  async batchImportStudentsForTeacher(
    students: Array<{
      name: string;
      classroom_name: string;
      birthdate: string | number;
    }>,
    duplicateAction: "skip" | "update" | "add_suffix" = "skip",
  ) {
    return this.request("/api/teachers/students/batch-import", {
      method: "POST",
      body: JSON.stringify({ students, duplicate_action: duplicateAction }),
    });
  }

  // ============ Audio Upload Methods ============
  async uploadAudio(
    audioBlob: Blob,
    duration: number,
    contentId?: number,
    itemIndex?: number,
  ) {
    const formData = new FormData();
    await appendAudioToFormData(formData, "file", audioBlob);
    formData.append("duration", duration.toString());

    // 加入 content_id 和 item_index 以便追蹤和替換舊檔案
    if (contentId) {
      formData.append("content_id", contentId.toString());
    }
    if (itemIndex !== undefined) {
      formData.append("item_index", itemIndex.toString());
    }

    const currentToken = this.getToken();
    const headers: HeadersInit = {};

    if (currentToken) {
      headers["Authorization"] = `Bearer ${currentToken}`;
    }

    const response = await fetch(`${this.baseUrl}/api/teachers/upload/audio`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (DEBUG) console.error("Upload error:", errorText);
      throw new Error(
        `Upload failed: ${response.status} - ${errorText || response.statusText}`,
      );
    }

    return response.json();
  }

  async uploadImage(formData: FormData) {
    const currentToken = this.getToken();
    const headers: HeadersInit = {};

    if (currentToken) {
      headers["Authorization"] = `Bearer ${currentToken}`;
    }

    const response = await fetch(`${this.baseUrl}/api/teachers/upload/image`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (DEBUG) console.error("Image upload error:", errorText);
      throw new Error(
        `Image upload failed: ${response.status} - ${errorText || response.statusText}`,
      );
    }

    return response.json();
  }

  // ============ Student Methods ============
  async getStudentProfile() {
    return this.request("/api/students/me");
  }

  async updateStudentProfile(data: { name?: string }) {
    return this.request("/api/students/me", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async updateStudentPassword(data: {
    current_password: string;
    new_password: string;
  }) {
    return this.request("/api/students/me/password", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // ============ Live Quiz (Issue #835) ============
  // assignmentId = Assignment.id（老師端）
  async openLiveQuiz(assignmentId: number) {
    return this.request<LiveQuizStatus>(
      `/api/teachers/assignments/${assignmentId}/quiz/open`,
      { method: "POST" },
    );
  }

  async closeLiveQuiz(assignmentId: number) {
    return this.request<LiveQuizStatus>(
      `/api/teachers/assignments/${assignmentId}/quiz/close`,
      { method: "POST" },
    );
  }

  async getLiveQuizProgress(assignmentId: number) {
    return this.request<LiveQuizProgress>(
      `/api/teachers/assignments/${assignmentId}/quiz/live-progress`,
    );
  }

  // studentAssignmentId = StudentAssignment.id（學生端，與其餘 quiz 端點一致）
  async getStudentQuizStatus(studentAssignmentId: number) {
    return this.request<StudentQuizStatus>(
      `/api/students/assignments/${studentAssignmentId}/quiz/status`,
    );
  }

  // ============ Assignment & Submission Methods ============
  async getSubmission(assignmentId: number, studentId: number) {
    return this.request(
      `/api/teachers/assignments/${assignmentId}/submissions/${studentId}`,
    );
  }

  async getAssignmentSubmissions(assignmentId: number) {
    return this.request(
      `/api/teachers/assignments/${assignmentId}/submissions`,
    );
  }

  async gradeSubmission(
    assignmentId: number,
    studentId: number,
    data: {
      score?: number;
      feedback?: string;
    },
  ) {
    return this.request(
      `/api/teachers/assignments/${assignmentId}/submissions/${studentId}/grade`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  }

  // AI 分析相關方法（包含重試機制）
  async analyzeWithRetry<T>(
    endpoint: string,
    data?: unknown,
    onRetry?: (attempt: number, error: Error) => void,
  ): Promise<T> {
    return retryAIAnalysis(
      () =>
        this.request<T>(endpoint, {
          method: "POST",
          body: data ? JSON.stringify(data) : undefined,
        }),
      onRetry,
    );
  }

  // ============ Organization Teacher Methods ============
  async getOrganizationTeachers(organizationId: string) {
    return this.request<
      Array<{
        id: number;
        email: string;
        name: string;
        role: string;
        is_active: boolean;
      }>
    >(`/api/organizations/${organizationId}/teachers`);
  }

  async inviteTeacherToOrganization(
    organizationId: string,
    data: { email: string; name: string; role: string },
  ) {
    return this.request<{ teacher_id: number }>(
      `/api/organizations/${organizationId}/teachers/invite`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  }

  async addTeacherToSchool(
    schoolId: string,
    data: { teacher_id: number; roles: string[] },
  ) {
    return this.request(`/api/schools/${schoolId}/teachers`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getSchoolTeachers(schoolId: string) {
    return this.request<
      Array<{
        id: number;
        email: string;
        name: string;
        roles: string[];
        is_active: boolean;
      }>
    >(`/api/schools/${schoolId}/teachers`);
  }

  // ============ Admin Organization Methods ============
  async listOrganizations(params?: {
    limit?: number;
    offset?: number;
    search?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.limit !== undefined)
      queryParams.append("limit", params.limit.toString());
    if (params?.offset !== undefined)
      queryParams.append("offset", params.offset.toString());
    if (params?.search) queryParams.append("search", params.search);

    const queryString = queryParams.toString();
    const url = `/api/admin/organizations${queryString ? `?${queryString}` : ""}`;
    return this.request(url, {
      method: "GET",
    });
  }

  async updateOrganization(
    orgId: string,
    data: {
      display_name?: string;
      description?: string;
      tax_id?: string;
      teacher_limit?: number;
      contact_email?: string;
      contact_phone?: string;
      address?: string;
      total_points?: number;
      per_student_price?: number | null;
    },
  ) {
    return this.request(`/api/admin/organizations/${orgId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // ===== Phase 5-2 (issue #768): institution monthly billing query =====
  async getOrganizationMonthlyBilling(
    orgId: string,
    year: number,
    month: number,
  ) {
    return this.request<{
      org_id: string;
      year: number;
      month: number;
      per_student_price: number;
      billable_student_count: number;
      total_amount: number;
      currency: string;
      students: Array<{
        student_id: number;
        name: string;
        billable: boolean;
      }>;
    }>(
      `/api/organizations/${orgId}/billing/monthly?year=${year}&month=${month}`,
      { method: "GET" },
    );
  }

  /**
   * Download the monthly 請款單 PDF (issue #838 Phase B). Returns the raw
   * Blob so the caller can trigger a browser download; the filename is taken
   * from the server's Content-Disposition when present.
   */
  async downloadOrganizationMonthlyInvoicePdf(
    orgId: string,
    year: number,
    month: number,
  ): Promise<{ blob: Blob; filename: string }> {
    const currentToken = this.getToken();
    const headers: Record<string, string> = {};
    if (currentToken) {
      headers["Authorization"] = `Bearer ${currentToken}`;
    }
    const response = await fetch(
      `${this.baseUrl}/api/organizations/${orgId}/billing/monthly.pdf?year=${year}&month=${month}`,
      { method: "GET", headers },
    );
    if (!response.ok) {
      let detail = `下載 PDF 失敗 (${response.status})`;
      try {
        const body = await response.json();
        if (body?.detail) detail = body.detail;
      } catch {
        // non-JSON error body; keep the default message
      }
      throw new ApiError(response.status, detail);
    }
    const blob = await response.blob();
    const cd = response.headers.get("content-disposition") || "";
    const match = cd.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : `invoice-${year}-${month}.pdf`;
    return { blob, filename };
  }

  // ===== Phase 5-2 (issue #768): group-buy plans listing =====
  async listGroupBuyPlans() {
    return this.request<
      Array<{
        name: string;
        teacher_seats: number;
        annual_fee: number;
        total_amount: number;
        topup_discount: number;
        monthly_quota: number;
        display_order: number;
      }>
    >("/api/credit-packages/group-buy-plans", { method: "GET" });
  }

  // ===== Phase 5-2 (issue #768): group-buy open =====
  async openGroupBuy(body: {
    prime: string;
    plan_name: string;
    cardholder?: { name?: string; email?: string; phone_number?: string };
    // issue #768 comment #3 roster flow: leader supplies all member emails
    // up-front. Length must equal plan.teacher_seats - 1; backend rejects
    // payment if any is not_registered / not_verified / in_group_buy_team.
    member_emails?: string[];
  }) {
    return this.request<{
      success: boolean;
      message: string;
      transaction_id?: string;
      organization_id?: string;
      school_id?: string;
      subscription_end_date?: string;
      teacher_seat_limit?: number;
      members_bound?: number;
    }>("/api/credit-packages/group-buy-open", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // ===== Phase 5-2 (issue #768 comment #3): roster email validation =====
  async validateTeamEmails(emails: string[], signal?: AbortSignal) {
    return this.request<{
      results: Array<{
        email: string;
        exists: boolean;
        verified: boolean;
        in_group_buy_team: boolean;
        // Backend contract — kept as a literal union so callers get a
        // compile error if a new status is added on either side and not
        // mirrored. Saves a runtime `as RowStatus` cast at the call site.
        status: "ok" | "not_registered" | "not_verified" | "in_group_buy_team";
      }>;
    }>("/api/credit-packages/validate-team-emails", {
      method: "POST",
      body: JSON.stringify({ emails }),
      signal,
    });
  }

  // ===== Personal promo code (issue #637) — needed for share-invite UX =====
  async getMyPersonalPromoCode() {
    // Backend `MyPromoCodeResponse.expires_at: Optional[str] = None`
    // serialises as `null` when the personal code is permanent. The
    // field is always present in the response — `string | null`, not
    // `?: string`. Drops the unreachable `undefined` from the type.
    return this.request<{
      code: string;
      expires_at: string | null;
      is_active: boolean;
      referral_count: number;
      verified_count: number;
      paid_count: number;
      total_points_awarded: number;
    }>("/api/teachers/me/promo-code", { method: "GET" });
  }

  // ============ Admin Plans Methods ============
  async listAdminPlans() {
    return this.request<
      Array<{
        id: number;
        name: string;
        price: number | null;
        quota: number | null;
        display_order: number;
        is_active: boolean;
        updated_at: string | null;
        updated_by_admin_id: number | null;
        // issue #768: group-buy economic levers. teacher_seats not-null
        // is the canonical group-buy signal; price is unused for those.
        teacher_seats: number | null;
        annual_fee: number | null; // PER teacher
        topup_discount: number | null;
      }>
    >("/api/admin/plans", { method: "GET" });
  }

  async updateAdminPlan(
    planName: string,
    data: {
      price?: number;
      quota?: number;
      is_active?: boolean;
      display_order?: number;
      // issue #768 group-buy levers; backend rejects these on individual plans
      annual_fee?: number;
      topup_discount?: number;
    },
  ) {
    return this.request<{
      id: number;
      name: string;
      price: number | null;
      quota: number | null;
      display_order: number;
      is_active: boolean;
      updated_at: string | null;
      updated_by_admin_id: number | null;
      teacher_seats: number | null;
      annual_fee: number | null;
      topup_discount: number | null;
    }>(`/api/admin/plans/${encodeURIComponent(planName)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // ============ Admin Credit Package Instance Methods ============
  async adminEditCreditPackage(
    packageId: number,
    data: {
      points_total?: number;
      expires_at?: string; // YYYY-MM-DD
      reason: string;
    },
  ) {
    return this.request<AdminCreditPackageResult>(
      `/api/admin/subscription/credit-package/${packageId}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
  }

  async adminCancelCreditPackage(packageId: number, data: { reason: string }) {
    return this.request<AdminCreditPackageResult>(
      `/api/admin/subscription/credit-package/${packageId}/cancel`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  }

  async getMyPromoCode() {
    return this.request<{
      code: string;
      expires_at: string | null;
      is_active: boolean;
      referral_count: number;
      verified_count: number;
      paid_count: number;
      total_points_awarded: number;
    }>("/api/teachers/me/promo-code", { method: "GET" });
  }

  async getSubscriptionStatus() {
    return this.request<{
      status: string;
      plan: string | null;
      days_remaining: number | null;
      is_active: boolean;
      quota_used: number;
      quota_total: number;
      quota_remaining: number;
      subscription_total?: number;
      subscription_used?: number;
      subscription_remaining?: number;
      credit_packages_total?: number;
      credit_packages_remaining?: number;
      credit_packages?: Array<{
        id: number;
        package_id: string;
        points_total: number;
        points_used: number;
        points_remaining: number;
        source: string;
        status: string;
        is_expired: boolean;
      }>;
    }>("/api/subscription/status", { method: "GET" });
  }

  // ============ Admin Promo Code Methods ============
  async listPromoCodes(params?: { teacher_id?: number; kind?: string }) {
    const qs = new URLSearchParams();
    if (params?.teacher_id !== undefined)
      qs.append("teacher_id", params.teacher_id.toString());
    if (params?.kind) qs.append("kind", params.kind);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.request<PromoCodeRow[]>(`/api/admin/promo-codes${suffix}`, {
      method: "GET",
    });
  }

  async createAffiliateCode(data: {
    teacher_id: number;
    expires_at?: string | null;
    note?: string;
  }) {
    return this.request<PromoCodeRow>("/api/admin/promo-codes", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updatePromoCode(
    codeId: number,
    data: { is_active?: boolean; expires_at?: string | null; note?: string },
  ) {
    return this.request<PromoCodeRow>(`/api/admin/promo-codes/${codeId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async listRewardConfigs() {
    return this.request<RewardConfigRow[]>(
      "/api/admin/promo-codes/reward-configs",
      { method: "GET" },
    );
  }

  async updateRewardConfig(
    rewardKey: string,
    data: { points?: number; is_active?: boolean },
  ) {
    return this.request<RewardConfigRow>(
      `/api/admin/promo-codes/reward-configs/${encodeURIComponent(rewardKey)}`,
      { method: "PATCH", body: JSON.stringify(data) },
    );
  }

  async getReferralReport() {
    return this.request<ReferralReportRow[]>("/api/admin/promo-codes/report", {
      method: "GET",
    });
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
