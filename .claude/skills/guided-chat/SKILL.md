---
name: guided-chat
description: |
  把某種內容（例如例句集、單字集）的「新增」從一整片設定表單改成 AI 引導式對話，
  或新的內容類型一開始就做成對話式。照四步驟：清點 → 轉成問題 → 套用
  frontend/src/components/shared/guided-chat/ 的共用元件與流程引擎（範例：情境對話）→ 驗收
  （原有功能一個都不能少）。共用元件不准複製一份改，不合用就擴充（加 prop）。
  自動觸發：「新增內容改對話式」、「做成引導式對話」、「改成對話式」、「guided chat」、「guided-chat」。
argument-hint: "<內容類型，例如 例句集>"
disable-model-invocation: false
allowed-tools: Bash, PowerShell, Read, Write, Edit, Grep, Glob, AskUserQuestion
---

# guided-chat：新增內容改成引導式對話

**開始時宣告：**「我用 guided-chat skill 把『$ARGUMENTS』的新增改成引導式對話」

## 先讀

- 共用元件：`frontend/src/components/shared/guided-chat/` 每支檔的檔頭 JSDoc（用法都寫在裡面），清單在 `docs/design/ui-style-guide.md` 第 6.2 節「引導式對話」。
- 流程引擎：`frontend/src/components/shared/guided-chat/flowEngine.ts`（檔頭有 `StepDef` 欄位表）。
- 範例（情境對話，照抄結構、不要照抄內容）：
  - 步驟設定：`frontend/src/components/scenario-dialogue-editor/scenarioSteps.ts`
  - 狀態 hook：`frontend/src/components/scenario-dialogue-editor/useScenarioSetup.ts`（答案、對話紀錄、AI 呼叫、清除連動）
  - 左欄畫面：`frontend/src/components/scenario-dialogue-editor/ScenarioSetupChat.tsx`
  - 面板：`frontend/src/components/ScenarioDialoguePanel.tsx`（外框、右欄清單、compose）
  - 外層面板：`frontend/src/components/ScenarioDialogueEditorSheet.tsx`（用 `GuidedChatSheet`）
- UI 規範：`docs/design/ui-style-guide.md`、根目錄 `REVIEW.md`。

## 原則（每一步都適用）

1. **對話只取代「開始前的設定」**：內容來源、難度、翻譯、語音這類一開始就要決定的東西。右欄每一列自己的工具（逐列翻譯、TTS／錄音、配圖、克漏字、排序、重新產生…）**全部不動**，照原本的列元件。
2. **記住老師上一次的翻譯和語音選擇**（翻譯語言、要不要語音、口音、性別、速度），下次預設帶入。存 `localStorage`，key 帶功能名稱，讀寫都包 try/catch，讀不到就用預設值。情境對話目前還沒做這項，第一個套用的功能要一起做，並抽成共用 helper 放 `shared/guided-chat/`。
3. **同頁版面**：一律用 `GuidedChatLayout`。依外框實際寬度決定版面（不看 viewport）：≥ 925px 左對話、右清單並列；以下頂端 Tabs「對話／題目（N）」。跨門檻時兩邊狀態都保留。從對話加入內容後，窄版自動切到清單分頁。清單卡片的寬窄排法看所在欄的寬度（`useGuidedChatLayout().sideWidth`），不看 viewport 的 `sm`。
4. **AI 判斷意圖只在明確允許的地方**：只有步驟設 `intent: true`（或 `done.intent`）的地方，老師打的字才交給 AI 判斷要做什麼。其他打字步驟照固定流程；選項步驟打字一律不呼叫 AI，只回「請點選上面的選項」。要新增 intent 的地方先問使用者。
5. **不准複製共用元件**：不合用就擴充（加 prop）。改共用元件的外觀先問使用者，改完同步 `ui-style-guide.md` 第 6 節與 `REVIEW.md`。
6. 共用文字用 `guidedChat.*`，功能專屬文字放在該功能自己的 i18n 區塊；中英文都要補，英文有數量的句子用 `_one`／`_other`。
7. 確認框一律用 `ConfirmDialog`；停用的按鈕要寫原因（REVIEW.md 按鈕層級第 3 條）。

## 步驟 1：清點

兩條路，產出**同一種清點表**：

- **改造已經做好的**：打開現有的新增畫面（含手機版），把每一個輸入、按鈕、開關、分頁、AI 功能都列出來；同時讀程式（面板、批次區、各列元件、送出的 API 參數）確認沒漏。
- **新增新的內容類型**：從需求（issue、計畫檔）列出老師要提供什麼、AI 要做什麼。

清點表欄位：

| 名稱 | 做什麼 | 老師要提供 | 用 AI？ | 共用元件 | 在對話裡變成問題，還是留在清單上 |
|---|---|---|---|---|---|

清點表給使用者確認後才往下。

## 步驟 2：轉成問題

「變成問題」的每一項，依序篩選，前面成立就不問：

1. **外層已經知道的**：直接沿用、不重問（例如教材的難度 `programLevel`）。
2. **能自動判斷的**：直接判斷、不問（例如上傳的檔案有對應圖片就一律擷取）。
3. **老師上次選過的**：帶入上次的值當預設（見原則 2），放在設定標籤裡讓老師改，不另外問。
4. 前三項都不是，才問老師。

產出步驟清單（照 `scenarioSteps.ts` 檔頭那張表的格式）：步驟 id、類型（選項／打字／卡片）、什麼時候出現、怎樣算已答、改答案要清掉什麼、要不要確認、灰字、要不要出現在已選項目列、怎麼從已存資料還原。給使用者確認（附畫面示意或草圖，用白話說明每個問題的目的）。

## 步驟 3：套用共用元件與流程引擎

### 3.1 步驟設定（新檔，例如 `<feature>-editor/<feature>Steps.ts`，純資料＋純函式）

- 型別：答案 `type XAnswers = { stepId?: value }`（`undefined`＝沒答）；情境 `XFlowContext`（答案以外、會影響流程的外部事實，例如「右欄有沒有內容」「哪一步正在產生中」）；已存資料 `XSaved`。
- 匯出一個 `FlowDef<XAnswers, XFlowContext, XSaved>`：
  - `choicePlaceholder`／`textPlaceholder`／`cardPlaceholder`／`pendingPlaceholder`：通用灰字（用 `guidedChat.placeholders.*`）。
  - `done`：全部答完後的狀態（`placeholder`、`intent`、`asyncState`）。
  - `steps`：每個 `StepDef` 的關鍵欄位：

| 欄位 | 寫什麼 |
|---|---|
| `id`、`kind` | 步驟 id；`choice` 選項／`text` 打字／`card` 卡片（卡片自帶確認鈕，對話框停用） |
| `question`／`reask`／`options` | 問句、答非所問的重問句、選項（值＋文字＋說明） |
| `when` | 出現條件，例如 `(a) => a.source === "ai"` |
| `isAnswered` | 已答判斷（預設：值不是 undefined／null） |
| `editable` | 已答過的這一步現在能不能改（例如有內容後不能改來源）；第一次回答不檢查 |
| `clears` | 改成不同答案時一併清掉的步驟；面板資料（文章、圖片、重問句）由 hook 依 `cleared` 清 |
| `confirm` | 改答案前要不要先確認（回 `ConfirmSpec` 或 null） |
| `asyncState` | `idle`／`pending`／`failed`，通常由 `ctx.pending`／`ctx.failed` 推出 |
| `placeholder`／`pendingPlaceholder` | 對話框灰字（這一步、產生中） |
| `intent` | 這一步打字要不要交給 AI 判斷意圖（原則 4） |
| `chip` | 已選項目列的標籤：`visible`、`label`、`value`、`popover`（`options`／`text`／`custom`） |
| `answerText` | 老師這一步的回答怎麼寫進對話紀錄（還原摘要也用） |
| `restore` | 從已存資料還原這一步（`answersFromSaved`）；只用在編輯既有內容，新建從 `{}` 開始 |

- 文字一律用 `text(key, params)` 回 `TextRef`，畫面用 `resolveText` 轉字串。

### 3.2 狀態 hook（照 `useScenarioSetup.ts`）

- 答案 state、對話紀錄 state（`FlowLog`，另存一份，不從答案即時推導）。
- 第一次回答：`applyAnswer` ＋ `appendLog`。在已選項目列改答案：先 `confirmForChange`（`CHANGE_BLOCKED` 就顯示原因、不跳確認框），確認後 `applyAnswer`，紀錄只用 `appendChange` 往下加一句「已把○○改成：…」。
- 編輯既有內容：`answersFromSaved` 還原答案，`summaryLog` 拼摘要紀錄。
- AI 工作進行中：放進 `ctx.pending`，對話框與已選項目列都要停用並寫原因。

### 3.3 畫面

- 外層：`GuidedChatSheet`（`sheet` 或 `modal`），儲存與 ✕ 放標題列。
- 內容：`GuidedChatLayout`，`chat` 放左欄、`side` 放清單（沿用原本的列元件）。
- 左欄由上到下：`SelectedChipsBar`（捲動區外、固定在頂端；Popover 用 `ChipOptionList`／`ChipTextEditor` 或自己畫）→ 對話捲動區（`BotBubble`、`TeacherBubble`、`ChoiceCards`、卡片）→ `ChatComposer`（捲動區外、固定在底端，狀態來自 `composerState`）。
- 難度選擇用 `CefrChips`。

## 步驟 4：驗收

- [ ] 步驟 1 清點表的每一項都有去處：變成問題、自動判斷、沿用外層，或留在清單上。**原有功能一個都不能少**（含手機版、編輯既有內容、各列工具）。
- [ ] 新建從第一個問題開始；編輯既有內容時答案與摘要紀錄正確還原、直接落在清單。
- [ ] 每個標籤的出現與消失、Popover 原地修改、改完紀錄只加一句。
- [ ] 清除規則與確認框照步驟設定；不能改的步驟顯示原因。
- [ ] 選項步驟打字不呼叫 AI；AI 判斷意圖只發生在 `intent` 的地方。
- [ ] 產生中：對話框與已選項目列停用、有原因；失敗時對話框保留原文。
- [ ] 925px 上下切換版面、Tabs 切換時兩邊狀態保留；從對話加入內容後窄版切到清單分頁。
- [ ] 上次的翻譯與語音選擇有帶入；`localStorage` 讀不到時照預設值。
- [ ] i18n 中英文齊全；沒有留下沒引用的舊 key、沒引用的舊元件。
- [ ] 測試：步驟設定（展開、已答、清除、還原）、面板（標籤、打字不呼叫 AI、AI 流程、分頁切換）；原有測試照舊通過。
- [ ] 新增或改到的共用元件已登記 `ui-style-guide.md` 第 6 節與 `REVIEW.md`；改到的檔頭 JSDoc 同步更新。
- [ ] 靜態檢查：`npm run typecheck`，改到的檔跑 eslint、prettier。
