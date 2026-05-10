# 1Campus 系統整合 API (jasmine)

> OpenAPI 3.0.0 · Version 1.0.1
> 1Campus 對口：榮哥正 (lelala@ischool.com.tw)
> 1Campus 開發者後台：https://auth.ischool.com.tw/1campus/manage/
> Swagger 文件入口：https://devapi.1campus.net/doc

文件涵蓋 Duotopia 用到的兩塊：

1. **Identity Code 認證** — 教師 / 學生從 1Campus 平台跳到 Duotopia 完成 SSO（已實作於 `auth_one_campus.py`）
2. **Jasmine 班群資料 API** — 後端 server-to-server 拉取教師的班級與學生名冊（#635 / #721 / #722）

---

## 系統架構

```
┌────────────────────────┐         ┌──────────────────────────┐
│  Duotopia 後端          │         │  1Campus 認證/資源主機    │
│                        │         │                          │
│  POST  oauth/token.php │ ──────▶ │  https://auth.ischool... │  ← 拿 access_token
│        (client creds)  │         │     /oauth/token.php     │
│                        │         │                          │
│  GET   /api/jasmine/   │ ──────▶ │  https://devapi.         │  ← 拉名冊
│        ...             │         │     1campus.net/api/...  │
└────────────────────────┘         └──────────────────────────┘
```

**重要分工**：
- 取 token：`https://auth.ischool.com.tw/oauth/token.php` (auth host)
- 呼叫 jasmine API：`https://devapi.1campus.net/api/jasmine/...` (api host)

兩個 host 不一樣。token 只能在 auth host 拿，所有 jasmine 資料端點都在 api host。

---

## OAuth 認證

### 取得 server-to-server access_token

```
POST https://auth.ischool.com.tw/oauth/token.php
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=<DUOTOPIA_CLIENT_ID>
&client_secret=<DUOTOPIA_CLIENT_SECRET>
&scope=jasmine,jasmine.idNumberHash,jasmine.profile
```

> 文件版本範例顯示 `GET /oauth/token` (query string)，實測 `POST /oauth/token.php` (form body) 也接受。Duotopia 統一用 POST + form body，跟使用者 OAuth 的 `authorization_code` 流程同一個 endpoint。

#### 回應

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "jasmine jasmine.idNumberHash jasmine.profile"
}
```

建議 token 快取到 expire 前 ~2 分鐘再重新請求（已實作於 `_get_access_token()`）。

### 可用的 scope 列表

| Scope | 用途 |
|-------|------|
| `jasmine` | **必填**。基本 jasmine 資料權限（getUserRole / getClass / getClassStudent / getCourse / getCourseStudent / getTeacher / getSchool） |
| `jasmine.sourceIndex` | 啟用 `*SourceIndex` 欄位（teacherSourceIndex、classSourceIndex、studentSourceIndex） |
| `jasmine.idNumberHash` | 啟用 `idNumberHash` 欄位（身分證 SHA256） |
| `jasmine.teacherTag` | 啟用教師類別（`tag` 陣列，例如「教務主任」） |
| `jasmine.teacherPosition` | 啟用教師處室與職務（`position` 陣列） |
| `jasmine.department` | 啟用班級科別資料（`department` 物件） |
| `jasmine.profile` | 啟用基本資料：`gender`、`birthdate`、`status`（一般 / 延修） |
| `jasmine.contact` | 啟用學生聯絡資料（電話、郵件、地址） |
| `jasmine.custodian` | 啟用學生監護人資料（父、母、監護人） |
| `jasmine.semesterHistory` | 啟用學生的學期歷程 |

> ⚠️ **沒有 `jasmine.class` / `jasmine.classroom`**。
> 班級與學生名冊只需要 `jasmine` 即可。如果回 401 / 403，問題不在 scope，請檢查 URL 路徑或 client 是否被學校授權。

---

## 學校與帳號資料模型

### 識別主體（同一份資料的多種 key）

帳號類：`teacherAcc`、`studentAcc`
ID 類：`teacherID`、`studentID` (int64，**僅在同一所 schoolDsns 內保證唯一**)
跨年度穩定：`teacherSourceIndex`、`studentSourceIndex`、`classSourceIndex`（需 `jasmine.sourceIndex` scope）

### 班級 vs 課程（重要區分）

| | 班級 (class) | 課程 (course) |
|---|---|---|
| API | `getClass` / `getClassStudent` | `getCourse` / `getCourseStudent` |
| 概念 | 學生年度編組（班導 / 副班導） | 老師開的科目課程 |
| Duotopia 用哪個 | ✅ **班級** | ❌（目前不需要） |

### 操作身份 vs 帳號

一個 1Campus 帳號可以有多個操作身份（teacher / student / parent / admin），同一個帳號跨多個學校時更明顯。
查詢時應該以「帳號 + schoolDsns」一起判定，不可只用帳號。

### 測試學校 / 測試帳號（密碼皆 `1234`）

| schoolDsns | 用途 |
|-------|------|
| `h.demo.1campus.net` | 1Campus 示範高中 |
| `j.demo.1campus.net` | 1Campus 示範國中 |
| `p.demo.1campus.net` | 1Campus 示範國小 |

| 帳號 | 角色 |
|------|------|
| `dev.teacher01@1campus.net` | 國中：班導 / 教課 / 家長；國小：家長 |
| `dev.teacher02@1campus.net` | 國小：班導 / 教課 / 家長 |
| `dev.teacher03@1campus.net` | 國中：教課；國小：教課 |
| `dev.j.s20101@1campus.net` | 國中 201-01 學生 |
| `dev.j.s20102@1campus.net` | 國中 201-02 學生 |
| `dev.p.s50101@1campus.net` | 國小 501-01 學生 |
| `dev.p.s50102@1campus.net` | 國小 501-02 學生 |

> 共用測試 client：
> - `client_id = edf96e2da7a4f156f1df52f07ab3490f`
> - `client_secret = 84aff4ae1841be51b6dcdd41546e3ad1eaf9b2d05e8240050753ac5fdddf3940`
>
> Duotopia 正式環境使用各環境自己的 `ONE_CAMPUS_CLIENT_ID/SECRET`（GitHub Actions secrets）。

---

## API 端點

所有 jasmine 資料端點都掛在 `https://devapi.1campus.net`，需要 OAuth Bearer token。

### Identity Code（SSO）

```
GET /{schoolDsns}/identity/{code}
```

從 1Campus 平台跳轉時帶過來的單次性 code（30 秒內有效），換成使用者基本資料。已實作於 `OneCampusService.exchange_identity_code()`，這份 doc 不再展開。

### `getUserRole` — 查詢使用者所有學校的角色 ✅ 我們在用

```
GET /api/jasmine/getUserRole
  ?account=<帳號>            (account 與 idNumberHash 至少一個)
  &idNumberHash=<身分證hash>
```

回傳 `school[]`，每個 school 物件含 `schoolDsns`、`teacherRole?`、`studentRole?`、`parentRole[]?`。
Duotopia 用這個判斷使用者在哪些學校有 teacher 身份，再對每間學校呼叫 `getClass`。

### `getClass` — 取班級與班導 ✅ 我們在用

```
GET /api/jasmine/{schoolDsns}/getClass
  ?teacherAcc=<帳號>           (任一條件即可，無條件則回整間學校所有班級)
  &teacherID=<int64>
  &teacherIDNumberHash=<hash>
  &studentAcc=<帳號>           (查指定學生所屬班級)
  &studentID=<int64>
  &studentIDNumberHash=<hash>
  &classID=<int64>             (查指定班級)
```

> ⚠️ **`schoolDsns` 在 path，不是 query**！這是 #722 卡住兩天的原因。
>
> ⚠️ Duotopia sync 必須帶 `teacherAcc=<該老師的 1Campus 帳號>`，否則會把整間學校的班全部掛到單一老師頭上。

回傳 `class[]`，每個 class 物件含 `classID`、`className`、`gradeYear`、`teacher`（班導）、`secondaryTeacher`（副班導）、`department?`（要 `jasmine.department` scope）。

### `getClassStudent` — 取班級的學生名單 ✅ 我們在用

```
GET /api/jasmine/{schoolDsns}/getClassStudent
  ?teacherAcc=<帳號>           (回此教師為班導/副班導的班與學生)
  &teacherID=<int64>
  &teacherIDNumberHash=<hash>
  &studentAcc=<帳號>           (回單一學生的資料)
  &studentID=<int64>
  &studentIDNumberHash=<hash>
  &classID=<int64>             (回指定班級的所有學生) ← Duotopia 用這個
```

> ⚠️ 同樣 **`schoolDsns` 在 path**。

回傳結構同 `getClass`，但每個 class 物件多一個 `student[]` 陣列。學生欄位含 `studentID`、`studentName`、`studentNumber`、`seatNo`，以及視 scope 解鎖的 `gender`、`birthdate`、`idNumberHash`、`contact`、`father` / `mother` / `custodian`、`semesterHistory`。

### 其他端點（Duotopia 目前未使用）

- `GET /api/jasmine/getSchool` — 學校基本資料
- `GET /api/jasmine/{schoolDsns}/getTeacher` — 教師資料
- `GET /api/jasmine/{schoolDsns}/getCourse` — 課程資料（科目，非班級）
- `GET /api/jasmine/{schoolDsns}/getCourseStudent` — 課程修課學生
- `POST /api/jasmine/{schoolDsns}/getTeacherDeparted` — 批次查已離職教師
- `POST /api/jasmine/{schoolDsns}/getStudentDeparted` — 批次查離校學生（休學中也算）

---

## Duotopia 端的對應實作

| 後端模組 | 用途 |
|---------|------|
| `services/one_campus_service.py` | OAuth token 取得 + jasmine HTTP client |
| `services/one_campus_class_sync_service.py` | `sync_school()`：依 schoolDsns + teacher_acc 同步班級與學生 |
| `routers/teachers/one_campus_ops.py` | `POST /api/teachers/me/sync-1campus-classes` 手動同步 endpoint |
| `routers/auth_one_campus.py` | OAuth + Identity Code 登入後的背景 fire-and-forget 同步 |

### 同步策略

1. `getUserRole(account)` → 篩出 `school[].teacherRole != null` 的所有 `schoolDsns`
2. 對每個 schoolDsns：
   - `getClass(school_dsns, teacher_acc=account)` → 拿這位老師為班導 / 副班導的班
   - 對每個 class：`getClassStudent(school_dsns, class_id=...)` → 拿學生名單
3. Upsert 到 Duotopia 的 `Classroom` / `Student` / `ClassroomStudent`

### 鐵則

- **班級匹配以 `one_campus_class_id`** 為主鍵，NULL 表示是 Duotopia 內建立的，不能被 sync 動到
- **學生匹配以 `Identity.one_campus_student_id`**，rename 會寫入該 Identity 的所有 linked Student
- **嚴格只增不刪**：1Campus 上消失的班級 / 學生在 Duotopia 端保留（學習紀錄不能丟）
- **錯誤容忍**：API 失敗收進 `SyncResult.errors[]`，不打斷其他學校的同步

---

## 故障排除

| 症狀 | 真因 | 解決 |
|------|------|------|
| `POST /oauth/token` 回 404 | URL 錯，正確端點是 `/oauth/token.php` 且在 `auth.ischool.com.tw` | 用 `auth.ischool.com.tw/oauth/token.php` |
| `GET /api/jasmine/getClass?schoolDsns=...` 回 401 | URL 錯，schoolDsns 應在 path 不是 query | 用 `GET /api/jasmine/{schoolDsns}/getClass` |
| `getClass` 回回整間學校所有班，把別人的班掛到當前老師頭上 | 沒帶 `teacherAcc` query param | 帶 `teacherAcc=<老師 1Campus 帳號>` |
| 401 + scope 沒問題、URL 也對 | client 沒被該學校授權 | 學校管理員要在 1Campus 後台啟用該 client，或聯絡 lelala@ischool.com.tw |
| token 拿到但 jasmine 401 | scope 不夠（極少見：基本 `jasmine` 就涵蓋班級資料） | 確認 token 回應的 `scope` 欄位包含 `jasmine` |

---

## 參考連結

- 1Campus 開發者中心：https://1campus-docs.web.app
- SSO 整合指引：https://1campus-docs.web.app/docs/guides/sso-integration
- Swagger 入口：https://devapi.1campus.net/doc
- jasmine OAuth client 註冊與管理：https://auth.ischool.com.tw/1campus/manage/
