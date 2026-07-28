# Issue #862 — 方案 B：後端全面重構（團購自成一格）

> **一句話**：團購不再借用 `Organization`／`School`。新增團購專屬模型，把「開團、座位、
> 名冊、帳務窗口、每月點數」全部搬離機構表，機構表只服務真正的機構方案。

---

## 1. 需求與產品決策

同方案 A：團購老師一律個人模式、自管班級/學生、切換器隱藏、發起人僅付款人、不得影響機構方案。
差異在於本案**從資料層徹底解耦**，清償「借用 org_owner 端點」的技術債。

## 2. 目標狀態

- 團購與機構在資料層完全獨立：機構表（`organizations`/`schools`/`teacher_organizations`/`teacher_schools`）
  不再出現任何 `group_buy` 列。
- 團購以專屬 `group_buy_teams` / `group_buy_members` 表達；發起人是 team 的 `owner_teacher_id`。
- 團購老師天生就是個人模式（沒有任何 org/school 綁定 → 不可能進 org 模式）。

## 3. 新資料模型（idempotent migration，只新增不刪除）

```
group_buy_teams
  id                    PK
  owner_teacher_id      FK teachers            -- 發起人（取代 TeacherOrganization org_owner + TeacherSchool school_admin）
  plan_id               FK plans               -- 團購方案（teacher_seats/annual_fee/topup_discount）
  seat_limit            int                    -- 席次上限（取代 School.teacher_seat_limit / Org.teacher_limit）
  subscription_start    timestamptz
  subscription_end      timestamptz            -- 年度窗口（取代 Org.subscription_*）
  contact_email         varchar                -- 發起人聯絡資訊
  contact_phone         varchar
  is_active             bool default true
  created_at / updated_at

group_buy_members
  id                    PK
  team_id               FK group_buy_teams
  teacher_id            FK teachers            -- 取代團員的 TeacherSchool(roles=["teacher"])
  is_active             bool default true
  UNIQUE(team_id, teacher_id)
```

> 重複開團：依現況語意（新增分校 = 加席次）改為 `add_seats_to_team`（同 team 疊加 `seat_limit`
> 並延展 `subscription_end`），或另建 team；建議沿用「同發起人聚合到同一 team」以對齊現有行為。

## 4. 變更清單（依層）

### 4.1 開團 / 名冊 `backend/services/group_buy.py`
- `create_group_buy_org_and_school` → `create_group_buy_team`（建 team + owner 記於 `owner_teacher_id`）。
- `add_group_buy_school_to_org` → `add_seats_to_team`。
- `find_owned_group_buy_org` → `find_owned_group_buy_team`。
- 團員綁定（`credit_packages.py:1385` 的 `TeacherSchool`）→ 建 `group_buy_members`。

### 4.2 帳務 `backend/routers/credit_packages.py`
- 新增團購專屬 `/group-buy-purchase`、`/group-buy-renew`；
  把關由 `TeacherOrganization.role=='org_owner'` 換成 `group_buy_teams.owner_teacher_id == current_teacher`。
- **不再共用** `/org-purchase`、`/org-renew`（機構專用，回歸機構語意乾淨）。
- `/validate-team-emails` 的 `in_group_buy_team` 判定改讀 `group_buy_members`。

### 4.3 每月點數 cron `backend/services/group_buy.py:305`
- `grant_monthly_for_group_buy` 改 join `group_buy_members → group_buy_teams → Plan`
  （條件：team `is_active` 且 `subscription_end >= today`）。
- Idempotency / advisory-lock / dedup 邏輯沿用。

### 4.4 訂閱狀態 `backend/routers/payment.py:964`
- `plan_type ∈ {individual, group_buy_owner, group_buy_member}` 改由
  `group_buy_teams`（owner）/ `group_buy_members`（member）推導，不再看 `org_type`。

### 4.5 Admin
- `admin_subscriptions.py` group_buy 分支（手動加入）改寫至新表。
- `frontend/src/pages/admin/AdminOrganizations.tsx`：group_buy 不再是 org → 需要獨立「團購管理」視圖或從 org 列表移除。
- `AdminSubscriptionDashboard.tsx`、`types/admin.ts`（`org_type` 相關）對應調整。

### 4.6 前端
- `GroupBuyOpenPage.tsx`、`TeacherSubscription.tsx`（`group_buy_owner/member` 分支）、
  `PricingPage.tsx`、`GroupBuyPlanCards.tsx`、`lib/api.ts` 改對新端點/欄位。

### 4.7 資料遷移（關鍵、最高風險）
- 回填：既有 group_buy `Organization/School` → `group_buy_teams`；
  `TeacherSchool(teacher)` → `group_buy_members`；`TeacherOrganization(org_owner)` → `owner_teacher_id`；
  既有 `SubscriptionPeriod(payment_method='group_buy')` 保持不動（仍掛在 teacher 上）。
- **雙讀過渡**：新舊路徑並行一段時間，cron/帳務先讀新表、缺漏 fallback 舊表；驗證無誤後再收斂。
- 依 migration 鐵則：**只新增、不 drop/rename**；舊 group_buy org/school 列保留（標記或閒置）。

## 4.8 既有個人訂閱者加入團購：暫停 + 延展（殘值保留）

> **產品決策（已定案）**：團購為期一年。若成員入團前已有有效個人訂閱，入團時**暫停**個人訂閱、
> 期間改吃團購每月 1000 點；退團或團購結束時**恢復個人訂閱的殘值**（凍結當下的剩餘時間＋未用點數
> 原封接續），殘值走完後 `auto_renew` 再自然接手續扣。**不給全新月配額。**

### 現況機制（設計前提）
- 個人訂閱 = 一筆 `SubscriptionPeriod`；`current_period` 只取 `status='active'` 且 `start_date` 最新一筆，
  quota 只算 current_period + credit_packages（多筆 active period 不相加）。
- **致命前提**：暫停期間只要 auto_renew cron 建了一筆 `status='active'` 個人 period（`start_date=now`），
  會立刻蓋掉團購並重複收費 → 暫停**必須同時關掉** `subscription_auto_renew`。

### 資料模型增修
- `SubscriptionPeriod.status` 新增 `'paused'`：暫停中的個人 period 不再是 current，
  也**不會**被 cron Phase 1 標 expired（Phase 1 只掃 `status='active'`）。
- `group_buy_members` 增欄位：
  - `paused_period_id` FK `subscription_periods`（被暫停的個人 period；NULL = 入團時無個人訂閱）
  - `paused_remaining_seconds` int（凍結的剩餘時間，精確到秒，避免時區誤差）
  - `individual_auto_renew_suspended` bool（入團時是否為它關掉 auto_renew，決定退團要不要恢復）
  - `paused_at` timestamptz

### 入團演算法
```
join(teacher, team):
    ind = teacher.current_period            # active 個人 period
    if ind and ind.end_date > now:
        member.paused_remaining_seconds = int((ind.end_date - now).total_seconds())  # 凍結殘值(時間)
        member.paused_period_id = ind.id
        member.paused_at = now
        ind.status = 'paused'               # 退出 current 選取；quota_used 原封不動 = 殘值(點數)
        if teacher.subscription_auto_renew:
            teacher.subscription_auto_renew = False
            member.individual_auto_renew_suspended = True
    # 之後成員照常吃團購每月 1000 monthly grant（4.3）
```
> `end_date <= now`（個人訂閱已過期）→ 不暫停，當純團購成員處理。

### 恢復演算法（退團 / 團購結束共用）
`resume trigger` = 會籍失效那一刻：**提早退團** → 退團日；**團購年度結束/發起人不續約** → 團購 `subscription_end`。
```
resume(member):
    resume_at = now
    p = member.paused_period_id -> SubscriptionPeriod
    if p:
        # 把凍結的殘值（時間＋未用點數）原封接到 resume 之後
        p.start_date = resume_at
        p.end_date   = resume_at + timedelta(seconds=member.paused_remaining_seconds)
        p.status     = 'active'             # quota_used 保持不變 → 點數殘值延續
        if member.individual_auto_renew_suspended:
            teacher.subscription_auto_renew = True   # 殘值走完後由既有月扣 cron 自然接手
```
> 在 **resume 當下**（`start_date=now`）才改動 period，不在入團時預建未來 period，
> 避免「未來 start_date 的 period 被誤選為 current」。恢復是「原 period 平移殘值」而非新建，
> 故時間與點數殘值皆保留。

### 恢復觸發點（實作面）
1. **成員主動退團 / 被移出名冊** → 立即 `resume(member)`。
2. **團購結束**：cron（月結或每日）掃 `group_buy_teams.subscription_end < now && is_active`，
   對其所有 `group_buy_members` 執行 `resume`，並停發次月團購點。
3. **對帳兜底 cron**：掃「有 `paused_period_id` 但會籍已失效卻仍 paused」的成員，補跑 resume（防 P2）。

### 邊界與定案
| 情境 | 處理 |
|------|------|
| 入團時無個人訂閱 | 純團購成員，`paused_period_id=NULL`，退團無恢復動作 |
| 個人訂閱已過期才入團 | 不暫停 |
| auto_renew 月扣型 | 殘值通常僅約當月剩餘＋未用點數；恢復後走完即 auto_renew 續扣 |
| manual 預付多月型 | 殘值可能數月；恢復後完整延續，走完才續扣（若當初有 auto_renew）|
| 提早退團 | 立即從退團日恢復殘值（不等年度走完）|
| 恢復時卡已失效 | 殘值先照跑；殘值走完 auto_renew 首扣失敗 → 走既有 auto_renew 失敗流程（見 P5）|

## 5. 測試計畫
- 新：team/member CRUD、`create_group_buy_team`、`add_seats_to_team`、
  `/group-buy-purchase`、`/group-buy-renew`、cron（新 join）、`/subscription/status`（新推導）、
  遷移回填正確性、雙讀 fallback。
- 重寫：整組既有 `test_group_buy_*`。
- 回歸：機構方案（org/school、`/org-purchase`、`/org-renew`、admin org）完全不變。

## 6. 影響檔案（約 15+ 後端 + 8+ 前端 + 多支遷移）

**後端**：`models/`（新增 2 模型）、`services/group_buy.py`、`routers/credit_packages.py`、
`routers/payment.py`、`routers/admin_subscriptions.py`、`routers/cron.py`、
`routers/teachers/teacher_organizations.py`、多支 `alembic/versions/*`、
`tests/test_group_buy_*` 全套 + 新測試。
**前端**：`GroupBuyOpenPage.tsx`、`TeacherSubscription.tsx`、`PricingPage.tsx`、
`GroupBuyPlanCards.tsx`、`admin/AdminOrganizations.tsx`、`admin/AdminSubscriptionDashboard.tsx`、
`types/admin.ts`、`lib/api.ts`。

## 7. 分階段上線（建議 3–4 PR）
1. **PR1**：新增 `group_buy_teams/members` 模型 + 遷移回填（不改讀寫路徑，純建表 + backfill）。
2. **PR2**：開團/名冊/cron/subscription-status 改雙讀新表（fallback 舊表）。
3. **PR3**：帳務改專屬端點；前端切新端點；admin 團購視圖。
4. **PR4**：收斂雙讀、清理舊路徑（保留舊資料列，不 drop）。

每個 PR 各自 staging 驗證；帳務/發點屬營收關鍵，需重點回歸。

## 8. 風險與緩解

### 8.1 重構整體風險
| 風險 | 等級 | 緩解 |
|------|------|------|
| 遷移回填錯誤影響營收/發點 | 高 | 雙讀過渡 + 回填對帳測試 + 只新增不刪除，可回滾讀取來源 |
| 共用檔案（credit_packages/payment/admin）回歸面積大 | 中 | 機構回歸測試套件 + 分階段 PR |
| 帳務端點切換期間邊界（跨月續約） | 中 | fallback 舊表 + 明確切換日 |
| `subscription_status` 語意變動 | 中 | 同步調整 status property + `/subscription/status` + e2e |
| admin 團購視圖缺口（group_buy 不再是 org） | 中 | 遷移前先做好獨立「團購管理」視圖 |

### 8.2 暫停+延展（4.8）專屬風險
| # | 風險 | 情境 | 等級 | 緩解 |
|---|------|------|:--:|------|
| P1 | **auto_renew 沒擋成** | 暫停期間 cron 仍月扣並建 active period → 蓋掉團購 + 重複收費 | 高 | 入團強制關 `subscription_auto_renew`；cron 加防呆：跳過有 active 團購會籍的老師 |
| P2 | **resume 沒被觸發** | 退團/團購結束事件漏跑 → 個人訂閱永停 paused，吞掉已付權益 | 高 | 事件即時 resume + 對帳兜底 cron（掃會籍失效但仍 paused 者）|
| P3 | **凍結時間算錯** | 時區/naive datetime（SQLite vs PG）→ `paused_remaining_seconds` 偏差 | 中 | 一律 tz-aware UTC 計算；沿用 `_as_utc` 模式；單元測試覆蓋跨時區 |
| P4 | **既有資料** | prod 已同時有個人訂閱＋團購的老師，遷移時需偵測並套暫停狀態 | 中 | 遷移回填階段掃描並套用 `join` 邏輯；對帳報表 |
| P5 | **恢復月扣的卡失效** | 暫停一年後卡過期，殘值走完 auto_renew 首扣失敗 | 中 | 走既有 auto_renew 失敗流程（關 auto_renew + 通知）；不阻斷殘值使用 |
| P6 | **`paused` status 汙染既有查詢** | 別處假設 status 只有 active/expired/cancelled | 中 | 全域搜尋 status 使用點；paused 明確排除於 current/expired 掃描 |

> P1、P2 為最致命兩點（一個重複收費、一個吞掉已付權益），實作必須有對帳 cron 兜底。

## 9. 取捨結論
- ✅ 語意乾淨：團購與機構在資料層完全解耦；機構表不再混入 group_buy。
- ✅ 移除「借用 org_owner 端點」技術債。
- ⚠️ 風險高、需資料遷移 + 雙讀、多 PR、回歸面積大。

**工作量：L（大）**

---

> 併排比較與最終建議見
> [`issue-862-groupbuy-decouple-comparison.md`](./issue-862-groupbuy-decouple-comparison.md)。
> 目前建議：先做**方案 A** 解痛點，**方案 B** 另開技術債 issue 分階段執行；方案 A 的
> `org_type`-based 過濾為方案 B 的乾淨墊腳石。
