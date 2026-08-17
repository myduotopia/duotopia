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
