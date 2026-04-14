import { createContext, useContext, useState, ReactNode } from "react";

interface SidebarContextType {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarWidth: number;
  sidebarDisabled: boolean;
  setSidebarDisabled: (disabled: boolean) => void;
  editorBusy: boolean;
  setEditorBusy: (busy: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarDisabled, setSidebarDisabled] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const sidebarWidth = sidebarCollapsed ? 64 : 256;

  return (
    <SidebarContext.Provider
      value={{
        sidebarCollapsed,
        setSidebarCollapsed,
        sidebarWidth,
        sidebarDisabled,
        setSidebarDisabled,
        editorBusy,
        setEditorBusy,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}
