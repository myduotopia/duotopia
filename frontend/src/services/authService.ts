import api from "./api";

interface LoginCredentials {
  email: string;
  password: string;
}

interface StudentLoginCredentials {
  id: number;
  password: string;
}

interface LoginResponse {
  access_token: string;
  token_type: string;
  user: {
    id: number;
    name: string;
    email: string;
    [key: string]: unknown;
  };
}

export interface LinkedAccount {
  student_id: number;
  name: string;
  student_number: string | null;
  is_primary_account: boolean | null;
  classroom: {
    id: number;
    name: string;
    teacher_name: string | null;
  } | null;
  school: {
    id: string;
    name: string;
  } | null;
  organization: {
    id: string;
    name: string;
  } | null;
  last_login: string | null;
}

interface LinkedAccountsResponse {
  linked_accounts: LinkedAccount[];
  current_email: string;
  identity_id: number | null;
}

interface SwitchAccountResponse {
  access_token: string;
  token_type: string;
  student: LinkedAccount;
  message: string;
}

export const authService = {
  async studentLogin(
    credentials: StudentLoginCredentials,
  ): Promise<LoginResponse> {
    const response = await api.post("/api/auth/student/login", credentials);
    return response.data;
  },

  async teacherLogin(credentials: LoginCredentials): Promise<LoginResponse> {
    const response = await api.post("/api/auth/teacher/login", credentials);
    return response.data;
  },

  async validateToken(): Promise<unknown> {
    const response = await api.get("/api/auth/validate");
    return response.data;
  },

  async logout(): Promise<void> {
    // Clear local storage
    localStorage.removeItem("auth-storage");
    localStorage.removeItem("student-auth-storage");
  },

  async getLinkedAccounts(studentId: number): Promise<LinkedAccountsResponse> {
    const response = await api.get(
      `/api/students/${studentId}/linked-accounts`,
    );
    return response.data;
  },

  async switchAccount(targetStudentId: number): Promise<SwitchAccountResponse> {
    const response = await api.post("/api/students/switch-account", {
      target_student_id: targetStudentId,
    });
    return response.data;
  },
};
