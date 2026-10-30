# UI 規範與共用元件目錄

> **標準文件** · 建立於 2026-10-13（issue #1116）
> 影響：所有前端畫面。做任何畫面或新功能前先看這份；標準文件總索引見 [`README.md`](./README.md)。

這份文件寫的是**現況**。每一條都從程式碼實際用法整理，並附出處檔案。
新定的只有「按鈕層級」：規則 1（沒有明確下一步的並列操作一律同一樣式）與深色欄的樣式（一般按鈕不分主次、危險用紅色圖示加分隔線），產品負責人 2026-10-13 定案。

統計方式：在 `frontend/src` 用 grep 數 Tailwind class，排除測試檔（`__tests__/`、`*.test.*`）與 `dark:` 變體。數字是 2026-10-13 的快照，只用來判斷「哪一種最常用」。

---

## 1. 管理原則

| 層級 | 適用情況 | 要做的事 |
|---|---|---|
| 一般功能 | 單一、不會被模仿的功能 | 遵守本文件的色調、按鈕層級與共用元件目錄；程式頂部寫好說明。不另寫文件 |
| 共用元件 | 同樣的介面第二次出現 | 搬到 `frontend/src/components/shared/`，在本文件「共用元件目錄」加一行 |
| 功能家族 | 以後會反覆往裡加東西（題庫題型、批改頁作業類型） | 設計文件＋CLAUDE.md 規則；需要時加 skill |

- **能用標準元件就用。** 差不多合用時，擴充標準元件（加 prop），不要複製一份來改。只有用途根本不同時，才新做一個。
- **要改標準元件的外觀或用法，先經產品負責人同意，改完同步更新目錄。** 產品負責人說「這個以後都要長這樣」時，就把它登記為標準。

名詞：
- **跨功能元件**：被兩個以上的功能資料夾（`frontend/src/components/` 或 `frontend/src/pages/` 底下的不同子資料夾）引用的元件。本文件統計時，不算元件自己所在的資料夾。
- **標準元件**：登記在本文件「共用元件目錄」裡的元件。

---

## 2. 色調

### 2.1 主題色票（`index.css`）

出處：`frontend/src/index.css` 的 `@layer base :root`；`frontend/tailwind.config.js` 把它們接成 `bg-primary`、`text-muted-foreground` 這類 class（#1046）。

| 名稱 | CSS 變數 | HSL | 近似 hex | 什麼時候用 |
|---|---|---|---|---|
| 主色 | `--primary` | 221.2 83.2% 53.3% | #2563EB（= Tailwind `blue-600`） | 主按鈕、連結、選取中、焦點框 |
| 主色上的文字 | `--primary-foreground` | 210 40% 98% | #F8FAFC | 主色底上的字 |
| 背景 | `--background` | 0 0% 100% | #FFFFFF | 頁面底色 |
| 文字 | `--foreground` | 222.2 84% 4.9% | #020817 | 一般內文 |
| 卡片 | `--card` | 0 0% 100% | #FFFFFF | 卡片底色（與背景同值） |
| 卡片文字 | `--card-foreground` | 222.2 84% 4.9% | #020817 | 卡片內文字 |
| 浮層 | `--popover` / `--popover-foreground` | 同卡片 | #FFFFFF / #020817 | 下拉、Popover |
| 次要底色 | `--secondary`、`--muted`、`--accent` | 210 40% 96% | #F1F5F9 | 次要按鈕底、淡底區塊、hover 底 |
| 次要文字 | `--muted-foreground` | 215.4 16.3% 46.9% | #64748B | 說明文字、提示文字 |
| 邊框 | `--border`、`--input` | 214.3 31.8% 91.4% | #E2E8F0 | 卡片框、輸入框框線 |
| 焦點框 | `--ring` | 221.2 83.2% 53.3% | #2563EB | 鍵盤焦點外框 |
| 刪除／錯誤 | `--destructive` | 0 84.2% 60.2% | #EF4444（= Tailwind `red-500`） | 刪除、錯誤 |
| 刪除上的文字 | `--destructive-foreground` | 210 40% 98% | #F8FAFC | 刪除底上的字 |

圓角變數 `--radius: 0.5rem` 也定義在同一處（見第 4 節）。

**現況提醒**：多數畫面沒有用語意 class，而是直接寫 Tailwind 色名。例如 `frontend/src/components/ui/button.tsx` 的預設按鈕實際是 `bg-blue-600`、外框按鈕是 `border-gray-300 bg-white`。兩種寫法顏色一致，都可以用。

### 2.2 影片品牌色

`video/src/theme.ts` 的 `brand: "#2563eb"`（blue-600）和網站主色 `--primary` 是同一個顏色。影片另有 `brandDark #1e40af`（blue-800）、`brandLight #3b82f6`（blue-500）、`accent #f59e0b`（amber-500，圈選標示）、`bg #f1f5f9`（slate-100）。

### 2.3 中性色

- 標準：**`gray`**。`gray-*` 共 3558 次、308 個檔案，是全站最常用的色系。
- 用法（出處 `frontend/src/components/ui/button.tsx`）：外框 `border-gray-300`、次要文字 `text-gray-700`、淡底 `bg-gray-100`、hover 底 `hover:bg-gray-50`。
- `slate` 見「待決定」。

### 2.4 狀態色

每一類取最常用的寫法為標準。

| 狀態 | 標準色系 | 提示框（淡底＋框＋字） | 小標籤（徽章） | 圖示／文字 | 依據 |
|---|---|---|---|---|---|
| 資訊、說明 | `blue` | `bg-blue-50 border-blue-200 text-blue-700` | `bg-blue-100 text-blue-800` | `text-blue-600` | 提示框 42 個檔案；框內字 `text-blue-700` 39 次 |
| 成功、完成、答對 | `green` | `bg-green-50 border-green-200 text-green-700` | `bg-green-100 text-green-800` | `text-green-600` | `green-*` 636 次／134 檔；`CheckCircle` 圖示 27 次用 `text-green-600`；徽章字 `text-green-800` 42 次 |
| 警示、需注意、未儲存 | `amber` | `bg-amber-50 border-amber-200 text-amber-700` | `bg-amber-100 text-amber-800` | `text-amber-600` | 提示框 23 個檔案（多於 yellow 16、orange 6）；框內字 `text-amber-700` 16 次 |
| 錯誤、刪除 | `red` | `bg-red-50 border-red-200 text-red-600` | `bg-red-100 text-red-800` | `text-red-600` | `red-*` 634 次／164 檔；`text-red-600` 210 次；框內字 `text-red-600` 44 次 |

出處範例：
- 警示：`frontend/src/components/classroom/AdjustGradeDialog.tsx`、`frontend/src/components/shared/BulkActionBar.tsx`（深藍膠囊上的「N 題有未儲存的修改」附註用 `text-amber-200`）。
- 成功／錯誤：`frontend/src/components/activities/shared/QuizOptionChip.tsx`（正解綠框綠底、錯誤紅）。
- 資訊：`frontend/src/components/AssignmentDialog.tsx`。

深色模式：`tailwind.config.js` 設 `darkMode: 'class'`。現有寫法是在淺色 class 後面補 `dark:` 版本，例如 `bg-blue-600 dark:bg-blue-500`（`frontend/src/components/ui/button.tsx`）、`bg-green-100 dark:bg-green-900/30`（`frontend/src/lib/practiceMode.ts`）。

### 2.5 分類色（不是狀態）

有些顏色用來區分「種類」，不代表好壞。目前分類色集中在下列對照表：

| 用途 | 對照表 | 用到的色系 |
|---|---|---|
| 練習模式 | `frontend/src/lib/practiceMode.ts` | blue、green、orange、purple、indigo、emerald、amber、pink、rose |
| 學生分組 | `frontend/src/lib/studentGroup.ts`（後端 `backend/models/student_group.py` 同步） | amber、rose、sky、emerald、violet、slate |
| 選擇題選項 4 色循環 | `frontend/src/components/activities/shared/WordSelectionOptionButton.tsx` | 藍、紫、琥珀、青 |

### 2.6 寫死的 hex 色碼

- 現況：`frontend/src` 有 227 處 6 位 hex（37 個檔案），以及 40 處 `bg-[#xxxxxx]` 這類任意值 class（10 個檔案）。
- 集中在遊戲畫面（`components/activities/tug-of-war/`）、畫布與列印（`components/activities/shared/PrintPdfSheet.tsx`）、行銷頁（`pages/Home.tsx`、`pages/PricingPage.tsx`）。
- 新寫的畫面用 Tailwind 色名或語意 class，不要再寫死 hex。
- **由 ESLint 擋**（`frontend/eslint.config.js` 的 `no-restricted-syntax`）：`bg-[#xxxxxx]` 這類任意值 class，以及 `style` 裡的 hex。上面這些既有檔案列在同一份設定的白名單（19 檔），只減不增：改掉某檔的 hex 後就從白名單移除。畫布、圖表等寫在 JS 常數裡的 hex 不在檢查範圍。
- ESLint 的寫死色碼檢查只抓 Tailwind 任意值 `-[#...]` 和 `style` 裡的 hex；SVG／圖表的 `fill`、`stroke` 屬性不在檢查範圍，仍應優先用 token／`currentColor`。

### 2.7 待決定

下面這些顏色有多種寫法。由產品負責人決定要統一成哪一種。**決定前不算違規。**

| 項目 | 寫法與次數 | 主要檔案 |
|---|---|---|
| 警示提示框用哪個色系 | amber 23 檔（標準暫定）；`bg-yellow-50 border-yellow-200` 16 檔；`bg-orange-50 border-orange-200` 6 檔 | yellow：`components/TeacherSubscriptionBanner.tsx`、`components/StudentImportDialog.tsx`、`components/shared/BatchTTSSettings.tsx`、`pages/teacher/TeacherSubscription.tsx` 等 16 檔。orange：`pages/teacher/TeacherAssignmentDetailPage.tsx`、`components/AssignmentDetailSheet.tsx`、`pages/teacher/ClassroomDetail.tsx` 等 6 檔 |
| `yellow` 整體 | 230 次／64 檔（星等、提醒、訂閱橫幅混用） | `components/CreateProgramDialog.tsx`（16）、`components/admin/TestRecordingPanel.tsx`（12）、`components/ReadingAssessmentPanel.tsx`（10） |
| `orange` 整體 | 133 次／47 檔 | `pages/teacher/TeacherAssignmentDetailPage.tsx`（18）、`pages/student/StudentAssignmentList.tsx`（10） |
| 成功用 green 還是 emerald | green 636 次；emerald 50 次／17 檔（分類色對照表以外也有） | `pages/StudentLogin.tsx`、`components/ClassroomSwitcher.tsx`、`components/StudentLayout.tsx`、`components/activities/shared/QuizReviewView.tsx`、`components/grading/QuizGradingPanel.tsx` |
| 錯誤用 red 還是 rose | red 634 次；rose 17 次／7 檔 | `components/activities/shared/QuizOptionChip.tsx`、`components/activities/shared/QuizReviewView.tsx`、`components/grading/QuizGradingPanel.tsx`、`components/assignment/QuizScoringMethodField.tsx` |
| 中性色用 gray 還是 slate | gray 3558 次；slate 86 次／19 檔 | `components/workspace/WorkspaceSwitcher.tsx`（24）、`components/ui/select.tsx`、`components/ui/checkbox.tsx`、`components/ui/switch.tsx`、`components/ui/sheet.tsx` |
| `purple`（對照表以外） | 269 次／64 檔 | `components/VocabularySetPanel.tsx`（22）、`pages/admin/AdminSubscriptionDashboard.tsx`（13）、`components/activities/*Template.tsx` |
| `indigo`（對照表以外） | 58 次／20 檔 | `components/PromoCodeCard.tsx`（18）、`components/grading/ScenarioDialogueGradingPanel.tsx` |
| 少量色系 | pink 24、violet 18、sky 12、teal 9、lime 9、cyan 4 次 | violet：`pages/teacher/TeacherProfile.tsx`；teal：`components/BatchGradingModal.tsx`；lime：`components/activities/WordClozeActivity.tsx` 等 3 檔；cyan：`pages/teacher/TeacherDashboard.tsx` |

**本文件列為標準的色系**：gray、blue、green、amber、red，以及第 2.5 節對照表裡的分類色。上表的色系在定案前可以照舊使用。

---

## 3. 按鈕層級

| 層級 | 一般淺色畫面 |
|---|---|
| 主要 | 藍底白字 |
| 次要 | 白底灰框 |
| 危險（例如刪除） | 紅底白字或紅字 |
| 停用 | 半透明；需要時說明原因（見規則 3） |

深藍膠囊（例如批次操作列 `BulkActionBar`，不分主次）：一般＝半透明白底白字（`bg-white/15`，hover `bg-white/25`，無外框）；危險＝同一般樣式＋紅色圖示（`text-red-200`）＋前面一條細分隔線，放在動作的最後一個（✕ 取消選取之前）；停用＝半透明，需要時說明原因（見規則 3）。

出處：
- **淺色・主要**：`frontend/src/components/ui/button.tsx` 預設 variant → `bg-blue-600 text-white hover:bg-blue-700`。
- **淺色・次要**：同檔 `variant="outline"` → `border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`。全站 `variant="outline"` 417 次，是最常用的按鈕。
- **淺色・危險（紅底）**：同檔 `variant="destructive"` → `bg-red-600 text-white hover:bg-red-700`（45 次／37 檔，例如 `components/organization/ConfirmDialog.tsx` 透過 `variant` prop 傳 `"destructive"`）。
- **淺色・危險（紅字）**：外框按鈕加紅字，例如 `frontend/src/components/activities/shared/WordActivityCard.tsx` 的 `text-red-600 border-red-300 hover:bg-red-50`。
- **淺色・停用**：`button.tsx` 共用 `disabled:opacity-50`；說明原因的寫法例如 `frontend/src/components/shared/BulkActionBar.tsx` 動作的 `disabledReason`（停用時當 title）與 `disabledBadge`（「即將推出」小標），題庫列表的批次編輯、派發鈕在用。
- **深色・一般**：`frontend/src/components/shared/BulkActionBar.tsx` 的 `BUTTON_CLASS` → `rounded-full bg-white/15 text-white font-medium hover:bg-white/25`，無外框（2026-10-13 定案，#1116 實作）。批次操作列的動作都常用、地位相同，沒有明確的下一步，所以不分主次。
- **深色・停用**：同檔 `disabled:opacity-60 disabled:cursor-not-allowed`。
- **深色・危險**：同檔動作設 `variant: "danger"` → 按鈕樣式與一般相同，只有圖示用 `text-red-200`，元件自動在前面加細分隔線（`h-5 w-px bg-white/30`）；danger 必須給圖示，沒給時文字改用同一紅色。呼叫端把它放在動作的最後一個（✕ 取消選取之前）（2026-10-13 定案，#1116 實作；題庫列表的刪除鈕）。按下仍先跳確認視窗。

三條規則：
1. 有明確下一步（例如表單送出、對話框確認）時，那一步用主按鈕，其餘用次要；沒有明確下一步的並列操作（例如批次操作列）一律同一樣式。
2. 危險動作永遠不當主按鈕。
3. 因權限、條件或功能未開放而停用的按鈕，一定要說明原因（tooltip 或旁邊小字）。處理中（busy）的暫時停用、表單驗證未通過的送出鈕不在此限。

---

## 4. 字型、圓角、間距

### 字型
- 內文用 Tailwind 預設字型（`tailwind.config.js` 沒有設定 `fontFamily`）。
- `frontend/index.html` 只載入 Google Fonts 的 `Caveat`，用在老師儀表板分頁的手寫風標題（`pages/teacher/SystemOverviewTab.tsx`、`ClassroomsTab.tsx`、`AllStudentsTab.tsx`、`ResourceMaterialsTab.tsx`）。
- 拔河遊戲另用 `Silkscreen`、`Patrick Hand`（`components/activities/TugOfWarGame.tsx`）。
- 字級：`text-sm` 最常用（1496 次），其次 `text-xs`（999）、`text-lg`（187）、`text-2xl`（157）、`text-base`（154）。
- 字重：`font-medium` 895 次、`font-semibold` 436 次、`font-bold` 346 次。
- 作答畫面的響應式字級用 `index.css` 的 `.quiz-question-font`、`.quiz-translation-font`、`.quiz-input-font`、`.word-card-word`、`.word-card-sentence`（#861、#880），不要自己再寫固定字級。

### 圓角
- `--radius: 0.5rem`（`index.css`），等於 Tailwind `rounded-lg`。
- 次數：`rounded` 431、`rounded-lg` 423、`rounded-full` 361、`rounded-md` 219。
- 一般按鈕 `rounded-md`（`components/ui/button.tsx`）；膠囊列與膠囊按鈕 `rounded-full`（`components/shared/BulkActionBar.tsx`）。

### 間距
- 元素間距：`gap-2` 最常用（741 次），其次 `space-y-2`（297）、`gap-1`（241）、`gap-3`（218）、`space-y-4`（203）。
- 內距：`p-4` 最常用（283 次），其次 `p-3`（177）、`p-6`（120）。
- 陰影：`shadow-sm` 最常用（92 次）。

---

## 5. 版面規則

- **卡片型內容的圖片固定在頂部。** 換題時視線不用重新對焦。手機版由上到下是：圖、音檔、句子、翻譯、評測；桌機版圖在左、文字在右。出處：產品負責人定案（錄音卡改版設計）。
- **底部浮動操作列要避開側欄，列表底部要留空間。** 浮動列從側欄右緣開始（`left: sidebarWidth`），列表底部留 `pb-24`，最後一列才不會被擋住。出處：`frontend/src/components/shared/BulkActionBar.tsx` 頂部說明；`pages/teacher/TeacherClassrooms.tsx`、`pages/organization/SchoolClassroomsPage.tsx`、`components/question-bank/QuestionBankTab.tsx` 的 `pb-24`。
- **小螢幕（≤480px）操作列縮小間距，所有按鈕只留圖示**（沒有圖示的改用短文字），完整文字留在 `aria-label`／`title`。 出處：`BulkActionBar.tsx` 的 `max-[480px]:` class。
- **手機版編輯面板滿版。** 出處：`frontend/src/index.css` 的 `.editor-panel`（#580）。
- **批改頁新增作業類型：同一個路由，依 `practice_mode` 換 Panel。** 出處：[`grading-page-architecture.md`](./grading-page-architecture.md)。
- **題庫新增題型：同一個 sheet 依題型分流。** 出處：[`question-bank-question-types.md`](./question-bank-question-types.md)。
- **派發預覽直接用學生端 Activity 元件，改 Activity 要驗證預覽。** 出處：[`preview-architecture.md`](./preview-architecture.md)。

---

## 6. 共用元件目錄

每個元件一行：名稱、路徑、什麼情況用。這張 issue 只登記，不搬家。

### 6.1 基礎元件（`frontend/src/components/ui/`，shadcn）

| 元件 | 路徑 | 什麼情況用 |
|---|---|---|
| Accordion | `frontend/src/components/ui/accordion.tsx` | 可展開收合的區塊 |
| Alert | `frontend/src/components/ui/alert.tsx` | 頁內提示框 |
| Badge | `frontend/src/components/ui/badge.tsx` | 小標籤 |
| Button | `frontend/src/components/ui/button.tsx` | 所有一般按鈕（層級見第 3 節） |
| Calendar | `frontend/src/components/ui/calendar.tsx` | 選日期 |
| Card | `frontend/src/components/ui/card.tsx` | 卡片外框 |
| Checkbox | `frontend/src/components/ui/checkbox.tsx` | 勾選框 |
| Dialog | `frontend/src/components/ui/dialog.tsx` | 對話框；`DialogContent` 的 `overlayClassName` 可調遮罩 class（例如要蓋過全站右側浮動工具列時，視窗與遮罩一起加 `z-[160]`，#1139） |
| DropdownMenu | `frontend/src/components/ui/dropdown-menu.tsx` | 「⋯」選單 |
| Input | `frontend/src/components/ui/input.tsx` | 單行輸入 |
| Label | `frontend/src/components/ui/label.tsx` | 表單標籤 |
| Popover | `frontend/src/components/ui/popover.tsx` | 點擊浮出的小面板 |
| Progress | `frontend/src/components/ui/progress.tsx` | 進度條 |
| ScrollArea | `frontend/src/components/ui/scroll-area.tsx` | 自訂捲動區 |
| Select | `frontend/src/components/ui/select.tsx` | 下拉選單 |
| Separator | `frontend/src/components/ui/separator.tsx` | 分隔線 |
| Sheet | `frontend/src/components/ui/sheet.tsx` | 側邊滑出面板 |
| Switch | `frontend/src/components/ui/switch.tsx` | 開關 |
| Table | `frontend/src/components/ui/table.tsx` | 表格 |
| Tabs | `frontend/src/components/ui/tabs.tsx` | 分頁籤 |
| TagInput | `frontend/src/components/ui/tag-input.tsx` | 輸入多個標籤 |
| Textarea | `frontend/src/components/ui/textarea.tsx` | 多行輸入 |
| Tooltip | `frontend/src/components/ui/tooltip.tsx` | 滑鼠移上去的說明（停用原因可用） |

### 6.2 共用元件（`frontend/src/components/shared/`）

| 元件 | 路徑 | 什麼情況用 |
|---|---|---|
| AIScoreDisplay | `frontend/src/components/shared/AIScoreDisplay.tsx` | 顯示 AI 發音評分 |
| AudioPlayer | `frontend/src/components/shared/AudioPlayer.tsx` | 播放音檔（含時間顯示）。`tone="onPrimary"`（#1133，只影響 `compact`）：放在主色藍底上用的淺色樣式（無綠底、半透明白按鈕、白色進度條），例如情境對話的學生回答氣泡；預設為原本綠色外觀。`fallbackDuration`（#1133，行為擴充、非外觀）：讀不到音檔時長時改顯示傳入的秒數（例如錄音秒數），不傳時照舊顯示 `--:--` |
| AudioRecorder | `frontend/src/components/shared/AudioRecorder.tsx` | 錄音。`variant="chat"`（#1133 情境對話）：大圓麥克風、點一下開始／再點停止（秒數＋聲波）→ 試聽／重錄，不包 Card、不跳完成 toast（畫面在同資料夾 `AudioRecorderChatControls.tsx`，只給 AudioRecorder 內部用） |
| BatchPasteArea | `frontend/src/components/shared/BatchPasteArea.tsx` | 帶行號的批次貼上文字區 |
| BatchTranslateSettings | `frontend/src/components/shared/BatchTranslateSettings.tsx` | 批次翻譯語言設定。card 變體在手機（< sm）語言下拉自成一列、撐滿寬度；sm 以上不變（#1146） |
| BatchTTSSettings | `frontend/src/components/shared/BatchTTSSettings.tsx` | 語音設定（口音、性別、語速）。card 變體在手機（< sm）改兩欄（口音整列、性別／語速並排）；sm 以上三欄一行（#1146） |
| BatchWorkPanel | `frontend/src/components/shared/BatchWorkPanel.tsx` | 桌面版左側批次工作區（組合貼上、翻譯、語音） |
| BatchSettingCard | `frontend/src/components/shared/batch/BatchSettingCard.tsx` | 左側批次工作區的卡片外框 |
| **批次操作列** BulkActionBar | `frontend/src/components/shared/BulkActionBar.tsx` | **標準**：列表勾選後的底部深藍膠囊操作列。目前用在「我的班級」、機構班級管理、題庫列表。呼叫端傳完整計數句子（`countLabel`）與動作；動作可設 `variant: "danger"`（不寫＝一般，膠囊上不分主次）、`disabledReason`、`disabledBadge`、`loading`、`testId`，計數旁可加 `countNote` 附註 |
| CreatableCombobox | `frontend/src/components/shared/CreatableCombobox.tsx` | 可搜尋、可新增的下拉 |
| ExamPointPicker | `frontend/src/components/shared/ExamPointPicker.tsx` | 選考點 |
| GradeRangeSlider | `frontend/src/components/shared/GradeRangeSlider.tsx` | 年段 1–12 兩點拉桿（必選的畫面用 `emptyLabel` 把未選的「不限」換成提示字） |
| LabeledSwitch | `frontend/src/components/shared/LabeledSwitch.tsx` | 文字寫在軌道裡的開關（含深色底版本） |
| MagicPasteDialog | `frontend/src/components/shared/MagicPasteDialog.tsx` | 手機版魔術貼上對話框 |
| MagicPasteInput | `frontend/src/components/shared/MagicPasteInput.tsx` | 上傳圖片／PDF 由 AI 擷取內容 |
| MaterialsPageTabs | `frontend/src/components/shared/MaterialsPageTabs.tsx` | 教材頁頂部「教材｜題庫」分頁 |
| MaterialsToolbar | `frontend/src/components/shared/MaterialsToolbar.tsx` | 教材頁工具列（標題、新增、搜尋、檢視切換） |
| ProgramFolderView | `frontend/src/components/shared/ProgramFolderView.tsx` | 資料夾式教材顯示 |
| ProgramLessonPicker | `frontend/src/components/shared/ProgramLessonPicker.tsx` | 「教材＋單元」關聯下拉 |
| ProgramTreeView | `frontend/src/components/shared/ProgramTreeView.tsx` | 教材／單元／內容三層樹（可編輯） |
| programTreeConfig | `frontend/src/components/shared/programTreeConfig.tsx` | 教材樹的層級設定（給 RecursiveTreeAccordion） |
| RecursiveTreeAccordion | `frontend/src/components/shared/RecursiveTreeAccordion.tsx` | 多層樹狀手風琴 |
| RefSaveButton | `frontend/src/components/shared/RefSaveButton.tsx` | 透過 ref 呼叫面板存檔的按鈕 |
| ResourceFolderView | `frontend/src/components/shared/ResourceFolderView.tsx` | 公版教材資料夾式顯示（唯讀＋複製） |
| SchoolProgramCreateDialog | `frontend/src/components/shared/SchoolProgramCreateDialog.tsx` | 建立學校層級教材 |
| TTSSettingsDialog | `frontend/src/components/shared/TTSSettingsDialog.tsx` | 單題產生語音前的設定視窗 |
| VisibilitySelect | `frontend/src/components/shared/VisibilitySelect.tsx` | 公開設定下拉 |

#### 引導式對話（`frontend/src/components/shared/guided-chat/`，#1158）

「新增內容」改成一問一答時用這一套（目前情境對話在用）。做法與步驟見 skill `/guided-chat`（`.claude/skills/guided-chat/SKILL.md`）。

| 元件 | 路徑 | 什麼情況用 |
|---|---|---|
| GuidedChatSheet | `frontend/src/components/shared/guided-chat/GuidedChatSheet.tsx` | 外層側滑面板外框（標題列＋徽章＋動作＋✕）；`sheet` 左緣貼齊側邊欄，`modal` 置中 |
| GuidedChatLayout | `frontend/src/components/shared/guided-chat/GuidedChatLayout.tsx` | 同頁外框：左對話、右 slot。依外框實際寬度（ResizeObserver）切換：≥ 925px 並列，以下頂端 Tabs「對話／題目（N）」，切換時兩邊狀態保留；右欄自帶浮動工具列留白。`useGuidedChatLayout()` 給 slot 判斷寬窄 |
| SelectedChipsBar（含 ChipOptionList、ChipTextEditor） | `frontend/src/components/shared/guided-chat/SelectedChipsBar.tsx` | 左欄頂端的已選項目列：點標籤跳 Popover 原地修改（選項／文字／功能自畫）；AI 工作中整列停用並寫原因；窄版可收合 |
| ChatComposer | `frontend/src/components/shared/guided-chat/ChatComposer.tsx` | 左欄底部固定的對話框：灰字依步驟換，停用時灰字＝原因；Enter 預設換行 |
| ChatBubbles（BotBubble、TeacherBubble） | `frontend/src/components/shared/guided-chat/ChatBubbles.tsx` | 機器人泡泡（灰底＋圖示）、老師泡泡（藍底白字，可帶「改選」） |
| ChoiceCards | `frontend/src/components/shared/guided-chat/ChoiceCards.tsx` | 選項型步驟的直排選項卡（主句＋灰色說明） |
| CefrChips | `frontend/src/components/shared/guided-chat/CefrChips.tsx` | CEFR 程度 A1～C2 單選小方塊 |
| flowEngine | `frontend/src/components/shared/guided-chat/flowEngine.ts` | 通用流程引擎（純 TS，沒有 UI）：各功能寫步驟設定（`FlowDef`／`StepDef`），引擎推導目前步驟、已選項目列、對話框狀態、清除規則、確認框、還原與對話紀錄。範例：`scenario-dialogue-editor/scenarioSteps.ts` |

### 6.3 作答共用元件（`frontend/src/components/activities/shared/`）

| 元件 | 路徑 | 什麼情況用 |
|---|---|---|
| ActivitySettingsPanel | `frontend/src/components/activities/shared/ActivitySettingsPanel.tsx` | 出作業時的活動設定面板 |
| CardNavArrow | `frontend/src/components/activities/shared/CardNavArrow.tsx` | 卡片兩側上一題／下一題箭頭 |
| ClozeBlankText | `frontend/src/components/activities/shared/ClozeBlankText.tsx` | 克漏字句子的挑空方塊 |
| CountdownRing | `frontend/src/components/activities/shared/CountdownRing.tsx` | 計時題的倒數圓環 |
| DrawingCanvas | `frontend/src/components/activities/shared/DrawingCanvas.tsx` | 手繪作畫區 |
| HandwritingCanvas | `frontend/src/components/activities/shared/HandwritingCanvas.tsx` | 手寫英文辨識輸入 |
| MultipleChoiceOptions | `frontend/src/components/activities/shared/MultipleChoiceOptions.tsx` | 選擇題選項區 |
| PreviewDemoDoneView | `frontend/src/components/activities/shared/PreviewDemoDoneView.tsx` | 考前說明模式提交後的「示範結束」畫面 |
| PrintPdfSheet | `frontend/src/components/activities/shared/PrintPdfSheet.tsx` | 列印學習單 PDF |
| ProgressIndicator | `frontend/src/components/activities/shared/ProgressIndicator.tsx` | 題目進度 |
| PronunciationScoreChart | `frontend/src/components/activities/shared/PronunciationScoreChart.tsx` | 發音分析雷達圖與長條圖 |
| QuizAnswerInput | `frontend/src/components/activities/shared/QuizAnswerInput.tsx` | 小考拼寫／克漏字答題輸入 |
| QuizOptionChip | `frontend/src/components/activities/shared/QuizOptionChip.tsx` | 小考選項唯讀格（檢討頁、批改頁） |
| QuizReviewView | `frontend/src/components/activities/shared/QuizReviewView.tsx` | 小考提交後的複盤畫面 |
| ScoreOverlay | `frontend/src/components/activities/shared/ScoreOverlay.tsx` | 答對／答錯分數動畫 |
| VirtualKeyboard | `frontend/src/components/activities/shared/VirtualKeyboard.tsx` | 觸控裝置的螢幕鍵盤 |
| WordActivityCard | `frontend/src/components/activities/shared/WordActivityCard.tsx` | 單字活動卡片 |
| WordCard | `frontend/src/components/activities/shared/WordCard.tsx` | 答對後的正解單字卡 |
| WordChoicePanel | `frontend/src/components/activities/shared/WordChoicePanel.tsx` | 可選擇的單字按鈕面板 |
| WordSelectionOptionButton | `frontend/src/components/activities/shared/WordSelectionOptionButton.tsx` | 單字選擇題選項按鈕（4 色循環） |

同資料夾另有作答用的 hook 與工具函式（`useQuizTimer.ts`、`useQuizStatusPolling.ts`、`useQuizRevision.ts`、`useQuizCloseRealtime.ts`、`useShortLandscape.ts`、`useShrinkToFit.ts`、`quizAnswerPersist.ts`、`clozeBlank.ts`、`optionLabels.ts`、`lottieCache.ts`），寫作答畫面前先看有沒有能用的。

### 6.4 跨功能元件（留在原位）

| 元件 | 路徑 | 什麼情況用 |
|---|---|---|
| AssignmentDialog | `frontend/src/components/AssignmentDialog.tsx` | 派發作業對話框 |
| ProgramVisibilitySelector | `frontend/src/components/ProgramVisibilitySelector.tsx` | 教材公開設定 |
| AdjustGradeDialog | `frontend/src/components/classroom/AdjustGradeDialog.tsx` | 班級批次升／降一個年級，或設為指定年級（含未設定年級的班，#1139） |
| BatchEditClassroomsDialog | `frontend/src/components/classroom/BatchEditClassroomsDialog.tsx` | 班級批次編輯名稱＋年級（每班一列、全部年級設為、只送變動列）；`renderSidePanel` 是右側面板插槽，平台管理員放 AI 助手 `ClassroomRenameAssistantPanel`（頁面用 `useClassroomRenameAssistantSlot()` 取得，非管理員拿到 undefined）；視窗與遮罩在全站浮動工具列之上（`z-[160]`） |
| GradeFilterSelect | `frontend/src/components/classroom/GradeFilterSelect.tsx` | 班級清單的年級篩選 |
| GradeSelect | `frontend/src/components/classroom/GradeSelect.tsx` | 班級表單的年級下拉；`allowEmpty={false}` 時已有年級就不給空白選項（不能清回未設定） |
| LevelBadge | `frontend/src/components/classroom/LevelBadge.tsx` | 班級 CEFR 等級徽章 |
| MissingGradeBanner | `frontend/src/components/classroom/MissingGradeBanner.tsx` | 「有 N 個班級尚未設定年級」提醒 |
| MissingGradeDialog | `frontend/src/components/classroom/MissingGradeDialog.tsx` | 逐班補填年級 |
| ConfirmDialog | `frontend/src/components/organization/ConfirmDialog.tsx` | 確認對話框（可設危險樣式） |
| OneCampusBindSection | `frontend/src/components/settings/OneCampusBindSection.tsx` | 1Campus 綁定與信箱驗證狀態 |
| StudentLoginQRShare | `frontend/src/components/teacher/StudentLoginQRShare.tsx` | 分享學生登入 QR code |
| ImageCarousel | `frontend/src/components/ImageCarousel.tsx` | 圖片輪播（左右箭頭、圓點、觸控滑動、鍵盤左右鍵）。預設為首頁功能特色外觀（圓點在上、下方說明文字）；`compact`（#1133）：圓點在圖下、無說明文字區、單張不顯示控制；`zoomable`：點圖放大（ZoomableImage），放大視窗內滑動／按鍵不會讓背後輪播換張 |
| ZoomableImage | `frontend/src/components/question-bank/LayoutRenderer.tsx`（具名匯出） | 圖片＋點擊放大。題庫與 `ImageCarousel` 的 `zoomable` 模式（#1133 情境對話）使用，是 `question-bank/LayoutRenderer.tsx` 的具名匯出。`className` 套在圖上；選用 `buttonClassName` 套在外層放大按鈕上（例如固定大小的縮圖框傳 `block h-full w-full` 讓按鈕撐滿），不傳時不變 |

### 6.5 淘汰中

目前沒有。

登記淘汰中元件時，同步在 `frontend/eslint.config.js` 加 `no-restricted-imports`，禁止新的程式再 import 它。

---

## 7. 變更規則

- 要改標準元件的外觀或用法，**先經產品負責人同意**。改完同步更新本文件。
- 產品負責人說「這個以後都要長這樣」時，就把它登記為標準元件。
- 新增跨功能元件時，在第 6 節加一行。
- 「待決定」的項目定案後，把結果寫進對應小節，並從「待決定」移除。
- 本文件有三份衍生檔案，改到相關內容時要同步：
  - `.claude/rules/frontend-ui.md`：精簡版，Claude 碰到前端檔案時自動載入。
  - 根目錄 `REVIEW.md`：審查清單，由 `CLAUDE.md` 匯入，CI 審查不讀其他檔案也看得到。標準元件名稱清單、標準色系、「待決定」色系都在這裡。
  - `frontend/eslint.config.js`：寫死 hex 的檢查與白名單。
