# 題庫（Question Bank）資料庫設計 — Issue #1061 P0

> 討論紀錄與定案。P1-P3（題庫 tab / 新增選擇題 / 查詢 filter）依此實作；
> P4-P5（派發、考卷 PDF）另開 issue，但本設計已為混合題型試卷留位。
>
> **新增題型**（單題／題組骨架、三種題型對照表、加題型檢查清單）見 [`question-bank-question-types.md`](./question-bank-question-types.md)，或用 skill `/qb-add-type`。

## 定案摘要

| 議題 | 決定 |
|------|------|
| 題庫 vs 既有 ContentItem | **開新表**。題庫是「一題可被多份考卷重用」的多對多；`ContentItem` 綁 `content_id` + `order_index`，不適合 |
| 選項儲存 | **獨立表 `question_options`**，以便做誘答選項統計 |
| 考點 | **有階層**、**平台維護**、名稱**多語**（zh-TW / en，未來可加）、**同一考點只能有一個正式名稱**，異名靠 alias 歸一 |
| 考點寫入來源 | 老師手動或 **AI 考點分析**。AI 只能從既有考點清單挑選，不得自由造字；對不到的送「待審」 |
| K12 年級 | 不當 tag，`questions.grade_min / grade_max` 數值欄位，方便範圍查詢 |
| 歸屬與公開 | 照抄 `Program` 模式：`teacher_id / organization_id / school_id` + `visibility` |
| 平台題庫 | 由 `contact@duotopia.co` 帳號建置，**恆為全公開** |
| 老師 / 機構題庫 | 自選是否公開；一旦公開視為公有財 |
| 重複偵測範圍 | 該老師**私人題庫 + 全部公開題目** |
| 多題型 | 主表 `questions` 全題型共用；「一份素材配多題」（文章閱讀、克漏字、獨白／對話聽力）用**題組 `question_groups`**，對話素材再拆 `question_group_segments`；填充題不走選項表 |
| 派發 | 沿用既有 `Content` 作業副本機制（`is_assignment_copy` / `source_content_id`）。混合題型試卷需把 `practice_mode` 從 Assignment 層下放到 Content 層 → P4 處理 |

## 資料表

### `questions` — 題目主表（所有題型共用）

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | serial PK | |
| question_type | varchar(30) NOT NULL | `multiple_choice` / `reading` / `cloze` / `listening_image` / ... 本期只實作 `multiple_choice` |
| stem | text NOT NULL DEFAULT '' | 題幹；純圖題可為空字串，但 CHECK `ck_questions_has_content` 要求 stem / image_url / stem_audio_url 至少一個（題組小題 `group_id` 有值者除外） |
| normalized_stem | text NOT NULL DEFAULT '' | 正規化題幹（小寫、去標點、壓空白），重複偵測用；空字串不做去重 |
| stem_audio_url | text | 題幹語音（語音生成工具只生成題幹，不生成選項） |
| image_url | text | PDF/圖片上傳 |
| explanation | text | 解析（AI 作答或老師填寫） |
| grade_min | smallint | K12 年級下限 1-12 |
| grade_max | smallint | K12 年級上限 1-12，CHECK grade_min <= grade_max |
| allow_multiple_answers | boolean default false | 正確答案可複選 |
| show_stem_text | boolean default true | 聽力題設 false → 學生只聽不看題幹 |
| accepted_answers | jsonb, nullable | 填充題可接受答案清單 `["colour","color"]`；選擇題為 NULL |
| answer_match_mode | varchar(20), nullable | 填充題比對規則：`exact` / `case_insensitive` / `ignore_punctuation` |
| group_id | int FK question_groups ON DELETE CASCADE, nullable | 屬於題組時填；一般單題為 NULL |
| group_order | smallint, nullable | 題組內順序 |
| blank_index | smallint, nullable | 克漏字：對應 `question_groups.layout` 內 `{{n}}` 的 n（1–999，#1085） |
| segment_id | int FK question_group_segments, nullable | 預留：小題只針對對話中某一段（本期不做 UI） |
| teacher_id | int FK teachers | 建立者（平台題庫 = contact@duotopia.co 對應的 teacher） |
| organization_id | uuid FK organizations, nullable | 機構題庫 |
| school_id | uuid FK schools, nullable | 學校題庫 |
| visibility | varchar(20) default 'private' | 與 `ProgramVisibility` 同值域：private / public / organization_only / individual_only |
| is_platform | boolean default false | 平台題庫標記，為 true 時 visibility 強制 public（CHECK） |
| source_question_id | int FK questions, nullable | 從公開題庫複製到自己題庫時的來源 |
| is_active / deleted_at | | 軟刪除，與其他表一致 |
| created_at / updated_at | | |

索引：
- `UNIQUE (teacher_id, normalized_stem) WHERE is_active AND group_id IS NULL AND normalized_stem <> ''`  — 擋同一老師完全重複（題組小題、純圖題不套用）
- `GIN (normalized_stem gin_trgm_ops)` — 相似題查詢，需 `CREATE EXTENSION IF NOT EXISTS pg_trgm`
- `(question_type, visibility)`、`(organization_id)`、`(grade_min, grade_max)`

### `question_options` — 選項

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | serial PK | |
| question_id | int FK questions ON DELETE CASCADE | |
| order_index | smallint NOT NULL | 0-5，UI 固定 6 格，至少填 2 個 |
| text | text NOT NULL DEFAULT '' | 純圖選項可為空字串，但 CHECK `ck_question_options_has_content` 要求 text / image_url / audio_url 至少一個 |
| is_correct | boolean default false | 至少一個 true（應用層驗證） |
| audio_url | text | 聽力題選項可為音檔 |
| image_url | text | 圖片聽力題選項可為圖片 |

`UNIQUE (question_id, order_index)`

> 填充題不建 options 列，答案存 `questions.accepted_answers`——填充題沒有「被選走的干擾項」可統計，硬塞 options 表會讓選擇題的誘答統計 query 一直要排除它。

> 學生作答紀錄未來以 `option_id` 存，選項順序調整不影響統計。

### `question_groups` — 題組（一份素材配多題）

適用：文章閱讀選擇、克漏字閱讀選擇、獨白型聽力、對話型聽力、圖片題組。

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | serial PK | |
| stimulus_type | varchar(20) NOT NULL | `passage` / `audio` / `dialogue` / `image` / `mixed` |
| title | varchar(200) | 題組標題（列表顯示用） |
| passage_text | text | 文章的純文字副本（搜尋／AI）；空格一律去編號成 `____`。帶編號的 `{{n}}` 只存在 `layout` 裡 |
| audio_url | text | 整段合併音檔（播放快取；segments 變動時重生成） |
| image_url | text | 以圖為準的題組（海報／漫畫／地圖）整組原圖 |
| layout | jsonb | 排版樹（#1079 閱讀題組，migration 在 sub-issue #1081；見下方「layout 格式」）；NULL 時退回 `passage_text` + `image_url` |
| glossary | jsonb | 單字註解 `[{"word": "...", "zh": "..."}]`（#1079/#1081） |
| grade_min / grade_max | smallint | 題組層預設，小題可覆寫 |
| teacher_id / organization_id / school_id / visibility / is_platform | | 與 `questions` 相同；**題組內題目的 visibility 跟隨題組**（應用層同步） |
| is_active / deleted_at / created_at / updated_at | | |

規則：題組整組公開／派發／刪除，不可單獨派其中一題。考點掛在小題層（`question_exam_points`），題組層不掛。

#### layout 格式（#1079 閱讀題組，欄位由 #1081 加入）

完整定義與五組驗收樣本見 [`question-bank-layout-samples/README.md`](./question-bank-layout-samples/README.md)。摘要：

- `{"version": 1, "rows": [...]}`；`rows` 由上到下，每個 row 有 `columns`，每欄 `span` 為比例（允許 1:1、1:2、2:1、1:1:1），欄內是 `blocks`
- `section`（`frame: true`）把一組 rows 框起來（兩篇並列的報導各一個 section）
- 區塊：`heading`、`paragraph`（可含 `**粗體**`、`__底線__`、克漏字 `{{n}}`）、`image`、`dialogue`
- 手機寬度時同一 row 的欄位依序上下堆疊，不做自由拉寬度；老師預覽、學生端、考卷共用同一個 renderer
- 原卷「文繞圖」刻意改成「左文右圖 + 下一段全寬」
- `passage_text` 為 layout 內所有文字區塊拼出的純文字副本，供搜尋、重複偵測、AI 考點分析；以圖為準的題組由 AI 擷取填入、老師可在「文字版」分頁修改

#### 克漏字題組（#1085）

> 與單題選擇題、閱讀題組的差異點對照見 [`question-bank-question-types.md`](./question-bank-question-types.md)「三、現有三種題型對照表」。

克漏字 = 閱讀題組的文字區塊裡有 `{{n}}` 空格，每個空格對一個小題。`question_groups.question_type` 由小題的 `question_type = 'cloze'` 推得，`questions.blank_index` 存空格編號。

- **空格編號是權威**：`{{n}}` 的 n 就是小題的 `blank_index`，也是畫面顯示的編號。拖拉重排區塊**不改編號**；手動插入時 n = **目前（文章與小題）最大編號 + 1**（新題組從 1 開始；文章已有 1–4 時接著插入拿到 5）。**AI 擷取一律把印刷空格重編成 1..k**（見下方「考卷擷取」），所以題庫不存原卷題號（如 40–43）；考卷上實際印出的題號由派發時的排版位置決定（P4／P5）。只有 max + 1 超過上限 999 時才退回「最小未使用編號」—— 以前是 clamp 回 999，但 999 已被用掉會變成兩張小題對同一個空格；1–999 全部用完時回 `null`，「插入空格」與「在文末插入空格」按鈕 disabled（`group.layout.blankLimit`）。老師按「依閱讀順序重新編號」才會把 layout 的 `{{舊}}` 與小題 `blank_index` 一起映射成 1..k（一次 replace 完成，交換編號不會互撞）。
- **插入**：段落聚焦工具列的「插入空格」在游標處插入 `{{n}}`（非包裹式）。只改文字 —— 對應的小題卡由 `syncClozeQuestions` 從空格差集自動建立，狀態只有一份。「在文末插入空格」把 `{{n}}` 加到最後一個段落尾端（沒有段落就補一列）。
- **刪除**：文字變更後比對前後的空格集合；消失的編號若對應小題還是「空白」（無題幹／圖、無填好的選項、無考點、無解析）就自動移除，有內容則保留並在卡上標「找不到空格 n」，提供「重新插入到文末」與「刪除小題」，驗證阻擋儲存。
- **只有完整 `{{n}}` 配對才算空格**：老師打到一半的 `{{4` 不會觸發同步。
- **小題卡**：隱藏題幹文字框與題幹插圖，標題改成徽章「空格 n」；選項、正確答案、考點、解析、進階不變。列表依 `blank_index` 升冪，不開放拖曳排序。
- **驗證**（前端 `clozeBlankError`、後端 `services/question_bank_layout.validate_cloze_blanks`，同規則）：layout 至少要有一個空格；每個小題都要有 `blank_index`；編號不可重複（小題之間，以及**文章內同一個 `{{n}}` 不可出現兩次** —— 兩個空格只能對一張小題）；layout 的空格集合與小題 `blank_index` 集合必須相等。不合格建立／PATCH 皆回 422 並指出缺的或多的編號。PATCH 以**合併後**的狀態檢查，所以只改 layout 把空格刪掉也會被擋。
- **reading 題組的文章不得含 `{{n}}`**（`assert_no_cloze_blanks`）→ 422「請改用克漏字題組」。
- **小題不需要自身題幹／插圖／語音**：題組小題（reading 與 cloze）一律放行空題幹，題幹由文章承擔（DB `ck_questions_has_content` 本來就排除 `group_id` 非空的列）。單題端點 `POST /questions` 維持「題幹／圖片／語音至少一個」。
- **克漏字小題不能從單題端點刪**：`DELETE /questions/{id}` 對 `blank_index` 非空回 422「克漏字小題請在題組內刪除」，否則題組會永遠驗證失敗（文章的空格沒有對應小題）。
- **`passage_text`（搜尋用）維持 `____`**，不帶編號。
- **AI 作答／考點分析**：小題題幹空白時送 `Fill in blank (n).`；passage 改用保留編號的版本（`layoutToNumberedText`：`{{3}}` → `(3)____`），prompt 另有一行說明 `(n)____` 代表第 n 個空格。

#### 考卷擷取（magic paste `reading_group` / `multiple_choice`，#1084／#1086）

上傳一份考卷圖片或 PDF → `backend/services/magic_paste_service.py` 一次 AI 呼叫回結構化結果，前端自己裁圖。

- **素材**：`stimulus.kind = "text"`（散文、書信、對話）或 `"image"`（海報／漫畫／地圖／時刻表，版面即內容，整塊裁成一張圖）。`box_2d` 一律 `[ymin, xmin, ymax, xmax]`、0–1000 正規化。
- **文章內插圖**：`stimulus.figures[] = { box_2d, after_paragraph, caption }`，只在 `kind = "text"` 回。`after_paragraph` 是 `paragraphs` 的 0-based 索引（-1 = 第一段之前），前端 `paragraphsToLayout` 把圖片區塊插在那一段之後、同一欄直排（`align: center`，不設寬度），老師可再拖成並排。
- **題幹圖與選項圖**：`questions[i].stem_box_2d`、`questions[i].option_boxes`（與 `options` 等長，不是圖的位置為 `null`）。**圖片選項可以沒有字**：`options[i]` 為空字串、靠 `option_boxes[i]` 認；normalize 的「選項非空」規則改成「有字或有座標」。列表對這種選項顯示「(圖片)」。
- **克漏字空格**：AI 必須把文章內的印刷空格（`__40__`、`___(40)___`、`(40)` …）**依閱讀順序重寫成 `{{1}}`…`{{k}}`**（`blanks_renumbered`），每個小題回對應的 `blank`。前端只在「每題都有 blank、不重複、且集合等於文章空格集合」時採用；否則整批改依閱讀順序補配（文章第 i 個空格 ↔ 第 i 題，`matchClozeBlanks`），多出來的小題 `blank_index` 留 `null` 交既有驗證提示。閱讀題組若意外拿到 `{{n}}`，前端轉回底線 `____`（避免 `assert_no_cloze_blanks` 422）。
- **裁圖在前端**：所有 box 攤平成一批交給 `cropImageFileMany`（原圖只解碼一次），再循序上傳（`uploadCroppedBoxes`）。單張裁切或上傳失敗只讓那個位置變 `null`，不中斷其他張，老師可在卡片上換圖。
- **PDF 不能裁圖**（前端沒有 pdf.js）：文字與空格照常擷取，圖片全部略過並 toast 提示手動補圖。

#### 題組端點與列表（#1082）

- `POST /api/question-bank/question-groups`：題組 + 小題 + 選項／考點／教材／來源同一個交易，任何失敗整組 rollback；小題的題型／公開／歸屬跟隨題組，年段未給時繼承
- `GET /api/question-bank/question-groups/{id}`、`PATCH …/{id}`（整組替換：小題帶 id 更新、無 id 新增、缺席軟刪；未知 id → 422）、`DELETE …/{id}`（整組含小題軟刪除）；可見／可編輯規則與單題相同
- `layout`／`glossary` 由 `backend/services/question_bank_layout.py` 深度驗證（區塊型別、必要欄位、數量與長度上限），不合格回 422 並指出路徑；五組樣本 JSON 為正向測試資料
- `GET /api/question-bank/questions` 回傳單題與題組列混合：每列帶 `kind: "single" | "group"`，題組列含 `title`、`preview`（文章前 200 字）、`question_count`、小題來源與考點的聯集；小題不單獨出現。分頁在 SQL 層合併（單題／題組各投影 `(kind, id, updated_at)` UNION ALL 後排序 `updated_at desc nullslast, id desc`，offset/limit 只取本頁鍵，再各自 selectinload），`total` = 兩邊 count 相加
- 列表對題組的操作：勾選、公開快速改（`PATCH` 只帶 `visibility`）、批次刪除、列尾刪除；批次編輯與派發只對單題

### `question_group_segments` — 題組素材分段（對話／獨白聽力）

對話聽力有 2-3 位角色穿插說話，每一句是一段、各自有音檔與語音角色。獨白 = 只有一段的特例。文章閱讀的 `passage_text` 仍放題組層，不拆段。

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | serial PK | |
| group_id | int FK question_groups ON DELETE CASCADE | |
| order_index | smallint NOT NULL | 播放順序 |
| speaker_label | varchar(50) | `Man` / `Woman` / `Narrator` / 角色名 |
| transcript | text NOT NULL | 該段文字；TTS 來源，老師示範卷逐段顯示 |
| audio_url | text | 該段音檔（TTS 生成或上傳） |
| tts_voice | varchar(100) | 該角色語音 id（沿用 `backend/utils/ttsVoiceResolver.py`） |
| pause_after_ms | int default 0 | 段後停頓 |

`UNIQUE (group_id, order_index)`

#### 圖片題組的對話文稿（#1083，2026-10-06 開始使用）

以圖為準的題組（漫畫、對話情境圖）擷取時，AI 另回逐句對話 `stimulus.dialogue = [{speaker, text}]`，存成這張表的一句一段（`order_index` 依閱讀順序、`speaker_label`、`transcript`；`audio_url`／`tts_voice`／`pause_after_ms` 留給之後的題組對話音檔）。不需要 migration。

- **API**：`POST`／`PATCH /question-groups` 收 `segments: [{speaker_label, transcript}]`（兩者都不可空白；說話者 ≤50 字、台詞 ≤2000 字、最多 100 句）。建立時依序寫入；PATCH 有帶就整組替換（`[]` = 清掉），不帶不動。`GET` 與建立／更新回應都帶 `segments`。
- **`passage_text` 由 segments 推導**：格式為「非對話文字（標題、旁白、標示；可無）＋空行＋逐句 `Speaker: line`」。後端只保留送來文字版**開頭**的非對話文字（結尾必須正好是這份對話，否則旁白也不留），對話部分一律由 segments 重組；PATCH 只改排版時沿用原本的旁白。沒有 segments 的題組（海報、地圖、散文、舊資料）規則不變。
- **說話者命名**（使用者定案；一律不加冠詞 the，比照會考／英檢聽力稿 `Man:`、`Woman:`）：
  1. 素材印有人名且能明確對應到說話者 → 用人名（小題會用名字提問，例如 Hank、David、Mary）；對應不確定就退回下面的規則
  2. 圖中有明確職業或角色 → 職稱：Teacher、Doctor、Clerk、Coach…
  3. 依外觀用英文泛稱：Girl／Boy／Woman／Man；多人一起說用 Girls／Boys／Women／Men，混合群體 Boy and girl、Boys and girls
  4. 同類出現兩人以上加代號：Girl A、Girl B；Boy A、Boy B；Woman A、Woman B；Man A、Man B

  擷取整理（`_normalize_dialogue`）另把說話者開頭的 `the ` 去掉並首字大寫，再保險一次。
- **決策：對話文稿不可修改**。編輯畫面「文字版」分頁有 segments 時以唯讀對話樣式顯示（說話者粗體＋冒號＋台詞、逐句交錯底色，上方說明「對話文稿由 AI 從圖片整理，會用來產生音檔，無法修改」），沒有 segments 時維持可編輯文字框。原因：
  - 對話文稿是題組對話音檔的唯一來源（一題組一個音檔，Gemini 2.5 Flash TTS 多說話者）；老師改了文稿而音檔沒重生，文字與聲音就會不一致
  - 圖片上的文字本來就改不了，學生看到的是圖；以 AI 整理的逐句對話為準
  - 原本的問題是「圖片擷取出的文字一整坨疊在一起、難以對照」。不做「點圖分段修改」，改用清楚的說話者標示解決

### `exam_points` — 考點（平台維護、有階層、多語）

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | serial PK | |
| code | varchar(100) UNIQUE NOT NULL | 穩定識別碼，如 `grammar.tense.present_perfect`；AI 分析回傳的是 code，不是名稱 |
| parent_id | int FK exam_points, nullable | 階層 |
| names | jsonb NOT NULL | `{"zh-TW": "現在完成式", "en": "Present Perfect"}`，未來直接加 key |
| description | jsonb | 同上結構，選填 |
| status | varchar(20) default 'active' | `active` / `pending`（AI 提議待平台審核）/ `merged`（已合併到 `merged_into_id`） |
| merged_into_id | int FK exam_points, nullable | 被合併時指向正式考點；查詢時自動 redirect |
| order_index | int | 同層排序 |
| created_at / updated_at | | |

索引：`(parent_id)`, `(status)`, `GIN (names)`

### `exam_point_aliases` — 考點異名歸一

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | serial PK | |
| exam_point_id | int FK exam_points ON DELETE CASCADE | |
| alias | text NOT NULL | 「現完式」「現在完成時態」「present perfect tense」 |
| lang | varchar(10) | `zh-TW` / `en` |

`UNIQUE (lower(alias))` — 一個異名只能對到一個考點。

用途：老師手動輸入或 AI 回傳非正式名稱時，先查 alias 表對回正式考點；老師在查詢 filter 打「現完式」也能命中「現在完成式」。

### `question_exam_points` — 題目 ↔ 考點（多對多）

| 欄位 | 說明 |
|------|------|
| question_id | FK questions ON DELETE CASCADE |
| exam_point_id | FK exam_points |
| source | `manual` / `ai` — 記錄是誰標的，日後評估 AI 準確度 |
| PK (question_id, exam_point_id) | |

### `question_sources` — 來源標註（歷屆考題 / 出版社版本）

| 欄位 | 說明 |
|------|------|
| id | serial PK |
| source_type | `exam` (歷屆考題) / `publisher` (出版社版本) |
| name | 如「113 學年度會考」「康軒 B2 U3」 |
| year | smallint, nullable |
| organization_id | nullable；有值 = 機構自建 |
| teacher_id | nullable；有值 = 個人老師自建（編輯面板可打字下拉直接新增） |

兩者皆 NULL = 平台公用。可見範圍 = 平台公用 + 所屬機構 + 自己建的；`POST /api/question-bank/sources` 同名同型別回既有那筆。

`question_source_links (question_id, source_id)` 多對多。

> 跟考點分開的原因：考點是「教什麼」，來源是「哪裡來」，兩者維護者與查詢方式不同，不混在同一棵樹。

### `question_program_links` — 題目 ↔ 教材包 / 單元

| 欄位 | 說明 |
|------|------|
| question_id | FK questions ON DELETE CASCADE |
| program_id | FK programs ON DELETE CASCADE |
| lesson_id | FK lessons, nullable（只掛教材包時為 NULL） |
| PK (question_id, program_id, COALESCE(lesson_id, 0)) | 用 unique index 實作 |

## 權限規則（查詢與重複偵測共用同一套）

老師 T 可見的題目 = 
1. `teacher_id = T`
2. `visibility = 'public'`（含所有平台題庫）
3. `visibility = 'organization_only'` 且 T 屬於該 `organization_id`
4. `visibility = 'individual_only'` 且 T 不屬於任何機構

重複偵測時只比對 **(1) + (2)**，不含 (3)(4)，避免機構內部題目在其他情境曝光。

重複偵測本期只對 `group_id IS NULL` 的單題做（比對 `normalized_stem`）；題組日後以 `passage_text` 做 trgm 相似比對。

## AI 考點分析流程

1. 後端把 `exam_points` 中 `status = 'active'` 的 `(code, names)` 清單餵給模型
2. 模型回傳 `exam_point_codes[]` + `grade_min/max`，**只能從清單選**
3. 若模型認為缺考點，回傳 `proposed: [{names}]` → 寫入 `exam_points` 且 `status = 'pending'`，題目先不關聯；平台後台審核後改 `active` 或 `merged`
4. 前端顯示 AI 選出的考點，老師可增刪後儲存，`question_exam_points.source` 依實際來源寫入

## Migration 注意

- 全部走 idempotent 寫法（見 CLAUDE.md）
- `pg_trgm` 需 `CREATE EXTENSION IF NOT EXISTS`，Supabase 允許
- 題組／分段／填充題／聽力欄位在 P0 migration **一次建齊**，本期 UI 只做單題選擇題；避免之後每加一種題型就改一次 migration
- 初始考點樹用 seed script 寫入，不放 migration（可重跑、可調整）
- `downgrade()` 需真正可復原（DROP TABLE IF EXISTS 反序）

## 為 P4 混合題型試卷預留

- `questions.question_type` 為欄位而非表拆分，一張試卷可混題型
- 派發時每個 question_type 產一份 `Content` 副本，`AssignmentContent` 掛多份
- 需要新增 `Content.practice_mode`（或等價欄位）讓計分／批改依 Content 分流，屬 P4 範圍
