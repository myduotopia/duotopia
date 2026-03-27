# Blog 發文指南

> 本文件供 AI agent 或人工編輯參考，說明如何透過 Duotopia Blog 後台發布文章。

## 存取方式

- **後台 URL**: `{domain}/admin/blog`
- **登入帳號**: 需使用 `is_admin = true` 的教師帳號（目前為 `contact@duotopia.co`）
- **API prefix**: `/api/blog`（需 Bearer token）

## 發文流程

1. 登入教師帳號 → 進入 `/admin/blog`
2. 點擊「新增文章」或前往 `/admin/blog/new`
3. 填寫各欄位（見下方說明）
4. 儲存為草稿 → 確認內容無誤後點擊「發布」
5. 發布後可在 `/blog` 公開頁面看到文章

## 欄位說明

### 必填欄位

| 欄位 | 說明 | 範例 |
|------|------|------|
| **標題** (title) | 文章主標題，會顯示在列表卡片、文章頁面、SEO title | `AI 如何改變英語教學：5 個實用策略` |
| **內容** (content) | Markdown 格式的文章本文，支援標題、列表、表格、圖片、程式碼區塊 | 見下方 Markdown 語法 |

### 選填欄位

| 欄位 | 說明 | 建議 |
|------|------|------|
| **Slug** | URL 路徑，自動從標題產生，可手動修改。會經過 sanitize 處理 | `ai-transform-english-teaching` |
| **摘要** (summary) | 列表頁卡片上的短文描述，建議 50-150 字 | 簡述文章重點，吸引點擊 |
| **分類** (categories) | 可多選，需先在後台建立分類 | `教學技巧`、`AI 教育`、`產品更新` |
| **封面圖片** (cover_image_url) | 列表頁卡片和文章頂部的大圖，支援上傳或貼 URL | 建議尺寸 1200x630px |

### SEO 欄位（可展開區塊）

| 欄位 | 說明 | 若留空的 fallback |
|------|------|------------------|
| **Meta Title** | 搜尋引擎顯示的標題，建議 60 字元內 | 使用文章標題 |
| **Meta Description** | 搜尋引擎顯示的描述，建議 120-160 字元 | 使用摘要 |
| **OG Image URL** | 社群分享時的預覽圖 | 使用封面圖片 |

## 分類管理

分類透過 API 管理：

```bash
# 建立分類
POST /api/blog/categories
Body: { "name": "教學技巧" }
# slug 會自動產生為 "教學技巧" → "教學技巧"

# 列出所有分類
GET /api/blog/categories

# 刪除分類
DELETE /api/blog/categories/{id}
```

目前後台 UI 尚無獨立的分類管理頁面，分類顯示在文章編輯器中供勾選。

## Markdown 語法

編輯器支援完整 Markdown + GFM (GitHub Flavored Markdown)：

```markdown
## 二級標題
### 三級標題

**粗體** 和 *斜體*

- 無序列表
1. 有序列表

> 引用區塊

| 表頭 | 表頭 |
|------|------|
| 儲存格 | 儲存格 |

![圖片說明](https://example.com/image.jpg)

[連結文字](https://example.com)

`行內程式碼`
```

### 嵌入媒體

#### YouTube

在 Markdown 內容中直接貼入 iframe HTML 即可渲染（已啟用 `rehype-raw`）：

```html
<iframe width="560" height="315" src="https://www.youtube.com/embed/VIDEO_ID" frameborder="0" allowfullscreen></iframe>
```

**步驟：**
1. 在 YouTube 影片頁面點擊「分享」→「嵌入」
2. 複製 `<iframe ...></iframe>` 程式碼
3. 直接貼到 Markdown 編輯器中
4. 預覽區會即時顯示影片播放器

**注意事項：**
- 使用 `https://www.youtube.com/embed/VIDEO_ID` 格式（不是 `watch?v=`）
- 建議加 `width="100%"` 以適應行動裝置：
  ```html
  <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden">
    <iframe style="position:absolute;top:0;left:0;width:100%;height:100%" src="https://www.youtube.com/embed/VIDEO_ID" frameborder="0" allowfullscreen></iframe>
  </div>
  ```

#### Instagram / Threads

> 尚未支援。追蹤 issue: [#537](https://github.com/myduotopia/duotopia/issues/537)

### 圖片上傳

- 在編輯器中可以**拖放圖片**，會自動上傳到 GCS 並插入 Markdown 圖片語法
- 也可以透過封面圖片欄位的「上傳」按鈕上傳
- 檔案大小限制：5MB
- 支援格式：JPG、PNG、GIF、WebP

## 發布狀態

| 狀態 | 說明 |
|------|------|
| **草稿** (draft) | 僅在後台可見，公開頁面不會顯示 |
| **已發布** (published) | 公開頁面可見，會出現在 sitemap 和 SEO 索引中 |

- 「儲存草稿」：儲存但不發布
- 「發布」：儲存並設為已發布
- 「取消發布」：將已發布文章改回草稿

## SEO 機制

文章發布後會自動獲得以下 SEO 支援：

1. **HTML meta tags**：透過 react-helmet-async 動態設定 title、description、canonical URL
2. **Open Graph tags**：og:title、og:description、og:image、og:type
3. **JSON-LD 結構化資料**：Article schema，含 headline、datePublished、author
4. **Sitemap**：`/api/public/blog/sitemap.xml` 自動包含所有已發布文章
5. **Prerender endpoint**：`/api/public/blog/{slug}/meta` 為社群平台爬蟲提供 OG meta HTML

## AI Agent 發文 Checklist

AI agent 在發布文章前應確認：

- [ ] 標題簡潔有力，含目標關鍵字
- [ ] Slug 是英文、有意義的 URL 路徑
- [ ] 摘要 50-150 字，概括文章重點
- [ ] 內容使用正確的 Markdown 格式
- [ ] 設定至少一個分類
- [ ] 上傳封面圖片（1200x630px 為最佳）
- [ ] 填寫 Meta Title（60 字元內）和 Meta Description（120-160 字元）
- [ ] OG Image 已設定（若不同於封面）
- [ ] 先儲存為草稿，確認預覽無誤後再發布
