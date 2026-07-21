"""
Tests for files router (Issue #958)

驗證已移除的 soundhelix 佔位端點不再存在，避免正式環境把使用者
307 導向第三方音檔網站（教育部徵求案對外連線清單合規需求）。
"""


class TestSoundhelixEndpointsRemoved:
    """Issue #958: soundhelix 佔位端點已移除"""

    def test_content_audio_endpoint_removed(self, test_client):
        """GET /api/files/audio/{content_id}/{item_index} 應已移除（404）"""
        response = test_client.get("/api/files/audio/1/0")
        assert response.status_code == 404
        # 不得再重定向到第三方 soundhelix
        assert "soundhelix" not in response.headers.get("location", "").lower()

    def test_test_audio_endpoint_removed(self, test_client):
        """GET /api/files/test-audio 應已移除（404）"""
        response = test_client.get("/api/files/test-audio")
        assert response.status_code == 404

    def test_recordings_endpoint_still_returns_404(self, test_client):
        """既有 /api/files/recordings/{filename} 行為維持不變（404）"""
        response = test_client.get("/api/files/recordings/nonexistent.webm")
        assert response.status_code == 404
