# 更新公告自動化（issue #804）

每次 release 進 staging / production，自動產生一則「更新公告草稿」，由管理者在
後台選擇要發到 **LINE 官方帳號**、**官網雙語文章**，或兩者都發。

## 流程

```
push staging / main
  └─ .github/workflows/release-announcement-draft.yml
       └─ POST {BACKEND_URL}/api/internal/release-announcements   (X-Release-Secret)
            └─ ReleaseAnnouncementService.create_draft_from_release
                 ├─ 解析 release 標題 → change_type / issue 編號
                 ├─ Vertex AI → 產生雙語內容（失敗則退回用 release 標題）
                 └─ release_announcements 一列草稿（status=draft）

管理者後台（PR2 前端）
  └─ POST /api/admin/release-announcements/{id}/publish {channels}
       ├─ website → 建立 zh-TW + en 兩篇 blog（互相 linked、同時上架、分類「產品更新」）
       └─ line    → Flex 卡片（樣板圖 + 中文段 + 英文段 + 文章連結）
```

## 設計重點

| 項目 | 決策 | 原因 |
|------|------|------|
| 兩份內容分開存 | `line_message_*` 與 `article_*` 各自欄位 | LINE 要短、官網要完整，後台需分開編輯 |
| 通道各自狀態 | `line_status` / `website_status` | 可先發官網，之後再補發 LINE；單邊失敗不影響另一邊 |
| 草稿去重 | unique index `(environment, source_ref)` | CI 重跑 / 重新部署同一 commit 不會重複建立草稿 |
| 發布順序 | 官網先、LINE 後 | LINE 卡片按鈕需要剛上架文章的網址 |
| 已發布通道略過 | `publish` 檢查 `*_status` | 重按發布不會重複發文 |
| 舊草稿可併入 | `merge` + `merged_into_id` | 沒發的更新累積到下次一起發，節省 LINE 訊息量 |
| AI 失敗不擋 | 退回 release 標題 + `generation_error` | 草稿仍可人工編修後發布 |

## 安全防呆

- **只有 `ENVIRONMENT=production` 才 broadcast**；其他環境改 `push` 給
  `LINE_TEST_USER_ID`，標題加 `[STAGING]` 前綴，避免測試訊息轟炸真實好友。
- Webhook 需 `X-Release-Secret`（`secrets.compare_digest` 比對）；
  `RELEASE_WEBHOOK_SECRET` 未設定時端點直接回 503。
- 草稿**不會**自動對外發布，一律要管理者在後台按發布。

## LINE 訊息量

LINE 官方帳號免費方案每月 200 則，**broadcast 一次消耗「好友數」則**。
因此設計為手動發布 + 可合併舊草稿，由管理者決定哪幾次更新值得廣播。

## 需要的設定

| 名稱 | 位置 | 說明 |
|------|------|------|
| `LINE_CHANNEL_ACCESS_TOKEN` | GitHub secret（已存在） | 與 CI 通知共用同一個 channel |
| `LINE_USER_ID` | GitHub secret（已存在） | 對應後端 `LINE_TEST_USER_ID` |
| `RELEASE_WEBHOOK_SECRET` | GitHub secret（**新增**） | CI ↔ backend webhook 驗證 |
| `RELEASE_ANNOUNCEMENT_BANNER_URL` | GitHub repo variable（選填） | 公告樣板圖，未設定時用官網現有圖片佔位 |

## API

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/internal/release-announcements` | CI 產生草稿（secret 驗證） |
| GET | `/api/admin/release-announcements` | 清單（預設隱藏已併入 / 已捨棄） |
| GET | `/api/admin/release-announcements/{id}` | 單筆 |
| PATCH | `/api/admin/release-announcements/{id}` | 編輯 LINE 文案 / 官網文章 |
| POST | `/api/admin/release-announcements/{id}/merge` | 併入未發布的舊草稿 |
| GET | `/api/admin/release-announcements/{id}/line-preview` | 取得實際會送出的 Flex JSON |
| POST | `/api/admin/release-announcements/{id}/publish` | 發布（`channels: line / website`） |
| POST | `/api/admin/release-announcements/{id}/discard` | 捨棄草稿 |

## 後台（PR2）

管理員控制台 `/admin` →「更新公告」分頁（`AdminReleaseAnnouncementsPage`）：

- 左側草稿清單：環境、變更類型、狀態、release 標題
- 右側分兩個獨立區塊：
  - **LINE 推播文案** — 中／英文案 + 圖片網址 + Flex 卡片即時預覽
    （`LineFlexPreview` 版型對齊後端 `build_release_flex`）
  - **官網雙語文章** — 中／英標題與內文；已發布時顯示文章連結
- 合併：`載入舊草稿` → 勾選未發布的舊草稿 → `併入這一則`
- 發布：勾選 `LINE 官方帳號` / `官網文章`（已發布的通道自動停用，不會重複發）
- `儲存草稿` 只送出有改動的欄位；`捨棄` 從待辦清單移除
