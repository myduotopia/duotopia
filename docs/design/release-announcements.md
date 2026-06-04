# Release Announcement System (Issue #804)

> 把「Blog 最新消息分類的已發布文章」一鍵推播到 **Email + LINE OA**，沿用既有 blog 編輯與審核流程。

## 1. 背景與目標

### 問題
產品上線新功能 / Bug 修正後，目前沒有系統化方式告知所有用戶。LINE 客服群只觸及少數加好友者，需要更廣的觸及面 + 留下歷史紀錄。

### 設計概念（核心）
**「公告」= BlogPost 屬於「最新消息 / Latest News」分類**。
- 撰寫、審核、i18n 對應、SEO、公開歷史頁全部沿用既有 blog 系統
- 多一個獨立的「發送通知」按鈕，把 post 推到 Email + LINE
- Email/LINE 內容用 `summary` + `cover_image_url` + 「閱讀全文」CTA 連回 blog

### 目標
1. 沿用 blog 編輯流程作為審核機制（`is_published` 切換）
2. 一鍵推送到 Email（全體 teacher，已訂閱者）+ LINE OA broadcast
3. 三層防呆：必須先發測試 → 二次確認 → placeholder 掃描
4. 用戶可在 Profile 控制是否接收 + Email 內一鍵退訂
5. 保留每筆送達狀態，可重試失敗
6. 依 teacher `language_preference` 自動寄對應語言的 post（中英分流）

### 非目標
- Student 通知（學生 email 多為家長/老師代填，未成年隱私）
- 自動從 GitHub Release PR 產生草稿（Phase 2）
- Pencil 版面定稿（另開子 issue）

---

## 2. 角色與通道

| 角色 | Email | LINE OA |
|------|-------|---------|
| Teacher（已訂閱） | ✅ | ✅（若加 OA 好友） |
| Teacher（已退訂） | ❌ | ✅（LINE broadcast 無 per-user opt-out） |
| Student | ❌ | ✅（若加 OA 好友） |
| Admin | ✅（其本身就是 teacher 身份） | ✅ |

> LINE broadcast 是「發給所有 OA 好友」，無法 per-user 過濾。這是 LINE Messaging API 限制，已知接受。

---

## 3. 資料模型

### 3.1 沿用既有 `blog_posts`（不改 schema 核心，只加追蹤欄）

```sql
-- 新增「發送通知」相關欄位
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'blog_posts'
                     AND column_name = 'notification_sent_at') THEN
        ALTER TABLE blog_posts ADD COLUMN notification_sent_at TIMESTAMPTZ;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'blog_posts'
                     AND column_name = 'notification_channels') THEN
        ALTER TABLE blog_posts
        ADD COLUMN notification_channels JSONB NOT NULL DEFAULT '[]';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'blog_posts'
                     AND column_name = 'notification_dispatched_by') THEN
        ALTER TABLE blog_posts
        ADD COLUMN notification_dispatched_by INTEGER REFERENCES teachers(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'blog_posts'
                     AND column_name = 'notification_test_log') THEN
        ALTER TABLE blog_posts
        ADD COLUMN notification_test_log JSONB NOT NULL DEFAULT '[]';
                   -- [{"channel": "email", "target": "x@x", "sent_at": "..."}]
    END IF;
END $$;
```

> 一篇 blog post 可能發送多次（先 email 再補 LINE）。`notification_channels` 是「**累計發過的通道**」，dispatch 時 append 不重複。`notification_sent_at` 是最後一次成功 dispatch 時間。

### 3.2 seed 「最新消息」分類

Migration 內 upsert：
```sql
INSERT INTO blog_categories (name, slug)
VALUES ('最新消息', 'latest-news')
ON CONFLICT (slug) DO NOTHING;
```

> 判定一篇 post 是否為「公告」：`exists (... blog_post_categories where category.slug = 'latest-news')`。

### 3.3 新增 table: `blog_post_notification_deliveries`

per-recipient 送達紀錄，供失敗重試與 audit。

```sql
CREATE TABLE IF NOT EXISTS blog_post_notification_deliveries (
    id SERIAL PRIMARY KEY,
    blog_post_id INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    dispatch_batch_id VARCHAR(36) NOT NULL,
                            -- UUID — 同一次 dispatch 屬同一個 batch，方便取消/重試
    channel VARCHAR(20) NOT NULL,           -- 'email' | 'line'
    recipient_type VARCHAR(20) NOT NULL,    -- 'teacher' | 'line_broadcast'
    recipient_id INTEGER,                   -- teacher_id；line broadcast = NULL
    recipient_address VARCHAR(200),         -- email snapshot；line = NULL
    locale_used VARCHAR(10),                -- 寄出時用的 locale（決定 link 到哪篇 post）
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
                                            -- queued | sent | failed | skipped | cancelled
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_notif_deliveries_lookup
    ON blog_post_notification_deliveries (blog_post_id, status);
CREATE INDEX IF NOT EXISTS idx_blog_notif_deliveries_queue
    ON blog_post_notification_deliveries (status, created_at)
    WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_blog_notif_deliveries_batch
    ON blog_post_notification_deliveries (dispatch_batch_id);
```

### 3.4 修改 `teachers` — 新增兩欄

```sql
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'teachers'
                     AND column_name = 'language_preference') THEN
        ALTER TABLE teachers
        ADD COLUMN language_preference VARCHAR(10) NOT NULL DEFAULT 'zh-TW';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'teachers'
                     AND column_name = 'subscribed_to_product_updates') THEN
        ALTER TABLE teachers
        ADD COLUMN subscribed_to_product_updates BOOLEAN NOT NULL DEFAULT true;
    END IF;
END $$;
```

> `language_preference` 值：`'zh-TW' | 'en'`（對齊 `BlogPost.locale` 與 `frontend/src/i18n/locales/`）。

---

## 4. 後端架構

### 4.1 新增 service: `backend/services/blog_announcement_service.py`

職責：
- `is_announcement(blog_post)` — 判定 post 是否屬 `latest-news` 分類
- `validate_for_notification(blog_post)` — dispatch 前檢查：
  - `is_published == true`
  - 屬 latest-news 分類
  - `summary` 非空（信件主體用 summary，沒有就擋）
  - `notification_test_log` 至少含一筆（必須發過測試）
  - `summary` / `title` 不含 placeholder（`TODO`、`XXX`、`{{`）
- `send_test_email(post_id, target_email)` — 測試 email；append 到 `notification_test_log`
- `send_test_line(post_id, target_line_user_id)` — 測試 LINE
- `dispatch(post_id, admin_id, channels)` — 正式發送：
  - validate
  - snapshot 收件人 → 建 deliveries（per-locale，依 teacher.language_preference 對應 `linked_post_id`）
  - 寫 batch_id 回 post
  - 更新 `notification_channels`（append）、`notification_dispatched_by`、`notification_sent_at`（dispatch 開始時間，全部送完不動）
- `cancel(batch_id, admin_id)` — queued → cancelled
- `retry_failed(batch_id)` — failed → queued

### 4.2 i18n 對應邏輯（核心）

dispatch 時組 deliveries：
```python
for teacher in teachers_with_subscription:
    target_locale = teacher.language_preference  # 'zh-TW' | 'en'

    # 找對應語言版本的 post
    if blog_post.locale == target_locale:
        target_post = blog_post
    else:
        target_post = (
            db.query(BlogPost)
            .filter(BlogPost.linked_post_id == blog_post.id,
                    BlogPost.locale == target_locale,
                    BlogPost.is_published.is_(True))
            .first()
            or blog_post  # fallback 用原始 post
        )

    create_delivery(channel='email', recipient_id=teacher.id,
                    recipient_address=teacher.email,
                    locale_used=target_post.locale,
                    blog_post_id=target_post.id, ...)
```

LINE broadcast 一次發給所有好友，無法按好友 locale 切。決策：**雙語並陳** — Flex 卡片同時放中英 title/summary，CTA 連到 `/blog/category/latest-news` 列表頁，由用戶自行挑語言版本。Email 仍照 teacher `language_preference` 分流，僅 LINE 走雙語單卡。

### 4.3 新增 worker endpoint: `POST /api/cron/dispatch-announcements`

掛在既有 `backend/routers/cron.py`，Cloud Scheduler 每分鐘觸發：
- 撈 `status='queued'` deliveries（按 created_at asc，limit 50）
- **Email 限速**：每天最多 50 封（用 DB counter table or redis）；LINE 不算
- 成功 → `status='sent'`；失敗 → `status='failed'` + `last_error`，最多 3 次重試
- batch 全部終態時自動更新 post 的 success/failure count（聚合查詢即可，不存欄位）

### 4.4 新增 service: `backend/services/line_messaging_service.py`

```python
class LineMessagingService:
    def __init__(self):
        self.channel_access_token = os.getenv("LINE_CHANNEL_ACCESS_TOKEN")

    def broadcast_flex(self, blog_post) -> dict:
        """POST https://api.line.me/v2/bot/message/broadcast"""

    def push_to_user(self, line_user_id: str, blog_post) -> dict:
        """測試用 — push 給單一已加好友的 user。"""

    def _build_flex_from_post(self, blog_post) -> dict:
        """組 Flex Message JSON，內容：cover_image + title + summary + CTA 連 blog."""
```

LINE Flex 卡片結構（雙語並陳）：
```
┌─────────────────────────────────────┐
│   [cover_image_url, 1040×520]       │
├─────────────────────────────────────┤
│ Duotopia 最新消息 / Latest News      │
├─────────────────────────────────────┤
│ 🇹🇼 {title_zh}                       │
│ {summary_zh（截斷至 ~120 字）}        │
│ ─────────────────────────────       │
│ 🇬🇧 {title_en}                       │
│ {summary_en（截斷至 ~120 字）}        │
├─────────────────────────────────────┤
│   [📖 看最新消息 / Read More]        │
│   → https://duotopia.co/blog/category/latest-news
└─────────────────────────────────────┘
```

組裝邏輯：
- 找出該 post 與其 `linked_post`，分別取中英版本（任一缺則該語言區塊省略，但至少留一語）
- CTA 統一連到 latest-news 列表頁，用戶在頁面切語言
- 單一語言 summary 截斷至約 120 字（雙語並陳空間有限）

### 4.5 修改 `backend/services/email_service.py`

新增方法：
```python
def send_blog_announcement(
    self,
    to_email: str,
    blog_post: BlogPost,         # 已是對應語言版本
    unsubscribe_token: str,
) -> bool:
    """寄產品更新通知信。
    內容：cover image + title + summary + 「閱讀全文」CTA → blog 頁面 + footer unsubscribe。
    """
```

SendGrid 切換：保持 `smtplib` 介面，只改 env：
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=<sendgrid-api-key>
```

---

## 5. API 設計

### 5.1 Admin Blog Notification API（新增 `backend/routers/admin_blog_notifications.py`）

> Blog post CRUD 沿用既有 `backend/routers/blog.py`，**不重複**。本檔只加「發送通知」相關 endpoint。

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/admin/blog/posts/{id}/notify/test-email` | 發測試 email（body: `{target_email}`） |
| `POST` | `/api/admin/blog/posts/{id}/notify/test-line` | 發測試 LINE（body: `{line_user_id}`） |
| `POST` | `/api/admin/blog/posts/{id}/notify/dispatch` | 正式發送（body: `{channels: ['email','line'], confirm: '發送'}`） |
| `POST` | `/api/admin/blog/posts/{id}/notify/cancel` | 取消 `sending` 中未發出的（body: `{batch_id}`） |
| `POST` | `/api/admin/blog/posts/{id}/notify/retry-failed` | 重試 failed（body: `{batch_id}`） |
| `GET` | `/api/admin/blog/posts/{id}/notify/deliveries?batch_id=...` | 查 per-recipient 送達狀態 |
| `GET` | `/api/admin/blog/posts/{id}/notify/status` | 摘要：last dispatch batch、success/failure count、可否再發 |

權限：所有 endpoint 要求 admin 身份（沿用既有 `require_admin` dependency）。

### 5.2 既有 blog API 微調

- `GET /api/admin/blog/posts` 回傳新增 `notification_sent_at`、`notification_channels`、`is_announcement`（computed 欄位）
- 列表頁可 filter `?category=latest-news`（既有功能即可，不用改）

### 5.3 Teacher Profile API

| Method | Path | 改動 |
|--------|------|------|
| `GET /api/teacher/profile` | response 加 `language_preference`、`subscribed_to_product_updates` |
| `PATCH /api/teacher/profile` | 允許更新上述兩欄 |

### 5.4 公開 unsubscribe

| Method | Path | Purpose |
|--------|------|---------|
| `GET /unsubscribe?token=...` | 落地頁（前端 route） |
| `POST /api/public/unsubscribe` | body `{token}`，更新 DB |

`unsubscribe_token` = `itsdangerous.URLSafeTimedSerializer` 簽 `teacher_id`，無期限。

### 5.5 註冊修改（`backend/routers/auth.py`）

`teacher_register` body 加 `language_preference`（可選，預設 `'zh-TW'`）。前端註冊時帶上偵測值。

---

## 6. 前端設計（行為描述，視覺由 Pencil 子 issue 定稿）

### 6.1 既有 Admin Blog 編輯頁加「發送通知」區塊

> 不蓋新頁面，直接在 blog 編輯頁底部加區塊。只在以下條件全成立時顯示：
> 1. `is_published == true`
> 2. post 分類包含 `latest-news`
> 3. `summary` 非空

```
─────────────────────────────────────────────────────────
📢 發送通知
─────────────────────────────────────────────────────────
此文章屬「最新消息」分類，可推送到 Email / LINE 通知用戶。

✅ 必須先發送測試才能正式發送
測試紀錄：
  • 2025-06-04 14:23 → your@duotopia.co (email) ✅
  • 尚未測試 LINE

通道  ☑ Email  ☑ LINE

       [📤 發送測試]   [🚀 正式發送]

────────────────────────────────────
歷史
最後發送：2025-06-04 15:10 by admin@xxx
通道：Email, LINE
成功 85 / 失敗 2 / 排隊中 0  [查看詳情]  [重試失敗]
─────────────────────────────────────────────────────────
```

### 6.2 「發測試」對話框

```
┌─────────────────────────────┐
│ 發送測試                     │
├─────────────────────────────┤
│ 通道  ( ) Email  ( ) LINE   │
│                             │
│ Email 收件人                 │
│ [your@email.com]            │
│ 或 LINE User ID              │
│ [U1234abcd...]              │
│                             │
│      [取消] [發送測試]        │
└─────────────────────────────┘
```

### 6.3 「正式發送」確認對話框（防手滑）

```
┌──────────────────────────────────────────────────┐
│ ⚠️  正式發送通知 — 此動作無法撤回                  │
├──────────────────────────────────────────────────┤
│ 文章：「v2.5 釋出公告」                           │
│ 通道：Email + LINE                              │
│                                                  │
│ 收件人：                                          │
│  • Email：87 位已訂閱教師                         │
│    - 中文版（zh-TW）：72 人                       │
│    - 英文版（en）：15 人                          │
│  • LINE：broadcast 給所有 OA 好友（約 142 人）     │
│                                                  │
│ 預估完成時間：                                     │
│  • LINE：立即                                    │
│  • Email：約 2 天分批送完                         │
│    （SendGrid Free 限速 50 封/天）               │
│                                                  │
│ 請輸入「發送」確認：                               │
│ [_______________]                                │
│                                                  │
│          [取消]   [⛔ 確認發送]                   │
└──────────────────────────────────────────────────┘
```

按鈕在輸入「發送」之前 disabled。

### 6.4 送達狀態頁（既有 blog 編輯頁的子分頁或 modal）

```
─────────────────────────────────────────────
送達狀態  batch: 8f3a-2025-06-04-15-10
─────────────────────────────────────────────
Email   [████████░░░░░░░░] 32/87
        ✅ 30   ❌ 2   ⏳ 55

LINE    [████████████████] ✅ broadcast 已送出

[取消未發送]  [重試失敗 2 筆]

失敗紀錄
─────────────────────────────────────────────
teacher@xxx.com    SMTP 550 mailbox full
another@yy.org     DNS lookup failed
─────────────────────────────────────────────
```

### 6.5 Teacher Profile 修改（`frontend/src/pages/teacher/TeacherProfile.tsx`）

新增「偏好設定」區塊：
```
通知設定
☑ 接收 Duotopia 產品更新通知（Email）

語言偏好
( ) 繁體中文
(•) English
```

### 6.6 註冊頁修改（`TeacherRegister.tsx` / `TeacherRegisterSheet.tsx`）

加語言下拉，預設 `i18n.language` 或 `navigator.language`：
```
語言偏好  [繁體中文 ▼]
```

### 6.7 Unsubscribe 落地頁 `/unsubscribe`

```
┌───────────────────────────────────┐
│       Duotopia                    │
├───────────────────────────────────┤
│  ✅ 已將您從產品更新通知中退訂      │
│                                   │
│  您仍會收到帳號相關的重要通知       │
│  （密碼重設、訂閱到期等）           │
│                                   │
│  改變主意了？                       │
│  [回到 Profile 重新訂閱]            │
└───────────────────────────────────┘
```

### 6.8 Email 模板

```
┌────────────────────────────────────┐
│ [Duotopia logo header]             │
├────────────────────────────────────┤
│                                    │
│  [cover_image_url — 600px 寬]       │
│                                    │
│  {blog_post.title}                 │
│                                    │
│  {blog_post.summary}               │
│                                    │
│         [📖 閱讀全文]               │
│         → /blog/{slug}             │
│                                    │
├────────────────────────────────────┤
│ © 2026 Duotopia                    │
│ 不想再收到此類郵件？                 │
│ [一鍵取消訂閱]                       │
└────────────────────────────────────┘
```

---

## 7. 審查與安全機制

### 7.1 三層防呆

1. **blog publish 本身就是審核** — 沒按 publish 不能發通知
2. **測試發送強制** — `notification_test_log` 空時 dispatch API 回 400
3. **二次確認對話框** — 輸入「發送」兩字才解鎖按鈕
4. **Placeholder 掃描** — `summary` / `title` 含 `TODO` / `XXX` / `{{` 擋下

### 7.2 權限與 audit

- 所有 `/api/admin/blog/posts/{id}/notify/*` 要求 admin 身份
- `notification_dispatched_by` 記發送者
- `notification_test_log` 記每次測試對象與時間
- 後續可從 deliveries 表查 per-recipient 結果

### 7.3 Rate limit

- Email：worker 每天最多 50 封產品更新（保留 50/100 給 transactional）
- 測試發送：每 post 每小時最多 10 次

---

## 8. 環境變數

```env
# LINE Messaging API
LINE_CHANNEL_ACCESS_TOKEN=<long-lived-token>
LINE_CHANNEL_SECRET=<channel-secret>

# Email (從 Gmail 切到 SendGrid)
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=<SENDGRID_API_KEY>

# 限速
ANNOUNCEMENT_EMAIL_DAILY_CAP=50

# Unsubscribe 簽章
UNSUBSCRIBE_TOKEN_SECRET=<random-secret>
```

部署：GCP Secret Manager + Cloud Run secret mount，三環境（develop/staging/production）各一份 LINE channel（建議 prod 用正式 OA，dev/staging 共用測試 OA）。

---

## 9. 測試計畫

### 9.1 Unit tests

| 檔案 | 涵蓋 |
|------|------|
| `tests/unit/test_blog_announcement_service.py` | `validate_for_notification` 各 fail case、is_announcement 判定、locale 對應邏輯 |
| `tests/unit/test_line_messaging_service.py` | Flex 組裝、summary 截斷 |
| `tests/unit/test_unsubscribe_token.py` | 簽章/驗證/篡改偵測 |
| `tests/unit/test_email_rate_limit.py` | daily cap counter |

### 9.2 Integration tests

| 檔案 | 涵蓋 |
|------|------|
| `tests/integration/api/test_blog_notify_api.py` | test-email / test-line / dispatch / cancel / retry / status / deliveries |
| `tests/integration/api/test_blog_notify_locale_routing.py` | teacher zh-TW vs en，發到 linked_post 正確版本 |
| `tests/integration/api/test_unsubscribe_flow.py` | email → 點連結 → DB 更新 |
| `tests/integration/api/test_teacher_profile_preferences.py` | language_preference / subscribed_to_product_updates 更新 |
| `tests/integration/api/test_announcement_dispatcher_worker.py` | worker mock SMTP / LINE，佇列 + 重試 + 限速 |

### 9.3 手動 checklist

- [ ] 在 admin 建一篇 blog post，分類「最新消息」，填 summary + cover image，publish
- [ ] 編輯頁底部出現「發送通知」區塊
- [ ] 沒填 summary → 不顯示按鈕（或顯示警告）
- [ ] 沒測試直接按發送 → API 擋下
- [ ] 發測試 email → 收到實際信件，模板正確，CTA 連回 blog 頁
- [ ] 發測試 LINE → 收到 Flex Message
- [ ] 二次確認對話框輸入錯誤值按鈕不解鎖
- [ ] summary 含 `TODO` → 擋下
- [ ] 正式發送 → 觀察狀態頁逐步增加 success_count
- [ ] zh-TW 教師收到中文版、en 教師收到英文版（linked_post 對應）
- [ ] 取消發送 → queued 變 cancelled
- [ ] 重試 failed → 重新進 queue
- [ ] 點 email unsubscribe → 落地頁正確 + DB 更新
- [ ] 已退訂者不在下一次 dispatch 收件清單
- [ ] Profile 改語言 → 下次推播切版本

---

## 10. 部署與 Migration 順序

1. **Migration**（`backend/alembic/versions/<timestamp>_blog_announcements.py`）：
   - `blog_posts` 加 4 欄
   - 建 `blog_post_notification_deliveries` table
   - `teachers` 加 `language_preference`、`subscribed_to_product_updates`
   - upsert `latest-news` category
   - 全部 idempotent（CLAUDE.md 鐵則）
2. **Backend deploy**：新 services + routers + worker endpoint
3. **GCP Secret Manager**：`LINE_CHANNEL_ACCESS_TOKEN`、`SENDGRID_API_KEY`、`UNSUBSCRIBE_TOKEN_SECRET`，三環境分別設定
4. **Cloud Scheduler**：每分鐘觸發 `/api/cron/dispatch-announcements`
5. **Frontend deploy**：blog 編輯頁加區塊、Profile、Register、Unsubscribe 落地頁
6. **冒煙測試**：staging 跑完整 9.3 checklist
7. **上 production**：先 admin 自己當收件人試發一次再 broadcast

---

## 11. Phase 2（未來，另開 issue）

- **GitHub Action 自動產生草稿** — Release PR merge 到 main 後抽 body 內 release notes → 經 Admin API 建 blog draft → Slack 通知 admin 審稿發送
- **排程發送** — 指定未來時間自動 dispatch（cron field on post）
- **Student 通知** — 等驗證 email 機制成熟
- **站內信中心** — in-app notification panel

---

## 12. 子 issue：Pencil 版面定稿

另開子 issue，內容：
1. Blog 編輯頁「發送通知」區塊 .pen
2. 「正式發送」確認對話框 .pen
3. 送達狀態頁/Modal .pen
4. Email 模板（HTML，desktop + mobile RWD）.pen
5. LINE Flex Message 卡片 .pen
6. Teacher Profile 通知設定區塊 .pen
7. Unsubscribe 落地頁 .pen

定稿後再回本 issue 進實作。

---

## 13. 預估工作量

| 區塊 | 估時 |
|------|------|
| Migration + model 欄位 | 0.5 天 |
| Backend: blog_announcement_service + API | 1 天 |
| Backend: line_messaging_service | 1 天 |
| Backend: dispatcher worker + Cloud Scheduler | 1 天 |
| Backend: unsubscribe + profile/register 修改 | 0.5 天 |
| Frontend: 既有 blog 編輯頁加區塊 + 對話框 | 1 天 |
| Frontend: 送達狀態頁 | 0.5 天 |
| Frontend: Profile + Register + Unsubscribe | 1 天 |
| Email 模板 HTML/CSS | 0.5 天 |
| 測試（unit + integration） | 1 天 |
| 手動驗證 + bug fix | 1 天 |
| **總計** | **~9 天** |

Pencil 子 issue 預估另外 1-2 天。

---

## 14. 風險

| 風險 | 緩解 |
|------|------|
| LINE channel access token 洩漏 | 只放 GCP Secret Manager，不進 git，不寫 log |
| broadcast 內容寫錯一發無法撤回 | 三層防呆 + blog publish 多一層；測試發送強制 |
| SendGrid Free 額度被 transactional 吃光 | worker 限速 50/天，留 50 給 transactional |
| Unsubscribe token 被猜測 | `itsdangerous` 簽章 + secret key 從 env 讀 |
| 中英版 linked_post 不一致或漏建英文版 | dispatch 時找不到對應 locale → fallback 原始 post，UI 顯示警告 |
| Blog 文章 summary 為空 | 發送通知按鈕不顯示 + API validate 擋下 |

---

## 15. 已確認決策

- [x] **LINE OA Messaging channel**：已申請（實作階段確認 token 有效 + 取得 `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` 放 GCP Secret Manager）
- [x] **Email 寄件人**：`updates@duotopia.co`（與 transactional 的 `noreply@` 分流，方便看 open rate）
  - 寄件 mailbox 可不存在，但網域必須設 SPF + DKIM + DMARC（`p=quarantine` 起步），否則 Gmail/Yahoo 會擋（2024 新規）
  - `Reply-To:` 指向 `support@duotopia.co`，避免用戶按回覆無人回應
- [x] **Blog 圖片上傳**：既有 `POST /api/admin/blog/upload-image`（GCS bucket，magic-byte 驗證 JPEG/PNG/GIF/WebP，20MB 上限）。`cover_image_url` 沿用此機制，本 spec 不另設
- [x] **LINE broadcast 雙語策略**：採「雙語並陳」單一 Flex Message
  - 卡片內同時放中文 + 英文 title/summary
  - CTA 連到 `/blog/category/latest-news`（最新消息列表），用戶在頁面選自己要看的語言版本
  - 不再依「原始 post locale」決定，省去語言判斷
