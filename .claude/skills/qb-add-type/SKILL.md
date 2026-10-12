---
name: qb-add-type
description: |
  在題庫（Question Bank）新增一種題型（例如聽力題組、填充題、圖片聽力）。照設計文件
  docs/design/question-bank-question-types.md 的檢查清單，逐步改後端清單／schema／驗證、
  前端草稿型別、sheet 與卡片分流、預覽、列表下拉與篩選、i18n、AI 輸入、擷取、驗收樣本與文件。
  同一個 QuestionSheet 依題型分流，禁止新增路由或複製 QuestionSheet／GroupCard／QuestionCard。
  自動觸發：「新增題型」、「題庫加題型」、「加一個題組類型」、「qb-add-type」。
argument-hint: "<題型名稱>"
disable-model-invocation: false
allowed-tools: Bash, PowerShell, Read, Write, Edit, Grep, Glob, AskUserQuestion
---

# qb-add-type：題庫新增題型

**開始時宣告：**「我用 qb-add-type skill 新增題庫題型：$ARGUMENTS」

## 硬規則（整個流程都適用）

- **禁止** `git reset --hard`、任何 `git checkout`（含 `-- <file>`）、`git clean`、force-push、amend 既有 commit。要修已 commit 的內容就再加一筆 commit。
- 主 repo `C:\Users\mixca\duotopia` **只允許** `git merge --ff-only claude/issue-<N>`；ff 不了就停下回報，不要自行「對齊」。
- **不自動推送、不自動開 PR**：完成後回報，等使用者明確指示。
- **不動任何程序**（不 kill、不重啟後端／vite），需要重啟先問。
- 指令 timeout ≤ 120000 ms。
- 單檔 ≤ 1000 行（`check-file-size.py`）。`GroupCard.tsx`、`QuestionSheet.tsx` 已近 800 行：新 UI 拆成子元件。
- 不在本地跑功能測試；vitest 交給 CI。pytest 題庫相關檔可在本地跑。
- 程式碼在 worktree（`C:\Users\mixca\duotopia\.worktrees\issue-<N>`，分支 `claude/issue-<N>`）寫，主 repo 只用來 ff 後跑前端檢查（主 repo 有 node_modules；worktree 沒有）。

## 步驟 0：讀文件、確認題型規格

1. 讀 `docs/design/question-bank-question-types.md`（全文）、`docs/design/question-bank-schema.md`（題組、segments、克漏字段落）、`docs/design/question-bank-layout-samples/README.md`。
2. 決定並向使用者確認（附「目的與意義」，用畫面白話說明）：
   - 單題（`single`，走 `/questions`）還是題組（`group`，走 `/question-groups`）？
   - `question_type` 值（`QUESTION_TYPES` 已預留 `fill_in`／`listening`／`listening_image`）
   - 照設計文件「三、現有三種題型對照表」逐列填出新題型的值：題幹可空、小題編號、新增小題方式、主圖文編輯器、題型專屬驗證、擷取模式與 `stimulus.kind`、AI 輸入、預覽、列表名稱
   - 需要的新素材欄位（例如題組整段音檔 `audio_url`：DB 已有，但 schema／`GroupDraft` 尚未接）
   - 驗收樣本用哪一份真實考卷題目

## 步驟 1：列檔案清單給使用者確認（未確認前不動工）

照設計文件「四、加題型檢查清單」第 1～12 步，列出**這個題型實際要改的**檔案、函式與每步驗證方式（表格）。標出不用改的步驟與理由。使用者說 OK 才開始。

## 步驟 2：逐步實作

依檢查清單順序，**每一步一筆 commit**（訊息格式 `feat(#N): ...`，結尾附 session 的 attribution 行），方便中斷後接手：

| 步 | 主要檔案 | 重點 |
|----|----------|------|
| 1 後端清單 | `backend/models/question_bank.py` `QUESTION_TYPES`；`backend/routers/question_bank_schemas.py` `SINGLE_CREATABLE_TYPES`／`GROUP_CREATABLE_TYPES`、`QuestionCreate`／`QuestionGroupCreate` 的 `Literal`、新輸入欄位（`QuestionGroupCreate`／`QuestionGroupUpdate` + `routers/question_bank_groups.py` 建立／PATCH） | `question_type` 無 DB CHECK，不需 migration |
| 2 題型驗證 | `check_group_blanks`（或新 `check_group_<rule>`，建立 schema `_check` 與 `update_question_group` 兩處都呼叫）；排版規則放 `services/question_bank_layout.py` | 新測試 `backend/tests/test_question_bank_<type>.py` |
| 3 前端草稿 | `frontend/src/types/questionBank.ts`；`components/question-bank/groupDraft.ts`（`GroupDraft` 欄位、`emptyGroupDraft`、`groupDraftFromGroup`、`toCreateGroupInput`／`toUpdateGroupInput`、`is<Type>Group`、`groupStemOptional`、`validateGroupDraft`、`groupHasStimulus`、`unitPassageByKey`）；單題改 `draftCore.ts` | 題型判斷集中成函式，元件不散寫字串比較 |
| 4 sheet | `QuestionSheet.tsx` `GROUP_TYPES` | 只加值，不複製 sheet |
| 5 卡片 | `GroupCard.tsx`（依題型函式分支；大塊 UI 拆 `GroupCard<Type>.tsx`）、`QuestionCard.tsx`（加 prop）、`LayoutEditor.tsx`（模式 prop） | 不複製 GroupCard／QuestionCard |
| 6 預覽 | `GroupPreview.tsx`、`QuestionsPreview.tsx` `numbering` | |
| 7 列表 | `QuestionBankToolbar.tsx` `CREATE_TYPES`（`enabled: true`）、`CREATE_TYPES_ORDER`；`QuestionBankTab.tsx` `groupTypeLabel`（寫死 reading／cloze，題組題型要加） | |
| 8 i18n | `frontend/src/i18n/locales/{zh-TW,en}/translation.json`：`questionBank.types.<type>`、`questionBank.groupTypes.<type>`、`questionBank.form.errors.*` | 兩語系同步 |
| 9 AI | `aiDraft.ts` `toAiInputs`／`draftsEligibleForAi`；`groupDraft.ts` `unitPassageByKey`；`backend/services/question_bank_ai.py` `PASSAGE_RULE`／prompt | |
| 10 擷取 | `backend/services/magic_paste_service.py`（`EXTRACT_MODES`、`_build_prompt`、`_normalize_reading_group`／新 normalize）；`components/shared/MagicPasteInput.tsx` 型別；`QuestionSheet.tsx` `extractMode`；`QuestionBankBatchPanel.tsx`；`extractedGroup.ts` `groupDraftFromExtracted` | 改後端需重啟本地後端才生效（先問） |
| 11 樣本 | `docs/design/question-bank-layout-samples/<qNN-type>.json` + README 表格 | 測試資料用真實情境，不塞內容繞過驗證 |
| 12 文件 | 見步驟 4 | |

每步寫完同步更新改到檔案的頂部 JSDoc／docstring。

## 步驟 3：每步驗證指令

後端（在 worktree 跑；venv 在主 repo，pytest 前把 venv Scripts 放進 PATH，conftest 會呼叫 `alembic`）：

```bash
cd /c/Users/mixca/duotopia/.worktrees/issue-<N>/backend
PATH="/c/Users/mixca/duotopia/backend/venv/Scripts:$PATH" PYTHONUTF8=1 \
  python -m pytest tests/test_question_bank_api.py tests/test_question_bank_cloze.py \
  tests/test_question_bank_dialogue.py tests/test_question_bank_layout.py \
  tests/test_question_bank_ai.py tests/test_question_bank_<type>.py -q
/c/Users/mixca/duotopia/backend/venv/Scripts/python.exe -m black --check <改到的 .py>
/c/Users/mixca/duotopia/backend/venv/Scripts/python.exe -m flake8 --config=../.flake8 <改到的 .py>
```

前端（worktree commit → 主 repo ff → 在主 repo 跑；worktree 沒有 node_modules，用 junction 跑 tsc 會掛住）：

```bash
git -C /c/Users/mixca/duotopia merge --ff-only claude/issue-<N>
cd /c/Users/mixca/duotopia/frontend
npm run typecheck
npx eslint src/components/question-bank src/components/shared/MagicPasteInput.tsx
```

prettier 用 **git 內容經 stdin** 逐檔比對（Windows worktree 的 CRLF 會讓 `--check` 誤報；只比 git 裡的內容才等同 CI）：

```bash
cd /c/Users/mixca/duotopia/frontend
o="$(mktemp)"
for f in $(git diff --name-only <起點commit>..HEAD -- src | sed 's#^frontend/##'); do
  git show "HEAD:frontend/$f" > "$o" 2>/dev/null || continue   # 已刪除的檔跳過
  npx prettier --stdin-filepath "$f" < "$o" | diff -q - "$o" >/dev/null \
    || echo "需要格式化: $f"
done
```

有輸出就在 worktree 修好格式後補一筆 `style(#N): prettier 格式` commit。

i18n 兩語系 key 對齊：

```bash
cd /c/Users/mixca/duotopia/frontend
node -e "const a=require('./src/i18n/locales/zh-TW/translation.json').questionBank,b=require('./src/i18n/locales/en/translation.json').questionBank;const k=(o,p='')=>Object.entries(o).flatMap(([x,v])=>typeof v==='object'?k(v,p+x+'.'):[p+x]);const A=new Set(k(a)),B=new Set(k(b));console.log([...A].filter(x=>!B.has(x)),[...B].filter(x=>!A.has(x)))"
```

檔案行數：

```bash
cd /c/Users/mixca/duotopia/.worktrees/issue-<N>
git diff --name-only <起點commit>..HEAD | xargs wc -l | sort -n | tail
```

## 步驟 4：更新設計文件

- `docs/design/question-bank-question-types.md`：「核心原則」題型表加一列；「三、對照表」加一欄；「六、已知缺口」移除已補上的項目；若新題型新增了散寫判斷點，更新「五、禁止事項」的清單。
- `docs/design/question-bank-schema.md`：新題型專屬規則段落（比照「克漏字題組（#1085）」）。
- 一筆 `docs(#N): ...` commit。

## 步驟 5：回報

回報給使用者（檔案一律給完整絕對路徑）：commit 清單、改動檔案與行數、驗證結果（pytest 數字、typecheck／eslint／prettier／black／flake8）、是否需要重啟後端、本地手動驗收步驟（從「新增題目 ▽」選新題型 → 填內容 → 預覽 → 儲存 → 列表篩選 → 重新開啟編輯）。**不推送、不開 PR**，等使用者指示。
