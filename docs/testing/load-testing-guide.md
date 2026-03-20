# 負載測試指南

> 模擬一班 30 人同時上課，驗證系統是否承受得住。

## 目錄

- [前置準備](#前置準備)
- [Step 1：安裝測試工具](#step-1安裝測試工具)
- [Step 2：設定環境變數](#step-2設定環境變數)
- [Step 3：確認環境可用](#step-3確認環境可用)
- [Step 4：執行負載測試](#step-4執行負載測試)
- [Step 5：判讀結果](#step-5判讀結果)
- [常見問題排除](#常見問題排除)
- [基礎設施調校記錄](#基礎設施調校記錄)
- [進階：擴充測試情境](#進階擴充測試情境)

---

## 前置準備

### 需要的工具

| 工具 | 用途 | 安裝方式 |
|------|------|----------|
| Python 3.10+ | 執行 Locust | `brew install python@3.11` |
| Locust | 負載測試框架 | `pip3 install -r requirements.txt` |
| gcloud CLI | 查看 Cloud Run 指標 | `brew install google-cloud-sdk` |

### 需要的帳號與權限

- Staging 環境的 **學生測試帳號**（email + password）
- Staging 環境的 **老師測試帳號**（email + password）
- 有效的 **assignment ID** 和 **content_item_id**（staging DB 中存在的）
- GCP Console 存取權限（查看 Cloud Run metrics）

---

## Step 1：安裝測試工具

```bash
cd backend/tests/load_testing
pip3 install -r requirements.txt
locust --version
```

> 如果 `pip` 找不到，用 `pip3`。

---

## Step 2：設定環境變數

```bash
cp .env.example .env
```

編輯 `.env`，填入 staging 的真實測試帳號：

```env
TEST_ENV=staging
STAGING_BASE_URL=https://duotopia-staging-backend-316409492201.asia-east1.run.app

# 學生測試帳號（需要在 staging DB 中存在）
TEST_STUDENT_EMAIL=你的測試學生帳號
TEST_STUDENT_PASSWORD=你的測試密碼

# 老師測試帳號
TEST_TEACHER_EMAIL=你的測試老師帳號
TEST_TEACHER_PASSWORD=你的測試密碼

# 測試用的作業 ID（需要在 staging DB 中存在）
TEST_ASSIGNMENT_ID=實際的assignment_id
TEST_CONTENT_ITEM_ID=實際的content_item_id
```

> **重要**：`.env` 已在 `.gitignore` 中，不會被 commit。

---

## Step 3：確認環境可用

```bash
# 1. Health check
curl -s https://duotopia-staging-backend-316409492201.asia-east1.run.app/health | python3 -m json.tool

# 2. 測試學生登入（確認帳密正確）
source .env
curl -s -X POST "$STAGING_BASE_URL/api/students/validate" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_STUDENT_EMAIL\",\"password\":\"$TEST_STUDENT_PASSWORD\"}"
```

必須看到 `access_token` 才能繼續。如果登入失敗，測試跑出來會 100% failure。

---

## Step 4：執行負載測試

### 方案 A：Web UI 即時觀察（推薦）

```bash
cd backend/tests/load_testing
locust -f locustfile.py --web-port 8089
```

打開 http://localhost:8089，設定：

| 欄位 | 值 | 說明 |
|------|-----|------|
| Number of users | `30` | 模擬一班 30 人 |
| Ramp up | `5` | 每秒加 5 人（6 秒全部上線） |
| Host | `https://duotopia-staging-backend-316409492201.asia-east1.run.app` | staging URL |

點 **Start** 開始。建議至少跑 **5 分鐘**讓 auto-scaling 穩定。

### 方案 B：Headless 模式

```bash
./run_tests.sh --env staging --users 30 --rate 5 --time 5m --headless
```

### 方案 C：預設 Scenario

```bash
./run_tests.sh --env staging --scenario endurance --headless  # 30 人 30 分鐘
./run_tests.sh --env staging --scenario spike --headless      # 50 人瞬間湧入
```

---

## Step 5：判讀結果

### 關鍵指標標準

| 指標 | 健康 | 可接受 | 需要處理 |
|------|------|--------|----------|
| **Median (p50)** | <1s | 1-3s | >3s |
| **p95 延遲** | <3s | 3-10s | >10s |
| **Failure rate** | 0% | <2% | >5% |
| **RPS** | 穩定不掉 | 小幅波動 | 持續下降 |
| **503 errors** | 0 | 偶發 | 頻繁（instance 過載） |

### 各 API 合理回應時間

| API | 合理 | 說明 |
|-----|------|------|
| `/api/students/validate` | <1s | 登入，只查一次 DB |
| `/api/students/profile` | <500ms | 簡單查詢 |
| `/api/students/assignments` | <1s | 可能有多筆資料 |
| `/api/students/upload-recording` | <3s | 有 GCS 上傳，本來就慢一些 |

### 最重要看的 3 件事

1. **有沒有 503 錯誤** — 代表 Cloud Run instances 過載
2. **Failure rate 是否隨時間上升** — 如果越測越多失敗，代表有 resource leak
3. **回應時間是否隨用戶增加而飆高** — 如果 10 人 200ms，30 人變 5s，代表有 bottleneck

### Response size 判讀

| Size | 代表什麼 |
|------|---------|
| 33-44 bytes | Error response（帳密錯誤或 API 錯誤） |
| 166 bytes | Profile 正常回傳 |
| 281+ bytes | Upload recording 成功 |
| 650 bytes | 學生登入成功（含 token + user data） |

---

## 常見問題排除

### 100% Authentication 失敗

**症狀**：所有請求都 fail，response size 只有 33-44 bytes。

**原因**：`.env` 的帳密不對，或 Locust 沒讀到 `.env`。

**解法**：
```bash
# 先手動 curl 確認帳密
source .env
curl -s -X POST "$STAGING_BASE_URL/api/students/validate" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_STUDENT_EMAIL\",\"password\":\"$TEST_STUDENT_PASSWORD\"}"
```

### Teacher login 429 Too Many Requests

**原因**：所有虛擬用戶共用同一個老師帳號，觸發 rate limiting。

**解法**：正常現象，不影響學生 API 的測試結果。

### Upload recording 全部失敗

**原因**：`TEST_ASSIGNMENT_ID` 和 `TEST_CONTENT_ITEM_ID` 不存在。

**解法**：在 staging 前端確認一個有效的 assignment，更新 `.env`。

### Locust 啟動後用戶數掉到 0

**原因**：登入失敗觸發 `RescheduleTask`，所有用戶被踢出。

**解法**：先解決登入問題。

### pip / locust 找不到

```bash
# macOS 用 pip3
pip3 install -r requirements.txt

# 或用 brew 的 python
/opt/homebrew/opt/python@3.11/bin/pip3 install -r requirements.txt
```

---

## 基礎設施調校記錄

### 2026-03-17 ~ 2026-03-21：負載測試與優化

#### 測試場景
- 30 concurrent users 模擬一班上課
- 持續 5+ 分鐘
- 測試 API：登入、取 profile、upload recording（50KB/200KB/500KB/2MB）

#### 優化過程與結果

| 階段 | 變更 | Upload Median | p95 | DB Latency | Failure Rate |
|------|------|:------------:|:---:|:----------:|:------------:|
| 1. 初始狀態 | 0.5 vCPU / 256MB / c=1 / Singapore DB | 14s | 30s | 312ms | 97% |
| 2. Cloud Run 規格提升 | 2 vCPU / 1GB / c=10 | 4.3s | 8.9s | 312ms | 0% |
| 3. min-instances=3 | 消除 cold start | 4.3s | 9.1s | 312ms | 0% |
| 4. DB 搬到 Tokyo | Supabase Singapore → Tokyo | 2.0s | 4.0s | 160ms | 0% |
| **5. 最終穩定** | **20,960 requests 長時間測試** | **2.0s** | **4.4s** | **160ms** | **0%** |

#### 發現的瓶頸

1. **Cloud Run concurrency=1**：每個 instance 同時只處理 1 個 request，30 人 = 30 個排隊
2. **Supabase 跨區延遲**：Cloud Run 在台灣 (asia-east1)，Supabase 在新加坡 (ap-southeast-1)，每次 DB query 要 312ms
3. **CPU 不足**：0.5 vCPU 搭配 concurrency=20，每個 request 只分到 0.025 vCPU

#### 最終 Production 設定

```yaml
# .github/workflows/deploy-backend.yml (production section)
CPU:            1000m       # 1 vCPU
Memory:         512Mi
Concurrency:    10          # 每個 instance 處理 10 個 concurrent request
Min instances:  3           # 3 個常駐 instance，30 人零 cold start
Max instances:  10
CPU throttling: false       # 閒置時不降速
Startup boost:  true        # 新 instance 啟動加速
```

#### Supabase 遷移

| 環境 | 舊 (Singapore) | 新 (Tokyo) | DB Latency |
|------|---------------|------------|:----------:|
| Staging | `gpmcajqrqmzgzzndbtbg` | `lhhygrwysmfybkxcuxme` | 312ms → 160ms |
| Production | `szjeagbrubcibunofzud` | `opfdkaamrxfhvoqctetb` | 312ms → 154ms |

遷移方式：
```bash
# 1. Dump 舊 DB
pg_dump "postgresql://postgres.舊ID:密碼@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres" \
  --schema=public --no-owner --no-privileges -F c -f backup.dump

# 2. Restore 到新 DB
pg_restore -d "postgresql://postgres.新ID:密碼@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres" \
  --no-owner --no-privileges --clean --if-exists backup.dump

# 3. 更新 GitHub Secrets（STAGING_DATABASE_URL, PRODUCTION_DATABASE_URL 等）
# 4. 觸發 deploy workflow
```

#### Cloud SQL 測試（供未來參考）

| 方案 | DB Latency | 說明 |
|------|:----------:|------|
| Supabase Singapore | 312ms | 跨區 GCP→AWS |
| Supabase Tokyo | 155ms | 跨雲 GCP→AWS 但距離近 |
| **Cloud SQL asia-east1** | **5ms** | **同區同網路，最快** |

Cloud SQL 已在 staging 驗證可行（health check 5ms），但需要額外處理 SQLAlchemy 的 Unix socket 連線格式。詳見 [Issue #489](https://github.com/myduotopia/duotopia/issues/489)。

#### 相關 Issues

| Issue | 內容 | 狀態 |
|-------|------|------|
| [#483](https://github.com/myduotopia/duotopia/issues/483) | 減少 API DB query 次數 | Open |
| [#489](https://github.com/myduotopia/duotopia/issues/489) | 遷移到 GCP Cloud SQL | Open |

---

## 進階：擴充測試情境

### 更完整的上課模擬

目前 locustfile 主要測試 login + upload recording。可新增：

| Task | API Endpoint | 權重 | 說明 |
|------|-------------|------|------|
| 取得作業列表 | `GET /api/students/{id}/assignments` | 高 | 進入課堂的第一步 |
| 取得題目內容 | `GET /api/assignments/{id}/contents` | 高 | 每個學生都會拉 |
| 提交答案 | `POST /api/students/submit-answer` | 中 | 答題互動 |
| 查看成績 | `GET /api/students/{id}/results` | 低 | 偶爾查看 |

### 多帳號測試

30 個虛擬用戶目前共用同一組帳號。要模擬真實的 30 個獨立學生：
1. 在 staging 建立 30 個測試學生帳號
2. 修改 locustfile 讓每個虛擬用戶使用不同帳號
3. 更真實地測試 DB 查詢效能（不同 student_id）

### 測試 Production（謹慎）

```bash
# 修改 .env
TEST_ENV=production
PRODUCTION_BASE_URL=https://duotopia-production-backend-316409492201.asia-east1.run.app

# 用較少用戶，避免影響真實使用者
locust -f locustfile.py --web-port 8089
# Web UI 中設定 5-10 users，不要用 30
```

---

## 快速指令速查表

```bash
# === 基本測試 ===
cd backend/tests/load_testing
pip3 install -r requirements.txt  # 首次安裝

# Web UI 模式（推薦）
locust -f locustfile.py --web-port 8089
# → 打開 http://localhost:8089

# Headless 模式
./run_tests.sh --env staging --users 30 --rate 5 --time 5m --headless

# === 查看 Cloud Run 設定 ===
gcloud run services describe duotopia-staging-backend \
  --region=asia-east1 --project=duotopia-472708 \
  --format="table(spec.template.spec.containers[0].resources.limits.cpu,spec.template.spec.containers[0].resources.limits.memory,spec.template.spec.containerConcurrency)"

# === 臨時調整 Cloud Run（測試用，deploy 會覆蓋回去）===
gcloud run services update duotopia-staging-backend \
  --region=asia-east1 --project=duotopia-472708 \
  --cpu=2 --memory=1Gi --concurrency=10 --max-instances=10 --min-instances=3 \
  --no-cpu-throttling --cpu-boost

# === Health check ===
curl -s https://duotopia-staging-backend-316409492201.asia-east1.run.app/health | python3 -m json.tool

# === 查看結果 ===
open results/staging_*/report.html
```
