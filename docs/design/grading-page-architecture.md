# 批改頁架構 — 同路由 + Panel 分流

> **ADR** · 建立於 2026-04-19（issue #630）· 影響：教師批改頁新增任一作業類型時都必須遵守本規範

## 核心原則

`/teacher/classroom/:classroomId/assignment/:assignmentId/grading` 是**唯一**的批改頁路由，服務所有作業類型（例句朗讀、例句重組、單字朗讀、單字選擇、…）。
切換作業類型的方式是 **依 `submission.practice_mode` 替換中間欄 Panel**，不是新增路由、不是複製頁面。

```
┌──────────────────────── GradingHeader (shared) ───────────────────────┐
│                                                                       │
├─────────────┬─────────────────────────────────┬───────────────────────┤
│             │                                 │                       │
│ StudentList │    XxxAssessmentPanel          │  OverallFeedback      │
│   Panel     │   (per-practice-mode)           │      Panel            │
│  (shared)   │                                 │     (shared)          │
│             │  ↳ ReadingAssessmentPanel       │                       │
│             │    for practice_mode ∈          │                       │
│             │    {reading, word_reading}      │                       │
│             │                                 │                       │
│             │  ↳ SentenceRearrangementPanel   │                       │
│             │    for practice_mode =          │                       │
│             │    rearrangement                │                       │
│             │                                 │                       │
│             │  ↳ ScenarioDialogueGradingPanel │                       │
│             │    for practice_mode =          │                       │
│             │    scenario_dialogue            │                       │
│             │                                 │                       │
│             │  ↳ QuizGradingPanel             │                       │
│             │    for practice_mode ∈          │                       │
│             │    {word_selection_quiz,        │                       │
│             │     word_spelling_quiz,         │                       │
│             │     word_cloze_quiz}            │                       │
│             │                                 │                       │
│             │  ↳ （未來新作業類型在此增加）    │                       │
│             │                                 │                       │
└─────────────┴─────────────────────────────────┴───────────────────────┘
```

## 為什麼採這個模式

- **URL 穩定**：老師從學生列表切換不同作業時 URL 不變，亦不需要判斷「這個作業該 navigate 去哪個路由」。
- **左/右欄行為一致**：所有作業類型共用同一套學生切換、儲存狀態、總分、總評、完成批改 / 要求訂正流程。
- **擴充成本最低**：新增作業類型 = 新增 1 個 Panel 元件 + GradingPage 加 1 個 case + 後端回傳專屬欄位。不動 router、不動共用 Panel、不改 API 介面。
- **UX 一致**：老師對「批改」的心智模型永遠是同一個頁面布局，不會因作業類型而錯亂。

## 分流點在哪

`src/pages/teacher/GradingPage.tsx` 的 `renderContentPanel()`：

```tsx
if (submission.practice_mode === "rearrangement") {
  return <SentenceRearrangementPanel {...panelProps} />;
}
return <ReadingAssessmentPanel {...panelProps} ... />;
```

## 共用元件 vs. 類型專屬元件

全部位於 `frontend/src/components/grading/`。

| 元件 | 類型敏感 | 責任 |
|---|---|---|
| `GradingHeader` | ❌ 不可知 | 作業標題 / 學生資訊 / 儲存狀態 / 學生切換 |
| `StudentListPanel` | ❌ 不可知 | 左欄學生列表 + 狀態燈號 |
| `OverallFeedbackPanel` | ❌ 不可知 | 右欄逐題燈號 / 分數 / 總評 / 完成/退回 |
| `ReadingAssessmentPanel` | ✅ 專屬 | reading / word_reading（錄音 + AI 語音評分） |
| `SentenceRearrangementPanel` | ✅ 專屬 | rearrangement（選字歷程 + 錯誤數 + expected_score） |
| `ScenarioDialogueGradingPanel` | ✅ 專屬 | scenario_dialogue（錄音 + 參考答案 + AI 語言特徵**建議**） |
| `QuizGradingPanel` | ✅ 專屬 | word_*_quiz（題目區依派發設定 + A-D 選項格 + 每題扣分） |

> **小考每題扣分（#1045）**。題目區資料由 `_build_quiz_submission` 回傳：每題
> `options`（選擇題優先學生作答當下存的 `answer_data.options_shown`，舊資料以同 seed
> 重建）、`blanked_sentence`、`image_url`、`deduction`，頂層 `quiz_settings`。
> 扣分公式與後端 `compute_quiz_score` 一致：單題扣分 = 100 / 題數（不先捨入），
> 總分 = round1(max(0, 100 − Σ扣分))，前端實作在 `components/grading/quizDeductions.ts`。
> 存檔走同一支 `POST /grade`，小考改送 `quiz_deductions: [{content_item_id, deduction}]`，
> 依 `content_item_id` upsert `StudentItemProgress.teacher_review_score`；**小考不送、
> 後端也不處理 `item_results`**（其 passed→100/60 映射會覆寫扣分）。老師直接改總分時
> 以送出的 `score` 為準，扣分不反向改寫。零 migration。

> **情境對話的 AI 與朗讀類不是同一套**（#1035）。朗讀走 Azure 發音評測（`/reanalyze-item`，
> 評「唸得多準」，需要 reference_text）；情境對話是開放式回答，沒有可比對的正解，走
> `/scenario-ai-grade`（Gemini 直接讀音檔 → 逐字稿 + 四個語言特徵分數）。後者**只產生
> 建議**，不寫 `teacher_review_score` / `teacher_passed` —— 老師仍是最終判定者。
> 兩邊的分數也分開存（`scenario_grading_data` vs `accuracy_score` 等欄），避免作業層
> 報告讀到語意不同的數字。

## 新增作業類型 Checklist

1. **確認後端 `practice_mode` 值**：在 `backend/models/base.py` 的 `PracticeMode` enum 確認字串值。
2. **擴充 API 回傳**：在 `backend/routers/assignments/grading.py` 的 `get_student_submission` 加上該類型專屬欄位（只在 `practice_mode == 新類型` 時填入）。保留其他類型回傳原樣。
3. **擴充 TypeScript 型別**：在 `frontend/src/pages/teacher/GradingPage.tsx` 的 `SubmissionItem` / `StudentSubmission` / `PracticeMode` union 加上新欄位與字串值。
4. **建立新 Panel**：在 `frontend/src/components/grading/` 新增 `XxxAssessmentPanel.tsx`，符合共用 Props 形狀（`submission` / `selectedGroupIndex` / `expandedRows` / `itemFeedbacks` / `submitting` / `activeTab` / `onGroupChange` / `onToggleRow` / `onItemFeedbacksChange` / `onAutoSave`）。
5. **更新分流點**：`GradingPage.tsx` 的 `renderContentPanel()` 加一個 `if (submission.practice_mode === "新類型") return <NewPanel ... />;` 分支。
6. **更新 index.ts**：`frontend/src/components/grading/index.ts` 匯出新 Panel，並在 header 註解內加進 per-practice-mode 清單。
7. **i18n**：在 `frontend/src/i18n/locales/{zh-TW,en}/translation.json` 的 `gradingPage` 下新增 `gradingPage.<type>.labels.*` 與 `.messages.*`，不要動現有 key。
8. **驗證朗讀頁未受影響**：打開既有朗讀類作業批改頁跑一遍 happy path，確認 UI / 儲存 / 完成批改 / 要求訂正 行為不變。

## 禁止事項

- ❌ **不要新增路由**（不做 `/grading-xxx`、`/grading/xxx`）。
- ❌ **不要複製 `GradingPage.tsx`**。任何兩份就地開始偏移，維運成本爆炸。
- ❌ **不要修改 `GradingHeader` / `StudentListPanel` / `OverallFeedbackPanel` 的 props 讓它依 practice_mode 分支**。共用元件就是作業類型不可知。若發現某作業類型「需要」改共用元件，先停下來重新設計——多半是 Panel 內部該處理的事。
- ❌ **不要把 state 或 API 呼叫搬進 Panel 元件**。`loadSubmission` / `performAutoSave` / `handleCompleteGrading` / `handleRequestRevision` 都留在 `GradingPage.tsx`，Panel 透過 props 接 callback。
- ❌ **不要為新作業類型另起一條前後端資料流**。同一支 `GET /api/teachers/assignments/{id}/submissions/{studentId}` endpoint 擴充，同一個 `POST /grade` 儲存。

## 可發現性錨點（保持同步）

這份 ADR 若改動，以下三處都要更新（不然新人找不到）：

- [`CLAUDE.md`](../../CLAUDE.md) 的 Project-Specific Rules
- [`frontend/src/pages/teacher/GradingPage.tsx`](../../frontend/src/pages/teacher/GradingPage.tsx) 頂部 JSDoc
- [`frontend/src/components/grading/index.ts`](../../frontend/src/components/grading/index.ts) header 註解
