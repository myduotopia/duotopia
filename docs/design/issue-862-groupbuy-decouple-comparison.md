# Issue #862 — 團購脫離機構、改屬個人模式：兩案比較

> 目標：團購老師（發起人 + 團員）在 App 內一律以「個人模式」運作，自行管理班級/學生；
> **完全不得影響正常機構（institution）方案的行為**。
> 已確認產品決策：workspace 切換器對團購老師隱藏（全個人模式）；發起人僅為「付款人」，
> 對其他團員的班級/學生無管理權。

## 背景：現況耦合點

| 面向 | 現況 | 檔案 |
|------|------|------|
| 方案判別 | `Organization.org_type ∈ {institution, group_buy}`（已存在的唯一判別欄位） | [organization.py:57](../../backend/models/organization.py#L57) |
| 團購建立 | 開團 = 建 `Organization(group_buy)` + `School` + 發起人 `TeacherOrganization(org_owner)` + `TeacherSchool(school_admin)` | [group_buy.py:97](../../backend/services/group_buy.py#L97) |
| 團員綁定 | 只綁 `TeacherSchool(roles=["teacher"])`，**無** `TeacherOrganization` | [credit_packages.py:1385](../../backend/routers/credit_packages.py#L1385) |
| 進 org 模式 | 前端 `WorkspaceContext` 打 `GET /teachers/{id}/organizations`，回傳非空即出現 org 切換器 | [WorkspaceContext.tsx:129](../../frontend/src/contexts/WorkspaceContext.tsx#L129) |
| 停用自管 | `TeacherClassrooms` 在 `mode==='organization' \|\| selectedSchool!==null` 時停用新增/編輯/刪除鈕 | [TeacherClassrooms.tsx:885](../../frontend/src/pages/teacher/TeacherClassrooms.tsx#L885) |
| 發起人帳務 | 續購/加購走 org-owner 把關的 `/org-purchase`、`/org-renew`（直接查 DB 的 `TeacherOrganization.role`） | [credit_packages.py](../../backend/routers/credit_packages.py) |
| 每月點數 | cron 以 `TeacherSchool→School→Plan→Organization(group_buy)` join 發點 | [group_buy.py:305](../../backend/services/group_buy.py#L305) |
| 訂閱狀態 | `/subscription/status` 由 `org_type=='group_buy'` 推導 `plan_type ∈ {group_buy_owner, group_buy_member}` | [payment.py:964](../../backend/routers/payment.py#L964) |

**關鍵**：只有**發起人**因 `TeacherOrganization(org_owner)` 被推進 org 模式；團員本來就是空 organizations → 已是個人模式。

---

## 方案 A — 只切 UI/Workspace（外科手術式）

**核心思路**：後端帳務/名冊/點數/座位限制的 `Organization`/`School` 機制**原封不動**；
只讓團購老師在 App 內「看不到、進不去」org 模式，恢復個人自管路徑。

### 變更清單

1. **後端 `get_teacher_organizations`** — 加 `Organization.org_type != 'group_buy'` 過濾，讓團購 org 不再進 workspace。
   發起人的 `organizations` 因此變空 → 前端回到 personal，新增/編輯鈕解除停用。
   - 機構老師：`org_type=='institution'` 不受影響，行為完全一致。
   - 帳務不受影響：`/org-purchase`、`/org-renew` 直接查 DB 的 `TeacherOrganization`，不經此端點。
2. **前端**：無需大改。organizations 變空後 org 切換器自然消失。
   （可選加固：`TeacherClassrooms`/layout 不再依賴 group_buy org。）
3. **驗證**：發起人與團員都能在個人模式新增班級/學生；機構老師 org 後台不變；
   發起人續購/加購仍可用；每月點數 cron 照常。
4. **測試**：
   - `test_teacher_organizations_excludes_group_buy`（新）：發起人只有 group_buy org → 回傳空。
   - 機構老師 org 仍回傳（回歸）。
   - 既有 `test_group_buy_*`、帳務、cron 測試全綠。

### 影響檔案（約 1 後端端點 + 測試；前端多為驗證）
- `backend/routers/teachers/teacher_organizations.py`（+ 過濾）
- `backend/tests/test_teacher_organizations*.py`（新測試）
- 前端 `TeacherClassrooms.tsx` / `WorkspaceContext.tsx`（視驗證結果微調）

### 優缺點
- ✅ 風險極低、零觸及機構方案、無資料遷移、可 1 個 PR 完成。
- ✅ 帳務/名冊/cron 全部沿用既有已測試路徑。
- ⚠️ 概念上團購「底層仍是一個 Organization/School」，只是對老師隱形；
  admin 後台仍會看到 group_buy org（現況本就如此，且 admin 需要它做帳務）。
- ⚠️ 未來若要讓團購座位/名冊語意完全脫離機構表，仍是技術債。

### 工作量：**S**（小，1–2 檔 + 測試）

---

## 方案 B — 後端全面重構（團購自成一格）

**核心思路**：團購不再借用 `Organization`/`School`。新增專屬模型，把「開團、座位、名冊、
帳務窗口、每月點數」全部搬離機構表，機構表只服務真正的機構方案。

### 變更清單

1. **新資料模型**（idempotent migration，只新增不刪除）
   - `group_buy_teams`：`id, owner_teacher_id, plan_id, seat_limit, subscription_start/end, contact_email/phone, is_active`。
   - `group_buy_members`：`team_id, teacher_id, is_active`（取代團員的 `TeacherSchool`）。
   - 發起人記於 `owner_teacher_id`（取代 `TeacherOrganization(org_owner)` + `TeacherSchool(school_admin)`）。
2. **開團流程** `group_buy.py`：`create_group_buy_org_and_school` → `create_group_buy_team`；
   重複開團 `add_group_buy_school_to_org` → `add_seats_to_team`（或多 team）。
3. **帳務**：新增團購專屬 `/group-buy-purchase`、`/group-buy-renew`，把 org-owner 把關換成
   `group_buy_teams.owner_teacher_id == current_teacher`；不再共用 `/org-purchase`、`/org-renew`。
4. **每月點數 cron** `grant_monthly_for_group_buy`：改 join `group_buy_members→group_buy_teams→Plan`。
5. **訂閱狀態** `/subscription/status`：`plan_type` 改由 `group_buy_teams/members` 推導，不再看 `org_type`。
6. **Admin**：`AdminOrganizations`、`admin_subscriptions` 的 group_buy 分支、`/validate-team-emails`
   （`in_group_buy_team` 判定）、`credit_packages` 名冊/加購全部改讀新表。
7. **資料遷移**：把既有 group_buy `Organization/School/TeacherSchool/TeacherOrganization/SubscriptionPeriod`
   回填進 `group_buy_teams/members`（保留舊列，雙讀過渡；依 migration 鐵則不 drop）。
8. **前端**：`GroupBuyOpenPage`、`TeacherSubscription`（group_buy_owner/member 分支）、
   `PricingPage`、`admin/*`、`api.ts` 全部改對新端點/欄位。
9. **測試**：整組 `test_group_buy_*` 重寫；新增 team/member CRUD、帳務、cron、遷移回填、
   admin 分支測試；機構回歸測試。

### 影響檔案（約 15+ 後端 + 8+ 前端 + 遷移）
group_buy.py、credit_packages.py、payment.py、admin_subscriptions.py、cron.py、
models/（新增）、多支 alembic、`test_group_buy_*` 全套；
前端 GroupBuyOpenPage、TeacherSubscription、PricingPage、admin/AdminOrganizations、
AdminSubscriptionDashboard、types/admin.ts、lib/api.ts。

### 優缺點
- ✅ 語意乾淨：團購與機構完全解耦，機構表不再混入 group_buy 列。
- ✅ 移除「借用 org_owner 端點」的技術債。
- ⚠️ 風險高：觸及帳務、cron、admin、遷移；任何回填錯誤會影響營收/發點。
- ⚠️ 需資料遷移 + 雙讀過渡，建議拆 3–4 個 PR 分階段上線並各自驗證。
- ⚠️ 機構方案雖非直接目標，但共用檔案多（credit_packages、payment、admin），回歸面積大。

### 工作量：**L**（大，多 PR、含資料遷移與雙讀過渡）

---

## 併排總結

| 面向 | 方案 A（UI 切割） | 方案 B（後端重構） |
|------|------------------|-------------------|
| 達成「團購=個人模式、自管班級/學生」 | ✅ | ✅ |
| 隱藏 workspace 切換器 | ✅ | ✅ |
| 發起人僅付款人 | ✅（沿用現況帳務） | ✅（專屬帳務端點） |
| 觸及機構方案風險 | 幾乎為零 | 中（共用檔案多） |
| 資料遷移 | 無 | 有（回填 + 雙讀） |
| 帳務/cron 重寫 | 無 | 有 |
| admin 後台看得到 group_buy org | 是（不變） | 否（改新表） |
| 技術債清償 | 否（org/school 仍為底層） | 是 |
| PR 數 / 工作量 | 1 PR / **S** | 3–4 PR / **L** |
| 回歸測試面積 | 小 | 大 |

**建議**：先出 **方案 A** 解決使用者痛點（發起人被鎖在 org 模式無法自管），
把 **方案 B** 列為後續技術債重構（另開 issue，分階段）。方案 A 的過濾若採
「`org_type` 判別」寫法，本身也是方案 B 的乾淨墊腳石，不會白做。
