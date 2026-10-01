# 打字類小考評分方式

> **Design doc** · 建立於 2026-10-01（issue #1092）· 適用：`word_spelling_quiz`（拼寫小考）、`word_cloze_quiz`（克漏字小考）

## 為什麼有這個設定

小考每題配分 = 100 ÷ 題數。選擇題答錯扣整題沒問題，但打字小考的答案常是好幾個單字，
只錯一個單字或一個字母也被扣整題；而且每位老師的寬嚴標準不同。所以派發打字小考時，
老師**必須**選一種評分方式（沒有預設值），之後也能在作業詳情改。

選擇題小考（`word_selection_quiz`）固定整題計分，不顯示這個設定。

## 規則

共用定義：

- `per_q = 100 / 題數`（不先捨入）。
- 正解以空白切成 N 個單字；學生答案**逐格**對應：第 i 格對第 i 個單字，空格 = 該單字錯。
- 比對前去掉前後空白；`quiz_case_sensitive` 為假（預設）時不分大小寫。
- 字母差 `d` = 編輯距離（多打、少打、打錯各算 1；空格的 `d` = 該單字字母數）。
- 學生字數多於格數（舊資料／API 誤用）：多出的字以空白併入最後一格 → 最後一格必錯。

| 代碼 | 名稱 | 單題扣分 |
|---|---|---|
| `whole_question`（A；NULL 亦同） | 整題計分 | 有任何一格不符 → `per_q` |
| `per_word`（B） | 依單字比例 | `per_q × 錯誤單字數 / N` |
| `per_word_lenient`（C） | 依單字比例＋拼字寬鬆 | 每個單字：d=0 扣 0；d=1 且該格有填且單字長度 > 1 扣 `per_q/N` 的一半；其餘扣 `per_q/N` |
| `fixed_per_word`（D） | 每錯一個單字扣固定分數 | `quiz_scoring_points × 錯誤單字數` |
| `fixed_per_letter`（E） | 每錯一個字母扣固定分數 | `quiz_scoring_points × Σd` |

全部方式共通：

- 上限 `per_q`；全對扣 0；**沒作答（含每格都空白）扣 `per_q`**。
- 部分扣分：先把該題各單字的扣分加總，再以 half-up 四捨五入到小數一位（後端用 `Decimal`）；
  捨入後 ≥ `per_q` 視為全扣。全扣一律是 `per_q` 原值，不先捨入。
- 總分 = `round1(max(0, 100 − Σ扣分))`（與 #1045 相同）。
- `is_correct` 仍是「整題全對」→ 答對題數、訂正「全對才能交」、班級統計、live 排名不受影響。
- 標點、撇號照字元比對（打錯算錯）。

### 驗算例（每題 4 分、正解 `look forward to`）

| 方式 | 學生答案 | 扣分 |
|---|---|---|
| B | `look forwerd to`（錯 1 字） | 1.3 |
| B | `look forwerd too`（錯 2 字） | 2.7 |
| C | `look forwerd to` | 0.7 |
| C | `look forword too` | 1.3 |
| C | `look to ＿`（第 3 格空） | 2.7 |
| D（每字 1 分） | 錯 2 字 | 2 |
| E（每字母 0.5 分） | `lok forwad t`（差 3 個字母） | 1.5 |

後端 `backend/tests/unit/test_quiz_scoring.py` 與前端 `frontend/src/lib/__tests__/quizScoring.test.ts`
用同一組案例。

## 資料

`assignments` 三個欄位（皆 nullable、無 backfill；migration `20261001_1000`）：

- `quiz_scoring_method VARCHAR(30)`：NULL = 舊作業 = 整題計分
- `quiz_scoring_points NUMERIC(5,2)`：D、E 用。允許值 **0.1～100、最多一位小數**
  （超過一位小數直接 422，不默默捨入；NaN / Infinity 也是 422）。前端輸入框同規則即時提示、不合法不能送出。
- `quiz_case_sensitive BOOLEAN`：NULL / false = 不分大小寫

分數一律在**算分當下**由「作業設定＋`practice_answers.answer_data`」推導，不在作答時存中間結果。
學生作答時另存 `typed_words`（逐格、空格為 `""`）；舊作答沒有時退回 `typed_answer.split()`。
舊作業（NULL）算出來與 #1045 公式逐位元相同，不追溯。

## API

- `POST /api/teachers/assignments/create`：打字小考必帶 `quiz_scoring_method`
  （否則 422 `QUIZ_SCORING_METHOD_REQUIRED`）；D/E 必帶 `quiz_scoring_points`
  （否則 422 `QUIZ_SCORING_POINTS_REQUIRED`）。即刻練習等老師沒機會選的路徑維持 NULL（＝整題計分）。
- `PATCH /api/teachers/assignments/{id}`：三欄可改，明確傳 `null` = 不變更。
  **有效值**（NULL method ＝ 整題計分、NULL 大小寫 ＝ 不分、points 只在 D/E 比較）有變 →
  同一 transaction 內重算，回應 `recomputed_count`；沒變不重算。
- 學生作答 `POST .../spelling_quiz/answer`、`.../cloze_quiz/answer`：可帶 `typed_words`。
  有帶時，存下的 `answer_data.typed_answer` 由後端從 `typed_words` 產生（非空格以單一空白相接），
  不採用 client 送的值 —— 學生複盤頁與老師批改頁永遠顯示同一份答案。

## 作答中改設定

重算只處理「已交卷」的第一次作答。還在作答中的答案（IN_PROGRESS、live 小考、被退回後的訂正
作答）在**算分當下**（`compute_quiz_score`：交卷、收卷、通用提交）以作業目前的設定重判
`is_correct` 並寫回、同步 `session.correct_count`；答對題數、整題計分的扣分、訂正「全對才能交」
都用重判後的值。例：學生作答中答 `Apple`（不分大小寫 → 對），老師改成區分大小寫後學生交卷 →
該題判錯、扣分。舊作答在設定沒變時重判結果與當初相同。

## 已知的舊資料細節（可接受）

- 舊作答（沒有 `typed_words`）的字串若中間有不規則空白（例如兩個空白），整題判定沿用舊的整串比對
  （判錯），但逐字比對時單字都對 → 在 B～E 方式下會出現「判錯但扣 0 分」。只發生在舊資料。
- 有 `typed_words` 時以逐格判定：正解本身含兩個空白的題目，學生逐格填對會判對；舊的整串比對會判錯。

## 重算（`recompute_quiz_scores`）

老師在作業詳情改了評分設定（且已有學生交卷）→ 前端先跳確認視窗 → 確定才 PATCH：

- 對每位「有已完成作答」的學生，取**第一次**完成的作答（＝成績紀錄那筆）。
- 用新的大小寫設定重判每題 `is_correct`，同步 `session.correct_count`。
- 清掉該作業題目的老師手動扣分（`StudentItemProgress.teacher_review_score`）。
- 直接寫 `student_assignment.score`；**不動** status 與時間戳（被退回訂正中的學生仍是 RETURNED）。
- 沒作答的題目扣整題。

## 新增一種評分方式時要改哪裡

1. **後端** `backend/utils/quiz_scoring.py`：`SCORING_METHODS`（需要扣分值就加進
   `METHODS_REQUIRING_POINTS`）與 `question_deduction`；`backend/routers/assignments/validators.py`
   的 `QuizScoringMethod` Literal；補 `backend/tests/unit/test_quiz_scoring.py`。
2. **前端** `frontend/src/lib/quizScoring.ts`：`QUIZ_SCORING_METHODS` / `METHODS_REQUIRING_POINTS`
   與 `questionDeduction`（試算用，數字必須與後端一致）；`quizScoring.methods.<code>` 的 zh-TW / en
   文案；補 `frontend/src/lib/__tests__/quizScoring.test.ts`（與後端同一組案例）。

派發／編輯 UI（`components/assignment/QuizScoringMethodField.tsx`）與批改頁會自動列出新方式。
