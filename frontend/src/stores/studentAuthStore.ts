import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useTeacherAuthStore } from "./teacherAuthStore";

export interface ClassroomInfo {
  id: number;
  /** 原始班級名稱；畫面顯示用 formatClassroomDisplayName 組合年級（#1097） */
  name: string;
  /** 年級 1–12；null = 未設定（#1097） */
  grade?: number | null;
  teacher_name?: string | null;
  student_id?: number;
  school_id?: string;
  school_name?: string;
  organization_id?: string;
  organization_name?: string;
}

export interface StudentUser {
  id: number;
  name: string;
  email: string;
  student_number: string;
  classroom_id: number;
  /** 原始班級名稱（不存組合後的字串，切換語言時才能重算）；顯示用 formatClassroomDisplayName */
  classroom_name?: string;
  /** 目前班級年級 1–12；null = 未設定（#1097） */
  classroom_grade?: number | null;
  teacher_name?: string;
  school_id?: string;
  school_name?: string;
  organization_id?: string;
  organization_name?: string;
  has_linked_accounts?: boolean;
  linked_accounts_count?: number;
  classrooms?: ClassroomInfo[];
  classrooms_count?: number;
}

interface StudentAuthState {
  token: string | null;
  user: StudentUser | null;
  isAuthenticated: boolean;
  login: (token: string, user: StudentUser) => void;
  logout: () => void;
  updateUser: (user: Partial<StudentUser>) => void;
  switchClassroom: (classroom: ClassroomInfo) => void;
}

export const useStudentAuthStore = create<StudentAuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,

      login: (token: string, user: StudentUser) => {
        // Clear teacher auth to prevent token conflicts (#310)
        useTeacherAuthStore.getState().logout();
        set({
          token,
          user,
          isAuthenticated: true,
        });
      },

      logout: () => {
        set({
          token: null,
          user: null,
          isAuthenticated: false,
        });
      },

      updateUser: (updates: Partial<StudentUser>) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        }));
      },

      switchClassroom: (classroom: ClassroomInfo) => {
        set((state) => ({
          user: state.user
            ? {
                ...state.user,
                classroom_id: classroom.id,
                classroom_name: classroom.name,
                classroom_grade: classroom.grade ?? null,
                teacher_name: classroom.teacher_name || undefined,
                school_id: classroom.school_id,
                school_name: classroom.school_name,
                organization_id: classroom.organization_id,
                organization_name: classroom.organization_name,
              }
            : null,
        }));
      },
    }),
    {
      name: "student-auth-storage",
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
