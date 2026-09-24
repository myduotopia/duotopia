# 題組 layout 驗收樣本（#1061 閱讀／克漏字題組）

來源：`9英語閱讀科試題本.pdf`（九年級第一次會考模擬測驗，115901-E）。
用途：`question_groups.layout` JSONB 格式的驗收基準。格式能完整表達這五組，才開工。

## 格式規則
- `rows` 由上到下；每個 row 有 `columns`，每欄 `span` 為比例（允許 1:1、1:2、2:1、1:1:1）。
- 手機寬度時同一 row 的欄位依序上下堆疊，不左右擠壓。
- `section`（`frame: true`）把一組 rows 框起來（兩篇並列的報導各一個 section）。
- 區塊：`heading`、`paragraph`（可含 `**粗體**`、`__底線__`、克漏字 `{{n}}`）、`image`、`dialogue`。
- 單字註解不在 layout 內，存 `question_groups.glossary`；樣本檔以 `_glossary` 附在旁邊供對照。
- 圖片 URL 以 `<xxx.png>` 占位。
- 刻意取捨：原卷的「文繞圖」改成「左文右圖 + 下一段全寬」，避免手機跑版。

| 檔案 | 題號 | 驗證的排版能力 |
|------|------|----------------|
| q20-21-dialogue-map.json | 20–21 | 引言、對話框、說明句、置中地圖 |
| q25-27-inline-figure.json | 25–27 | 段落之間插一張圖 |
| q34-36-two-figures.json | 34–36 | 兩張圖左右並排 |
| q37-39-two-articles.json | 37–39 | 兩篇框起來的報導、標題／作者分欄、右側插圖 |
| q40-43-cloze.json | 40–43 | 克漏字 `{{n}}`、右側插圖 |
