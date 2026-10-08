# 題庫題型架構 — 同一個 sheet、依題型分流

> **ADR** · 建立於 2026-10-06（issue #1087，克漏字父 issue #1080 的 3/3）
> 影響：題庫（`frontend/src/components/question-bank/`、`backend/routers/question_bank*.py`）新增任何題型時都必須遵守。
> 資料表定義見 [`question-bank-schema.md`](./question-bank-schema.md)；layout 格式與驗收樣本見 [`question-bank-layout-samples/README.md`](./question-bank-layout-samples/README.md)。
> 逐步執行流程：skill `/qb-add-type <題型名稱>`（`.claude/skills/qb-add-type/SKILL.md`）。

## 核心原則

題庫的新增／編輯畫面**只有一個**：`QuestionSheet`（左欄批次工具 + 右欄單元列表）。目前有三種可建立的題型：

| 題型 | `question_type` | 單元 kind | 建立端點 |
|------|-----------------|-----------|----------|
| 單題選擇題 | `multiple_choice` | `single` | `POST /api/question-bank/questions` |
| 閱讀題組 | `reading` | `group` | `POST /api/question-bank/question-groups` |
| 克漏字題組 | `cloze` | `group` | `POST /api/question-bank/question-groups` |

加題型 = 在既有分流點各加一個分支（或一個 Panel 元件），**不是**新增路由、新 sheet、新卡片。與批改頁規則相同（[`grading-page-architecture.md`](./grading-page-architecture.md)）。

**題型差異只允許出現在下列幾點**（其餘行為全部共用）：

1. 後端可建立清單與 schema `Literal`
2. 題型專屬驗證（如克漏字空格對應 `check_group_blanks`）
3. 前端草稿層的題型函式（`groupDraft.ts` 的 `isClozeGroup`／`groupStemOptional`…）
4. `GroupCard`／`QuestionCard` 的分流 props（題幹是否可空、小題編號方式、主圖文編輯器模式）
5. 預覽編號方式（`QuestionsPreview` 的 `numbering`）
6. 列表新增下拉、篩選與 i18n 名稱
7. AI 作答／考點分析送出的題幹與上下文
8. 擷取（magic paste）的模式與正規化

## 一、單元／題組骨架

### 前端草稿（`frontend/src/components/question-bank/`）

外部一律從 `questionDraft.ts`（入口，re-export）匯入；實作分三檔：

| 檔案 | 內容 |
|------|------|
| `draftCore.ts` | `QuestionDraft`（單題與題組小題共用）、`emptyDraft`、`draftFromQuestion`、`validateDraft(d, { stemOptional })`、`toCreateInput`／`toUpdateInput`、`errorKeyParts` |
| `groupDraft.ts` | `GroupDraft`、`UnitDraft`、`emptyGroupDraft(question_type)`、`emptyGroupQuestion`、`groupDraftFromGroup`、`validateGroupDraft`、`toCreateGroupInput`／`toUpdateGroupInput`、`unitPassageByKey`、克漏字包裝（`isClozeGroup`、`syncClozeQuestions`、`renumberClozeBlanks`…） |
| `aiDraft.ts` | `draftsEligibleForAi`、`toAiInputs`、`applyAiAnswers`／`applyAiAnalysis`、`clozeAiStem` |
| `clozeDraft.ts` | 克漏字空格純運算（`nextBlankIndex`、`clozeBlankError`、`renumberMap`…），只被 `groupDraft.ts` 使用 |

```ts
type UnitDraft =
  | { kind: "single"; draft: QuestionDraft }   // 單題
  | { kind: "group";  draft: GroupDraft };      // 題組（主圖文 + questions: QuestionDraft[]）
```

- `GroupDraft.question_type` 決定整組題型；小題的 `question_type`／公開／歸屬跟隨題組（`emptyGroupQuestion`、`toCreateGroupInput` 不送小題的這些欄位）。
- `GroupDraft.passage_view` 是純 UI 狀態（目前主圖文分頁），**不送後端**。
- sheet 右欄 `QuestionUnitList.tsx` 依 `unit.kind` 分流：`single` → `QuestionCard`、`group` → `GroupCard`。
- `QuestionSheet.tsx` 的模式由 `questions`／`groupId`／`createType` 決定；`createType` 在 `GROUP_TYPES` 內時右欄是一張 `GroupCard`（一次只建一個題組），擷取改走 `reading_group`。

### 後端

- **單題**：`backend/routers/question_bank.py` `create_question`；只收 `SINGLE_CREATABLE_TYPES`，schema `QuestionCreate`。
- **題組**：`backend/routers/question_bank_groups.py` `create_question_group`／`update_question_group`／`delete_question_group`；題組 + 小題 + 選項／考點／教材／來源／segments **同一個交易**，失敗整組 rollback。PATCH 是整組替換（小題帶 id 更新、無 id 新增、缺席軟刪），並以**合併後**狀態跑題型驗證。
- schema 全在 `backend/routers/question_bank_schemas.py`；輸出格式在 `backend/routers/question_bank_common.py`（`_question_out`、`_group_out`、`_group_row_out`）。
- **`question_groups` 沒有 `question_type` 欄位**：題組題型由第一個有效小題的 `question_type` 推得（`_group_out`、`_group_row_out`、PATCH 新增小題時），沒有小題時退回 `"reading"`。列表的題型篩選對題組也是查小題（`list_questions` 的子查詢）。
- 題組 PATCH schema（`QuestionGroupUpdate`）**不收 `question_type`**：題型建立後不能改。

## 二、layout 與題組素材

### layout（`question_groups.layout` JSONB）

完整規則見 [samples README](./question-bank-layout-samples/README.md)，五組會考樣本是後端正向測試資料。摘要：

- `{"version": 1, "frame"?: bool, "rows": [...]}`；row → `columns`（`span` 比例，最多 3 欄）→ `blocks`。
- **`layout.frame`**（根層，#1082 標題／外框輪加入）：整篇主圖文外包一個框（不含單字註解）；後端只驗布林（`validate_layout`），不需 migration。GroupCard「整篇加外框」勾選、擷取時 AI 回 `stimulus.framed`。
- `section`（`frame: true`）框住一組 rows（兩篇並列的報導）。
- 區塊：`heading`、`paragraph`（行內 `**粗體**`、`__底線__`、`==雙底線==`、克漏字 `{{n}}`）、`image`、`dialogue`。
- 深度驗證：`backend/services/question_bank_layout.py` `validate_layout`／`validate_glossary`；前端 renderer `LayoutRenderer.tsx` + `layoutInline.ts`（老師預覽、學生端、考卷共用同一個）。
- `passage_text` = layout 文字的純文字副本（搜尋／AI）；空格一律 `____`、不帶編號。

### segments（`question_group_segments`，對話文稿）

- 以圖為準的題組有人物對話時，擷取回 `stimulus.dialogue` → 存逐句 `speaker_label` + `transcript`。
- **決策：對話文稿唯讀**（`DialogueTranscriptView.tsx`）。原因：文稿是題組對話音檔（Gemini 2.5 Flash TTS 多說話者）的唯一來源，老師改字而音檔沒重生就會不一致；學生看的是圖，圖上的字本來就改不了。
- `passage_text` 由 segments 推導（開頭非對話文字 + 逐句 `Speaker: line`），前端 `dialogueTranscript.ts`、後端 `dialogue_passage_text`，兩邊同規則。
- 詳見 schema 文件「圖片題組的對話文稿」。聽力類題型會直接用到這張表。

### blank_index 規則（克漏字）

- `{{n}}` 的 n = 小題 `blank_index` = 畫面徽章「空格 n」。空格編號是權威，拖拉區塊不改號。
- 題庫內的編號是**題組內的 1..k**：AI 擷取一律把印刷題號（`__40__`）重編成 `{{1}}`…`{{k}}`；手動插入取 max + 1，老師可按「依閱讀順序重新編號」變回 1..k。**題庫不存原卷題號**。
- 考卷上印出的題號（例如 1–4 顯示為 10–13）由 **P4 組卷時以前面題數為偏移計算**（`LayoutRenderer`／`QuestionsPreview`／`GroupPreview` 屆時加起始題號參數），不改題庫資料。原卷題號另規劃記在「考題來源連結」（見 memory／schema 文件 P4 段落）。
- 前後端同規則驗證：前端 `clozeBlankError`、後端 `validate_cloze_blanks`；非克漏字題組文章不得含 `{{n}}`（`assert_no_cloze_blanks`）。

## 三、現有三種題型對照表

| 差異點 | 單題選擇題 `multiple_choice` | 閱讀題組 `reading` | 克漏字題組 `cloze` |
|--------|-----------------------------|--------------------|--------------------|
| 單元 kind／端點 | `single`／`/questions` | `group`／`/question-groups` | `group`／`/question-groups` |
| 後端清單 | `SINGLE_CREATABLE_TYPES` | `GROUP_CREATABLE_TYPES` | `GROUP_CREATABLE_TYPES` |
| 題幹可空 | 否（題幹／圖／語音至少一個：`QuestionBase.REQUIRES_CONTENT=True`；前端 `validateDraft` 不帶 `stemOptional`） | 後端放行（`GroupQuestionIn.REQUIRES_CONTENT=False`）；前端 `groupStemOptional` = false，仍要求題幹 | 可空（`groupStemOptional` = true；卡片隱藏題幹欄，`QuestionCard clozeBlank`） |
| 小題編號 | 卡片序號 | 陣列順序 1..n，可拖曳排序（`SortableQuestion`） | 依 `blank_index` 排序（`sortClozeQuestions`），不可拖；徽章「空格 n」 |
| 新增小題 | —（sheet「新增題目」） | GroupCard「新增小題」→ `emptyGroupQuestion` | 「插入空格」→ `{{n}}` + `syncClozeQuestions` 自動建卡；`addClozeBlank` |
| 主圖文編輯器 | — | `LayoutEditor` | `LayoutEditor clozeMode`（段落工具列多「插入空格」） |
| 題型專屬驗證 | 批內／庫內重複（`normalized_stem`） | 文章不得有 `{{n}}`（`assert_no_cloze_blanks`） | 空格集合 = 小題 `blank_index` 集合、不重複（`validate_cloze_blanks`／`clozeBlankError`）；`DELETE /questions/{id}` 拒刪克漏字小題 |
| 擷取 extract_mode | `multiple_choice` → `_normalize_mc_items` → `draftsFromExtracted` | `reading_group` → `_normalize_reading_group` → `groupDraftFromExtracted`；拿到 `{{n}}` 轉回 `____`（`stripBlankTokens`） | `reading_group`（同上）；保留 AI 重編的 `{{1..k}}`，小題 `blank` 對位或 `matchClozeBlanks` 依閱讀順序補配 |
| 擷取素材 `stimulus.kind` | — | `text`（段落＋`figures`）或 `image`（整塊裁圖＋可選 `dialogue`） | 實務上 `text`（空格在文字裡） |
| AI 作答／考點分析輸入 | `stem` | `stem` + `passage`（`groupPassageText`） | 空題幹送 `Fill in blank (n).`（`clozeAiStem`）+ 保留編號的 passage（`layoutToNumberedText`：`(n)____`）；後端 `PASSAGE_RULE` 說明 |
| 預覽 | `SheetPreviewButton` → `QuestionsPreview numbering="sequential"` | `GroupPreview`（`LayoutRenderer` + `QuestionsPreview` sequential） | `GroupPreview` + `QuestionsPreview numbering="blank"`（不顯示題幹、缺空格琥珀標記） |
| 列表名稱 | `questionBank.types.multiple_choice` | 篩選／列表 `groupTypes.reading`；新增下拉 `types.reading` | `groupTypes.cloze`／`types.cloze` |

## 四、加題型檢查清單

每一步都標「改哪個檔、哪個函式、怎麼驗」。路徑相對 repo 根目錄。先決定新題型是 **單題**（`single`）還是 **題組**（`group`），並在動工前列出「這個題型在第三節對照表每一列的值」。

### 1. 後端題型清單

- `backend/models/question_bank.py` `QUESTION_TYPES`：應用層值域常數（列表篩選用它驗 400）。已預留 `fill_in`／`listening`／`listening_image`；新值不在清單內才要加。`questions.question_type` 在 DB **沒有** CHECK（`20260916_1000_add_question_bank.py`），新題型值不需 migration；但 `question_groups.stimulus_type` 有 CHECK `ck_question_groups_stimulus_type`（`passage`／`audio`／`dialogue`／`image`／`mixed`），要新素材類型才需 migration（照 CLAUDE.md 冪等規則）。
- `backend/routers/question_bank_schemas.py`：
  - `SINGLE_CREATABLE_TYPES` 或 `GROUP_CREATABLE_TYPES` 加入新值（`CREATABLE_TYPES` 自動合併）
  - schema `Literal`：單題 → `QuestionCreate.question_type`；題組 → `QuestionGroupCreate.question_type`
  - 新題型需要新的輸入欄位時（例如題組整段音檔 `audio_url`：DB 欄位已有、`_group_out` 已輸出，但 `QuestionGroupCreate`／`QuestionGroupUpdate` **目前不收**），在兩個 schema 與 `create_question_group`／`update_question_group` 一起補
- 驗：`POST` 新題型回 201；不在清單的題型回 400／422。

### 2. 題型專屬驗證

- 共用的驗證掛點：`check_group_blanks(question_type, layout, blank_indexes)`（建立時由 `QuestionGroupCreate._check` 呼叫、PATCH 時由 `update_question_group` 以合併後狀態呼叫）。新題型有結構規則就在這個函式加分支，或照它的形式另寫一個 `check_group_<rule>` 並在**同兩處**呼叫。注意：非 `cloze` 題型預設走 `assert_no_cloze_blanks`。
- 純排版規則放 `backend/services/question_bank_layout.py`，拋 `LayoutError(path, message)`。
- 小題內容要求：`GroupQuestionIn.REQUIRES_CONTENT`（題組小題目前一律 False）；單題 `QuestionBase.REQUIRES_CONTENT`。
- 單題端點對題組小題的保護（如 `delete_question` 拒刪克漏字小題）視需要比照。
- 驗：新測試檔 `backend/tests/test_question_bank_<type>.py`（比照 `test_question_bank_cloze.py`：建立、PATCH 合併後驗證、422 訊息帶路徑）。

### 3. 前端型別與草稿

- `frontend/src/types/questionBank.ts` `QuestionType`：新值（已預留的不用改）；新輸入欄位加到 `QuestionGroupCreateInput`／`QuestionGroupUpdateInput`。
- `frontend/src/components/question-bank/groupDraft.ts`：
  - `GroupDraft` 新欄位 + `emptyGroupDraft`／`groupDraftFromGroup`／`toCreateGroupInput`／`toUpdateGroupInput` 對應
  - 題型判斷函式：比照 `isClozeGroup`、`groupStemOptional` 新增 `is<Type>Group`；**不要**在元件裡散寫 `question_type === "xxx"`
  - `validateGroupDraft`：題型專屬前端驗證（與後端同規則，回 i18n key）
  - `groupHasStimulus`：新素材（音檔、segments）是否算「有主圖文」
  - `unitPassageByKey`：AI 上下文用哪個版本的文字
- 單題題型改 `draftCore.ts`（`emptyDraft`、`validateDraft`、`toCreateInput`）。
- 純運算多時另開 `<type>Draft.ts`（比照 `clozeDraft.ts`，依賴方向 groupDraft → <type>Draft，不反向）。
- 驗：`frontend/src/components/question-bank/__tests__/questionDraft.test.ts` 或新 `<type>Draft.test.ts`。

### 4. sheet 分流

- `frontend/src/components/question-bank/QuestionSheet.tsx` `GROUP_TYPES`：題組題型加入（與後端 `GROUP_CREATABLE_TYPES` 對齊）。標題用 `questionBank.types.<type>`。
- `QuestionUnitList.tsx`：只依 `kind` 分流，一般不用改。
- 驗：從列表「新增題目 ▽」選新題型 → 右欄出現 GroupCard（或 QuestionCard）。

### 5. 卡片分流 props

- `GroupCard.tsx`：用第 3 步的題型函式切換——標題 `questionBank.groupTypes.<type>`（自動）、`LayoutEditor` 模式（如 `clozeMode`）、小題區（`isCloze ? 空格卡 : SortableQuestion`）、新增小題鈕、文字版分頁（有 segments → `DialogueTranscriptView`）。新素材控制（例如音檔播放／上傳）放在 GroupCard 主圖文區內，必要時抽成 `GroupCard<Xxx>.tsx` 子元件由 GroupCard 依題型渲染。
- `QuestionCard.tsx`：只透過 props 分流（`stemOptional`、`clozeBlank`、`compact`、`testIdPrefix`）。新題型需要不同小題外觀就**加 prop**，不要複製卡片。
- `LayoutEditor.tsx`／`LayoutBlockEditor.tsx`：編輯器模式 prop（比照 `clozeMode`）。
- 驗：元件測試比照 `__tests__/GroupCard.test.tsx`、`GroupCardCloze.test.tsx`（新檔 `GroupCard<Type>.test.tsx`）。

### 6. 預覽

- `GroupPreview.tsx`：依 `draft.question_type` 決定 `QuestionsPreview` 的 `numbering`、是否顯示題幹、素材呈現（排版／文字版／對話）。`GroupPreviewData` 若要新欄位一起加；`groupPreviewHasContent` 決定預覽鈕是否可按。
- `QuestionsPreview.tsx`：新編號方式加到 `numbering` 聯集（目前 `"sequential" | "blank"`）。
- `SheetPreviewButton.tsx`／`LayoutPreviewDialog.tsx`：一般不用改（標題列預覽鈕三題型共用）。
- 驗：`__tests__/GroupPreview.test.tsx`、`QuestionsPreview.test.tsx`。

### 7. 列表：新增下拉、篩選、名稱

- `frontend/src/components/question-bank/QuestionBankToolbar.tsx`：`CREATE_TYPES` 把該題型 `enabled: true`（未列入就加）；`CREATE_TYPES_ORDER`（= `TYPE_FILTERS`，篩選下拉順序）。
- `QuestionBankTab.tsx` `groupTypeLabel`：題組題型目前**寫死** `type === "reading" || type === "cloze"`，新題組題型要加進去（否則列表／篩選顯示單題名稱）。
- `GroupRow.tsx`／`QuestionRow.tsx`：只用 `typeLabel`，一般不用改。後端 `list_questions` 的題型篩選自動涵蓋。
- 驗：`__tests__/QuestionBankTab.test.tsx`（`question-bank-add-<type>` testid）。

### 8. i18n

- `frontend/src/i18n/locales/zh-TW/translation.json`、`en/translation.json`：
  - `questionBank.types.<type>`（新增下拉、sheet 標題）
  - `questionBank.groupTypes.<type>`（題組題型：列表、篩選、GroupCard 標題）
  - 新驗證 key（`questionBank.form.errors.*`）、新 UI 字串（`questionBank.group.*`）
- 驗：兩語系 key 數量一致；畫面無 raw key。

### 9. AI 作答／考點分析

- `frontend/src/components/question-bank/aiDraft.ts` `toAiInputs`：小題題幹空白時送什麼（比照 `clozeAiStem`）；`draftsEligibleForAi` 的資格。
- `groupDraft.ts` `unitPassageByKey`：上下文文字（例如聽力用 segments 逐句文稿）。
- `backend/services/question_bank_ai.py`：`PASSAGE_RULE`／`build_answer_prompt`／`build_analyze_prompt` 說明新上下文格式；`normalize_inputs` 的長度上限（`MAX_PASSAGE_CHARS`）。
- 驗：`backend/tests/test_question_bank_ai.py`（prompt 含說明句）；前端 `questionDraft.test.ts` 的 `toAiInputs` 案例。

### 10. 擷取（magic paste）

- `backend/services/magic_paste_service.py`：
  - 新 extract mode 才需要：`EXTRACT_MODE_*` 常數、`EXTRACT_MODES`（`backend/routers/magic_paste.py` 用它驗 422）、`_build_prompt` 分支、`extract` 內的 normalize 分派
  - 沿用 `reading_group` 時：在 prompt 補新素材欄位（例如聽力稿），`_normalize_reading_group` 正規化（`stimulus.kind` 值域 `STIMULUS_KINDS`、`_normalize_figures`、`_normalize_dialogue`、`_normalize_mc_items`）
- 前端：`frontend/src/components/shared/MagicPasteInput.tsx`（`MagicPasteExtractMode`、`MagicPasteGroupResult` 與後端回傳對應）；`QuestionSheet.tsx` 傳的 `extractMode`；`QuestionBankBatchPanel.tsx` `extractMode` 聯集；`extractedGroup.ts` `groupDraftFromExtracted`（依 `base.question_type` 分支，比照 `isCloze`）；裁圖上傳 `extractedImages.ts`、`useExtractedGroup.ts` 一般不用改。
- 驗：`backend/tests/test_magic_paste_endpoint.py`、`test_magic_paste_reading_group_frame.py`（normalize 單元測試）；前端 `__tests__/extractedGroup.test.ts`、`useExtractedGroup.test.tsx`。

### 11. 驗收樣本

- 題組題型：在 `docs/design/question-bank-layout-samples/` 加一份手寫 JSON（真實考卷一組題目），README 表格加一列；後端 `backend/tests/test_question_bank_layout.py` 會把樣本當正向資料（新題型若有專屬驗證，再用樣本跑一次）。
- 測試資料要用真實情境（例如克漏字小題就是空題幹無圖），不要塞內容繞過驗證。

### 12. 文件同步

- 本文件第三節對照表加一欄、第一節題型清單加一列。
- `docs/design/question-bank-schema.md`：題型專屬欄位或規則段落（比照「克漏字題組（#1085）」）。
- 改到的檔案頂部 JSDoc／docstring（例如 `QuestionSheet.tsx` 模式說明、`QuestionUnitList.tsx`、`question_bank_groups.py`）。

### 測試檔位置總覽

| 層 | 位置 |
|----|------|
| 後端 | `backend/tests/test_question_bank_api.py`（單題／列表）、`test_question_bank_cloze.py`、`test_question_bank_dialogue.py`、`test_question_bank_layout.py`、`test_question_bank_ai.py`、`test_magic_paste_*.py` |
| 前端 | `frontend/src/components/question-bank/__tests__/`（草稿：`questionDraft.test.ts`、`clozeDraft.test.ts`；元件：`GroupCard*.test.tsx`、`GroupPreview.test.tsx`、`QuestionsPreview.test.tsx`、`QuestionBankTab.test.tsx`；擷取：`extractedGroup.test.ts`、`useExtractedGroup.test.tsx`）、`frontend/src/components/shared/__tests__/MagicPasteDialog.test.tsx` |

## 五、禁止事項

- **不另開路由**：題庫新增／編輯一律在 `QuestionSheet`，由列表 `onCreate(type)` → `createType` 進入。
- **不複製** `QuestionSheet.tsx`、`GroupCard.tsx`、`QuestionCard.tsx`（也不要 `ListeningGroupCard.tsx` 這種整張複製）。差異用 props 或在 GroupCard 內依題型渲染的子元件處理，與批改頁「同路由 + Panel 分流」同原則。
- 題型判斷集中在草稿層函式（`isClozeGroup` 類），元件不散寫字串比較；目前已知的散寫點是 `QuestionBankTab.tsx` `groupTypeLabel`、`GroupPreview.tsx`、`aiDraft.ts`、`extractedGroup.ts`，加題型時一併檢查。
- 不為了題型建新表；「加題型不動 migration」是原則（P0 migration 已一次建齊題組／分段／聽力欄位），必要時加 nullable 欄位（冪等寫法）。
- 單檔 ≤ 1000 行（`check-file-size.py`）。`GroupCard.tsx`（~780 行）、`QuestionSheet.tsx`（~790 行）已接近上限，新題型的 UI 優先拆成子元件。

## 六、已知缺口（下一個題型會碰到）

- 題組整段音檔 `question_groups.audio_url`：DB 有、`_group_out` 有輸出，但建立／PATCH schema 不收、`GroupDraft` 沒有欄位、GroupCard 沒有播放／上傳 UI。
- segments 的 `audio_url`／`tts_voice`／`pause_after_ms` 尚未使用；題組對話音檔生成（Gemini 2.5 Flash TTS 多說話者，上限 2 人，三人以上分段串接）尚未實作。
- `questions.segment_id`（小題只針對某一段）預留，無 UI。
- 學生端作答與考卷題號偏移屬 P4／P5。
