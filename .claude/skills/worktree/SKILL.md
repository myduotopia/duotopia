---
name: worktree
description: |
  Create isolated git worktree for development. Automatically triggered when user mentions:
  - "開 worktree", "用 worktree", "worktree 處理", "worktree 隔離"
  - "handle issue", "fix issue", "work on issue" with worktree context
  Supports both GitHub issues and custom task descriptions.
argument-hint: "<issue-number(s)> | <task-description>"
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, WebFetch
---

# Worktree Skill

Create isolated git worktrees for parallel, focused development. Supports two modes:
1. **GitHub Issue Mode** - When input matches issue numbers
2. **General Task Mode** - When input is a task description

**Announce at start:** "I'm using the worktree skill to set up an isolated development environment."

## Arguments

- `$ARGUMENTS` - Either:
  - Issue numbers: `42`, `#42`, `42 43`, `#42 #43`
  - Task description: Any other text describing the work

## Current Context

- **Repository**: !`basename $(git rev-parse --show-toplevel)`
- **Current branch**: !`git branch --show-current`
- **Worktrees**: !`git worktree list 2>/dev/null | head -5`

## Mode Detection

```
Input: $ARGUMENTS
    │
    ├─ Matches /^#?\d+(\s+#?\d+)*$/ → GitHub Issue Mode
    │   Examples: "42", "#42", "42 43", "#42 #43"
    │
    └─ Any other text → General Task Mode
        Examples: "實作使用者登出功能", "fix navbar alignment"
```

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────┐
│  1. SETUP         Create worktree from staging              │
│                   ├─ Issue: .worktrees/issue-<N>            │
│                   └─ Task:  .worktrees/task-YYYYMMDD-NNN    │
├─────────────────────────────────────────────────────────────┤
│  2. ANALYZE       Understand requirements                   │
│                   ├─ Issue: Read GitHub issue content       │
│                   └─ Task:  Analyze user's description      │
├─────────────────────────────────────────────────────────────┤
│  3. PLAN          Present structured plan                   │
│                   └─ Problem summary                        │
│                   └─ Proposed solution                      │
│                   └─ Files to modify                        │
│                   └─ ⏸️ STOP: Wait for user approval        │
├─────────────────────────────────────────────────────────────┤
│  4. IMPLEMENT     After approval, execute in worktree       │
│                   └─ TDD: Write tests first                 │
│                   └─ Implement solution                     │
│                   └─ Run tests                              │
│                   └─ Commit & push                          │
└─────────────────────────────────────────────────────────────┘
```

---

# GitHub Issue Mode

When `$ARGUMENTS` matches issue number pattern.

## Phase 1: Setup Issue Worktree

### 1.1 Validate and extract issue number

```bash
# Strip # prefix and validate
ISSUE_NUM="${ISSUE_NUM#\#}"

# Validate issue number is numeric only (security check)
if ! [[ "$ISSUE_NUM" =~ ^[0-9]+$ ]]; then
    echo "Error: Issue number must be numeric, got: $ISSUE_NUM"
    exit 1
fi
```

### 1.2 Verify worktree directory

```bash
# Check if .worktrees exists
if [ ! -d ".worktrees" ]; then
    mkdir -p .worktrees
    # Ensure it's in .gitignore
    if ! git check-ignore -q .worktrees 2>/dev/null; then
        echo ".worktrees/" >> .gitignore
        git add .gitignore
        git commit -m "chore: add .worktrees to gitignore"
    fi
fi
```

### 1.3 Extract issue title for branch name

```bash
# Get issue title and convert to slug for branch name
ISSUE_TITLE=$(gh issue view "$ISSUE_NUM" --json title -q '.title')
ISSUE_SLUG=$(echo "$ISSUE_TITLE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | cut -c1-30 | sed 's/-$//')

# Branch name follows project standard: fix/issue-<N>-<description>
BRANCH_NAME="fix/issue-${ISSUE_NUM}-${ISSUE_SLUG}"
```

### 1.4 Fetch latest staging and create worktree

```bash
git fetch origin staging

# Create worktree with new branch from staging
git worktree add ".worktrees/issue-${ISSUE_NUM}" -b "$BRANCH_NAME" origin/staging
```

### 1.5 Install dependencies (if needed)

```bash
cd ".worktrees/issue-${ISSUE_NUM}"

# Backend (Python with virtual environment)
if [ -d backend ] && [ -f backend/requirements.txt ]; then
    cd backend
    python -m venv venv 2>/dev/null || true
    source venv/bin/activate 2>/dev/null || true
    pip install -r requirements.txt
    cd ..
fi

# Frontend (Node.js - use ci for reproducible builds)
if [ -f package.json ]; then
    npm ci
fi
```

## Phase 2: Analyze Issue

### 2.1 Read GitHub issue

```bash
gh issue view "$ISSUE_NUM" --json title,body,labels,comments,assignees
```

### 2.2 Analysis checklist

- [ ] Understand the problem statement
- [ ] Identify acceptance criteria
- [ ] Check for linked issues or PRs
- [ ] Note labels (bug, feature, priority)
- [ ] Review any existing comments
- [ ] List unclear requirements or questions

---

# General Task Mode

When `$ARGUMENTS` is a task description (not issue numbers).

## Phase 1: Setup Task Worktree

### 1.1 Generate Task ID

Task ID format: `YYYYMMDD-NNN` where NNN is a sequential number for the day.

```bash
TODAY=$(date +%Y%m%d)
WORKTREE_DIR=".worktrees"

# Find existing task worktrees for today and get next number
EXISTING=$(ls -1 "$WORKTREE_DIR" 2>/dev/null | grep "^task-${TODAY}-" | sort -r | head -1)
if [ -n "$EXISTING" ]; then
    LAST_NUM=$(echo "$EXISTING" | sed "s/task-${TODAY}-//" | sed 's/^0*//')
    NEXT_NUM=$((LAST_NUM + 1))
else
    NEXT_NUM=1
fi

TASK_ID=$(printf "%s-%03d" "$TODAY" "$NEXT_NUM")
```

### 1.2 Analyze description and generate branch slug

Analyze the user's task description to:
1. Identify the type of work (fix, feature, refactor, optimize, etc.)
2. Extract key terms for the branch name
3. Generate a concise, descriptive slug (max 30 chars)

Examples:
| User Input | Generated Slug |
|------------|---------------|
| 優化首頁載入速度 | optimize-homepage-loading |
| navbar 在手機版會跑版 | fix-navbar-mobile-layout |
| 新增使用者偏好設定 | add-user-preferences |
| fix the login validation | fix-login-validation |

```bash
# Branch name format: fix/YYYYMMDD-NNN-<slug>
BRANCH_NAME="fix/${TASK_ID}-${TASK_SLUG}"
WORKTREE_PATH="${WORKTREE_DIR}/task-${TASK_ID}"
```

### 1.3 Create worktree

```bash
git fetch origin staging

# Ensure .worktrees directory exists and is git-ignored
mkdir -p "$WORKTREE_DIR"
if ! git check-ignore -q "$WORKTREE_DIR" 2>/dev/null; then
    echo "$WORKTREE_DIR/" >> .gitignore
fi

# Create worktree with new branch from staging
git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" origin/staging
```

### 1.4 Install dependencies (same as issue mode)

```bash
cd "$WORKTREE_PATH"

# Backend
if [ -d backend ] && [ -f backend/requirements.txt ]; then
    cd backend
    python -m venv venv 2>/dev/null || true
    source venv/bin/activate 2>/dev/null || true
    pip install -r requirements.txt
    cd ..
fi

# Frontend
if [ -f package.json ]; then
    npm ci
fi
```

## Phase 2: Analyze Task

### 2.1 Clarify requirements

Based on the task description, identify:
- [ ] What is the expected outcome?
- [ ] What files/components are likely involved?
- [ ] Are there any dependencies or prerequisites?
- [ ] What are the acceptance criteria?

If the description is ambiguous, ask clarifying questions before proceeding.

---

# Phase 3: Present Plan (CRITICAL: STOP FOR APPROVAL)

Present the plan in this format (applies to both modes):

```markdown
## [Issue #<NUM>: <Title> | Task <TASK_ID>: <Description>]

### Problem Summary
[One paragraph summary of the work]

### Proposed Solution
1. [Step 1 - specific action]
2. [Step 2 - specific action]
3. [Step 3 - specific action]

### Files to Modify
- `path/to/file1.py` - [what changes]
- `path/to/file2.tsx` - [what changes]

### Test Plan
- [ ] Test case 1: [description]
- [ ] Test case 2: [description]

### Questions (if any)
- [ ] Question 1?
- [ ] Question 2?

### Scope Assessment
- [ ] Small (1-2 files, straightforward)
- [ ] Medium (3-5 files, some complexity)
- [ ] Large (6+ files, significant changes)

---
**Worktree**: `.worktrees/[issue-<NUM> | task-<TASK_ID>]`
**Branch**: `fix/[issue-<NUM>-<desc> | <TASK_ID>-<desc>]`

Please review and confirm this plan, or provide feedback.
```

**IMPORTANT**: Do NOT proceed to Phase 4 until user explicitly approves.

---

# Phase 4: Implement (After Approval Only)

### 4.1 Work in the worktree

```bash
cd ".worktrees/[issue-${ISSUE_NUM} | task-${TASK_ID}]"
```

### 4.2 TDD Development

1. **Red Phase**: Write failing tests first
2. **Green Phase**: Implement the fix (minimal changes to pass tests)
3. **Refactor Phase**: Clean up if needed

### 4.3 Run tests

```bash
# Backend
cd backend && pytest tests/ -v

# Frontend
cd frontend && npm run typecheck && npm run build
```

### 4.4 Commit changes

```bash
# For issues
git commit -m "fix: [description] (Related to #${ISSUE_NUM})

Co-Authored-By: Claude <noreply@anthropic.com>"

# For tasks
git commit -m "fix: [description]

Task: ${TASK_ID}
Co-Authored-By: Claude <noreply@anthropic.com>"
```

### 4.5 Push branch

```bash
git push -u origin "$BRANCH_NAME"
```

### 4.6 Report completion

```markdown
## [Issue #<NUM> | Task <TASK_ID>] Implementation Complete

**Branch**: `fix/[...]` (pushed)
**Worktree**: `.worktrees/[...]`

### Changes Made
- [Change 1]
- [Change 2]

### Test Results
- Backend: X tests passed
- Frontend: Build successful

### Next Steps
1. Create PR to staging: `gh pr create --base staging`
2. Wait for CI/CD checks
3. [For issues: Request case owner testing]
4. [📣 If the issue has the `📣 announce` label: after it gets `✅ tested-in-staging`,
   run `/announce #<NUM>` before the auto-created Release PR is merged]
```

### 4.7 Release announcement reminder (issue mode only)

Check the issue labels (`gh issue view <NUM> --json labels`). If it has `📣 announce`,
include step 4 above in the completion report. Do **not** run `/announce` yet when the
issue lacks `✅ tested-in-staging` — the announce skill refuses untested issues.

---

# Handling Multiple Issues

When `$ARGUMENTS` contains multiple issue numbers (e.g., "42 43 44"):

### Parallel Setup

```bash
ISSUES="$ARGUMENTS"  # e.g., "42 43 44"

# Validate all issue numbers first
for NUM in $ISSUES; do
    NUM="${NUM#\#}"
    if ! [[ "$NUM" =~ ^[0-9]+$ ]]; then
        echo "Error: Invalid issue number: $NUM"
        exit 1
    fi
done

# Create all worktrees
for NUM in $ISSUES; do
    NUM="${NUM#\#}"
    ISSUE_TITLE=$(gh issue view "$NUM" --json title -q '.title')
    ISSUE_SLUG=$(echo "$ISSUE_TITLE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | cut -c1-30 | sed 's/-$//')
    BRANCH_NAME="fix/issue-${NUM}-${ISSUE_SLUG}"
    git worktree add ".worktrees/issue-${NUM}" -b "$BRANCH_NAME" origin/staging &
done
wait
```

### Present All Plans Together

```markdown
# Plans for Issues $ARGUMENTS

## Issue #42: [Title]
[Full plan...]

---

## Issue #43: [Title]
[Full plan...]

---

Please review all plans. You can:
- Approve all: "proceed with all"
- Approve specific: "proceed with #42 and #43"
- Request changes: "for #42, please also consider..."
```

---

# Worktree Management

## List worktrees

```bash
git worktree list
```

## Check worktree status

```bash
cd ".worktrees/[issue-<NUM> | task-<TASK_ID>]" && git status
```

## Cleanup after merge

```bash
# Remove worktree
git worktree remove ".worktrees/[...]"

# Delete local branch if exists
git branch -D "fix/[...]"
```

---

# Recovery from Failed Implementation

If implementation fails in Phase 4:

### 1. Preserve Work

```bash
cd ".worktrees/[...]"
git status
git diff
```

### 2. Document What Failed

- Note the error message
- Identify which step failed
- Check test output if applicable

### 3. Options for User

- **Retry**: Fix the issue and continue
- **Adjust Plan**: Revise the plan based on learnings
- **Abandon**: Clean up and start fresh

### 4. Cleanup (Only After User Confirms)

```bash
.claude/skills/worktree/scripts/cleanup-worktree.sh [issue-NUM | task-TASK_ID]
```

---

# Edge Cases

### Running from Within a Worktree

If already in a worktree, return to main repository first:
```bash
cd "$(git rev-parse --show-toplevel)/.."
```

### Issue/Task Already Has a Branch

Check for existing branches before creating:
```bash
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME" 2>/dev/null; then
    echo "Warning: Branch $BRANCH_NAME already exists"
    git branch -a | grep "$BRANCH_NAME"
fi
```

### Issue is Closed

```bash
STATE=$(gh issue view "$ISSUE_NUM" --json state -q '.state')
if [ "$STATE" = "CLOSED" ]; then
    echo "Warning: Issue #${ISSUE_NUM} is closed"
    # Ask user if they want to proceed anyway
fi
```

---

# Red Flags - Never Do These

- Implement without presenting plan first
- Skip user confirmation before coding
- Work in main workspace instead of worktree
- Create branches from `main` instead of `staging`
- Push without running tests
- Assume requirements without asking
- Commit directly to `staging` branch
- Accept non-numeric issue numbers (security risk)
- Create task without generating proper Task ID

---

# Integration with Other Workflows

After implementation, use the standard PDCA workflow:
1. Create PR with `gh pr create --base staging`
2. Use "Fixes #<NUM>" in PR body to auto-close issue (for issues)
3. Wait for CI/CD checks
4. Wait for case owner approval
5. Merge via `gh pr merge --squash`

See `.claude/agents/git-issue-pr-flow.md` for complete workflow details.
