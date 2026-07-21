# Issue #862 — 方案 A：只切 UI/Workspace（外科手術式）

> **一句話**：後端帳務／名冊／點數／座位限制的 `Organization`／`School` 機制**原封不動**；
> 只讓團購老師在 App 內「看不到、也進不去」機構（organization）模式，恢復個人自管路徑。

---

## 1. 需求與產品決策

| 項目 | 決策 |
|------|------|
| 團購老師的模式 | 一律「個人模式」，自行管理班級／學生 |
| Workspace 切換器 | 對團購老師**隱藏**（不出現 org/school 切換） |
| 發起人（開團人）角色 | 僅「付款人」：買席次、邀名冊、付款／續約；**無**對他人班級/學生的管理權 |
| 不可影響 | 正常機構（`org_type='institution'`）方案行為必須完全一致 |

## 2. 現況與問題根因

- 方案判別欄位已存在：`Organization.org_type ∈ {institution, group_buy}`
  （[organization.py:57](../../backend/models/organization.py#L57)）。
- 開團時（[group_buy.py:97](../../backend/services/group_buy.py#L97)）建立：
  `Organization(group_buy)` + `School` + 發起人 `TeacherOrganization(org_owner)` + `TeacherSchool(school_admin)`。
- 團員只綁 `TeacherSchool(roles=["teacher"])`，**無** `TeacherOrganization`
  （[credit_packages.py:1385](../../backend/routers/credit_packages.py#L1385)）。
- 前端 `WorkspaceContext` 打 `GET /teachers/{id}/organizations`
  （[WorkspaceContext.tsx:129](../../frontend/src/contexts/WorkspaceContext.tsx#L129)）；
  回傳非空即出現 org 切換器，並可 `selectSchool` 進 organization 模式。
- `TeacherClassrooms` 在 `mode==='organization' || selectedSchool!==null` 時
  **停用**新增/編輯/刪除班級鈕（[TeacherClassrooms.tsx:885](../../frontend/src/pages/teacher/TeacherClassrooms.tsx#L885)）。

**根因**：`get_teacher_organizations` 端點
（[teacher_organizations.py:100](../../backend/routers/teachers/teacher_organizations.py#L100)）
join `TeacherOrganization` 且**不分 `org_type`**。於是持有 `org_owner` 的**發起人**被回傳一個
group_buy org → 前端進入 organization 模式 → 自管鈕被停用。
（團員無 `TeacherOrganization`，本來就回傳空 → 已是個人模式；本案讓兩者行為一致並鎖死。）

## 3. 設計

**唯一切點**：在 `get_teacher_organizations` 加入 `Organization.org_type != 'group_buy'` 過濾。

- 發起人的 `organizations` 因此變空 → 前端回到 `personal` → 自管鈕解除停用。
- 機構老師（`org_type='institution'`）不受影響，回傳與行為完全一致。
- **帳務不受影響**：`/org-purchase`、`/org-renew` 是後端端點，直接查 DB 的
  `TeacherOrganization.role=='org_owner'`，**不經** `get_teacher_organizations`。
  發起人續約/加購照常。
- **每月點數 cron 不受影響**：`grant_monthly_for_group_buy`
  （[group_buy.py:305](../../backend/services/group_buy.py#L305)）用
  `TeacherSchool→School→Plan→Organization(group_buy)` 直接查 DB，與此端點無關。
- **`/subscription/status` 不受影響**：`plan_type` 仍由 `org_type` 推導
  （[payment.py:964](../../backend/routers/payment.py#L964)），團購付款/名冊頁照常運作。

> 寫法建議：以 **`org_type` 判別**（非名稱）過濾，與現有 `_guard_group_buy`、cron 一致，
> 且日後若走方案 B，這個 `org_type`-based 判別可直接沿用，不白做。

### 3.1 後端變更

`backend/routers/teachers/teacher_organizations.py` — 在既有 query 加條件：

```python
.join(Organization, TeacherOrganization.organization_id == Organization.id)
.filter(
    TeacherOrganization.teacher_id == teacher_id,
    TeacherOrganization.is_active.is_(True),
    Organization.is_active.is_(True),
    Organization.org_type != "group_buy",   # ← 新增：團購 org 不進 workspace
)
```

> `org_type` 目前 NOT NULL 且 default `'institution'`，故 `!= 'group_buy'` 安全涵蓋所有機構列。

### 3.2 前端變更

- 理論上**零改動**：`organizations` 變空後，org 切換器與 organization 模式自然消失，
  `TeacherClassrooms` 回到個人自管。
- 加固（視驗證結果，可選）：
  - `WorkspaceContext` / layout 若有任何以 `TeacherSchool` 存在就顯示 school 工作區的分支，確認團購 school 不觸發。
  - `TeacherClassrooms.tsx` 的 1Campus 同步 gate `hasOrganization = organizations.length>0` 對團購老師會變 false（正確：團購非機構，不該有 1Campus 同步）。

## 4. 測試計畫（TDD）

| 測試 | 期望 |
|------|------|
| `test_get_teacher_organizations_excludes_group_buy`（新） | 只屬 group_buy org 的發起人 → 回傳 `organizations: []` |
| `test_get_teacher_organizations_returns_institution`（回歸） | 機構老師 → 照常回傳其 org/school |
| `test_group_buy_open_*`（既有） | 開團、名冊、座位限制全綠 |
| `test_org_purchase / org_renew`（回歸） | 發起人續約/加購仍可用（不依賴此端點） |
| `test_monthly_renewal_group_buy_phase`（既有） | 每月點數照發 |
| 前端 e2e（手動或 Playwright） | 團購發起人 + 團員都能新增班級/學生；機構老師 org 後台不變 |

## 5. 影響檔案

| 檔案 | 變更 |
|------|------|
| `backend/routers/teachers/teacher_organizations.py` | +1 filter 條件 |
| `backend/tests/test_teacher_organizations*.py` | 新增 2 個測試 |
| `frontend/src/pages/teacher/TeacherClassrooms.tsx`（視需要） | 驗證/微調 |
| `frontend/src/contexts/WorkspaceContext.tsx`（視需要） | 驗證/微調 |

## 6. 風險與緩解

| 風險 | 等級 | 緩解 |
|------|------|------|
| 誤過濾到機構 org | 低 | 以 `org_type` 精準判別；回歸測試覆蓋 institution |
| 發起人帳務失效 | 低 | 帳務走獨立端點查 DB，不經此端點；加回歸測試 |
| 前端仍有殘留 org 入口 | 低 | e2e 驗證發起人與團員兩種帳號 |

## 7. 上線

- 單一 PR → staging 驗證 → 正式。
- 無資料遷移、無破壞性變更。

## 8. 取捨結論

- ✅ 風險極低、零觸及機構方案、無資料遷移、1 個 PR。
- ✅ 帳務/名冊/cron 全走既有已測試路徑。
- ⚠️ 概念上團購「底層仍是一個 Organization/School」，僅對老師隱形；admin 後台仍看得到
  group_buy org（現況本就如此，admin 需要它做帳務）。
- ⚠️ 若日後要讓座位/名冊語意完全脫離機構表，仍是技術債 → 見**方案 B**。

**工作量：S（小）**
