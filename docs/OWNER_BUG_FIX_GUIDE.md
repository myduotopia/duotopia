# 案主小Bug修复标准流程

> 目的：让案主能快速修复小问题，不打乱工程师的节奏

---

## 🎯 适用范围

### ✅ 可以自行修复

- 前端UI文字修改（按钮文字、提示文字等）
- 前端样式调整（颜色、间距、字体等）
- 简单逻辑bug（显示隐藏、判断条件等）
- 错别字修正

### ❌ 不适合自行修复

- 资料库相关（表结构、migration）
- 后端API逻辑
- 复杂业务流程
- 第三方整合（TapPay、Azure等）

---

## 📋 案主修复流程（7步）

```
┌─────────────────────────────────────────────────────────────┐
│                    案主修复Bug完整流程                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  步骤1️⃣ : GitHub staging → 本地 staging                     │
│  ➜ git checkout staging && git pull origin staging          │
│                                                              │
│  步骤2️⃣ : 本地 staging → 本地新分支                          │
│  ➜ git checkout -b claude/issue-XX                          │
│                                                              │
│  步骤3️⃣ : 本地开发 + 本地测试                                │
│  ➜ 修改代码 → npm run dev / python main.py                  │
│                                                              │
│  步骤4️⃣ : 本地提交                                           │
│  ➜ git add . && git commit -m "fix: 描述 #XX"               │
│                                                              │
│  步骤5️⃣ : 推送到 GitHub                                      │
│  ➜ git push origin claude/issue-XX                          │
│                                                              │
│  步骤6️⃣ : 工程师处理（你等待）                               │
│  ➜ 工程师创建PR → 工程师部署到staging → 工程师通知你测试     │
│                                                              │
│  步骤7️⃣ : 你测试 + 工程师合并                                │
│  ➜ 你測試通過 → 工程师merge到main                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### **具体命令**

```bash
# 步骤1️⃣: 从GitHub拉取staging分支
git checkout staging
git pull origin staging

# 步骤2️⃣: 从本地staging创建新分支
git checkout -b claude/issue-XX  # XX = Issue号码

# 步骤3️⃣: 本地开发 + 测试
# 用VS Code编辑文件

# 前端测试
cd frontend
npm run dev  # 打开 http://localhost:5173 测试

# 或后端测试
cd backend
python main.py  # 测试API

# 步骤4️⃣: 确认修复后提交
git add .
git commit -m "fix: 简短描述问题 #XX"

# 步骤5️⃣: 推送到GitHub
git push origin claude/issue-XX

# ✅ 完成！等待工程师后续处理
```

---

## 📝 Commit Message 格式

| 类型     | 格式              | 示例                        |
| -------- | ----------------- | --------------------------- |
| 修复bug  | `fix: 描述 #XX`   | `fix: 修复登录按钮颜色 #28` |
| 样式调整 | `style: 描述 #XX` | `style: 调整导航栏间距 #35` |
| 文字修改 | `docs: 描述 #XX`  | `docs: 修正按钮文字 #42`    |

---

## 🔄 工程师的职责

| 步骤       | 工程师做什么            | 你做什么                  |
| ---------- | ----------------------- | ------------------------- |
| 步骤5️⃣ 后  | 创建 PR（如果还没有）   | 等待                      |
| PR 创建后  | 审核你的代码            | 等待                      |
| 审核通过后 | 部署到 staging 测试环境 | 收到通知                  |
| 部署完成   | 在 Issue 通知你测试 URL | **你测试** ✅             |
| 你測試通過 | 看到你的批准            | 在 Issue 留言「測試通過」（只寫這四個字，不加其他字） |
| 最后一步   | 合并 PR 到 main         | 完成！                    |

---

## 📊 各环节职责清晰

| 环节     | 谁负责     | 说明             |
| -------- | ---------- | ---------------- |
| 代码修复 | **你**     | 本地开发 + 测试  |
| 代码审核 | **工程师** | 检查代码质量     |
| 部署测试 | **工程师** | 发布到 staging   |
| 功能测试 | **你**     | 验证修复是否有效 |
| 代码合并 | **工程师** | 合并到 main      |
| 上线部署 | **工程师** | 部署到生产环境   |

---

## 💡 实际案例：Issue #203

```bash
# 1. 创建分支
git checkout -b claude/issue-203

# 2. 修改代码
# （工程师已经修复好了）

# 3. 本地测试
# （确认修复有效）

# 4. 提交
git add .
git commit -m "fix: 修复句子生成陣列錯位 #203"

# 5. 推送
git push origin claude/issue-203

# ✅ PR #220已创建，等工程师处理
```

---

## ⚠️ 重要注意事项

### 绝对不要做

- ❌ 修改资料库文件（`backend/models/`, `backend/migrations/`）
- ❌ 直接推送到 `main` 或 `staging` 分支
- ❌ 修改环境变数配置
- ❌ 修改CI/CD工作流文件

### 务必做到

- ✅ 分支命名：`claude/issue-XX`
- ✅ 本地测试通过后再推送
- ✅ Commit信息清晰明确
- ✅ 一个Issue对应一个分支

---

## 🆘 遇到问题怎么办

| 问题           | 解决方案                       |
| -------------- | ------------------------------ |
| 推送失败       | `git pull origin main` 再推送  |
| 本地测试错误   | 重新安装依赖 `npm install`     |
| 不确定能否修复 | 联络工程师讨论                 |
| 修复后想改动   | 继续修改，再次commit和push即可 |

---

## 🎓 快速参考

```bash
# 每次修复Bug的完整命令
git checkout staging && git pull origin staging
git checkout -b claude/issue-XX
# （修改代码 + 本地测试）
git add .
git commit -m "fix: 描述 #XX"
git push origin claude/issue-XX
# 完成！
```

---

## 📞 需要帮助

- 代码修改建议 → 联络工程师
- GitHub操作问题 → 参考本指南
- 环境设置问题 → 联络工程师

---

**祝修复愉快！** 🎉
