/**
 * WorkspaceContext - Teacher workspace state management
 *
 * Manages teacher's workspace mode (personal vs organization)
 * and selected organization/school context.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

// ============================================
// Types
// ============================================

export interface School {
  id: string;
  name: string;
  roles?: string[] | null;
}

export interface Organization {
  id: string;
  name: string;
  role: string;
  schools: School[];
}

export type WorkspaceMode = "personal" | "organization";

export interface WorkspaceContextState {
  mode: WorkspaceMode;
  organizations: Organization[];
  selectedOrganization: Organization | null;
  selectedSchool: School | null;
  loading: boolean;
  error: string | null;

  // Actions
  setMode: (mode: WorkspaceMode) => void;
  selectSchool: (school: School, organization: Organization) => void;
  clearSelection: () => void;
  fetchOrganizations: () => Promise<void>;
}

// ============================================
// Context
// ============================================

const WorkspaceContext = createContext<WorkspaceContextState | undefined>(
  undefined,
);

// ============================================
// localStorage keys
// ============================================

const STORAGE_KEYS = {
  MODE: "workspace:mode",
  ORGANIZATION: "workspace:organization",
  SCHOOL: "workspace:school",
} as const;

// ============================================
// Provider
// ============================================

interface WorkspaceProviderProps {
  children: ReactNode;
  teacherId: number;
}

export const WorkspaceProvider: React.FC<WorkspaceProviderProps> = ({
  children,
  teacherId,
}) => {
  // Get token from auth store
  const token = useTeacherAuthStore((state) => state.token);

  const [mode, setModeState] = useState<WorkspaceMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.MODE);
    return (
      saved === "organization" ? "organization" : "personal"
    ) as WorkspaceMode;
  });

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrganization, setSelectedOrganization] =
    useState<Organization | null>(() => {
      const saved = localStorage.getItem(STORAGE_KEYS.ORGANIZATION);
      try {
        return saved ? JSON.parse(saved) : null;
      } catch {
        return null;
      }
    });

  const [selectedSchool, setSelectedSchool] = useState<School | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SCHOOL);
    try {
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch organizations from API
  const fetchOrganizations = useCallback(async () => {
    if (!token) {
      console.warn("No token available, skipping organization fetch");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || "";

      const response = await fetch(
        `${apiUrl}/api/teachers/${teacherId}/organizations`,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch organizations: ${response.statusText}`,
        );
      }

      const data = await response.json();
      setOrganizations(data.organizations || []);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch organizations";
      setError(message);
      console.error("Error fetching organizations:", err);
    } finally {
      setLoading(false);
    }
  }, [token, teacherId]);

  // Load organizations on mount and when token/teacherId changes
  useEffect(() => {
    if (teacherId && token) {
      fetchOrganizations();
    }
  }, [teacherId, token, fetchOrganizations]);

  // Persist mode to localStorage
  const setMode = (newMode: WorkspaceMode) => {
    setModeState(newMode);
    localStorage.setItem(STORAGE_KEYS.MODE, newMode);

    // Clear selection when switching to personal mode
    if (newMode === "personal") {
      clearSelection();
    }
  };

  // Select school and organization
  const selectSchool = (school: School, organization: Organization) => {
    setSelectedOrganization(organization);
    setSelectedSchool(school);

    // Persist to localStorage
    localStorage.setItem(
      STORAGE_KEYS.ORGANIZATION,
      JSON.stringify(organization),
    );
    localStorage.setItem(STORAGE_KEYS.SCHOOL, JSON.stringify(school));

    // Auto-switch to organization mode if not already
    if (mode !== "organization") {
      setMode("organization");
    }
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedOrganization(null);
    setSelectedSchool(null);
    localStorage.removeItem(STORAGE_KEYS.ORGANIZATION);
    localStorage.removeItem(STORAGE_KEYS.SCHOOL);
  };

  const value: WorkspaceContextState = {
    mode,
    organizations,
    selectedOrganization,
    selectedSchool,
    loading,
    error,
    setMode,
    selectSchool,
    clearSelection,
    fetchOrganizations,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
};

// ============================================
// Hook
// ============================================

export const useWorkspace = (): WorkspaceContextState => {
  const context = useContext(WorkspaceContext);

  if (context === undefined) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }

  return context;
};

/**
 * Safe version of useWorkspace that returns null when used outside WorkspaceProvider.
 * Useful for shared components that may render in both teacher and organization contexts.
 */
export const useWorkspaceSafe = (): WorkspaceContextState | null => {
  const context = useContext(WorkspaceContext);
  return context === undefined ? null : context;
};
