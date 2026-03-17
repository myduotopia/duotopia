import { useEffect } from "react";

/**
 * 跨 Tab 登入狀態同步
 * 當其他 Tab 修改 auth localStorage 時，自動跳轉首頁
 * Issue #472
 */
export function useCrossTabAuthSync() {
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === "teacher-auth-storage" ||
        e.key === "student-auth-storage"
      ) {
        window.location.href = "/";
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);
}
