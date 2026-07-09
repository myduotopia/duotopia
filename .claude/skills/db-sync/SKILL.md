---
name: db-sync
description: |
  把 staging Supabase DB 的 public schema + 資料整包複製覆蓋到 develop，
  讓 develop 成為「上線前測試 DB」。用於：產生 migration 的 issue 想先在
  develop 套用＋驗證沒問題，才推到 staging。
  自動觸發：「同步 db」、「sync staging 到 develop」、「重置 develop 對齊 staging」、
  「把 staging 資料複製到 develop」。
---

# db-sync — staging → develop 資料庫同步

## 用途

develop 作為 staging 的**上線前測試 DB**。每個含 migration 的 issue：
1. 先用本 skill 把 develop 對齊 staging（乾淨基準）。
2. 對 develop 套用該 issue 的新 migration 並驗證。
3. 沒問題才推 staging。

把 staging 的 **public schema + 資料**（含 `alembic_version`、sequences、RLS policies）
整包複製覆蓋 develop。**不碰** Supabase 管理的 `auth` / `storage` / `realtime` schema
（複製會破壞 develop 登入）。

## ⚠️ 安全鐵則

- **方向固定 staging → develop**，不做反向。
- **Prod 絕對排除**：腳本會比對 `PROD_DATABASE_POOLER_URL`，目標/來源等於 prod 即中止。
- **破壞性**：develop 現有 public 物件與資料會被 staging 取代、不可復原。預設 `--dry-run`，
  真的執行要明確加 `--execute`。
- **連線字串永不落地/印出**：只從 `backend/.env` 即時讀 `DATABASE_URL_STAGING` /
  `DATABASE_URL_DEVELOP`；dump 只存在 Docker 容器 `/tmp`，`--rm` 即焚。

## 前置需求

- `backend/.env` 含 `DATABASE_URL_STAGING` 與 `DATABASE_URL_DEVELOP`。
- 兩個連線字串都要走 **session pooler(5432) 或 direct**，**不能是 transaction pooler(6543)**
  （pg_dump/restore 不支援 6543；腳本會擋）。
- 本地不需要 pg_dump/psql，但需要 **Docker 在執行中**（用 `postgres:17` image）。

## 使用方式

```bash
# 1) 先乾跑安全檢查（不改任何東西）
bash .claude/skills/db-sync/scripts/sync-staging-to-develop.sh

# 2) 比對 staging / develop 現況（alembic 版本 + 幾張表 row count）
bash .claude/skills/db-sync/scripts/sync-staging-to-develop.sh --verify

# 3) 確認無誤後，實際覆蓋 develop（破壞性）
bash .claude/skills/db-sync/scripts/sync-staging-to-develop.sh --execute
```

執行流程：在單一 `postgres:17` 容器內 `pg_dump`(staging, public, custom format) →
`pg_restore --clean --if-exists`(develop)，完成後自動比對 `alembic_version` 與
teachers/classrooms/assignments 的 row count。

## 同步後：套用新 migration 並驗證（範例：在 develop 驗 issue 的 migration）

```bash
# 對 develop 套用到最新（含本 issue 的新 migration）
cd backend
DATABASE_URL="<develop session pooler url>" PYTHONUTF8=1 \
  venv/Scripts/python.exe -m alembic upgrade head

# 起本地 backend 連 develop（session 環境變數切換，不改 .env）
DATABASE_URL="<develop session pooler url>" PYTHONUTF8=1 PORT=8080 \
  venv/Scripts/python.exe main.py
```

> 連 develop 前一律先確認要連哪個 DB；用 session 環境變數覆寫 `DATABASE_URL`，不改 `.env`。

## 注意事項

- `--clean` 只 DROP 出現在 dump 裡的物件；develop 獨有的表不會被刪（測試無害）。需要
  完全鏡像時才考慮先 `DROP SCHEMA public CASCADE`（風險較高，腳本預設不做）。
- 本 app 不使用 Supabase realtime（功能改用 polling），realtime publication 影響可忽略。
- 若 `pg_dump` 報版本不符，調整 `PG_IMAGE`（如 `PG_IMAGE=postgres:16 bash …`）。
- Docker 首次會 pull image，需網路。
