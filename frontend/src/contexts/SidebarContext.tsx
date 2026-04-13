import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface SidebarContextType {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarWidth: number;
  /** Panel left offset: 0 on mobile (< 640px), sidebarWidth on desktop */
  panelLeft: number;
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
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 640,
  );
  const sidebarWidth = sidebarCollapsed ? 64 : 256;
  const panelLeft = isMobile ? 0 : sidebarWidth;

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <SidebarContext.Provider
      value={{
        sidebarCollapsed,
        setSidebarCollapsed,
        sidebarWidth,
        panelLeft,
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
