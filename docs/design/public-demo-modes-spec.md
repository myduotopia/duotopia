# Spec：補齊六種模式的公開 Demo 頁

> 狀態：規劃（spec，待開 issue 後實作）
> 關聯：#854 / #878（五畫面一致性）；本 spec 補齊「畫面 5 公開 demo」在六個模式的缺口。

## 目的

公開 demo（`/demo/:id`，免登入）讓**老師/學生不用註冊就能直接試用**某個練習模式，是行銷與教學導入的關鍵入口。目前只有 4 類模式有公開 demo，以下 **6 個模式缺 demo**，需補齊：

- `word_selection_quiz` 單字選擇·小考
- `word_spelling` 單字拼寫
- `word_spelling_quiz` 單字拼寫·小考
- `word_cloze` 單字克漏字
- `word_cloze_quiz` 單字克漏字·小考
- `tug_of_war` 拔河

> demo 數量很少（每模式 1 份）、不會造成系統負擔，但對試用體驗非常必要。

## 現況機制（實作前必讀）

- **路由**：`/demo/:assignmentId` → `frontend/src/pages/DemoAssignmentPage.tsx`，抓 `GET /api/demo/assignments/{id}/preview`，再把 `practice_mode` + 設定丟給共用元件 `StudentActivityPageContent`（`isDemoMode=true` 且 `isPreviewMode=true`）。
- **資料來源**：`demo_config` 資料表（key→value，`backend/models/demo_config.py`）。`GET /api/demo/config` 直接回整張表。首頁 `frontend/src/pages/Home.tsx` 用它渲染 demo 卡片；`ReadingPreview.tsx`/`RearrangementPreview.tsx`（派發對話框預覽）也會讀它。
- **歸屬驗證**：`get_demo_assignment()`（`backend/routers/demo.py:73`）要求該 assignment 屬於 `contact@duotopia.co`（join Classroom→Teacher）且 `is_active`。**demo 作業必須是掛在該帳號某班級下的真實派發作業。**
- **既有 seeding 模式**：新 `demo_config` **key** 走 **idempotent alembic migration** 新增（先例：`backend/alembic/versions/20260205_1800_split_word_selection_demo_modes.py`，`INSERT ... ON CONFLICT (key) DO NOTHING`，value 先給 `NULL` + `description`）；表本身由 `20260201_0307_add_demo_config_table.py` 建立。**value（assignment id）不進 migration**，因各環境 id 不同，改由每環境建好 demo 作業後再填。`demo_config` 欄位為 `(key, value, description)`。

## 工作分層（關鍵：兩種模式代價差很多）

### Tier A — 只需建資料，**零程式碼**：`word_spelling`、`word_cloze`、`tug_of_war`

前端與後端的 demo 路徑**都已存在**：
- 後端 start endpoint 已有：`word-spelling-start`、`word-cloze-start`（`backend/routers/demo.py:348/363`）；`tug_of_war` 復用 `word-selection-start`。
- 前端元件已內建 `isDemoMode` 分支直接打上述 demo endpoint：`WordSpellingActivity.tsx:252`、`WordClozeActivity.tsx:246`、`TugOfWarGame.tsx:159`（拔河計分全在前端 `tug-of-war/useGameLogic.ts`，作答/提交在 demo 下短路，不需後端 answer endpoint）。

→ Tier A 只要：**(1) 建 demo 作業 (2) 插入 `demo_config` 列 (3) 首頁加卡片**。

> ⚠ **tug_of_war 的建立特例**：拔河不經 AssignmentDialog 派發（無 chip），只走即刻練習；而即刻練習作業多為個人、無班級，會被 `get_demo_assignment` 的 Classroom join 濾掉。實作時需確認建立路徑：把一份 tug_of_war 作業掛到 `contact@duotopia.co` 的 demo 班級下（可能需手動 DB 建立或擴充派發允許 tug_of_war）。此為本 spec 最大未知數，實作時先驗證這條。

### Tier B — 需前後端程式碼：`word_selection_quiz`、`word_spelling_quiz`、`word_cloze_quiz`

問題根因：`DemoAssignmentPage` 同時傳 `isPreviewMode=true` 與 `isDemoMode=true`；`StudentActivityPageContent.tsx`（L1937–2021）對 quiz 模式**先判 `if (isPreviewMode)`** → 渲染老師端預覽包裝 `*QuizPreview`，那些包裝去打 `GET /api/teachers/assignments/{id}/preview/*-quiz-start`（需登入）→ 公開訪客 **401**。

需要三處改動：
1. **後端**：新增 3 個免登入 demo quiz-start endpoint（薄包裝，經 `get_demo_assignment` 驗證、鏡射老師端 preview 版邏輯）：
   - `GET /api/demo/assignments/{id}/preview/selection-quiz-start`
   - `GET /api/demo/assignments/{id}/preview/spelling-quiz-start`
   - `GET /api/demo/assignments/{id}/preview/cloze-quiz-start`
   - （answer/complete 在前端 demo 下已短路，**不需**新增提交 endpoint。）
2. **前端路由分流**：`StudentActivityPageContent.tsx` 的 quiz 分支把 `if (isPreviewMode)` 改為 `if (isPreviewMode && !isDemoMode)`（或等效），讓 demo 訪客走 `*QuizActivity` 而非 `*QuizPreview`。
3. **前端 start 分支**：`WordSelectionQuizActivity.tsx:166`、`WordSpellingQuizActivity.tsx:198`、`WordClozeQuizActivity.tsx:203` 的 `start` 加 `isDemoMode` 分支改打上述 demo endpoint（現況它們只會打 `/api/students/...`）。
   - `liveQuizActive` 在 demo 下已為 false（`StudentActivityPageContent.tsx:358`），demo 用非 live quiz 即可，無需處理老師開關題。

## 資料設定（每環境都要做：staging + production）

1. 以 `contact@duotopia.co` 登入，在其下建立/沿用一個「Demo 班級」。
2. 針對 6 個模式各派發 **1 份** demo 作業，挑能凸顯該模式的教材與設定：
   - spelling/cloze 建議一份「關聲音（顯示翻譯）」凸顯拼寫/克漏字書寫；quiz 用**非 live**。
   - tug_of_war 見上方特例。
3. `demo_config` 分兩步（照 `20260205_1800` 先例）：
   - **(a) migration 建 key**（value=NULL）：新增一支 idempotent migration，`INSERT ... ON CONFLICT (key) DO NOTHING` 建下列 6 個 key + description。此步進 repo、跨環境跑。
     - `demo_word_selection_quiz_assignment_id`
     - `demo_word_spelling_assignment_id`
     - `demo_word_spelling_quiz_assignment_id`
     - `demo_word_cloze_assignment_id`
     - `demo_word_cloze_quiz_assignment_id`
     - `demo_tug_of_war_assignment_id`
   - **(b) 每環境填 value**：在該環境建好 demo 作業後，`UPDATE demo_config SET value='<id>' WHERE key='...'`（id 各環境不同，不進 migration）。

## 首頁露出（`frontend/src/pages/Home.tsx`）

- `DemoConfig` interface（L32）補 6 個 key；`DemoType` union（L29）與 `assignmentIdMap`（L76）補對應項；demo 卡片區塊加 6 張卡（含 zh/en i18n 文案）。
- 缺對應 `demo_config` 值的卡片要自動隱藏（沿用現有「值不存在就不顯示」邏輯），避免某環境未設定就壞頁。

## 關鍵檔案

- 後端：`backend/routers/demo.py`（新增 3 quiz-start）、`backend/models/demo_config.py`、老師端對照：`backend/services/preview_service.py`（quiz-start 既有邏輯來源）、新 migration（照 `backend/alembic/versions/20260205_1800_split_word_selection_demo_modes.py` 先例）
- 前端：`StudentActivityPageContent.tsx`、`WordSelectionQuizActivity.tsx` / `WordSpellingQuizActivity.tsx` / `WordClozeQuizActivity.tsx`、`Home.tsx`、`lib/demoApi.ts`（quiz 若走 demoApi 則補方法，否則沿用元件內直打）
- 已就緒（Tier A 免改）：`WordSpellingActivity.tsx`、`WordClozeActivity.tsx`、`TugOfWarGame.tsx`

## 驗收：AI Agent 可協助的測試清單

> 沿用 #878 QA 的 Playwright harness（headless、免登入直接測 `/demo/:id`；老師端用 auth 注入 `teacher-auth-storage`）。截圖存 `output/`。

### A. 前置
- [ ] `GET /api/demo/config` 回傳新增的 6 個 key，值為有效 assignment id。
- [ ] 每個新 demo id 的 `GET /api/demo/assignments/{id}/preview` 回 200，`practice_mode` 正確。

### B. 每個新 demo 頁（headless Playwright，逐一）
- [ ] `/demo/{id}` 載入不被導回首頁、無 401/403 network（特別盯 quiz 的 `*-quiz-start` 是否 200、不再打 `/api/teachers/...`）。
- [ ] 無非預期 console error（GA、autoplay `play()`、mp3 `ERR_BLOCKED_BY_ORB` 屬 headless 良性，忽略）。
- [ ] 依作業設定正確呈現（聲音鈕/翻譯/圖片/選項）；截圖存證。
- [ ] 可作答一題並得到回饋：
  - spelling/cloze：輸入答案 → 前端即時判定（demo 下不呼叫提交 endpoint）。
  - quiz：能載入題目、選/填答、切下一題（answer/complete 在 demo 下短路，不應 401）。
  - tug_of_war：能開始、拉動、計分（純前端）。

### C. 一致性 & 回歸
- [ ] 新 demo 與該模式「學生作答畫面」呈現一致（對照 #878 五畫面表）。
- [ ] 既有 5 個 demo（`/demo/72·73·74·76·77`）仍全數通過（未回歸）。
- [ ] 首頁 demo 卡片：6 張新卡出現、點擊開對應 `/demo/:id`；未設定值的環境該卡隱藏。

### D. 人工補充（AI 無法涵蓋）
- [ ] 用真實 Chrome 對至少一個含音檔的新 demo 確認音檔實際播放（headless 被 ORB 擋）。
- [ ] production 上 `contact@duotopia.co` 的 demo 作業與 `demo_config` 已設定且對外可開。

## 開放問題（實作前先決）
1. **tug_of_war demo 作業如何建立並掛到 demo 班級**（見 Tier A 特例）——建議先做 spike 驗證這條可行，再排其餘。
2. quiz demo 是否要顯示「正解/計分」給訪客，或只做體驗（不記分）——影響 quiz-start 回傳內容。
3. demo 作業的教材版權/內容選用（沿用現有 demo 教材集或另備）。
