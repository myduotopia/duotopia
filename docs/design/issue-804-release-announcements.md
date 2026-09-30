# 更新公告自動化（issue #804）

release 進 staging / production 時，為標記 `📣 announce` 且已測試通過的 issue
產生一則「更新公告草稿」，由管理者在後台選擇要發到 **LINE 官方帳號**、
**官網雙語文章**，或兩者都發。

> 設定（secret、LINE channel）與日常使用流程、畫面截圖：
> [`docs/integrations/RELEASE_ANNOUNCEMENT_SETUP.md`](../integrations/RELEASE_ANNOUNCEMENT_SETUP.md)

## 流程

```
開發者 Claude Code：/announce（PR3）
  ├─ /announce #N      → issue 留言（標記區塊）
  └─ /announce release → staging → main PR 描述（統整區塊）

push staging / main
  └─ .github/workflows/release-announcement-draft.yml
       └─ scripts/release_announcement.py ci-payload
            ├─ 沒有 issue 編號 / 沒有同時具備兩個標籤 → 略過，不建草稿
            ├─ staging：讀 issue 留言；main：讀 staging → main PR 描述
            └─ POST {BACKEND_URL}/api/internal/release-announcements   (X-Release-Secret)
                 └─ ReleaseAnnouncementService.create_draft_from_release
                      ├─ 解析 release 標題 → change_type / issue 編號
                      ├─ 有現成內容 → 直接使用（不呼叫 AI）
                      ├─ 沒有 → Vertex AI 產生雙語內容（失敗則退回用 release 標題）
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
| 內容優先由 Claude Code 產生 | `/announce` 寫進 issue 留言 / PR 描述，CI 帶給後端 | 用開發者的 Claude Code 訂閱，省 Vertex token；人可在 GitHub 直接改 |
| 發布資格 | issue 同時有 `📣 announce` + `✅ tested-in-staging` | 不是每個更新都值得對外公告；未測試通過的不公告 |
| 規則只寫一次 | `scripts/release_announcement.py` 給 skill 與 CI 共用 | 標籤判斷、區塊格式兩邊不會不一致 |

## 安全防呆

- **只有 `ENVIRONMENT=production` 才 broadcast**；其他環境改 `push` 給
  `LINE_ANNOUNCE_TEST_USER_ID`，標題加 `[STAGING]` 前綴，避免測試訊息轟炸真實好友。
- 發 LINE 只用官方帳號專用的 `LINE_ANNOUNCE_CHANNEL_ACCESS_TOKEN`，**不與 CI 通知 bot 共用**，
  避免 broadcast 到錯的帳號；未設定時發 LINE 會失敗並顯示「尚未設定官方帳號」。
- Webhook 需 `X-Release-Secret`（`secrets.compare_digest` 比對）；
  `RELEASE_WEBHOOK_SECRET` 未設定時端點直接回 503。
- 草稿**不會**自動對外發布，一律要管理者在後台按發布。

## LINE 訊息量

LINE 官方帳號免費方案每月 200 則，**broadcast 一次消耗「好友數」則**。
因此設計為手動發布 + 可合併舊草稿，由管理者決定哪幾次更新值得廣播。

## 需要的設定

| 名稱 | 位置 | 說明 |
|------|------|------|
| `RELEASE_WEBHOOK_SECRET` | GitHub secret | CI ↔ backend webhook 驗證 |
| `LINE_ANNOUNCE_CHANNEL_ACCESS_TOKEN` | GitHub secret | 官方帳號 Messaging API token |
| `LINE_ANNOUNCE_TEST_USER_ID` | GitHub secret | 非 production 的 LINE 測試收件人 |
| `RELEASE_ANNOUNCEMENT_BANNER_URL` | GitHub repo variable（選填） | 公告樣板圖，未設定時用官網現有圖片佔位 |

各值怎麼取得、用個人或官方帳號，見
[`RELEASE_ANNOUNCEMENT_SETUP.md`](../integrations/RELEASE_ANNOUNCEMENT_SETUP.md)。

## API

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/internal/release-announcements` | CI 產生草稿（secret 驗證；選填 `content` 帶現成雙語內容） |
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
- 有未儲存的修改時：「發布」會先儲存再發布（按鈕顯示「儲存並發布」），「併入這一則」停用
- 圖片網址必須是 `https://` 開頭的完整網址（前後端一致），清空則不帶圖

## /announce 與公告區塊（PR3）

- skill：`.claude/skills/announce/SKILL.md`
- 腳本：`scripts/release_announcement.py`（`check` / `release-scan` / `render` /
  `upsert-issue` / `upsert-pr` / `ci-payload`），測試在
  `backend/tests/unit/test_release_announcement_script.py`
- 區塊格式：`<!-- release-announcement:start -->` … `<!-- release-announcement:end -->`，
  六個欄位各用一個 `#### 欄位名稱` 小標（人可直接在 GitHub 編輯），
  統整版另有 `<!-- release-announcement:issues 1046,1045 -->`
- staging 的單一 issue 草稿讀 issue 最新一則公告留言；main 讀 staging → main PR 描述；
  hotfix 這類只含一個 issue 的 main PR，沒有統整區塊時沿用該 issue 的留言
