# 派發 Sheet 即時預覽架構

> **建立於 2026-05-15（issue #752）** · 影響：所有學生作答 Activity 元件、派發對話框預覽

## TL;DR

派發 sheet 的「學生畫面預覽」**直接重用**學生端 Activity 元件本身（不 mock、不複製）。
這樣老師看到的 = 學生實際看到的，零維護成本，但代價是**改動 Activity 元件就必須驗證預覽**。

**所有 `frontend/src/components/activities/*Activity.tsx`（與 `ReadingAssessmentTemplate.tsx`）改動 UI 或行為時，請打開「指派新作業」對話框、選對應練習模式，確認預覽仍正常。**

---

## 為什麼這樣設計

替代方案的取捨：

| 方案 | 老師看到的 ≈ 學生看到的？ | 維護成本 | 採用？ |
|------|---|---|---|
| Mock UI（手刻一份預覽元件） | 容易 drift（學生端改了 mock 沒改） | 高 | ❌ |
| iframe 嵌入學生頁 | 一致 | iframe 通訊複雜、auth 麻煩 | ❌ |
| **重用學生 Activity 元件 + previewItems prop** | **100% 一致** | 低，但元件改動需驗證預覽 | ✅ |

## 架構

兩條 code path：

```
                    ┌──────────────────────────────────────────────┐
                    │          XxxActivity.tsx                     │
                    │  （fetch / submit / Azure / quota 都在這）    │
                    └─────────────┬─────────────────┬──────────────┘
                                  │                 │
                  ┌───────────────┴────┐     ┌──────┴──────────────┐
                  │ 學生作答頁         │     │ 派發 sheet 預覽      │
                  │ assignmentId 真實  │     │ XxxPreview.tsx      │
                  │ isPreviewMode=false│     │ 提供 previewItems   │
                  │ → 走 fetch 與 API  │     │ → 跳過 fetch/submit │
                  └────────────────────┘     └─────────────────────┘
```

### 兩種預覽 wrapper 子類

#### A. previewItems 路徑（`isLivePreview` 旗標）

對於可以「外部餵題目」的元件，wrapper 抓 content（teacher API），轉換成元件需要的資料格式，
透過 `previewItems` / `previewWords` / `previewQuestions` prop 餵進元件，元件偵測到該 prop
存在就跳過自己的 fetch + 跳過所有 submit / upload / quota 路徑。

| 模式 | Activity | Preview Wrapper | 資料來源 |
|---|---|---|---|
| word_reading | WordReadingActivity | WordReadingPreview | `/api/teachers/contents/282` |
| word_selection | WordSelectionActivity | WordSelectionPreview | `/api/teachers/contents/282` + 前端組 4 選項 |
| word_selection_quiz | WordSelectionQuizActivity | WordSelectionQuizPreview | `/api/teachers/contents/282` + 前端組 4 選項（issue #828） |
| word_spelling | WordSpellingActivity | WordSpellingPreview | `/api/teachers/contents/282` |
| word_spelling_quiz | WordSpellingQuizActivity | WordSpellingQuizPreview | `/api/teachers/contents/282`（issue #828） |
| word_cloze | WordClozeActivity | WordClozeContextPreview | `/api/teachers/contents/282` + 前端把單字替換為 _____ |
| word_cloze_quiz | WordClozeQuizActivity | WordClozeQuizPreview | `/api/teachers/contents/282` + 前端把單字替換為 _____（issue #828） |

#### B. demo 路徑

對於太複雜不想改造的元件（例如 reading 用的 `GroupedQuestionsTemplate`），wrapper 直接重用
**既有的公開 demo 基礎設施**：抓 `/api/demo/config` 的 `demo_*_assignment_id`，丟給
`StudentActivityPageContent` + `isDemoMode={true} isPreviewMode={true}`，這就是
`https://duotopia.co/demo/<id>` 的同一條 code path。

| 模式 | Preview Wrapper | demo_config key |
|---|---|---|
| reading | ReadingPreview | `demo_reading_assignment_id`（=74）|
| rearrangement | RearrangementPreview | `demo_rearrangement_assignment_id`（=77）|

**取捨**：demo 路徑下，預覽顯示的設定來自 demo assignment 自己存的值，
**不會跟著老師當下調 toggle 變動**。reading / rearrangement 影響有限可接受；
其他模式若也想走 demo 路徑就要承擔此 trade-off。

---

## 改 Activity 元件時的檢查清單

當你動到 `frontend/src/components/activities/*Activity.tsx` 或 `ReadingAssessmentTemplate.tsx`：

- [ ] 打開「指派新作業」對話框（從 `/teacher/programs` 或 `/teacher/classroom/<id>`）
- [ ] 選對應的練習模式
- [ ] 確認預覽渲染正常、沒報錯
- [ ] 切該模式的 toggle（show_translation、play_audio、show_image 等），確認預覽即時反映（previewItems 路徑）或顯示提示文字（demo 路徑）
- [ ] 如果新增了從 API 來的設定，記得：
  - 加進對應 PreviewWrapper 的 `previewSettings` 型別
  - AssignmentDialog 把 `formData.<新欄位>` 傳進去
- [ ] 如果新增了 fetch / upload / submit，記得用 `isLivePreview` 旗標（或 `previewItems`/`previewWords`/`previewQuestions` 是否存在）gating

## Code Path 防呆

每個會被預覽共用的元件頂端 JSDoc 都有警示：

```ts
/**
 * XxxActivity - …
 *
 * ⚠️ 此元件同時被學生作答頁與派發 sheet 預覽共用。
 *    改動前必讀：docs/design/preview-architecture.md
 */
```

每個 PreviewWrapper 也指回這份 doc。

## 已知限制 / Trade-offs

- **previewItems 路徑**：5 個元件需要小改（加 prop + 跳 fetch）。新增模式時要照同套路。
- **demo 路徑**：設定來自 demo assignment 不跟著 formData 變。
- **音檔**：vocab content 拿來預覽 reading 時沒有 example_sentence_audio_url（音檔須老師派發後補生成）。已在預覽顯示提示「正式作業可聽到音檔」。
- **shuffle**：以前實作 Fisher-Yates 真的洗牌會閃白（item.id 改變觸發 reset effect）。改成顯示提示「學生實際作答時題目順序會被打亂」就好。
- **AI 分析額度**：`isLivePreview` 路徑跳過 `/api/speech/upload-analysis` 避免扣老師點數。Azure SDK 本身的 token 取得不扣點。
