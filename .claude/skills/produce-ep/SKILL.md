---
name: produce-ep
description: >
  量產一集 Duotopia 教學影片（EP3-EP7）：讀分鏡腳本 → 發音/用語 lint → Playwright 錄影 →
  切片 → TTS → 渲染 → QA 自驗證 loop（最多 3 輪）→ 交審。用法：/produce-ep 3。
  自動觸發：「做 EP3」「量產第 N 集」「produce ep N」。
---

# /produce-ep <N> — 教學影片量產（含 AI 自驗證 loop）

你是這一集的導演＋剪輯＋QA。視覺基調已定案，**禁區：`video/src/components/`、
`video/src/motion.ts`、`video/src/theme.ts` 一律不碰**；要動元件 = 停下問使用者。
詳細規範讀 `docs/social-media/TUTORIAL_EP_SOP.md`（必讀，本 skill 只是流程骨架）。

## Stage 0 — 開工前置

1. 讀 `docs/design/teacher-tutorial-video-script.md` 的 EP<N> 章節與「事實校正清單」
2. 列場景表：id / kind / page / step / 焦點元件 / 是否 sameScreen / 旁白草稿
   - **素材連續性原則（唯一規則）**：同一段連續錄影內的相鄰場景一律 `sameScreen: true`
     （含換頁——頁面切換的畫面變化本來就在錄影裡）；只有素材真正斷裂才轉場：
     字卡（slide）、兩段錄影之間（slide）、靜態截圖插入/回錄影（fade）
   - 全景說明場景（介紹整頁）壓 `camera=FULL`，避免被自動 zoom 進小按鈕（見 SOP）
   - **運鏡文法 v3**（SOP 有全文，元件/管線自動保證，場景表只需配合）：
     點擊場景不用手動填 highlights（管線自動用點擊目標框＋先框後點時序＋點擊後 0.8s 框退場）；
     **禁止**把 toast 當 highlights/spotlight/camera 焦點；
     錄影節奏：每景進場先 `d.hold(1.5)`；一景只有「關鍵點擊」用 `d.move_click`（可 `before=0.9`），
     同景的連鎖點選（選選項、切分頁、關對話框）一律用 `d.quick_click`——兩次點擊間不能讓觀眾乾等
3. 寫 `tts_tutorial_ep<N>.py`（複製 ep2 版改）：TEXT_SUB 從 `pron_dict.TEXT_SUB_BASE` import；
   clip 合入段改用 `manifest_v3.merge_clip()`（自動套預點擊標記，見該檔 docstring）
4. 跑 `lint_narration.py --ep <N>`：
   - 用語層 FAIL → 自己改旁白/字幕成台灣用語，重跑
   - 發音層 WARN → `gen_pron_candidates.py --from-lint ...` 生成試聽 →
     **停下等使用者定案**（人工閘門 1）→ 寫回 `pron_dict.py` → 重跑 lint 到全綠
5. 檢查資料前置（EP5/EP6 需先跑 autoplay_students.py；EP3 需 EP2 複製的教材存在）

## Stage 1 — 錄影

1. 寫 `record_tutorial_ep<N>.py`（複製 ep2 版改；Director 用法與鐵則見 SOP）
2. `MUTATE=False` 跑一次驗 selector → 修到過 → `MUTATE=True` 正式錄
3. 逐條核對 SOP「常見坑」表（心跳、sync flash、幾何挑按鈕、timeout=3000、冪等 reset）

## Stage 2 — 組裝

```bash
PYTHONUTF8=1 backend/venv/Scripts/python.exe docs/social-media/scripts/split_clips.py --ep ep<N> [--src ...]
FISH_KEY=<向使用者要> PYTHONUTF8=1 backend/venv/Scripts/python.exe docs/social-media/scripts/tts_tutorial_ep<N>.py
# Root.tsx 的 EPISODES 表加一行（唯一允許動的 .tsx）
cd video && npx tsc --noEmit && npx remotion render EP<N> out/ep<N>_v1.mp4 --concurrency=4
```
渲染必須掛**看門狗**：每 90 秒量渲染程序 CPU 增量（chrome-headless-shell＋node 總 CPU 秒數），
180 秒持平＝當機 → 殺掉 process tree、`--concurrency=4` 重跑。
不能只量目標 mp4 大小（Remotion 平行編碼先寫 temp chunk，中段目標檔不成長屬正常）。

成片後**必產影片縮圖**（Root.tsx 對每集自動註冊 `<EP>-thumb` composition，免手工設計）：
```bash
npx remotion still EP<N>-thumb out/ep<N>_thumb.png
```
縮圖自動取 manifest 的集數字卡＋第一個 shot 場景截圖；想換畫面在 manifest 頂層加 `thumbShot`。

## Stage 3 — QA 驗收 loop（最多 3 輪；stills 優先，整片渲染只做最後一次）

兩個關鍵紀律：
- **QA 在「整片渲染之前」跑**：用 `--stills` 直接從 composition 批渲檢查點（幾分鐘），
  不要每輪渲染整片（15-20 分鐘）——整片渲染留到 stills 全過後只做一次
- **驗收者是獨立 QA subagent，不是你自己**：你做的你不驗（自我確認偏誤）。
  PASS 判定權在 QA subagent，你不得自行改判

每輪：
1. `PYTHONUTF8=1 backend/venv/Scripts/python.exe docs/social-media/scripts/qa_frames.py --ep <N> --stills`
   → 靜態檢查須全綠；檢查點幀在 `video/out/qa_ep<N>/`
2. **用 Agent tool 派獨立 QA subagent 驗收**（subagent_type: general-purpose，`model: "sonnet"` 即可）。
   給它的 prompt 只含：抽幀資料夾絕對路徑＋report.json＋下方 rubric 全文＋分鏡腳本「事實校正清單」
   章節——**不給任何製作過程脈絡**。指令明確：「你是驗收者，任務是找出問題、不是確認沒問題；
   逐幀檢視，回報格式：場景id／問題描述／嚴重度（blocker|minor）／建議修法；全部通過才回 PASS。」
3. QA subagent 的 rubric：
   - [ ] 連續性：`*_pre-boundary` vs `*_post-boundary` 構圖幾乎相同（報告的 boundary diff < 12）；
         `*_cam-settled` 焦點已到新區塊且完整在畫面內
   - [ ] 字幕不壓關鍵 UI（按鈕/toast/輸入框）
   - [ ] highlight/spotlight 框住的就是旁白講的元件（對 freeze 狀態）
   - [ ] HUD：chip=當前頁、badge 編號/前綴正確、stepDone 打勾在該步驟最後一景
   - [ ] mask 蓋住真實帳號（正式站素材必查）
   - [ ] 事實紅線（分鏡腳本清單）＋ 跨場景資料一致（日期/名稱）
   - [ ] 字幕/字卡無大陸用語（lint 擋過一次，目視再確認）
   - [ ] **v3-先框後點**：每次點擊前橘框已在目標元件上、目標接近畫面中心
         （qa 的 center/mark-timing 驗算全綠 ＋ `_pre-click` 幀目視複核）
   - [ ] **v3-框不殘留**：點擊後橘框退場，不得殘留到變化後的畫面
         （qa 的 mark-off 驗算全綠 ＋ `_post-click` 幀目視複核）
   - [ ] **節奏**：連鎖點選之間無「乾等」感（兩次點擊間隔 > 2.5s 且畫面無變化 = 檢討是否該用 quick_click 重錄）
   - [ ] **v3-全局過渡**：深 zoom 焦點切換有經過全幅（`_zoomout-mid` 幀）
   - [ ] **v3-toast 禁令**：無任何橘框/spotlight 指向 toast（qa 的 REVIEW 全數目視排除）
4. QA 回報 blocker → 修（manifest 欄位/座標/旁白/重錄局部）→ 重跑受影響場景的 stills →
   派 QA subagent **只複驗變更場景**（後續輪不整集重驗）→ 下一輪
5. **3 輪未全過 → 停下**，整理殘留問題與已試做法回報使用者（人工閘門 2）

stills 全過後才做**唯一一次整片渲染**：
6. render（掛看門狗）→ `qa_frames.py --ep <N>`（mp4 模式）快速抽查 6-8 張關鍵幀與 stills 一致
   → `npx remotion still EP<N>-thumb out/ep<N>_thumb.png` → 進 Stage 4

## Stage 4 — 交審

回報（一律完整絕對路徑）：成片路徑、**縮圖路徑（out/ep<N>_thumb.png）**、時長場景數、
QA 報告摘要（全過項目/殘留風險）、燒掉的 AI 點數。
**使用者核准後才做下一集。**
