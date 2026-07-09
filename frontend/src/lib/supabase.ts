/**
 * Supabase client singleton — 目前僅用於 Live Quiz Realtime 收卷推播（#835 / PR #881 點 1）。
 *
 * Duotopia 主要走自訂 JWT REST（apiClient），不依賴 Supabase Auth。此 client 只訂閱
 * Realtime *Broadcast* 頻道（ephemeral pub/sub，不碰 RLS / postgres_changes），用 anon key 即可。
 *
 * 環境變數（需在各環境 build 時注入；缺任一則 isRealtimeEnabled=false，自動退回 polling）：
 *   - VITE_SUPABASE_URL
 *   - VITE_SUPABASE_ANON_KEY
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Realtime 是否可用（環境變數齊全才為 true）。 */
export const isRealtimeEnabled = Boolean(url && anonKey);

/**
 * 單例 client。未設定環境變數時為 null，呼叫端須據 isRealtimeEnabled 判斷後再使用。
 * 關閉 auth 持久化/自動刷新：我們不用 Supabase Auth，避免它動 localStorage。
 */
export const supabase: SupabaseClient | null = isRealtimeEnabled
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;
