---
name: announce
description: |
  整理 Duotopia 對外「更新公告」內容（LINE 官方帳號文案 + 官網中英文章），用開發者的
  Claude Code 產生，CI 建草稿時就不必再呼叫 Vertex AI（issue #804）。
  兩種模式：
  - `/announce #N`（或在 issue worktree 內 `/announce`）：寫成 issue 留言
  - `/announce release`：統整本次 staging → main 的公告，寫進 staging → main PR 描述
    （PR 還沒開就一起開）
  自動觸發：「整理公告」「寫更新公告」「announce」、「開 staging → main 的 PR」、
  「發 release 到 main」、「準備上 production」。
argument-hint: "#<issue> | release"
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Grep, Glob, AskUserQuestion
---

# Announce Skill（更新公告內容）

**開始時宣告：**「我使用 announce skill 整理更新公告內容。」

這個 skill **只寫內容，不對外發布**。實際發 LINE / 官網一律由管理者在後台
「更新公告」頁按「發布」。

所有 GitHub 讀寫都透過共用腳本（與 CI 同一套規則，不要自己拼 API 或 markdown）：

```bash
python3 scripts/release_announcement.py <command> ...
```

| 指令 | 用途 |
|------|------|
| `check <N>` | 單一 issue 的標籤判斷 + 既有公告內容 |
| `release-scan [--base origin/main --head origin/staging]` | 本次 release 內所有 issue 的判斷 |
| `render --content <json> [--issues 1,2]` | 預覽區塊（不寫入 GitHub） |
| `upsert-issue <N> --content <json>` | 寫入 / 更新 issue 公告留言 |
| `upsert-pr <PR> --content <json> --issues 1,2` | 寫入 / 更新 PR 描述內的統整區塊 |

內容 JSON 固定六個欄位（`line_message_zh` 與 `article_title_zh` 必填）：

```json
{
  "line_message_zh": "", "line_message_en": "",
  "article_title_zh": "", "article_body_zh": "",
  "article_title_en": "", "article_body_en": ""
}
```

JSON 檔寫在 scratchpad（或 `/tmp`），**不要**寫進 repo。

---

## 發布資格（兩種模式共用）

issue **同時**有這兩個標籤才整理公告：

| 標籤 | 缺少時 |
|------|--------|
| `📣 announce` | 回覆「此 issue 不需發布公告」並**停止** |
| `✅ tested-in-staging` | 回覆「此 issue 還沒測試通過」並**停止** |

`check` / `release-scan` 的輸出已經有 `eligible`、`reason`、`message`，直接照
`message` 回覆，不要自行放寬規則。

---

## 模式 A：單一 issue → issue 留言

觸發：`/announce #N`；或沒有參數時，從目前分支名稱 `issue-<N>` 取得 N
（取不到就問使用者）。

1. `python3 scripts/release_announcement.py check N`
   - `eligible: false` → 回覆 `message`，停止。
   - `content` 不是 null（已經寫過）→ 用 AskUserQuestion 問「覆蓋 / 保留」。
     保留就停止。
2. 了解這次改了什麼（給使用者看得懂的角度，不是技術細節）：
   - `gh issue view N --json title,body,comments`
   - 相關 PR：`gh pr list --state all --search "#N in:title,body" --json number,title,body`
   - 程式差異：在 issue worktree 內用 `git diff origin/staging...HEAD --stat` 與重點檔案；
     已合併的話用 `git log origin/staging --grep "#N" --format=%H` 找 commit 再看
3. 依下方「寫作原則」產生六個欄位，寫成 JSON 檔。
4. `render` 預覽，把預覽貼給使用者看。
5. `upsert-issue N --content <json>`，回報留言網址。
6. 提醒時間點：
   > 進 staging 的 Release PR 是 CI 在加上 `✅ tested-in-staging` 後自動開的。
   > 請在 **合併那個 Release PR 之前** 完成這一步，staging 草稿才會用到這份內容；
   > 來不及也沒關係，staging 會退回 Vertex，production 由 `/announce release` 統整。

## 模式 B：`release` → staging → main PR 描述

觸發：`/announce release`；或使用者要開 staging → main 的 PR、準備上 production。

1. `git fetch origin main staging`
2. `python3 scripts/release_announcement.py release-scan`
   - 列出每個 issue 的判斷結果給使用者（含「沒有 announce 標籤」「還沒測試通過」而略過的）。
3. 對 `eligible: true` 但 `content` 為 null 的 issue：依模式 A 的步驟 2–3 當場補產，
   並用 `upsert-issue` 寫回該 issue（之後改內容只要改留言）。
4. 統整所有 eligible issue 的內容成**一則**公告（寫作原則見下），寫成 JSON 檔。
   - 只有一個 eligible issue → 直接沿用那則內容即可。
   - 沒有任何 eligible issue → 告訴使用者「本次沒有需要發布的公告」，跳過步驟 4–6，
     仍可照常開 PR。
5. 找 PR：`gh pr list --base main --head staging --state open --json number,url`
   - 沒有就開：標題沿用既有格式
     `Release: staging → main（#N 短名、#M 短名）`（列出本次所有 issue，不只 eligible），
     描述包含「本次發版內容」表格（issue / 內容 / commit），比照過去的 release PR（例：#1072）。
     開 PR 前先讓使用者確認標題與描述。
6. `upsert-pr <PR> --content <json> --issues <eligible issue，逗號分隔>`，回報 PR 網址。
   - 描述裡原本的內容會保留，只替換（或附加）公告區塊。

合併後 push main 時，CI 會讀這個區塊建立 production 草稿。

---

## 寫作原則

讀者是 **Duotopia 的老師、學生與家長**，不是工程師。

- **只寫使用者感受得到的改變**：能做什麼新的事、什麼問題不會再發生。
  不寫檔名、API、migration、元件名稱、CI、重構等內部細節；
  純內部改動就寫「穩定性改善」一句帶過。
- **LINE 文案**：中文 ≤ 120 字、英文 ≤ 200 字元；一兩句重點 + 可加 1 個 emoji；
  不放連結（卡片按鈕會自動連到官網文章）。
- **官網標題**：中文 ≤ 30 字；英文 ≤ 70 字元；不要加「【公告】」之類前綴。
- **官網內文**：markdown。開頭一段說明這次更新，再用 `###` 小標或條列說明「怎麼用」；
  修正類寫「之前發生什麼 → 現在已修正」。
- **英文**是改寫給英文讀者，不是逐字翻譯；產品名稱固定寫 Duotopia。
- **統整版**：LINE 文案用「本次更新：① … ② …」列出重點；官網文章每個 issue 一個 `###` 段落，
  新功能在前、修正在後。

## 不要做

- 不要呼叫任何發布 API、不要 broadcast LINE（發布只在後台）。
- 不要替沒有兩個標籤的 issue 產生內容。
- 不要手動編輯區塊內的 `<!-- release-announcement:* -->` 標記或 `####` 小標題，
  一律透過腳本寫入（CI 靠它們解析）。
