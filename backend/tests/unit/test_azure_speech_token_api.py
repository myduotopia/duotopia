"""
Comprehensive tests for Azure Speech Token API
Testing token issuance, caching, authentication, and rate limiting
"""
import pytest
from unittest.mock import patch, AsyncMock
from datetime import datetime, timedelta


class TestAzureSpeechTokenAPI:
    """Test Azure Speech Token API endpoints"""

    def test_get_token_requires_authentication(self, test_client):
        """Test 1: 未登录用户无法获取 token"""
        response = test_client.post("/api/azure-speech/token")
        assert response.status_code == 401

    @patch("services.azure_speech_token.AzureSpeechTokenService.get_token")
    def test_get_token_success_teacher(
        self, mock_get_token, test_client, demo_teacher, auth_headers_teacher
    ):
        """Test 2: 登录教师成功获取 token"""
        mock_get_token.return_value = {
            "token": "fake-token-12345",
            "region": "eastasia",
            "expires_in": 600,
        }

        response = test_client.post(
            "/api/azure-speech/token", headers=auth_headers_teacher
        )

        assert response.status_code == 200
        data = response.json()
        assert data["token"] == "fake-token-12345"
        assert data["region"] == "eastasia"
        assert data["expires_in"] == 600

    @patch("services.azure_speech_token.AzureSpeechTokenService.get_token")
    def test_get_token_success_student(
        self, mock_get_token, test_client, demo_student, auth_headers_student
    ):
        """Test 3: 登录学生成功获取 token"""
        mock_get_token.return_value = {
            "token": "student-token-67890",
            "region": "eastasia",
            "expires_in": 600,
        }

        response = test_client.post(
            "/api/azure-speech/token", headers=auth_headers_student
        )

        assert response.status_code == 200
        data = response.json()
        assert data["token"] == "student-token-67890"
        assert data["region"] == "eastasia"

    @patch("services.azure_speech_token.AzureSpeechTokenService.get_token")
    def test_token_service_called_once(
        self, mock_get_token, test_client, auth_headers_teacher
    ):
        """Test 4: 验证服务层被正确调用"""
        mock_get_token.return_value = {
            "token": "test-token",
            "region": "eastasia",
            "expires_in": 600,
        }

        test_client.post("/api/azure-speech/token", headers=auth_headers_teacher)

        # 验证服务层被调用
        assert mock_get_token.call_count == 1

    @patch("services.azure_speech_token.AzureSpeechTokenService.get_token")
    def test_azure_service_not_configured(
        self, mock_get_token, test_client, auth_headers_teacher
    ):
        """Test 5: Azure 服务未配置时返回 500"""
        mock_get_token.side_effect = ValueError("AZURE_SPEECH_KEY not configured")

        response = test_client.post(
            "/api/azure-speech/token", headers=auth_headers_teacher
        )

        assert response.status_code == 500
        assert "not configured" in response.json()["detail"]

    @patch("services.azure_speech_token.AzureSpeechTokenService.get_token")
    def test_azure_service_network_error(
        self, mock_get_token, test_client, auth_headers_teacher
    ):
        """Test 6: Azure 网络错误时返回 500"""
        mock_get_token.side_effect = Exception("Network timeout")

        response = test_client.post(
            "/api/azure-speech/token", headers=auth_headers_teacher
        )

        assert response.status_code == 500
        assert "Failed to get speech token" in response.json()["detail"]


class TestAzureSpeechTokenService:
    """Test Azure Speech Token Service (unit tests)"""

    @pytest.mark.asyncio
    @patch("services.azure_speech_token.get_http_client")
    async def test_token_first_call_fetches_from_azure(self, mock_get_client):
        """Test 7: 第一次调用从 Azure 获取 token"""
        from services.azure_speech_token import AzureSpeechTokenService

        # Mock Azure response
        mock_response = AsyncMock()
        mock_response.text = "new-azure-token-12345"
        mock_response.raise_for_status = AsyncMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_get_client.return_value = mock_client

        # Mock environment variable
        with patch.dict("os.environ", {"AZURE_SPEECH_KEY": "test-key"}):
            service = AzureSpeechTokenService()
            result = await service.get_token()

            assert result["token"] == "new-azure-token-12345"
            assert result["region"] == "eastasia"
            assert result["expires_in"] == 600

            # 验证调用了 Azure issueToken endpoint
            mock_client.post.assert_called_once()

    @pytest.mark.asyncio
    @patch("services.azure_speech_token.get_http_client")
    async def test_token_caching_within_8_minutes(self, mock_get_client):
        """Test 8: 8 分钟内重用缓存的 token"""
        from services.azure_speech_token import AzureSpeechTokenService

        mock_response = AsyncMock()
        mock_response.text = "cached-token"
        mock_response.raise_for_status = AsyncMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_get_client.return_value = mock_client

        with patch.dict("os.environ", {"AZURE_SPEECH_KEY": "test-key"}):
            service = AzureSpeechTokenService()

            # 第一次调用
            result1 = await service.get_token()
            token1 = result1["token"]

            # 第二次调用（应该使用 cache）
            result2 = await service.get_token()
            token2 = result2["token"]

            assert token1 == token2
            # Azure issueToken 只应该被调用一次
            assert mock_client.post.call_count == 1

    @pytest.mark.asyncio
    @patch("services.azure_speech_token.get_http_client")
    async def test_fresh_token_reports_full_expires_in(self, mock_get_client):
        """Issue #136: 全新发放的 token 仍回传 expires_in == 600"""
        from services.azure_speech_token import AzureSpeechTokenService

        mock_response = AsyncMock()
        mock_response.text = "fresh-token"
        mock_response.raise_for_status = AsyncMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_get_client.return_value = mock_client

        with patch.dict("os.environ", {"AZURE_SPEECH_KEY": "test-key"}):
            service = AzureSpeechTokenService()
            result = await service.get_token()

            assert result["expires_in"] == 600

    @pytest.mark.asyncio
    @patch("services.azure_speech_token.get_http_client")
    async def test_cached_token_reports_real_remaining_life(self, mock_get_client):
        """Issue #136: cache 命中时回传「实际剩余秒数」而非固定 600

        避免前端依固定值 over-cache 一个即将到期的 token 而产生 401。
        """
        from services.azure_speech_token import AzureSpeechTokenService

        mock_response = AsyncMock()
        mock_response.text = "cached-token"
        mock_response.raise_for_status = AsyncMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_get_client.return_value = mock_client

        with patch.dict("os.environ", {"AZURE_SPEECH_KEY": "test-key"}):
            service = AzureSpeechTokenService()

            # 第一次发放 → expires_in == 600
            first = await service.get_token()
            assert first["expires_in"] == 600

            # 模拟时间已过去约 7.5 分钟（仍在 8 分钟 cache 窗口内，
            # 真实剩余约 2.5 分钟），手动把到期时间往前挪
            service._token_expires_at = datetime.now() + timedelta(seconds=150)

            cached = await service.get_token()

            # 仍是同一个 cached token，且未再呼叫 Azure
            assert cached["token"] == "cached-token"
            assert mock_client.post.call_count == 1

            # 关键断言：回传的 expires_in 反映真实剩余寿命，远小于 600
            assert cached["expires_in"] < 600
            assert 140 <= cached["expires_in"] <= 150

    @pytest.mark.asyncio
    @patch("services.azure_speech_token.get_http_client")
    async def test_token_refresh_after_expiration(self, mock_get_client):
        """Test 9: Token 过期后重新获取"""
        from services.azure_speech_token import AzureSpeechTokenService

        call_count = 0

        async def mock_post(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            mock_response = AsyncMock()
            mock_response.text = f"token-{call_count}"
            mock_response.raise_for_status = AsyncMock()
            return mock_response

        mock_client = AsyncMock()
        mock_client.post = mock_post
        mock_get_client.return_value = mock_client

        with patch.dict("os.environ", {"AZURE_SPEECH_KEY": "test-key"}):
            service = AzureSpeechTokenService()

            # 第一次获取
            result1 = await service.get_token()
            assert result1["token"] == "token-1"

            # 模拟时间过去 9 分钟（超过 8 分钟 cache，接近 10 分钟过期）
            service._token_expires_at = datetime.now() - timedelta(minutes=1)

            # 第二次获取应该重新生成
            result2 = await service.get_token()
            assert result2["token"] == "token-2"

            # 验证调用了两次
            assert call_count == 2

    @pytest.mark.asyncio
    async def test_token_service_requires_azure_key(self):
        """Test 10: 缺少 AZURE_SPEECH_KEY 时抛出错误"""
        from services.azure_speech_token import AzureSpeechTokenService

        with patch.dict("os.environ", {}, clear=True):
            with pytest.raises(ValueError, match="AZURE_SPEECH_KEY"):
                AzureSpeechTokenService()

    @pytest.mark.asyncio
    @patch("services.azure_speech_token.get_http_client")
    async def test_token_azure_http_error(self, mock_get_client):
        """Test 11: Azure HTTP 错误处理"""
        from services.azure_speech_token import AzureSpeechTokenService
        import httpx

        mock_response = AsyncMock()
        mock_response.status_code = 401
        mock_response.text = "Unauthorized"

        mock_client = AsyncMock()
        mock_client.post.side_effect = httpx.HTTPStatusError(
            "401 Unauthorized", request=AsyncMock(), response=mock_response
        )
        mock_get_client.return_value = mock_client

        with patch.dict("os.environ", {"AZURE_SPEECH_KEY": "invalid-key"}):
            service = AzureSpeechTokenService()

            with pytest.raises(Exception):
                await service.get_token()

    @pytest.mark.asyncio
    @patch("services.azure_speech_token.get_http_client")
    async def test_token_network_timeout(self, mock_get_client):
        """Test 12: 网络超时处理"""
        from services.azure_speech_token import AzureSpeechTokenService

        mock_client = AsyncMock()
        mock_client.post.side_effect = Exception("Timeout")
        mock_get_client.return_value = mock_client

        with patch.dict("os.environ", {"AZURE_SPEECH_KEY": "test-key"}):
            service = AzureSpeechTokenService()

            with pytest.raises(Exception, match="Timeout"):
                await service.get_token()


class TestTokenRateLimiting:
    """Test rate limiting for token endpoint"""

    @pytest.mark.skip(reason="Rate limiting requires time.sleep which is slow")
    @patch("services.azure_speech_token.AzureSpeechTokenService.get_token")
    def test_rate_limiting_blocks_excessive_requests(
        self, mock_get_token, test_client, auth_headers_teacher
    ):
        """Test 13: Rate limiting 阻止过多请求 (10次/分钟)"""
        mock_get_token.return_value = {
            "token": "test-token",
            "region": "eastasia",
            "expires_in": 600,
        }

        # 发送 11 次请求（limit 是 10次/分钟）
        responses = []
        for _ in range(11):
            responses.append(
                test_client.post(
                    "/api/azure-speech/token", headers=auth_headers_teacher
                )
            )

        # 前 10 次应该成功
        success_count = sum(1 for r in responses if r.status_code == 200)
        rate_limited_count = sum(1 for r in responses if r.status_code == 429)

        assert success_count == 10
        assert rate_limited_count == 1
