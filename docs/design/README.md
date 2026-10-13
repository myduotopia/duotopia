# docs/design 標準文件總索引

> 建立於 2026-10-13（issue #1116）。做任何畫面或新功能前，先看這份索引，找到相關的標準文件。
> 在 `docs/design/` 新增文件時，同步在這裡加一行並歸類。

## 標準文件

功能家族與規範。做相關功能時**必須遵守**。

| 文件 | 用途 |
|---|---|
| [`ui-style-guide.md`](./ui-style-guide.md) | UI 規範：色調、按鈕層級、字型圓角間距、版面規則、共用元件目錄 |
| [`grading-page-architecture.md`](./grading-page-architecture.md) | 批改頁新增作業類型：同一個路由，依 `practice_mode` 換 Panel |
| [`score-category-mapping.md`](./score-category-mapping.md) | 作業計分類別（口說／閱讀／寫作／聽力）的判定對照表 |
| [`question-bank-question-types.md`](./question-bank-question-types.md) | 題庫新增題型：同一個 sheet 依題型分流，附加題型檢查清單 |
| [`question-bank-schema.md`](./question-bank-schema.md) | 題庫資料表設計與定案 |
| [`preview-architecture.md`](./preview-architecture.md) | 派發預覽直接用學生端 Activity 元件；改 Activity 要驗證預覽 |
| [`quiz-scoring-methods.md`](./quiz-scoring-methods.md) | 打字類小考的評分方式（依單字／字母比例扣分、大小寫） |
| [`question-bank-layout-samples/`](./question-bank-layout-samples/README.md) | 題型驗收樣本：題庫題組 layout 的 JSON 樣本（`question-bank-question-types.md` 引用） |

## 規劃中

還在規劃階段，尚未定案為標準的文件。

| 文件 | 用途 |
|---|---|
| [`public-demo-modes-spec.md`](./public-demo-modes-spec.md) | 公開 Demo 頁（`/demo/:id`）各練習模式的規格 |

## 單次設計紀錄與參考資料

單一 issue 的設計稿、討論紀錄或素材。留作參考，**不是**通用規範。

| 文件 | 用途 |
|---|---|
| [`issue-804-release-announcements.md`](./issue-804-release-announcements.md) | #804 更新公告自動化的流程設計 |
| [`issue-862-groupbuy-decouple-comparison.md`](./issue-862-groupbuy-decouple-comparison.md) | #862 團購改屬個人模式：方案 A、B 比較 |
| [`issue-862-plan-a-ui-decouple.md`](./issue-862-plan-a-ui-decouple.md) | #862 方案 A：只切 UI／Workspace |
| [`issue-862-plan-b-backend-restructure.md`](./issue-862-plan-b-backend-restructure.md) | #862 方案 B：後端全面重構 |
| [`teacher-tutorial-video-script.md`](./teacher-tutorial-video-script.md) | 老師操作教學影片的分鏡腳本 |
