/**
 * Feature flags for temporarily enabling/disabling features.
 * Set to `true` to re-enable when ready.
 */
export const FEATURE_FLAGS = {
  /** 左側選單「作業管理」 */
  ASSIGNMENTS: false,
  /** 1Campus SSO 登入按鈕 */
  ONE_CAMPUS_LOGIN: false,
} as const;
