# 🤖 Claude Code GitHub Automation 使用指南

## 📋 功能概述

Claude 會自動化處理 GitHub Issues，遵循專案的 PDCA 流程。

**✨ 新功能**：Claude 每次回覆後都會提供「建議回覆選項」，引導你進行下一步操作！

## 🎯 三種觸發方式

### 1️⃣ 自動觸發（Issue 新開時）

**行為**：
- Issue 新開時自動執行 **Plan 階段**
- Claude 會留言完整的 PDCA Plan 分析
- **不會立即實作**，等待你確認

**範例**：
```
你開了一個 bug issue → Claude 自動留言：
- 5 Why 根因分析
- 修復方案
- 風險評估
- 等待你確認
```

### 2️⃣ 手動批准實作

**方式 A - 留言**：
```
在 Issue 留言：
開始實作
```

**方式 B - 加 Label**：
```
加上 label: 🤖 claude: auto-implement
```

**行為**：
- Claude 執行 **Do 階段**
- 自動創建 feature branch
- TDD 開發（Red → Green → Refactor）
- 創建 PR (feature → staging)
- 等待 CI/CD 部署 Per-Issue Test Environment

### 3️⃣ 隨時 @mention

**方式**：
```
在 Issue 或 PR comment 中：
@claude [你的問題或指令]
```

**範例**：
```
@claude 這個修復方案會不會影響其他功能？
@claude 可以幫我加上單元測試嗎？
@claude 重新分析這個問題
```

---

## 💬 建議回覆選項功能

### 🎯 功能說明

Claude 每次在 Issue 留言後，都會在最後提供「建議回覆選項」，包含：

1. **最常見的 3 種情境**
2. **可直接複製的回覆文字**
3. **@claude mention 的範例**（當需要進一步互動時）

### 📝 範例

**Claude 的留言會這樣結尾**：

```markdown
---

### 💬 建議回覆選項

**如果同意修復方案**：
- 「開始實作」
- 或加上 label: `🤖 claude: auto-implement`

**如果需要調整方案**：
- 「@claude 可以換個方案嗎？[說明原因]」
- 「@claude 這個修復會不會影響 [功能]？」

**如果需要更多資訊**：
- 「@claude 可以詳細說明技術細節嗎？」
- 「@claude 為什麼選擇這個方案？」
```

### 🎯 為什麼需要這個功能？

1. **降低學習曲線** - 新手也能快速上手
2. **提高互動效率** - 不用想該怎麼回覆
3. **避免誤解** - 提供正確的互動方式
4. **引導最佳實踐** - 幫助你做出最佳決策

---

## 📋 完整 PDCA 流程

### 1️⃣ Plan（Claude 自動執行）

**觸發時機**：Issue 新開時

**Claude 會做什麼**：
1. ✅ 讀取 Issue 內容和截圖
2. ✅ 執行 5 Why 根因分析
3. ✅ 檢查是否涉及 DB Schema 變更
   - ⚠️ 如果涉及 → 標記「需要人工審查」並停止
4. ✅ 評估風險和信心度
5. ✅ 在 Issue 留言完整分析
6. ✅ 加上 label: `✅ PDCA: Plan`

**你需要做什麼**：
- 審查 Claude 的分析
- 確認修復方案合理
- 回覆「開始實作」或加 `🤖 claude: auto-implement` label

### 2️⃣ Do（需要你批准後執行）

**觸發條件**：
- 你留言「開始實作」
- 或加上 `🤖 claude: auto-implement` label

**Claude 會做什麼**：
1. ✅ 創建 feature branch: `fix/issue-N-xxx`
2. ✅ TDD 開發：
   - Red: 寫測試
   - Green: 實作修復
   - Refactor: 重構代碼
3. ✅ Commit: `fix: 修復 XXX (Related to #N)`
4. ✅ Push to remote
5. ✅ 創建 PR (feature → staging)
6. ✅ 在 Issue 留言進度
7. ✅ 加上 labels:
   - `✅ PDCA: Do`
   - `⏳ 等待 CI/CD`

**自動觸發**：
- CI/CD 自動部署 Per-Issue Test Environment
- 完成後 GitHub bot 會留言測試 URLs

### 3️⃣ Check（你和案主測試）

**你需要做什麼**：
1. 查看 Per-Issue Test Environment URLs
2. 測試功能是否修復
3. 通知案主測試
4. 案主留言「測試通過」或「✅」

**自動化**：
- 執行 `check-approvals` 會自動偵測批准
- 自動加上 `✅ tested-in-staging` label
- 🤖 **自動建立 Release PR**（`automation-release-pr.yml`）：
  - 找到 `claude/issue-<N>*` 分支
  - 建立 PR → staging
  - Claude Code Action 自動修正 CI/review 問題（1 round）
  - LINE 通知結果

### 4️⃣ Act（Merge 和清理）

**你需要做什麼**：
```bash
# 收到 LINE 通知 "Ready to Merge" 後
# Merge PR
gh pr merge <PR_NUMBER> --squash
```

**自動觸發**：
- Issue 關閉時自動清理 Per-Issue Test Environment
- Cloud Run services 自動刪除
- 💰 立即停止計費

---

## 🚨 安全機制

### Schema 變更紅線

如果 Issue 涉及 DB Schema 變更，Claude 會：
- ❌ **不會自動實作**
- ✅ 在 Plan 留言中標記「需要 DB Schema 變更」
- ✅ 提供完整的 migration 計畫
- ⏳ 等待人工審查批准

### 絕對禁止

Claude **不會**做以下事情：
- ❌ 直接在 staging commit
- ❌ 跳過 PR
- ❌ 使用 `Fixes #N`（會意外關閉 issue）
- ❌ 沒有批准就 merge
- ❌ 處理涉及 Schema 變更的 issue

---

## 📊 Labels 說明

| Label | 說明 | 誰加上 |
|-------|------|--------|
| `✅ PDCA: Plan` | Plan 階段完成 | Claude |
| `🤖 claude: auto-implement` | 批准 Claude 實作 | 你 |
| `✅ PDCA: Do` | Do 階段完成 | Claude |
| `⏳ 等待 CI/CD` | 等待部署 | Claude |
| `✅ PDCA: Check` | Check 階段 | 手動 |
| `✅ tested-in-staging` | 案主測試通過 → 觸發自動 Release PR | 自動偵測 |
| `ready-to-merge` | PR 所有 CI 通過，可以 merge | 自動（Release PR workflow） |
| `🛡️ PDCA: Act` | Act 階段 | 手動 |

---

## 🎯 使用場景

### 場景 1：Bug 修復（標準流程）

```
1. 你開 Bug Issue
   → Claude 自動留言 Plan 分析

2. 你審查並回覆「開始實作」
   → Claude 創建 PR

3. CI/CD 部署 Per-Issue Test Environment
   → 你測試功能

4. 案主測試並批准
   → 你 merge PR

5. Issue 關閉
   → 自動清理測試環境
```

### 場景 2：緊急 Bug（快速實作）

```
1. 你開 Bug Issue
2. 同時加上 label: 🤖 claude: auto-implement
   → Claude 跳過等待，直接實作
3. 繼續標準流程...
```

### 場景 3：複雜問題（需要討論）

```
1. 你開 Issue
   → Claude 留言 Plan

2. 你：@claude 這個方案會影響 XXX 嗎？
   → Claude 回答問題

3. 你：@claude 可以換個方案嗎？
   → Claude 重新分析

4. 確認後：開始實作
   → Claude 實作
```

### 場景 4：Schema 變更（人工審查）

```
1. 你開 Issue（需要修改 DB schema）
   → Claude 留言 Plan + 標記「需要人工審查」
   → Claude **不會自動實作**

2. 你審查 migration 計畫
3. 確認安全後手動實作
```

---

## 💡 最佳實踐

### ✅ 建議做法

1. **讓 Claude 先分析** - 不要跳過 Plan 階段
2. **審查 Plan** - 確認方案合理再批准
3. **Schema 變更** - 務必人工審查
4. **測試完整** - Per-Issue 和 Staging 都要測試
5. **等待批准** - 案主測試通過才 merge

### ❌ 避免做法

1. **不要繞過 PR** - 即使緊急也要走流程
2. **不要跳過測試** - CI/CD 綠燈很重要
3. **不要忽略 Schema 警告** - 這是紅線
4. **不要過度依賴** - Claude 只是助手，最終決策是你的

---

## 🔧 進階配置

### 自訂 Claude Prompt

編輯 `.github/workflows/claude-code-automation.yml`:

```yaml
prompt: |
  # 你的自訂 prompt
  ...
```

### 更改觸發條件

```yaml
on:
  issues:
    types: [opened, labeled, edited]  # 加上 edited
  issue_comment:
    types: [created]
```

### 更改 Label

```yaml
if: |
  github.event.label.name == '你的自訂 label'
```

---

## 📚 相關文件

- **完整 PDCA 流程**: `.claude/ISSUE_HANDLING_CHECKLIST.md`
- **專案規範**: `CLAUDE.md`
- **測試指南**: `docs/TESTING_GUIDE.md`
- **CI/CD 說明**: `CICD.md`
- **Claude Code GitHub Actions 官方文件**: https://code.claude.com/docs/en/github-actions

---

**🎉 現在開始使用 Claude Code Automation 吧！**
