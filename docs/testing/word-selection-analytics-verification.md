# 單字選擇錯誤紀錄驗證指南

> Related: #451, #257

## 資料架構

| 表 | 用途 | 粒度 |
|---|------|------|
| `practice_answers` | 每次答題明細 | 每次作答一筆 |
| `practice_sessions` | 每輪練習統計 | 每輪（10題）一筆 |
| `student_item_progress.word_selection_data` | 累計聚合統計 | 每個學生 × 每個單字 |

### word_selection_data 格式

```json
{
  "correct_count": 5,
  "error_count": 2,
  "timeout_count": 1,
  "error_selections": [
    {"selected": "橘子", "count": 1},
    {"selected": "香蕉", "count": 1}
  ],
  "last_answered_at": "2026-03-20T10:00:00Z"
}
```

**Accounting invariant**:
- `error_count = timeout_count + 非超時錯誤次數`
- `error_selections` 只記錄非超時的錯誤選項（上限 20 筆）
- `error_count >= len(error_selections)` 恆成立

---

## 操作流程

1. 學生登入 → 開啟一份**單字選擇**作業
2. 作答幾題（故意答錯一些、讓一題超時）
3. 用以下 SQL 查詢驗證

---

## SQL 查詢

### A. PracticeAnswer 明細紀錄

```sql
SELECT
    pa.id,
    pa.is_correct,
    pa.time_spent_seconds,
    pa.answer_data->>'word_text' AS word,
    pa.answer_data->>'selected_answer' AS selected,
    pa.answer_data->>'correct_answer' AS correct,
    pa.answer_data->>'is_timeout' AS is_timeout,
    pa.created_at
FROM practice_answers pa
JOIN practice_sessions ps ON ps.id = pa.practice_session_id
WHERE ps.practice_mode = 'word_selection'
ORDER BY pa.created_at DESC
LIMIT 20;
```

### B. PracticeSession 統計

```sql
SELECT
    id,
    student_id,
    student_assignment_id,
    words_practiced,
    correct_count,
    started_at
FROM practice_sessions
WHERE practice_mode = 'word_selection'
ORDER BY created_at DESC
LIMIT 5;
```

### C. word_selection_data 累計統計

```sql
SELECT
    sip.content_item_id,
    ci.text AS word,
    ci.translation,
    sip.word_selection_data->>'correct_count' AS correct_count,
    sip.word_selection_data->>'error_count' AS error_count,
    sip.word_selection_data->>'timeout_count' AS timeout_count,
    sip.word_selection_data->'error_selections' AS error_selections,
    sip.word_selection_data->>'last_answered_at' AS last_answered
FROM student_item_progress sip
JOIN content_items ci ON ci.id = sip.content_item_id
WHERE sip.word_selection_data IS NOT NULL
ORDER BY sip.updated_at DESC
LIMIT 20;
```

---

## 模擬 #257 分析場景

### 某份作業所有單字的正確/錯誤統計（老師視角）

```sql
SELECT
    ci.text AS word,
    ci.translation,
    SUM((sip.word_selection_data->>'correct_count')::int) AS total_correct,
    SUM((sip.word_selection_data->>'error_count')::int) AS total_errors,
    ROUND(
        SUM((sip.word_selection_data->>'correct_count')::int)::numeric /
        NULLIF(SUM((sip.word_selection_data->>'correct_count')::int) +
               SUM((sip.word_selection_data->>'error_count')::int), 0) * 100
    , 1) AS accuracy_pct
FROM student_item_progress sip
JOIN content_items ci ON ci.id = sip.content_item_id
JOIN student_assignments sa ON sa.id = sip.student_assignment_id
WHERE sa.assignment_id = :assignment_id
  AND sip.word_selection_data IS NOT NULL
GROUP BY ci.text, ci.translation
ORDER BY total_errors DESC;
```

### 某學生最常選錯的選項

```sql
SELECT
    ci.text AS word,
    jsonb_array_elements(sip.word_selection_data->'error_selections')->>'selected' AS wrong_selection,
    (jsonb_array_elements(sip.word_selection_data->'error_selections')->>'count')::int AS times
FROM student_item_progress sip
JOIN content_items ci ON ci.id = sip.content_item_id
WHERE sip.student_assignment_id = :sa_id
  AND sip.word_selection_data IS NOT NULL
ORDER BY times DESC;
```

---

## 驗證 Checklist

| 驗證項目 | 預期結果 |
|---------|---------|
| 答對一題 | `practice_answers` 新增一筆 `is_correct=true`，`word_selection_data.correct_count` +1 |
| 答錯一題 | `practice_answers` 新增一筆 `is_correct=false`，`error_count` +1，`error_selections` 有紀錄 |
| 超時一題 | `answer_data.is_timeout=true`，`timeout_count` +1，`error_selections` 不增加 |
| 完成一輪（10題） | `practice_sessions.words_practiced=10`，`correct_count` = 答對題數 |
| 同一個字答錯兩次（選同選項） | `error_selections` 中該選項 `count=2`（不是新增兩筆） |
| 既有功能 | 記憶曲線、熟練度進度條、達標判定都正常運作 |
