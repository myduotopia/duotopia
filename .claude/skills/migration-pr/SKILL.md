---
name: migration-pr
description: >
  功能分支有新 migration 時，先在 develop 驗證，再把 migration 單獨抽成一個分支發 PR 到
  staging，並自動用 LINE 通知工程師審查合併；合併後才 push 功能分支。
  自動觸發：「migration 先進 staging」、「抽 migration」、「migration 開 PR」、
  push 前發現分支有 staging 沒有的 migration。
---

# migration-pr — migration 先單獨進 staging

## 為什麼

- push `claude/issue-N` 會觸發 per-issue 部署，部署會**直接在 staging DB** 跑 `alembic upgrade head`。
  所以 migration 必須先經工程師審查、合併進 staging，功能分支才能 push。
- 含 migration 的 issue 一律先在 develop 驗證（develop＝上線前測試 DB）。

## 鐵則

- **順序不可顛倒**：develop 驗證 → migration PR → 工程師合併 → staging 合回功能分支 → 才 push 功能分支。
- **分支名稱不可含 `issue-N`**：`claude/issue-N-xxx` 的 PR merge 會觸發 cleanup，刪掉所有
  issue-N 遠端分支與 per-issue 環境。用 `claude/<描述>-migration`，例如 `claude/scenario-image-usage-widen`。
- **不要在 issue 留只寫「測試通過」的留言**：那是核准訊號，會加 `✅ tested-in-staging` 並替整個
  功能分支開 Release PR。通知工程師一律靠 PR 標籤 `🗄️ migration`。
- **production 不碰**；連線字串只從 `backend/.env` 讀，不印出、不落地。
- **合併由工程師做**，skill 不自己 merge。

## 步驟

### 1. 找出這次的 migration
```bash
git fetch origin
git diff --name-only --diff-filter=A origin/staging...HEAD -- backend/alembic/versions/
```
- 沒有新檔 → 結束（不需要本流程）。
- 同時列出對應的 model 檔（`backend/models/*.py` 中這次改到、與 migration 同一張表的）。
- 確認每支 migration 的 `down_revision` 接在 `origin/staging` 最新的 head 後面；
  `alembic heads` 只能有一個，否則先停下回報。

### 2. 照 CLAUDE.md「Database Migration 鐵則」逐項檢查
- `CREATE TABLE/INDEX IF NOT EXISTS`；欄位用 DO $$ 守衛且 `table_schema = 'public'`
- constraint 守衛用 `pg_constraint JOIN pg_class`
- 新欄位有 DEFAULT 或 nullable
- 沒有 DROP / RENAME / ALTER TYPE（例外須使用者明確同意，並寫在 migration 註解）
- `downgrade()` 真的能復原
任一項不符 → 停下回報，不往下做。

### 3. develop 驗證
```bash
bash .claude/skills/db-sync/scripts/sync-staging-to-develop.sh --verify
```
- develop 的 `alembic_version` 和 staging **相同** → 不覆蓋 develop，直接下一步。
- 不同 → 回報差異，**問使用者**是否執行 `/db-sync --execute`（破壞性）。

在功能分支的 worktree `backend/` 下，以 develop 連線跑一輪（連線字串由 `.env` 的
`DATABASE_URL_DEVELOP` 讀入環境變數，不印出）：
```
alembic upgrade head      # 套用
<檢查：新表/欄位/約束存在、資料列數不變>
alembic downgrade -1      # 每支新 migration 各退一次，確認能復原
alembic upgrade head      # 再套用一次
alembic current           # 應為新 head
```
把每一步的結果（例如欄位寬度、列數）記下，寫進 PR 說明。

### 4. 開 migration 分支
```bash
git worktree add -b claude/<描述>-migration .worktrees/<描述>-migration origin/staging
cd .worktrees/<描述>-migration
git checkout <功能分支> -- <migration 檔> <model 檔>
```
- 只放 migration 與 model。model 若引用了功能分支才有的程式（import），改成只保留欄位定義與說明，
  確保 staging 單獨可跑。
- 跑 Black、Flake8（用 `backend/venv/Scripts/python.exe -m ...`，`python` 是空殼）。
- 必要時跑與該表相關的 pytest。

### 5. commit、push、建 PR
- commit 訊息：`feat(<scope>): <改了什麼>（migration 單獨先進 staging，Part of #N）`，
  內文寫守衛方式、downgrade 行為、develop 驗證結果；結尾加 attribution。
- `gh pr create --base staging --label "🗄️ migration"`，PR 說明固定段落：
  摘要／改動檔案／Migration 安全性／develop 驗證／`Part of #N`。
  **不要寫 `Fixes #N`、`Closes #N`**（會關掉 issue）。
- 加上 `🗄️ migration` 標籤 → workflow `notify-migration-pr.yml` 自動 LINE 通知工程師。

### 6. 回報使用者並等待
回報：PR 連結、檔案、develop 驗證結果、「已 LINE 通知工程師」。
等工程師合併（可用 `gh pr view <PR> --json state,mergedAt` 查狀態）。

### 7. 合併後
```bash
cd <功能分支 worktree>
git fetch origin && git merge origin/staging
```
- 衝突只可能在 migration／model 檔，以 staging 版本為準。
- 確認 `alembic heads` 仍只有一個。
- 這時才 push 功能分支。

## 常見狀況
- **功能分支已經先 push 了**：per-issue 部署已在 staging 跑過 migration。照樣補走 4～7，
  讓 migration 有獨立的審查紀錄，並在回報中註明順序顛倒。
- **一個 issue 有多支 migration**：同一個 migration 分支一起送，PR 說明逐支列出。
- **工程師要求修改**：在 migration 分支修、再 push，同步把修正帶回功能分支。
