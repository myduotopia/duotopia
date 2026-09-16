/**
 * Feature flags for temporarily enabling/disabling features.
 * Set to `true` to re-enable when ready.
 */
export const FEATURE_FLAGS = {
  /** 左側選單「作業管理」 */
  ASSIGNMENTS: true,
  /** 1Campus SSO 登入按鈕 */
  ONE_CAMPUS_LOGIN: true,
  /** 老師端 Google 登入按鈕（#740） */
  GOOGLE_LOGIN: true,
} as const;

/**
 * Issue #768 — group-buy (團購) entry points across the app.
 *
 * Build-time gate read from `VITE_ENABLE_GROUP_BUY` so each environment's
 * bundle ships with its own constant (Vite inlines `import.meta.env.VITE_*`
 * at build). Production deploy sets this to "false" so a staging→main
 * release can carry the rest of staging without exposing the not-yet-
 * ready group-buy feature; staging / develop / local default to "true".
 *
 * Any value other than the literal string "false" is treated as enabled
 * — safer than the inverse: a typo or unset env in CI hides the feature
 * for that env, not the other way around.
 *
 * Backend endpoints (`/api/credit-packages/group-buy-*`, the public
 * plans listing, monthly billing) are intentionally NOT gated; without
 * any UI entry, no production user can reach them, and an internal
 * admin can still hit the URL directly to verify before re-enabling.
 * Flipping this flag on production is a single deploy-frontend.yml
 * change — no code re-PR required.
 */
export const ENABLE_GROUP_BUY =
  (
    import.meta.env.VITE_ENABLE_GROUP_BUY as string | undefined
  )?.toLowerCase() !== "false";

/**
 * Issue #1039 — 情境對話（#1013～#1035 整條功能線）的前端入口。
 *
 * 與 `ENABLE_GROUP_BUY` 同一個機制、同一個理由：PR #1038 把這條功能線發到 main 並
 * 成功部署，但人工驗證還沒做完。用 build-time 開關把 prod 的入口關掉，就不必 revert
 * 整條發版線（revert 一個 merge commit 之後，那些 commit 日後不會自己回來），
 * 而 staging / develop 仍然開著，驗證才做得下去。
 *
 * ## 與 ENABLE_GROUP_BUY 相反：未設定時視為**關閉**
 *
 * 那一個是「不是字串 false 就當開啟」；這一個是「必須是字串 true 才開啟」。
 * 差別是刻意的 —— 這個開關要防的正是「未驗證的功能出現在 production」，所以漏設、
 * 拼錯、新環境忘了帶，都應該落到**隱藏**這一邊。本機開發請照 `.env.example` 設成 true。
 *
 * 關閉時：
 * * `ContentTypeDialog` 的情境對話卡片反灰、點不動，右上角 Soon 角標
 *
 * **派發不歸這個開關管**（Issue #1052）：能不能派發統一由 `lib/practiceMode.ts` 的
 * `DATASET_DISPATCH_STATUS` 決定，情境對話目前 `in_development`，所有環境都不可派發。
 * 原本這裡也接 `isAssignableContentType()`，但派發 chip 列沒接，兩邊漂移。
 *
 * **既有內容的編輯與批改不擋**，後端也不擋：功能在 prod 上活過約一小時，若那期間
 * 有老師建了教材，要讓它還讀得到、改得動，不要變成孤兒資料。
 *
 * prod 要打開時改 `deploy-frontend.yml` 的 feature flag 區塊即可。
 */
export const ENABLE_SCENARIO_DIALOGUE =
  (
    import.meta.env.VITE_ENABLE_SCENARIO_DIALOGUE as string | undefined
  )?.toLowerCase() === "true";
