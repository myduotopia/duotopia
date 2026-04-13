# Duotopia

> 通用規則見 `~/.claude/CLAUDE.md`（Agent 路由、Git、Security、TDD）

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+ / FastAPI |
| Database | PostgreSQL (Supabase) |
| Frontend | Node.js (shared) |
| Deploy | Vercel / GCP Cloud Run |

## GCP Configuration

| Field | Value |
|-------|-------|
| gcloud config | `default` |
| GCP Project | `duotopia-472708` |
| Region | `asia-east1` |

> Hook auto-switches. If permission error → `gcloud config configurations activate default`

## Environments

| Environment | URL | Branch | Database |
|-------------|-----|--------|----------|
| Production | https://duotopia.co | main | Supabase (prod) |
| Staging | https://duotopia-staging-frontend-316409492201.asia-east1.run.app | staging | Supabase (staging) |
| Develop | https://duotopia-frontend-develop-b2ovkkgl6a-de.a.run.app | develop | Supabase (develop) |

> **Note**: 每個環境使用獨立的 Supabase project，資料庫不共用。

## Key Docs

| Doc | Purpose |
|-----|---------|
| [PRD.md](./PRD.md) | 產品需求 |
| [ORG_IMPLEMENTATION_SPEC.md](./ORG_IMPLEMENTATION_SPEC.md) | 組織層級規格 |
| [TESTING_GUIDE.md](./docs/TESTING_GUIDE.md) | 測試指南 |
| [TAPPAY_INTEGRATION_GUIDE.md](./docs/integrations/TAPPAY_INTEGRATION_GUIDE.md) | 金流整合 |
| [CICD.md](./CICD.md) | 部署與 CI/CD |

## Project-Specific Agents

### @agent-git-issue-pr-flow
**Trigger**: issue, fix, bug, #N, 部署, staging
- PDCA workflow + TDD enforcement
- Per-Issue Test Environment
- AI-powered approval detection

### @agent-error-reflection
**Trigger**: errors, test failures, user corrections
- 錯誤模式學習
- `/reflect [error]` - 手動反思
- `/weekly-review` - 週報

**Learning Files**: `.claude/learning/*.json`

## Skills & Commands

### Skills (`.claude/skills/`)

| Skill | Purpose |
|-------|---------|
| `/worktree <issues \| description>` | 使用 git worktree 隔離開發。支援 GitHub issue（如 `#42 #43`）或任意任務描述。自動觸發：「開 worktree」、「用 worktree 處理」 |
| `/fix-review <PR-number>` | 自動分析 Claude Code Review 回饋並反覆修正，直到 PR 可以 merge。遇到需要人為判斷的項目才會提問 |
| `/fix-workflow <PR-number>` | 自動分析 CI test workflow 錯誤（backend/frontend），解析 GitHub Actions log，修復 Black、Flake8、Prettier、TypeScript、ESLint、build 等錯誤後重推 |

### Commands (`.claude/commands/`)

| Command | Purpose |
|---------|---------|
| `/reflect [error]` | 手動觸發錯誤反思 |
| `/weekly-review` | 產生週報 |
| `/restart-server` | 重啟 backend server |

## Project Hooks

| Hook | Script | Purpose |
|------|--------|---------|
| UserPromptSubmit | `check-agent-rules.py` | Agent 路由檢查 |
| PreToolUse(Write\|Edit) | `check-file-size.py` | 檔案大小檢查 |
| PostToolUse(Write\|Edit) | Auto-format | 程式碼格式化 |
| Stop | `error-reflection.py` | 錯誤學習 |

## Commands

```bash
# Testing
npm run test:api:all
npm run typecheck
npm run lint
npm run build

# Git workflow (via agent)
create-feature-fix <issue> <desc>
deploy-feature <issue>
```

## Project-Specific Rules

1. **組織層級管理** - 見 `ORG_IMPLEMENTATION_SPEC.md`
2. **TapPay 金流整合** - 見 `TAPPAY_INTEGRATION_GUIDE.md`
3. **Per-Issue Test Environment** - 每個 issue 有獨立測試環境
4. **Use feature branches** - 不直接 commit 到 staging

## Database Migration 鐵則

> **核心原則**：所有 migration 必須是 **Idempotent（冪等）**，可安全重複執行。

### ✅ 必須使用的寫法

```python
# 新增表 - 使用 IF NOT EXISTS
op.execute("""
    CREATE TABLE IF NOT EXISTS new_table (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100)
    )
""")

# 新增欄位 - 使用 IF NOT EXISTS + nullable 或 DEFAULT
op.execute("""
    DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'users' AND column_name = 'new_field') THEN
            ALTER TABLE users ADD COLUMN new_field VARCHAR(50) DEFAULT 'default_value';
        END IF;
    END $$;
""")

# 新增 Index - 使用 IF NOT EXISTS
op.execute("CREATE INDEX IF NOT EXISTS idx_name ON table_name (column)")

# 新增 Constraint - 檢查後再建立
op.execute("""
    DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_table_column') THEN
            ALTER TABLE table_name ADD CONSTRAINT uq_table_column UNIQUE (column);
        END IF;
    END $$;
""")

# Function - 使用 CREATE OR REPLACE
op.execute("CREATE OR REPLACE FUNCTION func_name() RETURNS ... AS $$ ... $$ LANGUAGE plpgsql;")
```

### ❌ 禁止的寫法

```python
# ❌ 直接使用 Alembic op（重複執行會失敗）
op.create_table('new_table', ...)
op.add_column('users', sa.Column('field', ...))
op.create_index('idx_name', 'table', ['column'])

# ❌ 破壞性變更（會破壞其他環境）
op.drop_column('users', 'old_field')
op.alter_column('users', 'name', new_column_name='full_name')
op.drop_table('old_table')
```

### 為什麼需要 Idempotent？

1. **多環境部署**：同一個 migration 可能在 develop、staging、production 各執行一次
2. **時序問題**：不同分支的 migration 可能以不同順序執行
3. **重試安全**：部署失敗重試時不會報錯
4. **Feature branch**：Per-Issue 環境可能先於 staging 執行 migration

### Migration Checklist

建立 migration 前必須確認：
- [ ] 使用 `CREATE TABLE IF NOT EXISTS`
- [ ] 使用 `ADD COLUMN IF NOT EXISTS` 或 DO $$ 檢查
- [ ] 使用 `CREATE INDEX IF NOT EXISTS`
- [ ] Constraint 使用 pg_constraint 檢查後再建立
- [ ] 新增欄位有 `DEFAULT` 或 `nullable=True`
- [ ] 沒有 DROP, RENAME, ALTER TYPE 等破壞性操作
- [ ] Functions 使用 `CREATE OR REPLACE`
