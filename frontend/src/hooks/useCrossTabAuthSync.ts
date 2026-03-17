import { useEffect } from "react";

/**
 * 跨 Tab 登入狀態同步
 * 當其他 Tab 的登入/登出狀態改變時，自動跳轉首頁
 * 只比較 isAuthenticated 欄位，避免 profile 更新、角色切換等無關變更觸發重導向
 * Issue #472
 *
 * 使用 window.location.href（hard navigation）而非 useNavigate，
 * 因為需要完整重載頁面以清除所有 in-memory 狀態（Zustand store、React state），
 * 確保切換身分後不會殘留舊的 auth token 或權限資料。
 */
export function useCrossTabAuthSync() {
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (
        e.key !== "teacher-auth-storage" &&
        e.key !== "student-auth-storage"
      ) {
        return;
      }

      const prev = e.oldValue ? JSON.parse(e.oldValue) : null;
      const next = e.newValue ? JSON.parse(e.newValue) : null;
      const wasAuthenticated = prev?.state?.isAuthenticated;
      const isAuthenticated = next?.state?.isAuthenticated;

      if (wasAuthenticated !== isAuthenticated) {
        window.location.href = "/";
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);
}
