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
  /**
   * 情境對話逐題「AI 生成圖片」（#1024 做的 Imagen 生圖）。
   *
   * #1044 先關掉：實測發現生圖品質與流程還要調整，團隊決定先把「出內容 → 出作業 →
   * 學生作答」整條主線做完整，之後再回頭修這一塊。
   *
   * **只關前端入口**：後端端點與月配額（scenario_image_usage）不動，已經生成的圖片
   * 仍然顯示得出來、換得掉、刪得掉 —— 既有資料不能因為關掉入口就變成孤兒。
   * 手動上傳圖片也完全不受影響，那是這段期間的主要途徑。
   *
   * 要開回來就把這裡改成 true（生圖的程式碼路徑完整保留著，沒有被刪）。
   */
  SCENARIO_IMAGE_GENERATION: false,
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
 * **2026-10-31 起所有環境（含 production）一律開啟** —— 驗證完成。開關本身保留：
 * 情境對話出狀況時還能用一行 workflow 改動緊急收掉入口，不必 revert 程式。
 * 怎麼關回去寫在 `deploy-frontend.yml` 的 feature flag 區塊註解裡。
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

/**
 * Issue #1052 後續 —— 情境對話**派發**的開關。
 *
 * 與 `ENABLE_SCENARIO_DIALOGUE`（建立教材入口）刻意分開：#1052 的註解寫明「這只管
 * 派發」，兩者本來就可能在不同時間開放 —— 事實上我們曾經處在「建得了、派不了」
 * 的狀態。合成一個會失去那個自由度。
 *
 * 與 `ENABLE_SCENARIO_DIALOGUE` 同樣由 `deploy-frontend.yml` 依分支給值。
 * 「派發 → 學生作答 → 批改」整條線已驗證完成，**2026-10-31 起所有環境（含
 * production）一律開啟**；開關保留，出狀況時仍可用一行 workflow 改動收掉派發。
 *
 * **未設定時視為關閉**（必須是字串 `true` 才開）—— 漏設、拼錯、新環境忘了帶都落到
 * 隱藏那一邊。要防的正是「未驗證的功能出現在 production」。
 */
export const ENABLE_SCENARIO_DIALOGUE_DISPATCH =
  (
    import.meta.env.VITE_ENABLE_SCENARIO_DIALOGUE_DISPATCH as string | undefined
  )?.toLowerCase() === "true";

/**
 * Issue #1112 —— 題庫「上傳題本」（擷取引擎＋上傳畫面）的前端入口。
 *
 * 與 `ENABLE_SCENARIO_DIALOGUE` 同一個機制、同一個理由：功能已經進 staging，但
 * 人工驗證還沒做完，而這一版 staging→main 的發版要帶上其他東西。用 build-time
 * 開關把 production 的入口關掉，就不必為了等驗證而擋住整條發版線。
 *
 * **未設定時視為關閉**（必須是字串 `true` 才開）—— 漏設、拼錯、新環境忘了帶都落到
 * 隱藏那一邊。要防的正是「未驗證的功能出現在 production」。
 *
 * 關閉時（`TeacherTemplatePrograms` 不把 `examImport` 傳給 `QuestionBankTab`）：
 * * 「新增題目 ▽ → 上傳題本」反灰，小字說明「即將推出」
 * * 未完成匯入提示列（`ExamImportBanner`）不顯示
 * * 上傳／進度 Sheet（`ExamImportSheet`）不掛載
 * * `useExamImport(false)` 不去打 `GET /api/question-bank/exam-imports`
 *
 * **後端不擋**，與 `ENABLE_GROUP_BUY` 同一個判斷：沒有任何 UI 入口，prod 使用者
 * 到不了；內部要先驗證時還能直接打 URL。另一個理由是萬一 prod 上已經有人跑過
 * 匯入，資料要讀得到、改得動，不要變成孤兒。
 *
 * prod 要打開時改 `deploy-frontend.yml` 的 feature flag 區塊即可，不用再發一次 PR。
 */
export const ENABLE_QUESTION_BANK_EXAM_IMPORT =
  (
    import.meta.env.VITE_ENABLE_QUESTION_BANK_EXAM_IMPORT as string | undefined
  )?.toLowerCase() === "true";
