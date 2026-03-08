import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useTeacherAuthStore } from "./teacherAuthStore";

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
}

interface StudentAuthState {
  token: string | null;
  user: StudentUser | null;
  isAuthenticated: boolean;
  login: (token: string, user: StudentUser) => void;
  logout: () => void;
  updateUser: (user: Partial<StudentUser>) => void;
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
