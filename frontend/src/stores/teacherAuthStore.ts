import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useStudentAuthStore } from "./studentAuthStore";

export interface TeacherUser {
  id: number;
  name: string;
  email: string;
  role?: string;
  organization_id?: string | null;
  school_id?: string | null;
  is_demo?: boolean;
  is_admin?: boolean;
  phone?: string;
}

interface TeacherAuthState {
  token: string | null;
  user: TeacherUser | null;
  isAuthenticated: boolean;
  userRoles: string[];
  rolesLoading: boolean;
  login: (token: string, user: TeacherUser) => void;
  logout: () => void;
  updateUser: (user: Partial<TeacherUser>) => void;
  setUserRoles: (roles: string[]) => void;
  setRolesLoading: (loading: boolean) => void;
}

export const useTeacherAuthStore = create<TeacherAuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      userRoles: [],
      rolesLoading: false,

      login: (token: string, user: TeacherUser) => {
        // Clear student auth to prevent token conflicts (#310)
        useStudentAuthStore.getState().logout();
        set({
          token,
          user,
          isAuthenticated: true,
          userRoles: [],
          rolesLoading: false,
        });
      },

      logout: () => {
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          userRoles: [],
          rolesLoading: false,
        });
      },

      updateUser: (updates: Partial<TeacherUser>) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        }));
      },

      setUserRoles: (roles: string[]) => {
        set({ userRoles: roles });
      },

      setRolesLoading: (loading: boolean) => {
        set({ rolesLoading: loading });
      },
    }),
    {
      name: "teacher-auth-storage",
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        userRoles: state.userRoles,
        rolesLoading: state.rolesLoading,
      }),
    },
  ),
);
