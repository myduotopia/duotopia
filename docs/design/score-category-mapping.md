# Score Category Mapping

> 作業計分類別（`score_category`）的自動判定規則。

## 為什麼需要這份對照表

成績單與分數統計需要把作業歸到四大語言技能之一：

- **口說 (speaking)** — 學生開口朗讀／錄音
- **閱讀 (reading)** — 學生看文字、靠閱讀理解作答（無音檔輔助）
- **寫作 (writing)** — 學生用打字／選字作答，且沒有音檔輔助
- **聽力 (listening)** — 作答時有播放音檔（學生需靠聽覺輔助）

過去 `score_category` 是「教師建立作業時手動指定」的欄位，但實際上幾乎沒有 UI 在設定，
導致大量作業 `score_category` 為 `NULL`，且即使有值也未必正確。

從 issue #708 起，`score_category` 改為**由 `practice_mode` 與 `play_audio` 自動推導**，
不再接受外部覆寫。所有既有資料以下表回填。

## 對照表

| # | Practice Mode | Audio (`play_audio`) | Category | 中文 |
|---|--------------|---------------------|----------|------|
| 1 | `word_reading`（單字朗讀） | 任意 | `speaking` | 口說 |
| 2 | `reading`（例句朗讀） | 任意 | `speaking` | 口說 |
| 3 | `word_cloze`（單字克漏字） | 任意 | `reading` | 閱讀 |
| 4 | `rearrangement`（例句重組） | `false` | `reading` | 閱讀 |
| 5 | 其他 practice_mode | `false` | `writing` | 寫作 |
| 6 | 其他 practice_mode | `true` | `listening` | 聽力 |

### 規則邏輯（白話）

1. **朗讀類**（單字朗讀／例句朗讀）→ 一律 **口說**，因為作答行為本身就是開口。
2. **克漏字**（`word_cloze`）→ 一律 **閱讀**，因為主要靠看上下文判斷答案，即使搭配音檔也只是輔助。
3. **例句重組**（`rearrangement`）無音檔 → **閱讀**；有音檔 → 落到通則 6，視為 **聽力**。
4. **通則**：
   - 沒有音檔 → **寫作**（靠打字／選字作答）
   - 有音檔 → **聽力**（需要靠聽辨輔助）

### 衍生對照（常見 practice_mode 全展開）

| Practice Mode | `play_audio=false` | `play_audio=true` |
|---------------|-------------------|------------------|
| `word_reading` | speaking | speaking |
| `reading` | speaking | speaking |
| `word_cloze` | reading | reading |
| `rearrangement` | reading | listening |
| `word_selection` | writing | listening |
| `word_spelling` | writing | listening |
| `tug_of_war` | writing | listening |
| 未來新模式 | writing | listening |

## 程式碼落實位置

| 位置 | 用途 |
|------|------|
| [`backend/models/base.py`](../../backend/models/base.py) | `ScoreCategory` enum（`speaking` / `listening` / `writing` / `reading`） |
| [`backend/utils/score_category.py`](../../backend/utils/score_category.py) | `resolve_score_category(practice_mode, play_audio)` 唯一判定函式 |
| [`backend/routers/assignments/crud.py`](../../backend/routers/assignments/crud.py) | 建立／更新作業時呼叫 helper，覆寫 request 傳入的值 |
| [`backend/routers/teachers/instant_practice.py`](../../backend/routers/teachers/instant_practice.py) | 即刻練習建立暫存作業時同樣套用 |
| Alembic migration `add_score_category_auto_backfill` | 把既有資料依新規則重算 |

## 未來新增 practice_mode 時要做什麼

1. 在上面的「衍生對照」表加一列；
2. 若該模式不符合「通則」或「朗讀類／克漏字／重組」既有分支，請更新 `resolve_score_category`
   並補上對應的單元測試（[`backend/tests/unit/test_score_category.py`](../../backend/tests/unit/test_score_category.py)）；
3. 若新增類別會影響成績單顯示順序，請同步檢視 [grade-report-architecture.md](./grade-report-architecture.md)（issue #708 PR-2 加入）。
