# 題庫（Question Bank）資料庫設計 — Issue #1061 P0

> 討論紀錄與定案。P1-P3（題庫 tab / 新增選擇題 / 查詢 filter）依此實作；
> P4-P5（派發、考卷 PDF）另開 issue，但本設計已為混合題型試卷留位。

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
| stem | text NOT NULL DEFAULT '' | 題幹；純圖題可為空字串，但 CHECK `ck_questions_has_content` 要求 stem / image_url / stem_audio_url 至少一個 |
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
| blank_index | smallint, nullable | 克漏字：對應 `passage_text` 內 `{{n}}` 的 n |
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
| passage_text | text | 文章；克漏字用 `{{1}}` `{{2}}` 標記空格 |
| audio_url | text | 整段合併音檔（播放快取；segments 變動時重生成） |
| image_url | text | |
| grade_min / grade_max | smallint | 題組層預設，小題可覆寫 |
| teacher_id / organization_id / school_id / visibility / is_platform | | 與 `questions` 相同；**題組內題目的 visibility 跟隨題組**（應用層同步） |
| is_active / deleted_at / created_at / updated_at | | |

規則：題組整組公開／派發／刪除，不可單獨派其中一題。考點掛在小題層（`question_exam_points`），題組層不掛。

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
| organization_id | nullable；NULL = 平台公用，有值 = 機構自建 |

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
