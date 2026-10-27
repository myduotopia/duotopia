/**
 * 情境對話的錄音長度上限（Issue #1140）。
 *
 * **伺服器才是真相**：`backend/services/audio_upload.recording_limits_for_mode()`
 * 對 `scenario_dialogue` 回 120 秒，超過就回 400。這裡是畫面要先知道才擋得住 ——
 * 不擋的話學生錄完才被拒，而且只會看到一句看不懂的錯誤（夥伴 staging 回報的正是
 * 這個：超過 30 秒 → 上傳 400 → 前端顯示「AI 建議暫時拿不到」）。
 *
 * 兩邊的數字若有一天不一致，使用者看到的是伺服器那個上限的錯誤訊息（#1140 的 1a
 * 讓那句錯誤會講真話），不會變成無聲的失敗。
 */
export const SCENARIO_MAX_RECORDING_SECONDS = 120;
