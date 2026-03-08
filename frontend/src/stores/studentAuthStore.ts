import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useTeacherAuthStore } from "./teacherAuthStore";

export interface ClassroomInfo {
  id: number;
  name: string;
  teacher_name?: string | null;
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
  classroom_name?: string;
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
