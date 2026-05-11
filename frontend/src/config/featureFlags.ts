/**
 * Feature flags for temporarily enabling/disabling features.
 * Set to `true` to re-enable when ready.
 */
export const FEATURE_FLAGS = {
  /** 左側選單「作業管理」 */
  ASSIGNMENTS: true,
  /** 1Campus SSO 登入按鈕 */
  ONE_CAMPUS_LOGIN: true,
  /** 出作業時的「單字拼寫 / 克漏字」作答模式選項（Issue #641 / #262）。Issue #732: prod 上線前暫時隱藏 */
  WORD_SPELLING_CLOZE: false,
  /** 出作業進階設定的「顯示選項圖片」toggle（Issue #631）。Issue #732: prod 上線前暫時隱藏 */
  SHOW_OPTION_IMAGES: false,
} as const;
