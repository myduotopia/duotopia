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

interface StudentEmailLoginResponse {
  access_token: string;
  token_type: string;
  student: {
    id: number;
    name: string;
    email: string;
    student_number: string;
    classroom_id: number | null;
    classroom_name: string | null;
    school_id: string | null;
    school_name: string | null;
    organization_id: string | null;
    organization_name: string | null;
    has_linked_accounts: boolean;
    linked_accounts_count: number;
    classrooms: Array<{
      id: number;
      name: string;
      teacher_name: string | null;
      student_id: number;
      school_id?: string;
      school_name?: string;
      organization_id?: string;
      organization_name?: string;
    }>;
    classrooms_count: number;
  };
}

interface SwitchClassroomResponse {
  access_token: string;
  token_type: string;
  student: StudentEmailLoginResponse["student"];
}

export const authService = {
  async studentLogin(
    credentials: StudentLoginCredentials,
  ): Promise<LoginResponse> {
    const response = await api.post("/api/auth/student/login", credentials);
    return response.data;
  },

  async studentEmailLogin(
    email: string,
    password: string,
  ): Promise<StudentEmailLoginResponse> {
    const response = await api.post("/api/students/validate", {
      email,
      password,
    });
    return response.data;
  },

  async switchClassroom(
    targetStudentId: number,
  ): Promise<SwitchClassroomResponse> {
    const response = await api.post("/api/students/switch-classroom", {
      target_student_id: targetStudentId,
    });
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
