"""錄音長度／檔案大小上限依練習模式（Issue #1140，夥伴 staging 回報）。

原本是寫死的「30 秒 / 2MB」，那是為「朗讀一個單字或一個例句」訂的。情境對話是開放式
口說，學生要講完整的回答 —— 夥伴在 staging 錄超過 30 秒，上傳端回 400，而前端把它
顯示成「AI 建議暫時拿不到」（訊息在說謊，所以很難查）。

這支守兩件事：
1. **只放寬情境對話**，其他模式照舊（為一個模式改掉全站行為與成本是不對的）。
2. 檔案大小要跟著放寬 —— 不然只是把 400 從「太長」換成「太大」。
"""
from services.audio_upload import (
    MAX_DURATION_SECONDS_DEFAULT,
    MAX_FILE_SIZE_DEFAULT,
    recording_limits_for_mode,
)


class TestRecordingLimits:
    def test_scenario_dialogue_gets_two_minutes(self):
        seconds, _ = recording_limits_for_mode("scenario_dialogue")
        assert seconds == 120

    def test_other_modes_keep_the_old_limit(self):
        for mode in ("reading", "word_reading", "rearrangement", "word_cloze"):
            seconds, size = recording_limits_for_mode(mode)
            assert seconds == MAX_DURATION_SECONDS_DEFAULT, mode
            assert size == MAX_FILE_SIZE_DEFAULT, mode

    def test_unknown_and_empty_fall_back_to_the_default(self):
        """未知模式不該丟錯 —— 這條路徑是學生在交作業。"""
        for mode in ("no_such_mode", "", None):
            assert recording_limits_for_mode(mode) == (
                MAX_DURATION_SECONDS_DEFAULT,
                MAX_FILE_SIZE_DEFAULT,
            )

    def test_file_size_is_raised_along_with_the_duration(self):
        """Safari 的 AAC 128kbps 錄 2 分鐘約 1.9MB，貼著舊的 2MB 上限。

        只放寬秒數不放寬大小，等於把 400 從「太長」換成「太大」—— 對學生來說一樣是
        送不出去。
        """
        seconds, size = recording_limits_for_mode("scenario_dialogue")
        # 以 128kbps 估：120s × 128kbps ÷ 8 ≈ 1.92MB，上限要明顯高於它
        assert size > 2 * 1024 * 1024
        assert size >= seconds * 128 * 1024 / 8
