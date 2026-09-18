# Issue #1073 — Vertex AI SDK 遷移評估

> 狀態：評估完成，待決定實作排程
> 調查日期：2026-09-18
> 範圍：後端 AI 呼叫層。不含 Azure Speech（發音評估、TTS）。

---

## 結論先講

原本這個 issue 問的是「舊 SDK 要不要換」。調查後發現**真正的急迫項目不是 SDK，是模型退役**：

| 項目 | 期限 | 若不處理的後果 |
|---|---|---|
| **`gemini-2.5-flash` / `gemini-2.5-pro` 退役** | **2026-10-20**（約 1 個月） | Production AI 功能全掛 |
| **Imagen `imagen-3.0-generate-002`** | 官方建議 2026-06-30 前換掉（**已逾期 80 天**） | 生圖隨時可能停止服務 |
| `vertexai.generative_models` 移除 | 官方公告 2026-06-24（**已逾期，但套件仍有此模組**） | 升級套件才會壞；不升級暫時無事 |

SDK 遷移本身**不緊急**（我們版本鎖在 1.95.0，不動就不會壞），但因為模型一定要換，而換模型的程式碼會動到同一批檔案，兩件事一起做比較划算。

**建議：把這個 issue 拆成兩個，模型汰換優先。**

---

## 目前的使用範圍

`google-cloud-aiplatform` 在後端**只**用於生成式 AI，沒有其他用途（`google-cloud-storage`、`-bigquery`、`-tasks`、`-logging` 都是獨立套件）。

### 共用封裝

| 檔案 | 內容 |
|---|---|
| `backend/services/vertex_ai.py` | `vertexai.init`、`GenerativeModel`、`GenerationConfig`、`generate_content_async`、thinking budget hack |

### 直接 import `vertexai` 的服務

| 檔案 | 用到的 API |
|---|---|
| `backend/services/scenario_grading_ai.py` | `Part.from_uri`（GCS 錄音）、`Part.from_data`、JSON mime、`usage_metadata` |
| `backend/services/scenario_dialogue_ai.py` | `GenerativeModel`、`Part.from_data`、`usage_metadata` |
| `backend/services/magic_paste_service.py` | `Part.from_data`（檔案 bytes）、JSON、thinking hack、`usage_metadata` |
| `backend/services/scenario_dialogue_image.py` | `vertexai.vision_models.ImageGenerationModel`、`response.images[0]._image_bytes` |

### 透過共用封裝呼叫

`translation.py`、`analysis_service.py`、`billing_analysis_service.py`、`release_announcement_service.py`、`routers/cron.py`

全部都是**單次請求／單次回應**：沒有 function calling、沒有多輪對話狀態、沒有 agent 流程。

### 測試

11 個測試檔會受影響，其中 5 處直接 patch SDK 內部路徑，必須跟著改：

```
patch("vertexai.generative_models.GenerativeModel")   ×4
patch("vertexai.generative_models.Part")              ×1
```

---

## 調查中發現的既有問題（與遷移無關，但要一起處理）

### 1. `USE_VERTEX_AI` 已經是死開關

`backend/core/config.py:119` 仍定義，deploy workflow 仍在傳（`deploy-backend.yml:397-401`、`deploy-per-issue.yml:125`），但**沒有任何非測試程式碼讀取它**。

commit `3a37b342`（#947 / PR #980）移除 OpenAI fallback 分支後，所有 AI 呼叫都無條件走 Vertex。

連帶影響：
- `docs/VERTEX_AI_MIGRATION.md:41` 仍寫「設為 false 即可回退到 OpenAI」→ **文件過期，該敘述已不成立**
- `openai==1.57.4` 仍在 `requirements.txt`，但非測試程式碼沒有任何 `import openai` → 可移除
- **遷移的 rollback 不能依賴這個 flag**，只能 revert + 重新部署

### 2. thinking budget 的 hack 是靜默失敗

`backend/services/vertex_ai.py:96-107` 直接寫入內部 protobuf `config._raw_generation_config.thinking_config`，外層 `except Exception` 只印 warning。

若 SDK 結構改變，thinking 會默默地繼續開著——正是 issue #874 的症狀（延遲 3~13 倍、JSON 被 thinking 吃掉 token 而截斷）。

現有測試 `tests/test_vertex_disable_thinking.py` 只驗證 `disable_thinking=True` 這個參數有往下傳，**沒有驗證 budget 真的套用到 request 上**。遷移時應補上真正的斷言。

### 3. 成本統計低估（非遷移造成）

`candidates_token_count` **不包含 thinking token**，後者在 `thoughts_token_count`，而 Google 對 thinking token 是收費的。
兩個 SDK 都是同一組 proto 欄位，所以我們現在就已經低估，尤其 `scenario_grading_ai`（批改路徑**沒有**關 thinking）。

建議遷移時順手把 `thoughts_token_count` 加進 `output_tokens`。

---

## SDK API 對照（`vertexai` → `google-genai`）

官方遷移指南：<https://docs.cloud.google.com/vertex-ai/generative-ai/docs/deprecations/genai-vertexai-sdk>

| 項目 | 舊（`vertexai`） | 新（`google-genai`） |
|---|---|---|
| 安裝 | `google-cloud-aiplatform` | `google-genai` |
| Import | `from vertexai.generative_models import ...` | `from google import genai` / `from google.genai import types` |
| 初始化 | `vertexai.init(project=, location=)` | `genai.Client(vertexai=True, project=, location=)` |
| 工作單位 | **model 物件**持有 model 名稱 + system_instruction | **client 無狀態**，model 名稱改成每次呼叫的參數 |
| Config | `GenerationConfig(...)` 以 `generation_config=` 傳入 | `types.GenerateContentConfig(...)` 以 `config=` 傳入，並**吸收** system_instruction / safety_settings / thinking_config |
| Async | `model.generate_content_async(...)` | `client.aio.models.generate_content(...)` |
| Parts | `Part.from_uri(uri, mime_type=)` | `types.Part.from_uri(file_uri=, mime_type=)` — **keyword-only** |
| Parts (bytes) | `Part.from_data(data=, mime_type=)` | `types.Part.from_bytes(data=, mime_type=)` — **改名** |
| Imagen | `ImageGenerationModel.from_pretrained(id).generate_images(...)` | `client.models.generate_images(model=id, prompt=, config=GenerateImagesConfig(...))` |
| Thinking | 無公開 API（我們 hack protobuf） | `types.ThinkingConfig(thinking_budget=0)` — **公開 API** |
| Response | `.text` 在被擋時**拋 ValueError** | `.text` 在被擋時**回傳 `None`** |

### 不會變的部分

- `usage_metadata.prompt_token_count` / `.candidates_token_count` → 欄位名稱相同，**成本估算程式碼不用改**
- `response_mime_type="application/json"` → 名稱相同
- Cloud Run ADC 認證 → 不變，`genai.Client` 一樣走 `google.auth.default()`，service account 照舊

---

## 會壞掉的地方（依風險排序）

### 硬錯誤（遷移當下就會炸，好抓）

1. `scenario_grading_ai.py:344` — `Part.from_uri(gcs_uri, mime_type=...)` 用**位置參數**傳 URI，新 SDK 是 keyword-only 的 `file_uri=` → `TypeError`
2. `Part.from_data` → `Part.from_bytes`，3 個呼叫點（`scenario_grading_ai.py:352`、`magic_paste_service.py:235`、`scenario_dialogue_ai.py:553`）
3. `scenario_dialogue_image.py:162` — `safety_filter_level="block_some"` 在新 SDK 是**無效值**，新 enum 只有 `BLOCK_LOW_AND_ABOVE` / `BLOCK_MEDIUM_AND_ABOVE` / `BLOCK_ONLY_HIGH` / `BLOCK_NONE`
4. 4 個測試檔在 `sys.modules` mock `vertexai` → 全部要改指向 `google.genai`

### 靜默行為改變（測試不會抓到，會在 production 才爆）

5. **`response.text` 在安全性攔截時回傳 `None` 而非拋錯**。我們的 `vertex_ai.py:244` 做 `response.text.strip()`，其他地方做 `parse_json(response.text)` → 原本是清楚的 `ValueError`，遷移後會變成 `AttributeError: 'NoneType' object has no attribute 'strip'`。**必須主動加 None 檢查**。

### 遷移順便可以拿到的簡化

6. 刪掉 `_set_thinking_budget` 與 `_raw_generation_config` protobuf hack
7. 刪掉 `_get_model` 的 model 快取（新 SDK 沒有 model 物件），改成快取單一 `genai.Client`
8. `_image_bytes` 私有屬性 → 公開的 `.image.image_bytes`，`scenario_dialogue_image.py:130` 的防禦性 `hasattr` 檢查可以改成正常判斷
9. `requirements.txt` 移除 `google-cloud-aiplatform`；`google-genai` 依賴樹輕很多（不再拉 protobuf/grpc）
10. 新 SDK 有 `response_schema`，可以砍掉我們自己寫的 markdown fence 剝除與括號掃描救援邏輯（`vertex_ai.generate_json`、`magic_paste_service._parse_json`）

---

## 模型汰換（真正的急件）

官方 lifecycle 頁：<https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions>

| 目前使用 | 退役日 | 位置 |
|---|---|---|
| `gemini-2.5-flash` | 2026-10-20 | `vertex_ai.py:27`、`scenario_grading_ai.py:50` |
| `gemini-2.5-pro` | 2026-10-20 | `vertex_ai.py:28` |
| `imagen-3.0-generate-002` | 已列入停用清單（官方建議 2026-06-30 前更換） | `scenario_dialogue_image.py:44` |

### ⚠️ 與 thinking 的交互作用

替代的 Gemini 3.x 系列改用 `thinking_level`，而且**傳 `thinking_budget` 會直接報錯**。
所以 `disable_thinking=True` 不能照字面搬過去，必須依目標模型分兩種寫法。這會影響 `translation.py` 的全部 8 個呼叫點。

另外要注意：**Gemini 2.5 Pro 本來就不能關 thinking**，所以現在 `disable_thinking=True` 搭 `model_type="pro"` 已經是 no-op。

---

## 建議的執行計畫

### Phase 1：模型汰換（急，建議 2026-10-20 前完成）

1. 決定替代模型（需先確認 `asia-east1` / `us-central1` 可用性與定價）
2. 把 model ID 抽成設定，不要散在各檔案 hardcode
3. 處理 `thinking_budget` → `thinking_level` 的分支
4. Imagen 改用建議的替代 endpoint
5. 在 develop 環境實測各 AI 功能（翻譯、例句、干擾選項、批改、魔術貼上、生圖）

### Phase 2：SDK 遷移（可在 Phase 1 之後或合併進行）

1. `requirements.txt`：加 `google-genai`，移除 `google-cloud-aiplatform`、`openai`
2. 先改 `vertex_ai.py` 共用封裝（對外介面 `generate_text` / `generate_json` 保持不變 → 上游 6 個服務不用動）
3. 再改 4 個直接 import `vertexai` 的服務
4. 補 `response.text is None` 的處理
5. 改 11 個測試檔的 mock
6. 順手：`thoughts_token_count` 納入成本、刪掉 protobuf hack 與 model 快取

### Phase 3：清理

1. 移除死掉的 `USE_VERTEX_AI`（含 config、2 個 deploy workflow）
2. 更新或標記 `docs/VERTEX_AI_MIGRATION.md` 為過期

### Rollback 策略

**不能靠 `USE_VERTEX_AI`**（已失效）。可行方式：
- 走正常 PR → develop → staging → prod 流程，每階段實測
- 真出事就 revert commit 重新部署
- 若要更保險，可在遷移期間臨時加一個新的 SDK 切換 flag，但這等於要維護兩套程式碼路徑，成本不低——建議改成「在 develop 充分驗證」而非加 flag

---

## 不在範圍內：Google ADK

ADK（Agent Development Kit）是 agent 編排框架：多 agent、工具呼叫、session、評估。它硬性依賴 `google-genai`（`google-adk` 2.9.1 把 `google-genai>=2.19,<3` 列為核心依賴）。

**我們用不到。** 所有呼叫點都是單次無狀態的請求（翻一個詞、改一份錄音、抽一個檔案、畫一張圖），導入 ADK 只會多一層框架與 session/runner 抽象，換不到任何好處。ADK 官方文件也說呼叫 Gemini 不需要它。

**未來什麼情況再評估**：出現模型需要自行決定流程的功能，例如 AI 助教要多輪對話、中途自己去查學生成績與作業再決定怎麼回應。屆時應**只針對該功能**開獨立服務，不動現有這些呼叫。

---

## 尚未查證、實作前必須確認的項目

以下無法從文件確定，需要實際打 API 或等官方澄清：

1. **`imagen-3.0-generate-002` 目前在 `asia-east1` 是否仍能服務**——文件已列為停用，但需要實際呼叫才知道。官方頁面自相矛盾：Caution 表格把所有 `imagen-4.0-*` 也列為停用，但同頁的 Python 範例仍在用 `imagen-4.0-generate-001`。
2. **`block_some` 的對應值**——舊 SDK 同時接受 `block_most/some/few/fewest` 與 `block_low_and_above/...` 兩套詞彙，新 SDK 只留後者。依舊 SDK docstring 的強弱排序推斷 `block_some` ≈ `BLOCK_MEDIUM_AND_ABOVE`，但**找不到 Google 官方的對照表**，實作時需實測確認。
3. **Gemini 2.5 確切退役日**——官方自己的頁面不一致：release notes 寫 10/16，lifecycle 頁寫 10/20。且 Google 表示 Gemini 3 GA 後才會鎖定最終日期並提前 6 個月通知。**以最早的 10/16 為準來排程比較安全。**
4. **`pydantic` 版本相容性**——`google-genai` 要求 `pydantic>=2.12.5`，需比對我們目前 pin 的 pydantic / FastAPI 版本。
5. **替代模型的定價**——各服務的 `estimate_cost` 都寫死了單價，換模型後要一併更新。

## 參考資料

- 官方遷移指南：<https://docs.cloud.google.com/vertex-ai/generative-ai/docs/deprecations/genai-vertexai-sdk>
- 模型生命週期：<https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions>
- Thinking 設定：<https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thinking>
- Imagen 生圖與停用端點表：<https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images>
- Google ADK：<https://adk.dev/>
