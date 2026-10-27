# #1139 班級批次編輯：指定年級＋批次改名＋AI 助手（計畫檔）

> 狀態：規劃中，等使用者確認。每一輪的決策、審查意見、修正結果都追加在本檔。

## 需求（issue #1139）

1. 批次「設為指定年級」：未設定年級的班也能設（升／降一級需要基準值，指定不需要）。
2. 批次改班名：年級從班名拆出來後，很多班名要改，不想一班一班點編輯。
3. 兩個頁面都要：
   - 機構：`/organization/schools/:schoolId/classrooms`（`frontend/src/pages/organization/SchoolClassroomsPage.tsx`）
   - 老師：`/teacher/classrooms`（`frontend/src/pages/teacher/TeacherClassrooms.tsx`）
4. 追加（使用者 2026-10-21）：批次改名通常是我司代為處理，希望有 AI 助手代為操作；保留人工介面。

## 已定案（使用者 2026-10-21）

| # | 決策 |
|---|------|
| D1 | 「設為 N 年級」併入現有「調整年級」視窗（`AdjustGradeDialog`），在升一級／降一級旁加第三個選項。改到標準元件外觀，使用者已同意。 |
| D2 | 批次改名做成新的「批次編輯」modal：操作列加一顆按鈕，每個勾選的班一列（名稱輸入框＋年級下拉），上方可一鍵「全部年級設為 N」，一次儲存。 |
| D3 | AI 助手只有**平台管理員**看得到（`Teacher.is_admin`），機構擁有者、機構管理者、學校管理員、一般老師都看不到。 |
| D4 | AI 只把結果填進 modal 表格，人按「儲存」才寫入資料庫。AI 碰不到資料庫。 |
| D5 | AI 只能改 modal 裡勾選的那幾班的「名稱」和「年級」兩欄。 |

| D6 | 分兩階段，兩階段都在 #1139 底下做（不另開 issue）。 |
| D7 | AI 一次呼叫拿到全部結果：等待時顯示「AI 思考中…」，回來後逐列填入表格並顯示 k/n 與「原 → 新」。按停止：已填的保留，沒填的捨棄（等待中按停止＝取消請求、表格不動）。 |
| D8 | 復原＝回到該次 AI 執行前的整張表格（之後的手動修改一起還原），按鈕旁小字提醒。可連續復原多次。 |
| D9 | 批次編輯不能把年級清回「未設定」：已有年級的列，下拉不給空白選項；本來未設定的列可維持未設定，只改名也能存。 |
| D10 | AI 對話紀錄只存在這次開著的視窗，關掉就清空，不存資料庫；前端每次送最近 10 輪。 |
| D11 | （實作預設）寬螢幕表格與 AI 面板左右並排；窄螢幕 AI 面板改在表格上方、可收合。 |

## 現況（調查結論，2026-10-21）

- 兩個 batch-grade 端點已存在，收「每班的絕對年級」，升降一級在前端算（`frontend/src/components/classroom/classroomGrade.ts` `computeGradeAdjust`）。**指定年級後端不用改。**
  - 老師：`POST /api/teachers/classrooms/batch-grade`（`backend/routers/teachers/classroom_ops.py`）
  - 機構：`POST /api/schools/{school_id}/classrooms/batch-grade`（`backend/routers/classroom_schools.py`），權限 `has_school_materials_permission`
- 老師端有 `POST /api/teachers/classrooms/batch-update`（grade／level／is_active，上限 200，全成功或全失敗），**沒有 name**。機構端沒有 batch-update。
- 單班 PUT：機構端 name 驗證 1–100 字；老師端 `ClassroomUpdate.name` 沒有長度驗證（DB 是 String(100)，超長會 500）。
- 班名沒有唯一性限制。
- 顯示名稱組合規則：`classroom_display_name`（後端 `backend/utils/classroom_grade.py`）／`formatClassroomDisplayName`（前端 classroomGrade.ts）——名稱不含「年／班／grade／class」時會顯示成「N年X班」。批次編輯 modal 要顯示「實際會看到的名稱」預覽。
- 兩頁共用：BulkActionBar、AdjustGradeDialog、MissingGradeDialog、GradeSelect、classroomGrade.ts。勾選狀態與批次處理函式兩頁各寫一份。
- 老師頁的批次操作只對個人班（屬於學校的班回 403）。
- 平台管理員判定：`Teacher.is_admin`（已用於 magic paste 配額豁免 `backend/services/magic_paste_quota.py`）。
- 其他 worktree：issue-1133 會動 `REVIEW.md`、`docs/design/ui-style-guide.md` 元件清單，若本 issue 也加新標準元件，合併時可能小衝突。

## 設計

### 第一階段：手動（學校、老師都能用）

**後端**
1. 老師端 `batch-update` 的 item 加 `name`（`min_length=1, max_length=100`，去頭尾空白）。順手幫 `ClassroomUpdate.name` 補同樣驗證。
2. 機構端新增 `POST /api/schools/{school_id}/classrooms/batch-update`：item 為 `{classroom_id, name?, grade?}`（至少一項），權限、404 規則、200 上限、全成功或全失敗都比照機構 batch-grade。
3. pytest：name 長度、空白、只改名、名稱＋年級、權限、跨校 404。

**前端**
1. `AdjustGradeDialog` 加「設為 [N 年級 ▼]」模式：所有勾選的班（含未設定）都列在「將調整」，已經是 N 年級的列在「略過（不變）」。說明文字照模式調整。
2. 新共用元件 `components/classroom/BatchEditClassroomsDialog.tsx`：
   - 每班一列：名稱輸入框（maxLength 100、必填）＋ `GradeSelect`；顯示名稱預覽（套 `formatClassroomDisplayName`）；改過的列標記。
   - 上方「全部年級設為 [▼]」。
   - 儲存只送有變動的列；沒有變動時儲存鈕停用。
   - 版面預留右側面板插槽，第二階段放 AI 助手。
3. 兩頁的 BulkActionBar 加「批次編輯」按鈕，接各自的 API（老師：batch-update；機構：新端點）。兩頁錯誤都用 `batchGradeErrorMessageKey` 顯示（403／404／422）；儲存失敗時視窗不關、保留輸入。（老師頁本來就只讓個人班可勾選，403 只在競態出現。）
4. i18n（zh-TW／en）：新增文案；`classroomGrade.adjust.description`「班級名稱不會變更」視模式調整。
5. 文件：`docs/design/ui-style-guide.md` 第 6 節、`REVIEW.md` 元件清單加 BatchEditClassroomsDialog。
6. vitest：設為 N 年級的計算、批次編輯 dialog（只送變動列、驗證、全部設為）。

### 第二階段：AI 助手（只有平台管理員）

**限制方式（D4、D5）**：AI 不是能自由操作的 agent，而是單一用途的 AI 呼叫——
- 輸入只有：modal 裡那幾班的 `{id, name, grade}` ＋ 對話紀錄 ＋ 本次指示。
- 輸出固定格式：`{reply, changes:[{id, name?, grade?}]}`（structured output）。
- 後端再過濾：id 不在輸入清單的丟掉、名稱 1–100 字、年級 1–12；與改名無關的要求，AI 只回覆「我只能協助調整這些班級的名稱與年級」，不給 changes。
- AI 沒有任何工具、不連資料庫；寫入只能靠人按「儲存」走第一階段的端點。

**後端**
1. 新端點 `POST /api/classrooms/batch-edit/ai-suggest`：`Teacher.is_admin` 才能用，否則 403。
2. 用現有 Vertex AI 服務（`backend/services/vertex_ai.py`）＋ structured output；prompt 寫死任務範圍。
3. pytest：非管理員 403、過濾不在清單的 id、超長名稱／越界年級被剔除、空 changes。

**前端**
1. `BatchEditClassroomsDialog` 右側 `ClassroomRenameAssistantPanel`（只在 `is_admin` 時渲染）：
   - 對話輸入框＋送出。
   - 工作中顯示「正在處理 k/n」，逐列把結果套進表格並列出「原名稱 → 新名稱（年級變更）」，被 AI 改過的格子加標記。
   - 「停止」：中斷請求；若結果已回來、正在逐列套用，則停止套用剩下的列。
   - 「復原」：每次 AI 執行前存表格快照，復原回到該次執行前（可連續復原多次）。
   - AI 有改動時，人仍可手動再改；儲存前一律由人確認。
2. 前端判斷 `is_admin`：從 `useTeacherAuthStore`（`frontend/src/stores/teacherAuthStore.ts`）的 `user.is_admin` 取；機構頁與老師頁都是老師登入狀態，同一來源。
3. vitest：非管理員不顯示面板、停止、復原、套用只動指定列。

## 分段（D6：同一個 issue #1139）

| 階段 | 內容 | 影響範圍 |
|----|------|---------|
| 第一階段 | 後端 2 個批次端點＋前端指定年級＋批次編輯 modal | 約 12–15 個檔（含測試、i18n、文件） |
| 第二階段 | AI 助手 | 約 8–10 個檔 |

- 同一個分支 `claude/issue-1139`：第一階段 commit、push、使用者在 per-issue 環境驗過，再接第二階段 commit。
- 兩階段都做完才開 PR，只開一個 PR（`Fixes #1139`）。注意：`claude/issue-1139*` 的 PR 一 merge，cleanup workflow 會刪掉所有 issue-1139 遠端分支和 per-issue 環境，所以不要第一階段先 merge 再開第二階段的分支。

## 驗收

- 機構頁、老師頁：勾選數班 → 調整年級 → 設為 7 年級，未設定年級的班也變 7。
- 批次編輯：改 3 班名稱＋年級，一次儲存，列表與顯示名稱正確；名稱空白或超過 100 字擋下。
- 學校管理員、機構擁有者打開批次編輯：看不到 AI 面板；直接呼叫 AI 端點回 403。
- 平台管理員：輸入「把名稱裡的年級拿掉」→ 看到逐列進度與「原 → 新」，可停止、可復原，按儲存才寫入。

## Cold-read 補充（2026-10-21，實作者照此執行）

**後端**
- `ClassroomUpdate` 指 `backend/routers/teachers/validators.py`（約 :133）。**不要改** `backend/routers/teachers.py`（舊單檔，被同名 package 蓋過、沒被載入）。
- 老師端 item 是 `backend/routers/schemas/classroom.py` 的 `ClassroomBatchUpdateItem`；加 `name` 後 `at_least_one_field` 要把 name 算進去。機構端另開 `SchoolClassroomBatchUpdateItem`，沿用 `no_duplicate_classrooms` 與 `BATCH_GRADE_MAX_ITEMS`。
- name 一律先去頭尾空白再檢查 1–100 字，四處一致：老師 batch、機構 batch、老師單班 PUT、機構單班 PUT。
- 機構端 batch-update 回傳 `{updated:[{id,name,grade}], count}`；前端收到直接更新列表，不重抓。
- 停用中（未刪除）的班可以批次編輯，表格那列沿用停用標記。（頁面原本的可勾選規則不變。）

**前端**
- 「改過的列」：與打開視窗時的原值比較（name 先去空白）；改回原值就不算變動、標記消失。AI 改過的格子用另一種標記，人工再改後換成人工標記。
- 「全部年級設為」：套到表格所有列（含原本未設定），只改年級，不碰名稱，之後仍可逐列修改。
- 有變動的列超過 `BATCH_GRADE_MAX_ITEMS` 時停用儲存，顯示 `classroomGrade.limitExceeded`。
- `AdjustGradeDialog` 設為 N 年級模式：N 沒有預設、必選，沒選時套用鈕停用；說明文字「所選班級的年級都會改成 N 年級；班級名稱不會變更」（en：「All selected classes will be set to Grade N. Class names won't change.」）。

**AI 端點（第二階段）**
- request：`{classrooms:[{id,name,grade}] (1–200), history:[{role,content}] (最多 10 輪), instruction: str (1–1000 字)}`。
- 用 `vertex_ai.generate_json` ＋ `system_instruction`。現有函式沒有 `response_schema`，改成「prompt 指定格式＋後端 Pydantic 解析」。`max_tokens` 依班數放大（約每班 40 ＋ 固定 500）。用 flash 模型。只限管理員，不另做配額。
- 同一 id 回傳多次取最後一筆；名稱先去頭尾空白再驗證。
- 解析失敗或逾時回 502，前端顯示「AI 暫時無法回應，請重試」，表格不動。

**測試補充**
- pytest：老師 batch-update 只送 name、name＋grade、name 全空白→422、101 字→422、重複 id→422；機構端無權限→403、跨校班→404、停用的班可改。
- pytest（AI）：回傳不在清單的 id、名稱超長、年級 13 都被剔除；Vertex 回傳非 JSON → 502（mock）。
- vitest：設為 N「已經是 N→略過」、變動超過 200 列停用儲存、年級不能清空（見待決定）。

**驗收補充**
- 批次改名後，預覽與實際顯示一致（例：名稱「12」＋8 年級 → 顯示「8年12班」）。
- 儲存失敗（例如網路錯誤）時視窗不關、輸入保留。

**流程**
- 文件改動（`REVIEW.md`、`ui-style-guide.md`）放在第一階段最後一個 commit；issue-1133 也動這兩檔，push 前先 rebase 確認。

## 修正事項

（審查意見與修正結果追加於此）

### 第一階段實作結果（2026-10-21）

**Commits（分支 `claude/issue-1139`，未 push）**
- `dd74662c` 後端：老師 batch-update 加 name；新增機構 `POST /api/schools/{school_id}/classrooms/batch-update`（回傳 `{updated:[{id,name,grade}], count}`）；共用 `ClassroomName`（去頭尾空白後 1–100 字）套到老師／機構單班 PUT 與兩個批次端點；pytest `backend/tests/test_classroom_batch_edit.py`。
- `c71635ab` 前端：`AdjustGradeDialog` 加第三模式「設為指定年級」（N 必選、含未設定的班、已是 N 列入略過、說明文字隨模式切換）；`classroomGrade.computeGradeSet`；vitest。
- `9d0e03f4` 前端：新共用元件 `BatchEditClassroomsDialog`＋純邏輯 `batchEditClassrooms.ts`；`GradeSelect` 加 `allowEmpty`；兩頁 BulkActionBar 加「批次編輯」；`api.ts`、`useClassroomListActions.runBatchUpdate`（支援 name、failureKey 可傳函式）；i18n；vitest。
- 本 commit：`ui-style-guide.md` 第 6.4 節、`REVIEW.md` 元件清單加 BatchEditClassroomsDialog（並註記 AdjustGradeDialog 設為指定年級、GradeSelect allowEmpty）；本段紀錄。

**計畫外的決定（保守選擇，待使用者確認）**
- 批次編輯視窗有未儲存修改時，按取消／Esc／點背景會先跳確認（沿用 `classroomGrade.inline.unsavedConfirm`）。計畫未提，為避免誤關丟失輸入而加。
- 「全部年級設為」是選了就套用、下拉回到空白（不保留選取值），避免之後逐列修改時上方顯示過期的值。
- 批次操作列「批次編輯」按鈕放在既有按鈕之後（老師頁：調整年級、調整等級、批次編輯、停用開關；機構頁：調整年級、批次編輯），圖示用 lucide `Edit`。
- 老師頁儲存成功沿用 `runBatchUpdate` 的流程（就地更新後背景重新載入）；機構頁照計畫直接用回傳結果更新、不重抓。
- 名稱驗證只檢查「有變動的列」；沒變動的列沿用原名，不因舊資料擋住儲存。
- 右側面板插槽 `renderSidePanel(ctx)`，ctx 提供 `rows`、`setRows`（復原快照用）、`applyChanges(changes, "ai"|"manual")`、`saving`；已有 vitest 驗證 AI 填入的標記與人工再改後換回人工標記。
- AI 標記色用琥珀色（amber），人工用藍色。
- `SchoolClassroomCreate`／老師 `ClassroomCreate` 的 name 未改（計畫只列四處：兩個批次＋兩個單班 PUT）。

**沒做的**
- 第二階段（AI 助手）照指示未做。

**靜態檢查**
- 後端：black（2 檔重新排版後通過）、flake8 `--config=../.flake8`（於 backend/，改動的 5 檔 0 錯誤）。
- 前端：prettier --write（改動檔）、`npm run typecheck` 通過；`npx eslint` 改動檔 0 錯誤，僅 `SchoolClassroomsPage.tsx:129` 一個既有的 exhaustive-deps 警告；`npm run lint`（--max-warnings 0）因全專案既有 95 個警告而失敗，非本次新增。
- pytest／vitest 未在本機跑（交給 CI）。

### 第一階段審查意見（2026-10-21，code-reviewer）→ 使用者決定：修 R1–R3，R4 這次不做

結論：需修正。後端權限／驗證、i18n key、UI 規範皆無問題；實作者計畫外的決定 reviewer 全部同意。

- R1【高】`backend/tests/test_classroom_status.py:345-350`：既有測試用整個 dict 比對 batch-update 回傳，現在多了 `name` → CI 必紅。修法：預期值補 `"name": c1.name`。
- R2【中】`BatchEditClassroomsDialog.tsx:274-285`＋`batchEditClassrooms.ts:132`：原本未設年級的列被設了年級（例如「全部年級設為」）後，下拉的空白選項選了沒反應，回不到「未設定」，違反 D9。修法：`originalGrade === null` 的列選空白時把 grade 還原成 null（`applyBatchEditChanges` 只在原值為 null 時接受 null）；補 vitest：全部設為 7 後把未設定的列改回未設定，送出筆數少一。
- R3【低】`SchoolClassroomsPage.tsx:361`、`TeacherClassrooms.tsx:414`、`BatchEditClassroomsDialog.tsx:326`：批次編輯沿用年級的錯誤文字（「更新年級失敗」「沒有權限調整此學校的班級年級」「一次最多調整 200 個班級，請用年級篩選分批」），改名失敗時文字不對。修法：在 `classroomGrade.batchEdit` 加 `saveFailed`、`forbidden`、`limitExceeded`（中英），`batchGradeErrorMessageKey` 加參數讓呼叫端選用。
- R4【低】老師 `ClassroomCreate.name`（`backend/routers/teachers/validators.py:123-124`）不限長度、機構 `SchoolClassroomCreate` 不去空白；不在計畫範圍，待使用者決定是否一起改。

### 審查修正結果（R1–R3，2026-10-21）

commit `3165df5b` fix(classroom): 批次編輯審查修正——測試補 name、未設定列可改回未設定、改用批次編輯專屬錯誤文字

- R1：`backend/tests/test_classroom_status.py` 的 `test_batch_combined_fields` 預期回傳補 `"name": c1.name`；檔頭 docstring 註明回傳含 name。
- R2：`batchEditClassrooms.ts` 的 `BatchEditChange.grade` 改為 `number | null`；`applyBatchEditChanges` 收到 null 時只在該列 `originalGrade === null` 才接受（還原回未設定、記來源），已有年級的列仍忽略。`BatchEditClassroomsDialog.tsx` 列年級下拉的 onChange 不再丟掉 null。補 vitest：純函式（null 只對原本未設定的列有效）、視窗（全部設為 7 後把未設定的列改回空白 → 儲存 (2) 變 (1)）。
- R3：i18n `classroomGrade.batchEdit` 新增 `saveFailed`、`forbidden`、`limitExceeded`（zh-TW／en）。`batchGradeErrorMessageKey(error, scope = "grade")` 加 `scope` 參數（`"grade" | "batchEdit"`），老師頁、機構頁批次編輯失敗改傳 `"batchEdit"`；視窗超量提示改用 `classroomGrade.batchEdit.limitExceeded`。補 vitest：batchEdit scope 的 403／其他錯誤 key；視窗測試的超量文字 key 同步更新。
- R4：照使用者決定未做。
- 靜態檢查：black、flake8 通過；prettier、`npm run typecheck` 通過；eslint 改動檔 0 錯誤（僅 `SchoolClassroomsPage.tsx` 既有的 exhaustive-deps 警告）。pytest／vitest 交給 CI。

### R1–R3 修正審查（2026-10-21，新 code-reviewer）
結論：通過。兩個小問題不擋合併，留待之後：
- 【低】`BatchEditClassroomsDialog.test.tsx:130-133` 未直接驗證第 1 列「已修改」標記消失（只從儲存筆數間接推得）。
- 【低】`useClassroomListActions.ts:189-192` `runBatchUpdate` 超量提示仍用年級版文字；批次編輯視窗會先擋，實際走不到。

### 第一階段 per-issue 截圖（2026-10-27）
留言：https://github.com/myduotopia/duotopia/issues/1139#issuecomment-6431170249 。發現（待使用者決定是否修）：
- V1 手機寬度 390px：全站右側浮動工具列（計時器、骰子、舉手…）蓋住批次編輯視窗右緣的「已修改」標籤與輸入框右側。
- V2 `AdjustGradeDialog`「設為指定年級」未選目標時說明文字結尾沒有句號，與升／降一級不一致。
- V3 名稱清空時，游標仍在輸入框內，藍色焦點框蓋過紅色錯誤框（紅字提示正常）。
- 使用者決定（2026-10-27）：V1–V3 與第二階段一起做。V1 做法：批次編輯視窗（及其遮罩）打開時層級高於全站右側浮動工具列；只調整這個視窗或 Dialog 的層級，不改工具列在其他畫面的行為；先查清工具列與 Dialog 目前的 z-index 再決定最小改法。V2 補句號（中英一致）。V3 名稱有錯時，焦點狀態仍顯示紅色外框。

### 第二階段實作結果（2026-10-27）

先把本計畫檔未 commit 的「第一階段 per-issue 截圖」段落 commit（`25d8a0de`），再 `git rebase origin/staging`（已是最新，無衝突）。未 push。

**Commits（分支 `claude/issue-1139`）**
- `4d5436fb` 後端：`POST /api/classrooms/batch-edit/ai-suggest`（`backend/routers/classroom_batch_edit_ai.py`，`main.py` 註冊）；服務 `backend/services/classroom_batch_edit_ai.py`；pytest `backend/tests/test_classroom_batch_edit_ai.py`。
- `5c4c7816` 前端：`ClassroomRenameAssistantPanel`＋`useClassroomRenameAssistantSlot`、純邏輯 `classroomRenameAssistant.ts`、`api.suggestClassroomBatchEdit`、兩頁接上插槽；V1–V3；i18n；`ui-style-guide.md` 第 6 節；vitest。
- 本 commit：本段紀錄。

**後端重點**
- 非管理員 403（不打 AI）。request：`classrooms` 1–200（id 不可重複、name ≤100 可為空字串＝表格當下值、grade 1–12 或 null）、`history` ≤20 則（10 輪，role 只能 user／assistant，每則 ≤2000 字）、`instruction` 去空白後 1–1000 字；不合 → 422。
- 單次 `generate_json`（flash、`system_instruction`、temperature 0.2、`disable_thinking=True`、`max_tokens = 500 + 40 × 班數`）。prompt 寫死任務範圍、班名視為資料不是指令、離題只回「我只能協助調整這些班級的名稱與年級。」且 changes 空。
- 過濾：不是 JSON 物件或 `changes` 不是陣列 → 502；id 不在清單丟掉；名稱去空白後 1–100 字、年級 1–12 整數（排除 bool），**只丟不合格的那個欄位**，兩欄都不剩才丟整筆；同一 id 取最後一筆（最後一筆不合格＝該班不改）；結果依輸入順序。任何例外（逾時、解析失敗）→ 502「AI 暫時無法回應，請重試」。
- 只限管理員，不另做配額、不記用量。

**前端重點**
- 面板只在 `useTeacherAuthStore` 的 `user.is_admin === true` 時由 `useClassroomRenameAssistantSlot()` 回傳；非管理員拿到 undefined，視窗不顯示面板。
- 送出時帶表格「當下」的列（含人工剛改的值；機構頁字串 id 轉數字、回來再對回）。「AI 思考中…」→ 回來後每 150ms 套一列、顯示「正在套用 k/n」、對話裡逐列加「原名 → 新名（年級：A → B）」；結束附註「已填入 N 個班級，確認後按「儲存」」。
- 停止：等待中＝abort 請求、表格不動；套用中＝已套用保留、其餘捨棄，附註 k/n。
- 復原：每次 AI 真的要套用前存整張表格快照（AI 沒改任何列就不存），「復原上一次 AI 修改」可連續按；按鈕下方小字提醒之後的手動修改也會一起還原。沒有可復原的快照時按鈕不顯示（不做停用狀態）。
- 失敗：對話裡顯示紅字「AI 暫時無法回應，請重試」，表格不動、不存快照。
- 對話只存在面板 state，視窗關閉（面板卸載）即清空，並取消進行中的請求與套用；每次送最近 10 輪（失敗／停止／復原等附註不送）。
- 版面：寬螢幕在表格右側（lg:w-80）；窄螢幕在表格上方，對話區最高 12rem 可捲動，標題列右側有收合鈕（只在窄螢幕出現，預設展開）。Enter 送出、Shift+Enter 換行、輸入法選字中的 Enter 不送出。

**V1–V3**
- V1：查證結果——工具列 `DigitalTeachingToolbar` 外層 `fixed inset-0 z-[140]`（工具列本身 `z-[150]`，在外層的堆疊內），shadcn Dialog 遮罩與內容都是 `z-50`。最小改法：`components/ui/dialog.tsx` 的 `DialogContent` 加選用 prop `overlayClassName`（不給就和以前一樣），批次編輯視窗的內容與遮罩都加 `z-[160]`。其他畫面與工具列不受影響。
- V2：`classroomGrade.adjust.descriptionSet`／`descriptionSetPending`（zh-TW）補「。」；英文本來就有句號。
- V3：名稱有錯時輸入框加 `focus:border-red-500 focus:ring-red-500 focus-visible:ring-red-500`，焦點狀態維持紅框。

**計畫外的決定（保守選擇，待使用者確認）**
- AI 輸出某欄不合格時只丟那一欄（例：名稱合格、年級 13 → 只改名稱），不丟整筆。
- 「送出」「停止」「復原」都用次要按鈕（白底灰框）：視窗的明確下一步是底部「儲存」（主按鈕），避免同一視窗兩顆主按鈕。
- AI 套用中沒有鎖住表格與「儲存」；人工可同時修改、也可按儲存（儲存後視窗關閉，剩下的套用自動取消）。
- `ClassroomRenameAssistantPanel` 只透過批次編輯視窗的插槽使用，不另外登記為獨立標準元件（未加進 REVIEW.md 清單），寫在 `ui-style-guide.md` 第 6.4 節 BatchEditClassroomsDialog 那一行；Dialog 那一行補 `overlayClassName` 用法。
- 面板內不使用會 portal 出去的 Tooltip／Popover（視窗層級 z-[160] 會蓋住 z-50 的 portal），說明文字用 `title`／小字。

**沒做的**
- 無。

**靜態檢查**
- 後端：black（2 檔重新排版後通過）、flake8 `--config=../.flake8`（改動 4 檔 0 錯誤）。
- 前端：prettier --write 改動檔、`npm run typecheck` 通過；`npx eslint` 改動檔 0 錯誤，僅 `SchoolClassroomsPage.tsx` 既有的 exhaustive-deps 警告（行號因新增 3 行移到 134）。
- pytest／vitest 未在本機跑（交給 CI）。
